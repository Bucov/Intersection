import type {
  AgentId,
  AgentStatus,
  ArbitrationRecord,
  ControllerStatus,
  DecisionOutcome,
  ErrorDetail,
  JevStatus,
  ProviderStatus,
  ServerEvent,
  SessionStatus,
  SignalPhase,
  SignalState,
  SimulationSnapshot,
  TrafficMetrics,
  TrafficProposal,
} from "@intersection/shared";
import type { DataSourceKind } from "@/transport/IntersectionTransport";
import { describeEvent, describeSnapshot, type TranscriptEntry } from "./transcript";

type EventOf<T extends ServerEvent["type"]> = Extract<ServerEvent, { type: T }>;
export type FallbackPayload = EventOf<"arbitration.fallback">["payload"];

/** Everything observed for one coordination round, grouped by correlation ID. */
export interface DecisionCycle {
  correlationId: string;
  startedAtSimMs: number;
  proposals: Partial<Record<AgentId, TrafficProposal>>;
  conflict: boolean;
  arbitration: ArbitrationRecord | null;
  arbitrationEndedAtSimMs: number | null;
  fallback: FallbackPayload | null;
  decisions: DecisionOutcome[];
  /** Signal phase when the latest decision arrived (tells "keep" from "change"). */
  phaseAtDecision: SignalPhase | null;
}

export type TimelineLane = "agent-a" | "agent-b" | "jev" | "safety";

export interface TimelineBar {
  id: string;
  lane: TimelineLane;
  correlationId: string;
  startSimMs: number;
  /** Null while pending. */
  endSimMs: number | null;
  outcome: "pending" | "completed" | "failed" | "cancelled" | "stale" | "accepted" | "rejected" | "unnecessary" | "duplicate";
  latencyMs: number | null;
  provenance: "mock" | "live" | "deterministic";
}

export interface PhaseSegment {
  phase: SignalPhase;
  startSimMs: number;
}

export interface MetricsPoint {
  t: number;
  queueNS: number;
  queueEW: number;
  backlogNS: number;
  backlogEW: number;
  completed: number;
  active: number;
  throughput: number;
  avgWaitS: number | null;
  activeWaitingS: number;
}

export type SyncState = "idle" | "live" | "resyncing";

export interface SessionState {
  source: DataSourceKind | null;
  sessionId: string | null;
  generation: number;
  /** Sequence of the last applied domain event or checkpoint. */
  cursor: number;
  sync: SyncState;
  /** Events were skipped at some point; the transcript may be incomplete. */
  historyGap: boolean;
  snapshot: SimulationSnapshot | null;
  /** performance.now() when the latest snapshot arrived (drives interpolation). */
  snapshotReceivedAt: number;
  status: SessionStatus | null;
  speedMultiplier: number;
  simulationTimeMs: number;
  controller: ControllerStatus | null;
  signal: SignalState | null;
  agents: [AgentStatus, AgentStatus] | null;
  providers: [ProviderStatus, ProviderStatus] | null;
  jev: JevStatus | null;
  metrics: TrafficMetrics | null;
  cycles: DecisionCycle[];
  timeline: TimelineBar[];
  phases: PhaseSegment[];
  series: MetricsPoint[];
  transcript: TranscriptEntry[];
  lastError: ErrorDetail | null;
}

const MAX_CYCLES = 40;
const MAX_TIMELINE = 400;
const MAX_PHASES = 240;
const MAX_SERIES = 1800;
const MAX_TRANSCRIPT = 600;

export function createSessionState(source: DataSourceKind | null = null, sessionId: string | null = null): SessionState {
  return {
    source,
    sessionId,
    generation: 0,
    cursor: -1,
    sync: "idle",
    historyGap: false,
    snapshot: null,
    snapshotReceivedAt: 0,
    status: null,
    speedMultiplier: 1,
    simulationTimeMs: 0,
    controller: null,
    signal: null,
    agents: null,
    providers: null,
    jev: null,
    metrics: null,
    cycles: [],
    timeline: [],
    phases: [],
    series: [],
    transcript: [],
    lastError: null,
  };
}

export interface ReduceResult {
  state: SessionState;
  /** The caller must request a fresh checkpoint. */
  resync: boolean;
}

/**
 * Apply one domain event following the contract's sequence algorithm:
 * snapshots replace state, duplicates are ignored, a gap or incompatible
 * generation stops incremental application until a checkpoint arrives.
 */
