/** Authoritative fixed-step engine, adapted from the existing frontend engine.
 * Controller hooks are synchronous; provider work runs outside physics steps. */
import {
  DEFAULT_CONFIDENCE_POLICY,
  DEFAULT_GEOMETRY,
  OPPOSITE_APPROACH,
  PROTOCOL_VERSION,
  type AgentStatus,
  type Approach,
  type ConfidencePolicy,
  type ControllerMode,
  type ControllerStatus,
  type GreenPhase,
  type InjectedEvent,
  type JevStatus,
  type MetricsSample,
  type MovementGroup,
  type ProviderStatus,
  type ScenarioId,
  type ScenarioParameters,
  type ServerEvent,
  type SessionConfig,
  type SessionStatus,
  type SignalPhase,
  type SignalState,
  type SignalTiming,
  type SimulationSnapshot,
  type TrafficMetrics,
  type VehicleState,
  type VehicleType,
} from "@intersection/shared";
import { createStream, type RandomStream } from "./rng.js";


export const STEP_MS = 100;



export type ServerEventType = ServerEvent["type"];
export type EventOf<T extends ServerEventType> = Extract<ServerEvent, { type: T }>;
export type EventSource = ServerEvent["source"];
export type EventProvenance = ServerEvent["provenance"];
export type FaultKind = Extract<InjectedEvent, { type: "provider_fault" }>["fault"];
export type PhaseChangeReason = EventOf<"signal.phase_changed">["payload"]["reason"];
export type ControlAction = "start" | "pause" | "resume" | "reset" | "set_speed";

export const APPROACHES: readonly Approach[] = ["north", "south", "east", "west"];
export const GROUP_OF: Record<Approach, MovementGroup> = { north: "NS", south: "NS", east: "EW", west: "EW" };
export const GREEN_OF: Record<MovementGroup, GreenPhase> = { NS: "NS_GREEN", EW: "EW_GREEN" };
export const OTHER_GREEN: Record<GreenPhase, GreenPhase> = { NS_GREEN: "EW_GREEN", EW_GREEN: "NS_GREEN" };
const GROUP_APPROACHES: Record<MovementGroup, readonly Approach[]> = { NS: ["north", "south"], EW: ["east", "west"] };

// Geometry from the contract: distances along each lane's travel axis, negative before the centre.
const STOP_LINE = -DEFAULT_GEOMETRY.stopLineDistanceM;
const SPAWN_CENTER = -DEFAULT_GEOMETRY.spawnDistanceM;
const BOX = DEFAULT_GEOMETRY.occupancyHalfExtentM;
const DESPAWN = DEFAULT_GEOMETRY.despawnDistanceM;
const LANE_OFFSET = DEFAULT_GEOMETRY.laneCenterOffsetM;
const MIN_GAP = 2;
const STOPPED_MPS = 0.5;

// Intelligent Driver Model parameters (simplified, shared by every vehicle).
const HEADWAY_S = 1.3;
const COMFORT_DECEL = 2.2;
const LINE_STANDSTILL = 0.4;


const VEHICLE_SPECS: Record<VehicleType, { length: number; desired: number; accel: number }> = {
  car: { length: 4.5, desired: 13.9, accel: 1.6 },
  van: { length: 5.4, desired: 13.0, accel: 1.3 },
  bus_truck: { length: 11, desired: 11.1, accel: 0.9 },
  ambulance: { length: 6, desired: 15.3, accel: 2 },
  police: { length: 4.9, desired: 15.3, accel: 2.2 },
};

const HEADING: Record<Approach, number> = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 };

/** World position of a lane coordinate `d` (vehicle centre along its travel axis). */
export function lanePosition(approach: Approach, d: number): { x: number; z: number } {
  switch (approach) {
    case "north": return { x: -LANE_OFFSET, z: d };
    case "south": return { x: LANE_OFFSET, z: -d };
    case "east": return { x: -d, z: -LANE_OFFSET };
    case "west": return { x: d, z: LANE_OFFSET };
  }
}

interface SimVehicle {
  id: string;
  demandId: string;
  type: VehicleType;
  approach: Approach;
  d: number;
  v: number;
  a: number;
  length: number;
  desired: number;
  maxAccel: number;
  requestedAt: number;
  spawnedAt: number;
  waitingMs: number;
  signalDelayMs: number;
  emergency: boolean;
  /** Decided to proceed on yellow (could not stop comfortably). */
  committed: boolean;
}

interface DemandRequest {
  demandId: string;
  approach: Approach;
  type: VehicleType;
  emergency: boolean;
  requestedAt: number;
  /** Desired-speed variation, drawn with the demand so spawn timing never shifts the stream. */
  variation: number;
}

interface ScheduledInjection {
  scheduleId: string;
  atSimMs: number;
  event: InjectedEvent;
  order: number;
}

interface ActiveEffect {
  scheduleId: string;
  event: InjectedEvent;
  endsAt: number;
}

interface SignalRuntime {
  phase: SignalPhase;
  startedAt: number;
  nextGreen: GreenPhase;
  activeCommandId: string | null;
  clearanceBlocked: boolean;
  /** Why the current green is ending (carried through yellow and all-red). */
  exitReason: PhaseChangeReason;
  plannedEnd: { at: number; commandId: string; reason: PhaseChangeReason } | null;
  pendingSwitch: { at: number; commandId: string; reason: PhaseChangeReason; target: GreenPhase } | null;
}