export function reduceEvent(state: SessionState, event: ServerEvent, now = nowMs()): ReduceResult {
  if (!state.sessionId || event.sessionId !== state.sessionId) return { state, resync: false };
  if (event.type === "simulation.snapshot") return { state: applySnapshot(state, event.payload, now), resync: false };
  if (state.sync === "resyncing" || state.cursor < 0) return { state, resync: false };
  if (event.sequence <= state.cursor) return { state, resync: false };
  if (event.sequence > state.cursor + 1) return { state: { ...state, sync: "resyncing", historyGap: true }, resync: true };

  if (event.generation < state.generation) {
    // Late telemetry from before a reset: visible in the transcript, never applied.
    const entry = describeEvent(event, true);
    return { state: { ...state, cursor: event.sequence, transcript: entry ? appendBounded(state.transcript, entry, MAX_TRANSCRIPT) : state.transcript }, resync: false };
  }
  if (event.generation > state.generation) return { state: { ...state, sync: "resyncing" }, resync: true };

  const next = applyIncremental({ ...state, cursor: event.sequence, simulationTimeMs: Math.max(state.simulationTimeMs, event.simulationTimeMs) }, event);
  const entry = describeEvent(event, false);
  if (entry) next.transcript = appendBounded(next.transcript, entry, MAX_TRANSCRIPT);
  return { state: next, resync: false };
}

/** Replace the baseline with a full snapshot (socket broadcast, checkpoint or REST response). */
export function applySnapshot(state: SessionState, snapshot: SimulationSnapshot, now = nowMs()): SessionState {
  if (!state.sessionId || snapshot.sessionId !== state.sessionId) return state;
  // A checkpoint may reuse the latest sequence; anything older is stale.
  if (state.cursor >= 0 && snapshot.sequence < state.cursor) return state;
  const first = state.snapshot === null;
  const generationChanged = !first && snapshot.generation !== state.generation;
  const wasResyncing = state.sync === "resyncing";

  let next: SessionState = {
    ...state,
    generation: snapshot.generation,
    cursor: snapshot.sequence,
    sync: "live",
    snapshot,
    snapshotReceivedAt: now,
    status: snapshot.status,
    speedMultiplier: snapshot.config.speedMultiplier,
    simulationTimeMs: snapshot.simulationTimeMs,
    controller: snapshot.controller,
    signal: snapshot.signal,
    agents: snapshot.agents,
    providers: snapshot.providers,
    jev: snapshot.jev,
    metrics: snapshot.metrics,
  };

  if (first || generationChanged) {
    // Reset drops vehicles, proposals, arbitration, timeline and metric series.
    next.cycles = [];
    next.timeline = [];
    next.phases = [];
    next.series = [metricsPoint(snapshot.simulationTimeMs, snapshot.metrics)];
    next.transcript = appendBounded(state.transcript, describeSnapshot(snapshot, first ? "ready" : "reset"), MAX_TRANSCRIPT);
  } else if (wasResyncing) {
    next.transcript = appendBounded(state.transcript, describeSnapshot(snapshot, "resync"), MAX_TRANSCRIPT);
  }

  next.phases = upsertPhase(next.phases, snapshot.signal);
  for (const agent of snapshot.agents) {
    if (agent.lastInference) next.timeline = upsertInference(next.timeline, agent.agentId, agent.lastInference, agent.provenance);
  }
  const arbitration = snapshot.jev.lastArbitration;
  if (arbitration && !next.timeline.some(bar => bar.id === arbitration.arbitrationId && bar.endSimMs !== null)) {
    next.timeline = upsertArbitration(next.timeline, arbitration, snapshot.simulationTimeMs);
    next.cycles = upsertCycle(next.cycles, arbitration.correlationId, arbitration.requestedAtSimMs, cycle => ({
      ...cycle,
      proposals: { "agent-a": arbitration.proposalA, "agent-b": arbitration.proposalB, ...cycle.proposals },
      conflict: true,
      arbitration: cycle.arbitration?.status !== "pending" && cycle.arbitration ? cycle.arbitration : arbitration,
    }));
  }
  return next;
}

function applyIncremental(state: SessionState, event: ServerEvent): SessionState {
  switch (event.type) {
    case "simulation.status":
      return { ...state, status: event.payload.status, speedMultiplier: event.payload.speedMultiplier, controller: event.payload.controller };

    case "signal.phase_changed":
      return { ...state, signal: event.payload.signal, phases: upsertPhase(state.phases, event.payload.signal) };

    case "agent.status": {
      const agent = event.payload;
      const agents = state.agents ? ([...state.agents] as [AgentStatus, AgentStatus]) : null;
      if (agents) agents[agent.agentId === "agent-a" ? 0 : 1] = agent;
      let timeline = state.timeline;
      let cycles = state.cycles;
      if (agent.lastInference) {
        timeline = upsertInference(timeline, agent.agentId, agent.lastInference, agent.provenance);
        cycles = upsertCycle(cycles, agent.lastInference.correlationId, agent.lastInference.startedAtSimMs, c => c);
      }
      return { ...state, agents, timeline, cycles };
    }

    case "agent.proposal": {
      const proposal = event.payload;
      return {
        ...state,
        cycles: upsertCycle(state.cycles, proposal.correlationId, proposal.createdAtSimMs, c => ({ ...c, proposals: { ...c.proposals, [proposal.agentId]: proposal } })),
      };
    }

    case "arbitration.conflict":
      return { ...state, cycles: upsertCycle(state.cycles, event.correlationId, event.simulationTimeMs, c => ({ ...c, conflict: true })) };

    case "jev.arbitration": {
      const record = event.payload;
      const pending = record.status === "pending";
      const previous = state.jev;
      const jev: JevStatus = {
        status: pending ? "arbitrating" : previous && previous.status !== "arbitrating" ? previous.status : "idle",
        pendingArbitrationId: pending ? record.arbitrationId : null,
        lastArbitration: record,
      };
      return {
        ...state,
        jev,
        timeline: upsertArbitration(state.timeline, record, event.simulationTimeMs),
        cycles: upsertCycle(state.cycles, record.correlationId, record.requestedAtSimMs, c => ({
          ...c,
          conflict: true,
          proposals: { "agent-a": record.proposalA, "agent-b": record.proposalB, ...c.proposals },
          arbitration: record,
          arbitrationEndedAtSimMs: pending ? null : event.simulationTimeMs,
        })),
      };
    }

    case "arbitration.fallback":
      return { ...state, cycles: upsertCycle(state.cycles, event.correlationId, event.simulationTimeMs, c => ({ ...c, fallback: event.payload })) };

    case "decision.outcome": {
      const decision = event.payload;
      const bar: TimelineBar = {
        id: decision.commandId,
        lane: "safety",
        correlationId: decision.correlationId,
        startSimMs: event.simulationTimeMs,
        endSimMs: Math.max(event.simulationTimeMs, decision.scheduledAfterSimMs ?? event.simulationTimeMs),
        outcome: decision.status,
        latencyMs: null,
        provenance: "deterministic",
      };
      return {
        ...state,
        timeline: upsertBar(state.timeline, bar),
        cycles: upsertCycle(state.cycles, decision.correlationId, event.simulationTimeMs, c => ({
          ...c,
          decisions: [...c.decisions.filter(d => d.commandId !== decision.commandId), decision],
          phaseAtDecision: state.signal?.phase ?? null,
        })),
      };
    }

    case "simulation.metrics": {
      const point = metricsPoint(event.simulationTimeMs, event.payload);
      const last = state.series[state.series.length - 1];
      const series = last && last.t === point.t ? [...state.series.slice(0, -1), point] : appendBounded(state.series, point, MAX_SERIES);
      return { ...state, metrics: event.payload, series };
    }

    case "simulation.error":
      return { ...state, lastError: event.payload };

    case "simulation.vehicle_event":
    case "simulation.scenario_event":
    case "simulation.snapshot":
      return state;
  }
}

// -----------------------------------------------------------------------------
// Helpers

export function metricsPoint(t: number, m: TrafficMetrics): MetricsPoint {
  return {
    t,
    queueNS: m.queueByApproach.north + m.queueByApproach.south,
    queueEW: m.queueByApproach.east + m.queueByApproach.west,
    backlogNS: m.upstreamBacklogByApproach.north + m.upstreamBacklogByApproach.south,
    backlogEW: m.upstreamBacklogByApproach.east + m.upstreamBacklogByApproach.west,
    completed: m.completedVehicleCount,
    active: m.activeVehicleCount,
    throughput: m.throughputVehPerHour,
    avgWaitS: m.averageCompletedWaitingTimeMs === null ? null : m.averageCompletedWaitingTimeMs / 1000,
    activeWaitingS: m.activeWaitingTimeMs / 1000,
  };
}

function upsertPhase(phases: PhaseSegment[], signal: SignalState): PhaseSegment[] {
  const last = phases[phases.length - 1];
  if (last && last.phase === signal.phase && last.startSimMs === signal.phaseStartedAtSimMs) return phases;
  if (last && signal.phaseStartedAtSimMs < last.startSimMs) return phases;
  return appendBounded(phases, { phase: signal.phase, startSimMs: signal.phaseStartedAtSimMs }, MAX_PHASES);
}