export class SimulationError extends Error {
  readonly code: "INVALID_STATE" | "STALE_GENERATION" | "VALIDATION_ERROR";
  constructor(code: SimulationError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface Coordination {
  update(): void;
  requestCycle(reason: string): void;
  onGreenStarted(): void;
  discardOutstanding(reason: string): void;
  reset(): void;
  agentStatuses(): [AgentStatus, AgentStatus];
  providerStatuses(): [ProviderStatus, ProviderStatus];
  jevStatus(): JevStatus;
}

export interface SimulationOptions {
  demoMode?: "mock" | "live";
  jevMode?: "mock" | "live";
  sessionId: string;
  mode: ControllerMode;
  scenarioId: ScenarioId;
  parameters: ScenarioParameters;
  signalTiming: SignalTiming;
  seed: number;
  speedMultiplier?: number;
  confidencePolicy?: ConfidencePolicy;
  /** Wall clock in epoch ms. Defaults to Date.now; tests and headless runs pass a virtual clock. */
  wallClock?: () => number;
  /** Keep events for the history endpoint. Headless comparison runs disable this. */
  retainEvents?: number;
}

interface CompletedStats {
  count: number;
  waitingSum: number;
  travelSum: number;
  emergencyCount: number;
  emergencyDelaySum: number;
}

interface LatencyStats {
  count: number;
  sum: number;
  max: number;
}

export interface EventMeta {
  source: EventSource;
  provenance: EventProvenance;
  summary: string;
  correlationId?: string;
}

export class Simulation {
  readonly sessionId: string;
  readonly mode: ControllerMode;
  readonly scenarioId: ScenarioId;
  readonly parameters: ScenarioParameters;
  readonly timing: SignalTiming;
  readonly seed: number;
  readonly confidencePolicy: ConfidencePolicy;
  readonly wallClock: () => number;

  private retainEvents: number;
  private speed: number;
  private sessionStatus: SessionStatus = "ready";
  private gen = 0;
  private version = 0;
  private sequence = 0;
  private time = 0;
  /** How far the step being run lies before the wall clock's "now" (see advance). */
  private wallLag = 0;
  private outbox: ServerEvent[] = [];
  private history: ServerEvent[] = [];
  private samples: MetricsSample[] = [];

  // World state, rebuilt on reset.
  private lanes!: Record<Approach, SimVehicle[]>;
  private backlog!: Record<Approach, DemandRequest[]>;
  private signal!: SignalRuntime;
  private scheduled!: ScheduledInjection[];
  private effects!: ActiveEffect[];
  private timeZeroApplied = false;
  private checkpointCounter = 0;
  private vehicleCounter = 0;
  private demandCounter = 0;
  private scheduleCounter = 0;
  private injectionOrder = 0;
  private requested = 0;
  private spawned = 0;
  private completed!: CompletedStats;
  private maxQueue = 0;
  private signalChanges = 0;
  private servedAt!: Record<MovementGroup, number | null>;
  private greenTotal!: Record<MovementGroup, number>;
  private demandRng!: RandomStream;
  private mixRng!: RandomStream;
  private hazardRng!: RandomStream;
  latencyRng!: RandomStream;

  // Coordination counters live here so metrics stay a single source.
  geminiRequests = 0;
  geminiLatency: LatencyStats = { count: 0, sum: 0, max: 0 };
  jevLatency: LatencyStats = { count: 0, sum: 0, max: 0 };
  jevConfidence = { high: 0, medium: 0, low: 0 };
  deadlineMisses = 0;
  safetyRejections = 0;
  controllerStatus!: ControllerStatus;

  adaptive: Coordination | null = null;
  decisionStateVersion = 0;
  snapshotSequence = 0;
  demoMode: "mock" | "live";
  jevMode: "mock" | "live";
  private queueIntegral = 0;
  private maxDelay = 0;
  private executedCommand: string | null = null;
  invalidateDecisions() { this.decisionStateVersion++; }
  /** The only public signal-plan mutation. Validation and commit are synchronous. */
  requestGreen(target: GreenPhase, durationMs: number, commandId: string, fallback = false) {
    const s = this.signal;
    if (this.status !== "running" || !["NS_GREEN", "EW_GREEN"].includes(target) ||
        !Number.isFinite(durationMs) || durationMs % STEP_MS !== 0 ||
        durationMs < this.timing.minimumGreenMs || durationMs > this.timing.maximumGreenMs ||
        !s.phase.endsWith("_GREEN") || s.pendingSwitch || this.executedCommand === commandId) return null;
    const latest = s.startedAt + this.timing.maximumGreenMs;
    const earliest = s.startedAt + this.timing.minimumGreenMs;
    const at = target === s.phase ? Math.min(latest, Math.max(earliest, this.time + durationMs)) : Math.max(earliest, this.time + STEP_MS);
    if (at > latest) return null;
    const reason = fallback ? "fallback" : "adaptive_command";
    if (target === s.phase) this.extendGreen(at, commandId, reason);
    else this.scheduleSwitch(target, at, commandId, reason);
    this.executedCommand = commandId;
    this.invalidateDecisions();
    this.bumpVersion();
    return at;
  }

  constructor(options: SimulationOptions) {
    this.demoMode = options.demoMode ?? "mock";
    this.jevMode = options.jevMode ?? this.demoMode;
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    this.scenarioId = options.scenarioId;
    this.parameters = structuredClone(options.parameters);
    this.timing = structuredClone(options.signalTiming);
    this.seed = options.seed;
    this.speed = options.speedMultiplier ?? 1;
    this.confidencePolicy = options.confidencePolicy ?? DEFAULT_CONFIDENCE_POLICY;
    this.wallClock = options.wallClock ?? Date.now;
    this.retainEvents = options.retainEvents ?? 2000;
    this.buildWorld();
  }

  // ---------------------------------------------------------------------------
  // Public accessors

  get status(): SessionStatus { return this.sessionStatus; }
  get generation(): number { return this.gen; }
  get simulationTimeMs(): number { return this.time; }
  get speedMultiplier(): number { return this.speed; }
  get stateVersion(): number { return this.version; }
  get latestSequence(): number { return this.sequence; }
  get durationMs(): number { return this.parameters.durationMs; }

  /** Take every event emitted since the last drain, in sequence order. */
  drain(): ServerEvent[] {
    const events = this.outbox;
    this.outbox = [];
    return events;
  }

  /** Checkpoint snapshot: reuses the latest issued sequence, not stored in history. */
  snapshot(): SimulationSnapshot {
    return this.buildSnapshot(this.sequence);
  }

  /** Broadcast snapshot: allocates a new sequence like any other domain event. */
  broadcastSnapshot(): EventOf<"simulation.snapshot"> {
    this.snapshotSequence++;
    const sequence = this.sequence + 1;
    const snapshot = this.buildSnapshot(sequence);
    return this.emit("simulation.snapshot", snapshot, {
      source: "simulation",
      provenance: "simulation",
      summary: `Snapshot at ${formatClock(this.time)}`,
    }) as EventOf<"simulation.snapshot">;
  }

  checkpointEvent(): EventOf<"simulation.snapshot"> {
    const snapshot = this.snapshot();
    this.checkpointCounter += 1;
    return {
      ...this.envelope("simulation", "simulation", "Checkpoint", `checkpoint-${this.gen}-${this.sequence}`,
        `${this.sessionId}-c${this.sequence}-${this.checkpointCounter}`),
      type: "simulation.snapshot",
      payload: snapshot,
    };
  }

  eventHistory(afterSequence: number | undefined, limit: number) {
    const oldest = this.history[0]?.sequence ?? 0;
    const start = afterSequence ?? oldest - 1;
    const events = this.history.filter(e => e.sequence > start).slice(0, limit);
    return {
      events,
      oldestAvailableSequence: this.history.length ? oldest : 0,
      latestSequence: this.history.length ? this.sequence : 0,
      expired: afterSequence !== undefined && this.history.length > 0 && afterSequence < oldest - 1,
      hasMore: this.history.filter(e => e.sequence > start).length > events.length,
    };
  }

  metricsSamples(): MetricsSample[] {
    return this.samples;
  }

  currentMetrics(): TrafficMetrics {
    return this.buildMetrics();
  }

  // ---------------------------------------------------------------------------
  // Controls

  control(action: ControlAction, generation: number, speedMultiplier?: number): void {
    if (generation !== this.gen) throw new SimulationError("STALE_GENERATION", `Generation ${generation} is not current (${this.gen}).`);
    switch (action) {
      case "start":
        if (this.sessionStatus !== "ready") throw new SimulationError("INVALID_STATE", `Cannot start a ${this.sessionStatus} session.`);
        this.setStatus("running");
        this.applyTimeZeroEvents();
        break;
      case "pause":
        if (this.sessionStatus !== "running") throw new SimulationError("INVALID_STATE", `Cannot pause a ${this.sessionStatus} session.`);
        this.invalidateDecisions();
        this.adaptive?.discardOutstanding("paused");
        this.setStatus("paused");
        break;
      case "resume":
        if (this.sessionStatus !== "paused") throw new SimulationError("INVALID_STATE", `Cannot resume a ${this.sessionStatus} session.`);
        this.setStatus("running");
        break;
      case "reset":
        this.adaptive?.discardOutstanding("reset");
        this.invalidateDecisions();
        this.gen += 1;
        this.version += 1;
        this.buildWorld();
        this.sessionStatus = "ready";
        // The first event of a new generation is a full snapshot.
        this.broadcastSnapshot();
        break;
      case "set_speed": {
        if (this.sessionStatus === "completed") throw new SimulationError("INVALID_STATE", "Cannot change the speed of a completed session.");
        if (speedMultiplier === undefined || !(speedMultiplier >= 0.1 && speedMultiplier <= 20))
          throw new SimulationError("VALIDATION_ERROR", "Speed must be between 0.1 and 20.");
        this.speed = speedMultiplier;
        this.version += 1;
        this.emitStatus(`Speed set to ${speedMultiplier}×`);
        break;
      }
    }
  }

  inject(event: InjectedEvent, generation: number, atSimMs?: number): { scheduleId: string; scheduledAtSimMs: number; sequence: number } {
    if (generation !== this.gen) throw new SimulationError("STALE_GENERATION", `Generation ${generation} is not current (${this.gen}).`);
    if (this.sessionStatus === "completed") throw new SimulationError("INVALID_STATE", "The session has completed.");
    if (event.type === "provider_fault" && event.fault === "low_confidence" && event.provider !== "jev")
      throw new SimulationError("VALIDATION_ERROR", "Low-confidence faults apply to JEV only.");
    const nextStep = this.sessionStatus === "ready" ? 0 : this.time + STEP_MS;
    const at = atSimMs ?? nextStep;
    if (at % STEP_MS !== 0 || at < nextStep || at >= this.parameters.durationMs)
      throw new SimulationError("VALIDATION_ERROR", "Injection time must be a future 100 ms step before the scenario ends.");
    if (this.scheduled.length >= 200) throw new SimulationError("INVALID_STATE", "Scheduled event capacity reached.");
    this.bumpVersion();
    this.invalidateDecisions();
    const scheduleId = `g${this.gen}-inject-${++this.scheduleCounter}`;
    this.scheduled.push({ scheduleId, atSimMs: at, event, order: 1000 + this.injectionOrder++ });
    this.emit("simulation.scenario_event", { scheduleId, event, status: "scheduled" }, {
      source: "api",
      provenance: "simulation",
      summary: `Scheduled ${describeInjection(event)} at ${formatClock(at)}`,
      correlationId: scheduleId,
    });
    // A time-zero injection in a running session still applies at the next step.
    return { scheduleId, scheduledAtSimMs: at, sequence: this.sequence };
  }

  /** Run up to `steps` physics steps while the session is running. */
  /**
   * Runs physics steps. A real-time driver catching up after a slow frame runs several steps at one
   * instant; `stepWallMs` dates each of them back to the real moment it stands for, so simulated model
   * latency (wall clock) ends at the matching simulation time instead of at the first step of the batch.
   */
  advance(steps: number, stepWallMs = 0): void {
    for (let i = 0; i < steps && this.sessionStatus === "running"; i++) {
      this.wallLag = (steps - 1 - i) * stepWallMs;
      this.step();
    }
    this.wallLag = 0;
  }

  // ---------------------------------------------------------------------------
  // Host interface used by the adaptive controller

  now(): number { return this.time; }
  wallNow(): number { return this.wallClock() - this.wallLag; }
  bumpVersion(): number { return ++this.version; }

  signalView() {
    const s = this.signal;
    const state = this.signalState();
    return {
      phase: s.phase,
      startedAt: s.startedAt,
      earliestEnd: state.earliestEndAtSimMs,
      latestEnd: state.latestEndAtSimMs,
      nextGreen: s.nextGreen,
      plannedEnd: s.plannedEnd?.at ?? null,
      pendingSwitch: s.pendingSwitch ? { target: s.pendingSwitch.target, at: s.pendingSwitch.at, commandId: s.pendingSwitch.commandId } : null,
    };
  }

  observe(group: MovementGroup) {
    let queue = 0;
    let approaching = 0;
    let maxWaitMs = 0;
    let emergencyCount = 0;
    let nearestEta: number | null = null;
    for (const approach of GROUP_APPROACHES[group]) {
      for (const veh of this.lanes[approach]) {
        const front = veh.d + veh.length / 2;
        if (front > STOP_LINE) continue;
        if (veh.v < STOPPED_MPS) queue++;
        else if (STOP_LINE - front < 55) approaching++;
        maxWaitMs = Math.max(maxWaitMs, veh.waitingMs + (veh.spawnedAt - veh.requestedAt));
        if (veh.emergency) {
          emergencyCount++;
          const eta = veh.v >= STOPPED_MPS ? (STOP_LINE - front) / veh.v : null;
          if (eta !== null) nearestEta = nearestEta === null ? eta : Math.min(nearestEta, eta);
        }
      }
      for (const req of this.backlog[approach]) {
        maxWaitMs = Math.max(maxWaitMs, this.time - req.requestedAt);
        if (req.emergency) emergencyCount++;
      }
    }
    const rate = GROUP_APPROACHES[group].reduce((sum, a) => sum + this.effectiveRate(a), 0);
    return {
      queueLength: queue,
      approaching,
      maxWaitSeconds: round1(maxWaitMs / 1000),
      emergencyCount,
      nearestEmergencyEtaSeconds: nearestEta === null ? null : round1(nearestEta),
      estimatedArrivalRateVehPerHour: Math.round(rate),
      lastServedAtSimMs: this.signal.phase === GREEN_OF[group] ? this.time : this.servedAt[group],
      totalGreenMs: this.greenTotal[group] + (this.signal.phase === GREEN_OF[group] ? this.time - this.signal.startedAt : 0),
    };
  }

  activeFault(provider: "gemini" | "jev"): FaultKind | null {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i].event;
      if (e.type === "provider_fault" && e.provider === provider) return e.fault;
    }
    return null;
  }

  /** Schedule a switch to `target` (yellow onset at `at`). Called by the safety gate only. */
  private scheduleSwitch(target: GreenPhase, at: number, commandId: string, reason: PhaseChangeReason) {
    this.signal.pendingSwitch = { target, at, commandId, reason };
    this.signal.plannedEnd = null;
  }

  /** Keep the current green until `at` (yellow onset), bounded by maximum green. */
  private extendGreen(at: number, commandId: string, reason: PhaseChangeReason) {
    this.signal.plannedEnd = { at, commandId, reason };
  }

  setActiveController(activeController: ControllerStatus["activeController"], reason: string | null) {
    if (this.controllerStatus.activeController === activeController && this.controllerStatus.reason === reason) return;
    this.controllerStatus = { requestedMode: this.mode, activeController, reason };
    this.emitStatus(activeController === "deterministic_fallback" ? `Deterministic fallback in control: ${reason ?? "fallback"}` : "Adaptive controller in control");
  }

  emit<T extends ServerEventType>(type: T, payload: EventOf<T>["payload"], meta: EventMeta): EventOf<T> {
    this.sequence += 1;
    const event = {
      ...this.envelope(meta.source, meta.provenance, meta.summary, meta.correlationId ?? `${type}-${this.gen}-${this.sequence}`),
      type,
      payload,
    } as unknown as EventOf<T>;
    this.outbox.push(event);
    if (this.outbox.length > 4000) this.outbox.shift();
    if (this.retainEvents > 0) {
      this.history.push(event);
      if (this.history.length > this.retainEvents) this.history.splice(0, this.history.length - this.retainEvents);
    }
    return event;
  }