function upsertInference(timeline: TimelineBar[], lane: AgentId, interval: NonNullable<AgentStatus["lastInference"]>, provenance: "mock" | "live"): TimelineBar[] {
  return upsertBar(timeline, {
    id: interval.inferenceId,
    lane,
    correlationId: interval.correlationId,
    startSimMs: interval.startedAtSimMs,
    endSimMs: interval.completedAtSimMs,
    outcome: interval.outcome,
    latencyMs: interval.latencyMs,
    provenance,
  });
}

function upsertArbitration(timeline: TimelineBar[], record: ArbitrationRecord, eventTime: number): TimelineBar[] {
  return upsertBar(timeline, {
    id: record.arbitrationId,
    lane: "jev",
    correlationId: record.correlationId,
    startSimMs: record.requestedAtSimMs,
    endSimMs: record.status === "pending" ? null : Math.max(eventTime, record.requestedAtSimMs),
    outcome: record.status,
    latencyMs: record.result?.latencyMs ?? null,
    provenance: record.result?.provenance ?? (record.proposalA.provenance === "live" ? "live" : "mock"),
  });
}

function upsertBar(timeline: TimelineBar[], bar: TimelineBar): TimelineBar[] {
  const index = timeline.findIndex(b => b.id === bar.id && b.lane === bar.lane);
  if (index === -1) return appendBounded(timeline, bar, MAX_TIMELINE);
  const next = timeline.slice();
  next[index] = bar;
  return next;
}

function upsertCycle(cycles: DecisionCycle[], correlationId: string, startedAtSimMs: number, update: (cycle: DecisionCycle) => DecisionCycle): DecisionCycle[] {
  const index = cycles.findIndex(c => c.correlationId === correlationId);
  if (index === -1) {
    const created: DecisionCycle = { correlationId, startedAtSimMs, proposals: {}, conflict: false, arbitration: null, arbitrationEndedAtSimMs: null, fallback: null, decisions: [], phaseAtDecision: null };
    return appendBounded(cycles, update(created), MAX_CYCLES);
  }
  const next = cycles.slice();
  next[index] = update(cycles[index]);
  return next;
}

function appendBounded<T>(list: T[], item: T, max: number): T[] {
  const next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(item);
  return next;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// -----------------------------------------------------------------------------
// Derived views used by panels

export function latestCycle(state: SessionState): DecisionCycle | null {
  return state.cycles[state.cycles.length - 1] ?? null;
}

/** Latest cycle that has produced at least one proposal or decision. */
export function latestDecidedCycle(state: SessionState): DecisionCycle | null {
  for (let i = state.cycles.length - 1; i >= 0; i--) {
    const c = state.cycles[i];
    if (Object.keys(c.proposals).length || c.decisions.length || c.fallback) return c;
  }
  return null;
}

export type AgentVerdict =
  | { kind: "none" }
  | { kind: "waiting" }
  | { kind: "accepted"; via: "agreement" | "arbitration" | "fallback" | "single"; decision: DecisionOutcome }
  | { kind: "not-selected"; by: "jev" | "fallback" }
  | { kind: "deferred" }
  | { kind: "rejected"; decision: DecisionOutcome };

/** How the latest round ended for one agent's proposal, derived only from received events. */
export function agentVerdict(cycle: DecisionCycle | null, agentId: AgentId): AgentVerdict {
  if (!cycle) return { kind: "none" };
  const proposal = cycle.proposals[agentId];
  if (!proposal) return { kind: "none" };
  const own = cycle.decisions.find(d => d.proposalIds.includes(proposal.proposalId) && d.requestedPhase === proposal.requestedPhase);
  if (own?.status === "accepted") {
    const a = cycle.proposals["agent-a"];
    const b = cycle.proposals["agent-b"];
    const via = cycle.fallback ? "fallback"
      : cycle.arbitration?.result ? "arbitration"
      : a && b && a.requestedPhase === b.requestedPhase ? "agreement"
      : "single";
    return { kind: "accepted", via, decision: own };
  }
  if (own?.status === "rejected") return { kind: "rejected", decision: own };
  const result = cycle.arbitration?.result;
  if (result) {
    const mine = agentId === "agent-a" ? "GRANT_A" : "GRANT_B";
    if (result.choice === "DEFER" && !cycle.fallback) return { kind: "deferred" };
    if (cycle.fallback) return { kind: "not-selected", by: "fallback" };
    if (result.choice !== mine) return { kind: "not-selected", by: "jev" };
    return { kind: "waiting" };
  }
  if (cycle.fallback) return { kind: "not-selected", by: "fallback" };
  if (cycle.decisions.length) return { kind: "not-selected", by: "jev" };
  return { kind: "waiting" };
}