  // ---------------------------------------------------------------------------
  // Simulation step

  private step() {
    const T = this.time + STEP_MS;
    this.time = T;
    this.version += 1;

    this.expireEffects(T);
    this.applyScheduled(T);
    this.hazards(T);
    this.arrivals(T);
    this.updateSignal(T);
    for (const approach of APPROACHES) this.moveLane(approach, T);
    this.despawn(T);
    for (const approach of APPROACHES) this.spawn(approach, T);
    this.trackQueue();
    this.adaptive?.update();

    if (T % 1000 === 0 && T < this.parameters.durationMs) this.emitMetrics();
    if (T >= this.parameters.durationMs) {
      this.adaptive?.discardOutstanding("completed");
      this.setStatus("completed");
      this.emitMetrics(true);
    }
  }

  private applyTimeZeroEvents() {
    if (this.timeZeroApplied) return;
    this.timeZeroApplied = true;
    this.applyScheduled(0);
  }

  private expireEffects(T: number) {
    const remaining: ActiveEffect[] = [];
    for (const effect of this.effects) {
      if (effect.endsAt <= T) {
        this.emit("simulation.scenario_event", { scheduleId: effect.scheduleId, event: effect.event, status: "expired" }, {
          source: "simulation", provenance: "simulation",
          summary: `${capitalize(describeInjection(effect.event))} ended`, correlationId: effect.scheduleId,
        });
      } else remaining.push(effect);
    }
    this.effects = remaining;
  }

  private applyScheduled(T: number) {
    const due = this.scheduled.filter(s => s.atSimMs <= T).sort((a, b) => a.atSimMs - b.atSimMs || a.order - b.order);
    if (!due.length) return;
    this.scheduled = this.scheduled.filter(s => s.atSimMs > T);
    for (const item of due) this.applyInjection(item, T);
  }

  private applyInjection(item: ScheduledInjection, T: number) {
    const { event } = item;
    switch (event.type) {
      case "emergency":
        this.request(event.approach, event.vehicleType, event.responding, T, true);
        break;
      case "demand_surge":
      case "temporary_congestion":
      case "provider_fault":
        this.effects.push({ scheduleId: item.scheduleId, event, endsAt: T + event.durationMs });
        break;
      case "decision_boundary":
        // The fixed-time controller ignores decision triggers by contract.
        this.adaptive?.requestCycle("decision_boundary");
        break;
    }
    this.emit("simulation.scenario_event", { scheduleId: item.scheduleId, event, status: "applied" }, {
      source: "simulation", provenance: "simulation",
      summary: `${capitalize(describeInjection(event))}${event.type === "decision_boundary" && this.mode === "traditional" ? " (ignored by the fixed-time controller)" : ""}`,
      correlationId: item.scheduleId,
    });
  }

  private hazards(T: number) {
    const random = this.parameters.randomEvents;
    if (!random.enabled || T % random.intervalMs !== 0) return;
    const surge = this.hazardRng.next() < random.surgeProbability;
    const congestion = this.hazardRng.next() < random.congestionProbability;
    if (surge) {
      const approach = APPROACHES[Math.floor(this.hazardRng.next() * 4)];
      this.applyInjection({ scheduleId: `g${this.gen}-hazard-${++this.scheduleCounter}`, atSimMs: T, order: 0, event: { type: "demand_surge", approach, multiplier: 3, durationMs: 120_000 } }, T);
    }
    if (congestion) {
      const approach = APPROACHES[Math.floor(this.hazardRng.next() * 4)];
      this.applyInjection({ scheduleId: `g${this.gen}-hazard-${++this.scheduleCounter}`, atSimMs: T, order: 0, event: { type: "temporary_congestion", approach, speedFactor: 0.5, durationMs: 120_000 } }, T);
    }
  }

  private effectiveRate(approach: Approach): number {
    let rate = this.parameters.arrivalRatesVehPerHour[approach];
    for (const { event } of this.effects) {
      if (event.type === "demand_surge" && event.approach === approach) rate *= event.multiplier;
    }
    return Math.min(rate, 7200);
  }

  private speedFactor(approach: Approach): number {
    let factor = 1;
    for (const { event } of this.effects) {
      if (event.type === "temporary_congestion" && event.approach === approach) factor = Math.min(factor, event.speedFactor);
    }
    return factor;
  }

  private arrivals(T: number) {
    // One draw per approach per step regardless of spawn success or controller.
    for (const approach of APPROACHES) {
      const count = this.demandRng.poisson((this.effectiveRate(approach) / 3600) * (STEP_MS / 1000));
      for (let i = 0; i < count; i++) {
        const { type, responding } = this.drawVehicleType();
        this.request(approach, type, responding, T, false);
      }
    }
  }

  private drawVehicleType(): { type: VehicleType; responding: boolean } {
    const mix = this.parameters.vehicleMix;
    const u = this.mixRng.next();
    const respondingDraw = this.mixRng.next();
    let acc = 0;
    for (const type of ["car", "van", "bus_truck", "ambulance", "police"] as const) {
      acc += mix[type];
      if (u < acc) {
        const responding = type === "ambulance" || (type === "police" && respondingDraw < this.parameters.policeRespondingProbability);
        return { type, responding };
      }
    }
    return { type: "car", responding: false };
  }

  private request(approach: Approach, type: VehicleType, responding: boolean, T: number, priority: boolean) {
    const emergency = responding && (type === "ambulance" || type === "police");
    const variation = priority ? 1 : 0.92 + this.mixRng.next() * 0.16;
    const req: DemandRequest = { demandId: `g${this.gen}-demand-${++this.demandCounter}`, approach, type, emergency, requestedAt: T, variation };
    this.requested++;
    // Emergency vehicles move to the head of the upstream backlog.
    if (priority && emergency) this.backlog[approach].unshift(req);
    else this.backlog[approach].push(req);
    this.emit("simulation.vehicle_event", { kind: "requested", demandId: req.demandId, approach, emergency }, {
      source: "simulation", provenance: "simulation",
      summary: `${emergency ? `Responding ${typeLabel(type)}` : capitalize(typeLabel(type))} requested on the ${approach} approach`,
    });
  }

  private spawn(approach: Approach, T: number) {
    const queue = this.backlog[approach];
    if (!queue.length) return;
    const req = queue[0];
    const spec = VEHICLE_SPECS[req.type];
    const lane = this.lanes[approach];
    const last = lane[lane.length - 1];
    const front = SPAWN_CENTER + spec.length / 2;
    let speed = spec.desired * this.speedFactor(approach);
    if (last) {
      const gap = last.d - last.length / 2 - front;
      if (gap < MIN_GAP) return; // Blocked entrance: demand stays upstream.
      speed = Math.min(spec.desired * this.speedFactor(approach), last.v + Math.max(0, gap - MIN_GAP) * 0.4);
    }
    queue.shift();
    const veh: SimVehicle = {
      id: `g${this.gen}-vehicle-${++this.vehicleCounter}`,
      demandId: req.demandId,
      type: req.type,
      approach,
      d: SPAWN_CENTER,
      v: Math.max(0, speed),
      a: 0,
      length: spec.length,
      desired: round1(spec.desired * (req.emergency ? 1 : req.variation)),
      maxAccel: spec.accel,
      requestedAt: req.requestedAt,
      spawnedAt: T,
      waitingMs: 0,
      signalDelayMs: 0,
      emergency: req.emergency,
      committed: false,
    };
    lane.push(veh);
    this.spawned++;
    this.emit("simulation.vehicle_event", { kind: "spawned", demandId: req.demandId, vehicle: this.vehicleState(veh) }, {
      source: "simulation", provenance: "simulation",
      summary: `${capitalize(typeLabel(veh.type))} entered from the ${approach}`,
    });
    if (veh.emergency) {
      const eta = veh.v >= STOPPED_MPS ? round1((STOP_LINE - (veh.d + veh.length / 2)) / veh.v) : null;
      this.emit("simulation.vehicle_event", { kind: "emergency_detected", demandId: req.demandId, vehicleId: veh.id, approach, stopLineEtaSeconds: eta }, {
        source: "simulation", provenance: "simulation",
        summary: `Responding ${typeLabel(veh.type)} detected on the ${approach} approach${eta === null ? "" : `, ${eta.toFixed(0)} s from the stop line`}`,
      });
      this.adaptive?.requestCycle("emergency");
    }
  }

  private moveLane(approach: Approach, T: number) {
    const lane = this.lanes[approach];
    const group = GROUP_OF[approach];
    const phase = this.signal.phase;
    const green = phase === GREEN_OF[group];

    const factor = this.speedFactor(approach);
    const dt = STEP_MS / 1000;

    for (let i = 0; i < lane.length; i++) {
      const veh = lane[i];
      const leader = i > 0 ? lane[i - 1] : null;
      const front = veh.d + veh.length / 2;
      const beforeLine = front <= STOP_LINE;
      if (!beforeLine || veh.v < STOPPED_MPS) veh.committed = false;

      let gap = Number.POSITIVE_INFINITY;
      let leadSpeed = 0;
      let standstill = MIN_GAP;
      if (leader) {
        gap = leader.d - leader.length / 2 - front;
        leadSpeed = leader.v;
      }

      const stopping = beforeLine && !green;
      if (stopping) {
        const toLine = Math.max(STOP_LINE - front, 0.01);
        if (toLine < gap) { gap = toLine; leadSpeed = 0; standstill = LINE_STANDSTILL; }
      }

      const v0 = Math.max(veh.desired * factor, 0.5);
      const free = 1 - (veh.v / v0) ** 4;
      let interaction = 0;
      if (Number.isFinite(gap)) {
        const dv = veh.v - leadSpeed;
        const desiredGap = standstill + Math.max(0, veh.v * HEADWAY_S + (veh.v * dv) / (2 * Math.sqrt(veh.maxAccel * COMFORT_DECEL)));
        interaction = (desiredGap / Math.max(gap, 0.01)) ** 2;
      }
      const accel = clamp(veh.maxAccel * (free - interaction), -9, veh.maxAccel);

      let v = Math.max(0, veh.v + accel * dt);
      let d = veh.d + ((veh.v + v) / 2) * dt;
      if (leader) {
        const maxCenter = leader.d - leader.length / 2 - MIN_GAP - veh.length / 2;
        if (d > maxCenter) {
          d = Math.max(veh.d, maxCenter);
          v = Math.min(v, leader.v);
        }
      }
      if (stopping) {
        const maxCenter = STOP_LINE - 0.05 - veh.length / 2;
        if (d > maxCenter) {
          d = Math.max(veh.d, maxCenter);
          v = 0;
        }
      }

      veh.a = clamp((v - veh.v) / dt, -12, 4);
      veh.v = clamp(v, 0, 60);
      veh.d = d;

      if (veh.v < STOPPED_MPS && T > veh.spawnedAt) {
        veh.waitingMs += STEP_MS;
        if (veh.d + veh.length / 2 <= STOP_LINE && !green) veh.signalDelayMs += STEP_MS;
      }
    }
  }

  private despawn(T: number) {
    for (const approach of APPROACHES) {
      const lane = this.lanes[approach];
      while (lane.length && lane[0].d - lane[0].length / 2 > DESPAWN) {
        const veh = lane.shift()!;
        const waiting = veh.spawnedAt - veh.requestedAt + veh.waitingMs;
        const travel = T - veh.requestedAt;
        this.maxDelay = Math.max(this.maxDelay, waiting);
        this.completed.count++;
        this.completed.waitingSum += waiting;
        this.completed.travelSum += travel;
        if (veh.emergency) {
          this.completed.emergencyCount++;
          this.completed.emergencyDelaySum += veh.signalDelayMs;
        }
        this.emit("simulation.vehicle_event", {
          kind: "completed", demandId: veh.demandId, vehicleId: veh.id, travelTimeMs: travel,
          waitingTimeMs: waiting, signalDelayMs: veh.signalDelayMs, emergency: veh.emergency,
        }, {
          source: "simulation", provenance: "simulation",
          summary: `${capitalize(typeLabel(veh.type))} from the ${veh.approach} cleared the intersection after ${(travel / 1000).toFixed(0)} s`,
        });
      }
    }
  }

  private trackQueue() {
    let waiting = 0;
    for (const approach of APPROACHES) {
      for (const veh of this.lanes[approach]) if (veh.v < STOPPED_MPS && veh.d + veh.length / 2 <= STOP_LINE) waiting++;
    }
    this.maxQueue = Math.max(this.maxQueue, waiting);
    this.queueIntegral += waiting * STEP_MS;
  }

  private boxOccupied(): boolean {
    return this.occupiedIds().length > 0;
  }

  private occupiedIds(): string[] {
    const ids: string[] = [];
    for (const approach of APPROACHES) {
      for (const veh of this.lanes[approach]) {
        if (veh.d + veh.length / 2 > -BOX && veh.d - veh.length / 2 < BOX) ids.push(veh.id);
      }
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // Signal controller

  private updateSignal(T: number) {
    const s = this.signal;
    const t = this.timing;
    if (s.phase === "NS_GREEN" || s.phase === "EW_GREEN") {
      const latestEnd = s.startedAt + t.maximumGreenMs;
      if (this.mode === "traditional") {
        if (T >= s.startedAt + t.fixedGreenMs) this.endGreen(T, "fixed_cycle", null);
        return;
      }
      if (T >= latestEnd) this.endGreen(T, "maximum_green", null);
      else if (s.pendingSwitch && T >= s.pendingSwitch.at) this.endGreen(T, s.pendingSwitch.reason, s.pendingSwitch.commandId);
      else if (s.plannedEnd && T >= s.plannedEnd.at) this.endGreen(T, s.plannedEnd.reason, s.plannedEnd.commandId);
      else if (!s.pendingSwitch && !s.plannedEnd && T >= s.startedAt + t.fixedGreenMs) this.endGreen(T, "fallback", null);
      return;
    }
    if (s.phase === "NS_YELLOW" || s.phase === "EW_YELLOW") {
      if (T >= s.startedAt + t.yellowMs) this.changePhase("ALL_RED", T, s.exitReason);
      return;
    }
    if (T >= s.startedAt + t.allRedMs) {
      if (this.boxOccupied()) s.clearanceBlocked = true;
      else this.changePhase(s.nextGreen, T, "clearance_complete");
    }
  }

  private endGreen(T: number, reason: PhaseChangeReason, commandId: string | null) {
    const s = this.signal;
    s.exitReason = reason;
    s.activeCommandId = commandId;
    this.changePhase(s.phase === "NS_GREEN" ? "NS_YELLOW" : "EW_YELLOW", T, reason);
  }

  private changePhase(next: SignalPhase, T: number, reason: PhaseChangeReason) {
    const s = this.signal;
    const previousPhase = s.phase;
    if (previousPhase === "NS_GREEN" || previousPhase === "EW_GREEN") {
      const group: MovementGroup = previousPhase === "NS_GREEN" ? "NS" : "EW";
      this.servedAt[group] = T;
      this.greenTotal[group] += T - s.startedAt;
    }
    this.invalidateDecisions();
    s.phase = next;
    s.startedAt = T;
    s.clearanceBlocked = false;
    if (next === "NS_GREEN" || next === "EW_GREEN") {
      s.nextGreen = OTHER_GREEN[next];
      s.plannedEnd = null;
      s.pendingSwitch = null;
      s.activeCommandId = null;
    } else if (next === "NS_YELLOW") s.nextGreen = "EW_GREEN";
    else if (next === "EW_YELLOW") s.nextGreen = "NS_GREEN";
    this.signalChanges++;
    this.bumpVersion();
    this.emit("signal.phase_changed", { previousPhase, signal: this.signalState(), reason }, {
      source: this.mode === "ai" ? "safety" : "controller",
      provenance: "deterministic",
      summary: `${phaseLabel(previousPhase)} → ${phaseLabel(next)} (${reasonLabel(reason)})`,
      correlationId: s.activeCommandId ?? undefined,
    });
    if (next.endsWith("_GREEN")) this.adaptive?.onGreenStarted();
  }

  private signalState(): SignalState {
    const s = this.signal;
    const t = this.timing;
    const green = s.phase === "NS_GREEN" || s.phase === "EW_GREEN";
    const minimum = green ? t.minimumGreenMs : s.phase === "ALL_RED" ? t.allRedMs : t.yellowMs;
    return {
      phase: s.phase,
      phaseStartedAtSimMs: s.startedAt,
      earliestEndAtSimMs: s.startedAt + minimum,
      latestEndAtSimMs: green ? s.startedAt + t.maximumGreenMs : null,
      nextGreen: s.nextGreen,
      activeCommandId: s.activeCommandId,
      clearanceBlockedByVehicles: s.phase === "ALL_RED" && s.clearanceBlocked,
    };
  }

  // ---------------------------------------------------------------------------
  // State builders

  private buildWorld() {
    this.time = 0;
    this.lanes = { north: [], south: [], east: [], west: [] };
    this.backlog = { north: [], south: [], east: [], west: [] };
    this.effects = [];
    this.timeZeroApplied = false;
    this.vehicleCounter = 0;
    this.demandCounter = 0;
    this.scheduleCounter = 0;
    this.injectionOrder = 0;
    this.requested = 0;
    this.spawned = 0;
    this.completed = { count: 0, waitingSum: 0, travelSum: 0, emergencyCount: 0, emergencyDelaySum: 0 };
    this.maxQueue = 0;
    this.queueIntegral = 0;
    this.maxDelay = 0;
    this.executedCommand = null;
    this.signalChanges = 0;
    this.servedAt = { NS: null, EW: null };
    this.greenTotal = { NS: 0, EW: 0 };
    this.samples = [];
    this.geminiRequests = 0;
    this.geminiLatency = { count: 0, sum: 0, max: 0 };
    this.jevLatency = { count: 0, sum: 0, max: 0 };
    this.jevConfidence = { high: 0, medium: 0, low: 0 };
    this.deadlineMisses = 0;
    this.safetyRejections = 0;
    // Streams restart so a reset replays the same demand from the same seed.
    this.demandRng = createStream(this.seed, "demand");
    this.mixRng = createStream(this.seed, "mix");
    this.hazardRng = createStream(this.seed, "hazards");
    this.latencyRng = createStream(this.seed, "latency");

    const initialGreen = this.parameters.initialGreen;
    this.signal = {
      phase: initialGreen,
      startedAt: 0,
      nextGreen: OTHER_GREEN[initialGreen],
      activeCommandId: null,
      clearanceBlocked: false,
      exitReason: "fixed_cycle",
      plannedEnd: null,
      pendingSwitch: null,
    };
    this.scheduled = this.parameters.scheduledEvents.map((e, index) => ({
      scheduleId: `g${this.gen}-${e.id}`, atSimMs: e.atSimMs, event: e.event, order: index,
    }));
    this.controllerStatus = {
      requestedMode: this.mode,
      activeController: this.mode === "ai" ? "adaptive" : "fixed_time",
      reason: this.mode === "ai" ? null : "Fixed-time schedule; no AI is called.",
    };

    // Initial queues: deterministic passenger cars already spawned at time zero.
    for (const approach of APPROACHES) {
      const count = this.parameters.initialQueueByApproach[approach];
      let front = STOP_LINE - 0.5;
      for (let i = 0; i < count; i++) {
        const spec = VEHICLE_SPECS.car;
        const demandId = `g${this.gen}-demand-${++this.demandCounter}`;
        this.lanes[approach].push({
          id: `g${this.gen}-vehicle-${++this.vehicleCounter}`, demandId, type: "car", approach,
          d: front - spec.length / 2, v: 0, a: 0, length: spec.length, desired: spec.desired, maxAccel: spec.accel,
          requestedAt: 0, spawnedAt: 0, waitingMs: 0, signalDelayMs: 0, emergency: false, committed: false,
        });
        this.requested++;
        this.spawned++;
        front -= spec.length + MIN_GAP;
      }
    }
    this.maxQueue = this.lanes.north.length + this.lanes.south.length + this.lanes.east.length + this.lanes.west.length;

    this.adaptive?.reset();
    this.recordSample();
  }

  private vehicleState(veh: SimVehicle): VehicleState {
    const pos = lanePosition(veh.approach, veh.d);
    const front = veh.d + veh.length / 2;
    const rear = veh.d - veh.length / 2;
    const exit = OPPOSITE_APPROACH[veh.approach];
    let movementState: VehicleState["movementState"];
    if (front <= STOP_LINE) movementState = veh.v < STOPPED_MPS ? "queued" : "approaching";
    else if (rear < BOX) movementState = "crossing";
    else movementState = "departing";
    const eta = front < STOP_LINE && veh.v >= STOPPED_MPS ? round2((STOP_LINE - front) / veh.v) : null;
    return {
      id: veh.id,
      type: veh.type,
      approach: veh.approach,
      intendedExit: exit,
      travelDirection: exit,
      laneId: `${veh.approach}-inbound`,
      position: { x: round3(pos.x), y: 0, z: round3(pos.z) },
      headingRadians: HEADING[veh.approach],
      velocityMps: round2(veh.v),
      accelerationMps2: round2(veh.a),
      desiredSpeedMps: veh.desired,
      lengthM: veh.length,
      requestedAtSimMs: veh.requestedAt,
      spawnedAtSimMs: veh.spawnedAt,
      waitingTimeMs: veh.waitingMs,
      signalDelayMs: veh.signalDelayMs,
      emergency: veh.emergency,
      stopLineEtaSeconds: eta,
      movementState,
    };
  }

  private buildMetrics(): TrafficMetrics {
    const T = this.time;
    const queueByApproach = { north: 0, south: 0, east: 0, west: 0 };
    const upstreamBacklogByApproach = { north: 0, south: 0, east: 0, west: 0 };
    let active = 0;
    let waiting = 0;
    let activeWaiting = 0;
    let activeEmergencyDelay = 0;
    let upstreamWaiting = 0;
    for (const approach of APPROACHES) {
      for (const veh of this.lanes[approach]) {
        active++;
        if (veh.v < STOPPED_MPS && veh.d + veh.length / 2 <= STOP_LINE) {
          waiting++;
          queueByApproach[approach]++;
        }
        activeWaiting += veh.spawnedAt - veh.requestedAt + veh.waitingMs;
        if (veh.emergency) activeEmergencyDelay += veh.signalDelayMs;
      }
      for (const req of this.backlog[approach]) {
        upstreamBacklogByApproach[approach]++;
        upstreamWaiting += T - req.requestedAt;
      }
    }
    this.maxQueue = Math.max(this.maxQueue, waiting);
    const backlog = upstreamBacklogByApproach.north + upstreamBacklogByApproach.south + upstreamBacklogByApproach.east + upstreamBacklogByApproach.west;
    const c = this.completed;
    const latency = (stats: LatencyStats) => ({
      sampleCount: stats.count,
      meanMs: stats.count ? Math.round(stats.sum / stats.count) : null,
      maxMs: stats.count ? Math.round(stats.max) : null,
    });
    return {
      timeAverageQueueLength: T ? this.queueIntegral / T : 0,
      maximumObservedDelayMs: Math.max(this.maxDelay, ...APPROACHES.flatMap(a => this.lanes[a].map(v => v.waitingMs + v.spawnedAt - v.requestedAt)), ...APPROACHES.flatMap(a => this.backlog[a].map(v => T - v.requestedAt))),
      requestedVehicleCount: this.requested,
      spawnedVehicleCount: this.spawned,
      completedVehicleCount: c.count,
      activeVehicleCount: active,
      upstreamBacklogCount: backlog,
      upstreamBacklogByApproach,
      waitingVehicleCount: waiting,
      queueByApproach,
      maximumQueueLength: this.maxQueue,
      averageCompletedWaitingTimeMs: c.count ? Math.round(c.waitingSum / c.count) : null,
      averageCompletedTravelTimeMs: c.count ? Math.round(c.travelSum / c.count) : null,
      totalObservedWaitingTimeMs: c.waitingSum + activeWaiting + upstreamWaiting,
      activeWaitingTimeMs: activeWaiting,
      upstreamWaitingTimeMs: upstreamWaiting,
      throughputVehPerHour: T > 0 ? round1((c.count * 3_600_000) / T) : 0,
      emergencyCompletedCount: c.emergencyCount,
      averageCompletedEmergencySignalDelayMs: c.emergencyCount ? Math.round(c.emergencyDelaySum / c.emergencyCount) : null,
      activeEmergencySignalDelayMs: activeEmergencyDelay,
      signalChangeCount: this.signalChanges,
      geminiRequestCount: this.geminiRequests,
      jevDecisionCount: this.jevConfidence.high + this.jevConfidence.medium + this.jevConfidence.low,
      jevConfidenceCounts: { ...this.jevConfidence },
      geminiLatency: latency(this.geminiLatency),
      jevLatency: latency(this.jevLatency),
      deadlineMissCount: this.deadlineMisses,
      safetyRejectionCount: this.safetyRejections,
    };
  }

  private buildSnapshot(sequence: number): SimulationSnapshot {
    const vehicles: VehicleState[] = [];
    for (const approach of APPROACHES) for (const veh of this.lanes[approach]) vehicles.push(this.vehicleState(veh));
    const config: SessionConfig = {
      mode: this.mode,
      scenarioId: this.scenarioId,
      seed: this.seed,
      speedMultiplier: this.speed,
      timestepMs: 100,
      demoMode: this.demoMode,
      signalTiming: this.timing,
      scenario: this.parameters,
      geometry: DEFAULT_GEOMETRY,
    };
    return {
      protocolVersion: PROTOCOL_VERSION,
      sessionId: this.sessionId,
      generation: this.gen,
      stateVersion: this.version,
      decisionStateVersion: this.decisionStateVersion,
      snapshotSequence: this.snapshotSequence,
      eventSequence: sequence,
      sequence,
      status: this.sessionStatus,
      simulationTimeMs: this.time,
      config,
      signal: this.signalState(),
      vehicles,
      occupiedVehicleIds: this.occupiedIds(),
      metrics: this.buildMetrics(),
      controller: { ...this.controllerStatus },
      agents: this.agentStatuses(),
      providers: this.providerStatuses(),
      jev: this.jevStatus(),
    };
  }

  private agentStatuses(): [AgentStatus, AgentStatus] {
    if (this.adaptive) return this.adaptive.agentStatuses();
    const disabled = (agentId: "agent-a" | "agent-b"): AgentStatus => ({
      agentId,
      group: agentId === "agent-a" ? "NS" : "EW",
      status: "disabled",
      provenance: this.demoMode,
      model: null,
      lastInference: null,
      latestProposalId: null,
      requestCount: 0,
      message: "Fixed-time mode: agents are not called.",
    });
    return [disabled("agent-a"), disabled("agent-b")];
  }

  private providerStatuses(): [ProviderStatus, ProviderStatus] {
    if (this.adaptive) return this.adaptive.providerStatuses();
    return [
      { provider: "gemini", mode: this.demoMode, status: "disabled", model: null, reason: "Agents inactive." },
      { provider: "jev", mode: this.jevMode, status: "disabled", model: null, reason: "Arbitration inactive." },
    ];
  }

  private jevStatus(): JevStatus {
    if (this.adaptive) return this.adaptive.jevStatus();
    return { status: "disabled", pendingArbitrationId: null, lastArbitration: null };
  }

  private recordSample() {
    const last = this.samples[this.samples.length - 1];
    if (last && last.simulationTimeMs === this.time) return;
    this.samples.push({ simulationTimeMs: this.time, metrics: this.buildMetrics() });
    if (this.samples.length > 4000) this.samples.shift();
  }

  private emitMetrics(final = false) {
    this.recordSample();
    const metrics = this.buildMetrics();
    this.emit("simulation.metrics", metrics, {
      source: "simulation", provenance: "simulation",
      summary: final ? `Final metrics at ${formatClock(this.time)}` : `Metrics at ${formatClock(this.time)}`,
    });
  }

  private setStatus(status: SessionStatus) {
    this.sessionStatus = status;
    this.version += 1;
    this.emitStatus(`Session ${status}`);
  }

  private emitStatus(summary: string) {
    this.emit("simulation.status", { status: this.sessionStatus, speedMultiplier: this.speed, controller: { ...this.controllerStatus } }, {
      source: "simulation", provenance: "simulation", summary,
    });
  }

  private envelope(source: EventSource, provenance: EventProvenance, summary: string, correlationId: string, eventId?: string) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      eventId: eventId ?? `${this.sessionId}-e${this.sequence}`,
      correlationId,
      sessionId: this.sessionId,
      generation: this.gen,
      stateVersion: this.version,
      sequence: this.sequence,
      simulationTimeMs: this.time,
      wallTime: new Date(this.wallNow()).toISOString(),
      source,
      provenance,
      summary: summary.slice(0, 500),
    };
  }
}

// -----------------------------------------------------------------------------
// Labels shared with summaries (kept short; the UI renders its own copy).

export function phaseLabel(phase: SignalPhase): string {
  switch (phase) {
    case "NS_GREEN": return "North/South green";
    case "NS_YELLOW": return "North/South yellow";
    case "EW_GREEN": return "East/West green";
    case "EW_YELLOW": return "East/West yellow";
    case "ALL_RED": return "All red";
  }
}

function reasonLabel(reason: PhaseChangeReason): string {
  switch (reason) {
    case "fixed_cycle": return "fixed schedule";
    case "adaptive_command": return "adaptive command";
    case "maximum_green": return "maximum green reached";
    case "clearance_complete": return "clearance complete";
    case "reset": return "reset";
    case "fallback": return "deterministic fallback";
  }
}

function typeLabel(type: VehicleType): string {
  return type === "bus_truck" ? "bus or truck" : type;
}

export function describeInjection(event: InjectedEvent): string {
  switch (event.type) {
    case "emergency": return `${event.responding ? "responding " : ""}${event.vehicleType} from the ${event.approach}`;
    case "demand_surge": return `${event.approach} traffic surge ×${event.multiplier} for ${event.durationMs / 1000} s`;
    case "temporary_congestion": return `${event.approach} congestion (${Math.round(event.speedFactor * 100)}% speed) for ${event.durationMs / 1000} s`;
    case "provider_fault": return `${event.provider === "jev" ? "JEV" : "Gemini"} ${event.fault.replace("_", " ")} fault for ${event.durationMs / 1000} s`;
    case "decision_boundary": return `decision trigger (${event.reason.replace("_", " ")})`;
  }
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) { return Math.round(value * 10) / 10; }
function round2(value: number) { return Math.round(value * 100) / 100; }
function round3(value: number) { return Math.round(value * 1000) / 1000; }
