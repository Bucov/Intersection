import {
  CreateComparisonRequestSchema,
  CreateSessionRequestSchema,
  DEFAULT_CONFIDENCE_POLICY,
  DEFAULT_GEOMETRY,
  DEFAULT_SIGNAL_TIMING,
  DEMAND_PRESETS,
  InjectEventRequestSchema,
  SCENARIO_CATALOG,
  SessionControlRequestSchema,
  type ComparisonResponse,
  type CreateComparisonRequest,
  type CreateSessionRequest,
  type DemandPresetId,
  type EventsQuery,
  type EventsResponse,
  type MetricsQuery,
  type MetricsResponse,
  type RuntimeConfigResponse,
  type ScenarioParameters,
  type ServerEvent,
  type SimulationSnapshot,
} from "@intersection/shared";
import {
  TransportError,
  type Catalog,
  type CommandResult,
  type ConnectionStatus,
  type IntersectionTransport,
  type SimulationCommand,
} from "./IntersectionTransport";
import { MockCommandError, MockSimulation, STEP_MS } from "./mock/engine";
import { MockDriver } from "./mock/driver";

export const MOCK_RUNTIME_CONFIG: RuntimeConfigResponse = {
  protocolVersion: 1,
  demoMode: "mock",
  timestepMs: 100,
  snapshotIntervalMs: 100,
  metricsIntervalMs: 1000,
  eventRetentionCount: 2000,
  maxSessions: 8,
  speedMultiplierRange: { min: 0.1, max: 20, liveRecommended: 1 },
  signalTiming: DEFAULT_SIGNAL_TIMING,
  geometry: DEFAULT_GEOMETRY,
  confidencePolicy: DEFAULT_CONFIDENCE_POLICY,
  demandPresets: (Object.keys(DEMAND_PRESETS) as DemandPresetId[]).map(id => ({ id, arrivalRatesVehPerHour: DEMAND_PRESETS[id] })),
  faultInjectionEnabled: true,
};

interface MockComparison {
  response: ComparisonResponse;
  traditional: MockSimulation;
  ai: MockSimulation;
}

let sessionCounter = 0;

/**
 * Offline demo transport. Runs the deterministic mock engine in the browser and
 * exposes it through the same contract as the backend: validated requests,
 * contract error codes, checkpoint-first event streams and polling comparisons.
 */
export class MockIntersectionTransport implements IntersectionTransport {
  readonly source = "mock" as const;
  private sessions = new Map<string, MockSimulation>();
  private readOnly = new Set<string>();
  private created = new Map<string, string>();
  private comparisons = new Map<string, MockComparison>();
  private listeners = new Set<(event: ServerEvent) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private driver: MockDriver | null = null;
  private activeSessionId: string | null = null;
  private status: ConnectionStatus = { source: "mock", state: "offline-demo", message: "Offline demo: simulated locally in this browser.", reconnectAttempt: 0 };

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  onConnectionStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async loadCatalog(): Promise<Catalog> {
    return { config: MOCK_RUNTIME_CONFIG, scenarios: [...SCENARIO_CATALOG], health: null };
  }

  async createSession(request: CreateSessionRequest): Promise<SimulationSnapshot> {
    const parsed = CreateSessionRequestSchema.safeParse(request);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;
    const existing = this.created.get(body.requestId);
    if (existing) return this.sessions.get(existing)!.snapshot();
    const scenario = SCENARIO_CATALOG.find(s => s.id === body.scenarioId)!;
    if (!scenario.supportedModes.includes(body.mode)) {
      throw new TransportError("VALIDATION_ERROR", `${scenario.name} does not support the ${body.mode} controller.`, { status: 422 });
    }
    const sessionId = `demo-${(++sessionCounter).toString(36)}-${Date.now().toString(36)}`;
    const sim = new MockSimulation({
      sessionId,
      mode: body.mode,
      scenarioId: body.scenarioId,
      parameters: body.scenarioParameters ?? scenario.defaults,
      signalTiming: body.signalTiming ?? DEFAULT_SIGNAL_TIMING,
      seed: body.seed,
      speedMultiplier: body.speedMultiplier,
    });
    if (body.autoStart) sim.control("start", 0);
    sim.drain();
    this.sessions.set(sessionId, sim);
    this.created.set(body.requestId, sessionId);
    return sim.snapshot();
  }

  async connect(sessionId: string): Promise<void> {
    const sim = this.requireSession(sessionId);
    this.stopDriver();
    this.activeSessionId = sessionId;
    this.driver = new MockDriver(sim, events => this.deliver(sessionId, events));
    // The first event on a new subscription is a checkpoint, as on the socket.
    queueMicrotask(() => {
      if (this.activeSessionId === sessionId) this.deliver(sessionId, [sim.checkpointEvent()]);
    });
    this.driver.start();
  }

  async disconnect(): Promise<void> {
    this.stopDriver();
    this.activeSessionId = null;
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendCommand(command: SimulationCommand): Promise<CommandResult> {
    const sim = this.requireSession(command.sessionId);
    if (this.readOnly.has(command.sessionId)) {
      throw new TransportError("INVALID_STATE", "Comparison sessions are read-only.", { status: 409 });
    }
    try {
      if (command.kind === "control") {
        const parsed = SessionControlRequestSchema.safeParse(command.body);
        if (!parsed.success) throw validationError(parsed.error);
        const body = parsed.data;
        sim.control(body.action, body.generation, body.action === "set_speed" ? body.speedMultiplier : undefined);
        this.flush(command.sessionId, sim);
        return { kind: "control", snapshot: sim.snapshot() };
      }
      const parsed = InjectEventRequestSchema.safeParse(command.body);
      if (!parsed.success) throw validationError(parsed.error);
      const body = parsed.data;
      const result = sim.inject(body.event, body.generation, body.atSimMs);
      this.flush(command.sessionId, sim);
      return {
        kind: "inject",
        response: { protocolVersion: 1, sessionId: command.sessionId, generation: sim.generation, scheduleId: result.scheduleId, scheduledAtSimMs: result.scheduledAtSimMs, sequence: result.sequence },
      };
    } catch (error) {
      if (error instanceof MockCommandError) {
        throw new TransportError(error.code, error.message, { status: error.code === "VALIDATION_ERROR" ? 422 : 409 });
      }
      throw error;
    }
  }

  requestSnapshot(): void {
    const sessionId = this.activeSessionId;
    if (!sessionId) return;
    const sim = this.sessions.get(sessionId);
    if (sim) this.deliver(sessionId, [sim.checkpointEvent()]);
  }

  async getEvents(sessionId: string, query: EventsQuery = {}): Promise<EventsResponse> {
    const sim = this.requireSession(sessionId);
    const after = query.afterSequence === undefined ? undefined : Number(query.afterSequence);
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100)));
    if (after !== undefined && after > sim.latestSequence) throw new TransportError("VALIDATION_ERROR", "Cursor is ahead of the latest sequence.", { status: 422 });
    const history = sim.eventHistory(after, limit);
    if (history.expired) throw new TransportError("EVENT_HISTORY_EXPIRED", "Older events are no longer retained.", { status: 410 });
    const last = history.events[history.events.length - 1];
    return {
      protocolVersion: 1,
      sessionId,
      events: history.events,
      oldestAvailableSequence: history.oldestAvailableSequence,
      latestSequence: history.latestSequence,
      nextAfterSequence: last ? last.sequence : after ?? history.latestSequence,
      hasMore: history.hasMore,
    };
  }

  async getMetrics(sessionId: string, query: MetricsQuery = {}): Promise<MetricsResponse> {
    const sim = this.requireSession(sessionId);
    if (query.generation !== undefined && Number(query.generation) !== sim.generation) {
      throw new TransportError("STALE_GENERATION", "Metrics history is only kept for the current generation.", { status: 409 });
    }
    const from = Number(query.fromSimMs ?? 0);
    const limit = Math.min(1000, Math.max(1, Number(query.limit ?? 300)));
    const all = sim.metricsSamples().filter(s => s.simulationTimeMs >= from);
    const samples = all.slice(0, limit);
    return {
      protocolVersion: 1,
      sessionId,
      generation: sim.generation,
      simulationTimeMs: sim.simulationTimeMs,
      current: sim.currentMetrics(),
      samples,
      sampleIntervalMs: 1000,
      nextFromSimMs: all.length > samples.length ? all[samples.length].simulationTimeMs : null,
      truncatedBeforeSimMs: sim.metricsSamples()[0]?.simulationTimeMs ? sim.metricsSamples()[0].simulationTimeMs : null,
    };
  }

  async createComparison(request: CreateComparisonRequest): Promise<ComparisonResponse> {
    const parsed = CreateComparisonRequestSchema.safeParse(request);
    if (!parsed.success) throw validationError(parsed.error);
    const body = parsed.data;
    const scenario = SCENARIO_CATALOG.find(s => s.id === body.scenarioId)!;
    const parameters: ScenarioParameters = body.scenarioParameters ?? { ...scenario.defaults, durationMs: body.durationMs };
    if (parameters.scheduledEvents.some(e => e.atSimMs >= parameters.durationMs)) {
      throw new TransportError("VALIDATION_ERROR", "A scheduled scenario event falls outside the comparison duration.", { status: 422 });
    }
    const comparisonId = `compare-${(++sessionCounter).toString(36)}-${Date.now().toString(36)}`;
    const timing = body.signalTiming ?? DEFAULT_SIGNAL_TIMING;
    // Virtual wall clocks: simulated model latency applies as if the run were at 1×.
    const build = (mode: "traditional" | "ai") => {
      const sessionId = `${comparisonId}-${mode === "ai" ? "ai" : "fixed"}`;
      const base = Date.now();
      let sim: MockSimulation | null = null;
      sim = new MockSimulation({
        sessionId, mode, scenarioId: body.scenarioId, parameters, signalTiming: timing, seed: body.seed,
        speedMultiplier: body.speedMultiplier, retainEvents: 0, wallClock: () => base + (sim?.simulationTimeMs ?? 0),
      });
      this.sessions.set(sessionId, sim);
      this.readOnly.add(sessionId);
      return sim;
    };
    const traditional = build("traditional");
    const ai = build("ai");
    const demandScheduleHash = await sha256Hex(JSON.stringify({ seed: body.seed, scenarioId: body.scenarioId, parameters }));
    const response: ComparisonResponse = {
      protocolVersion: 1,
      comparisonId,
      status: "running",
      createdAtWallTime: new Date().toISOString(),
      completedAtWallTime: null,
      execution: body.execution,
      demoMode: "mock",
      seed: body.seed,
      scenarioId: body.scenarioId,
      durationMs: parameters.durationMs,
      speedMultiplier: body.speedMultiplier,
      demandScheduleId: `demand-${body.scenarioId}-${body.seed}`,
      demandScheduleHash,
      traditional: side(traditional),
      ai: side(ai),
      limitations: [
        "Offline demo: both controllers run locally as deterministic mocks. No Gemini or JEV calls were made.",
        "Computed faster than real time; simulated model latency is applied as if the run were at 1×.",
        "One seed and one scenario. Results change with the seed and are not a benchmark.",
      ],
    };
    const entry: MockComparison = { response, traditional, ai };
    this.comparisons.set(comparisonId, entry);
    traditional.control("start", 0);
    ai.control("start", 0);
    this.runComparison(entry);
    return structuredClone(response);
  }

  async getComparison(comparisonId: string): Promise<ComparisonResponse> {
    const entry = this.comparisons.get(comparisonId);
    if (!entry) throw new TransportError("NOT_FOUND", "Unknown comparison.", { status: 404 });
    return structuredClone(entry.response);
  }

  dispose(): void {
    this.stopDriver();
    this.listeners.clear();
    this.statusListeners.clear();
    this.sessions.clear();
    this.comparisons.clear();
  }

  // ---------------------------------------------------------------------------

  private runComparison(entry: MockComparison) {
    const chunk = () => {
      if (!this.comparisons.has(entry.response.comparisonId)) return;
      const { traditional, ai } = entry;
      // Work in ~12 ms slices so the page (and the 3D scene) stay responsive.
      const started = performance.now();
      let done = false;
      do {
        traditional.advance(50);
        ai.advance(50);
        traditional.drain();
        ai.drain();
        done = traditional.status === "completed" && ai.status === "completed";
      } while (!done && performance.now() - started < 12);
      entry.response = {
        ...entry.response,
        status: done ? "completed" : "running",
        completedAtWallTime: done ? new Date().toISOString() : null,
        traditional: side(traditional),
        ai: side(ai),
      };
      if (!done) setTimeout(chunk, 0);
    };
    setTimeout(chunk, 0);
  }

  private requireSession(sessionId: string): MockSimulation {
    const sim = this.sessions.get(sessionId);
    if (!sim) throw new TransportError("NOT_FOUND", "Unknown session. Offline demo sessions do not survive a reload.", { status: 404 });
    return sim;
  }

  private flush(sessionId: string, sim: MockSimulation) {
    const events = sim.drain();
    if (events.length) this.deliver(sessionId, events);
  }

  private deliver(sessionId: string, events: ServerEvent[]) {
    if (sessionId !== this.activeSessionId) return;
    for (const event of events) for (const listener of this.listeners) listener(event);
  }

  private stopDriver() {
    this.driver?.stop();
    this.driver = null;
  }
}

function side(sim: MockSimulation) {
  return { sessionId: sim.sessionId, generation: sim.generation, simulationTimeMs: sim.simulationTimeMs, metrics: sim.currentMetrics() };
}

function validationError(error: { issues: { path: PropertyKey[]; message: string }[] }): TransportError {
  const issues = error.issues.map(i => ({ path: i.path.filter((p): p is string | number => typeof p !== "symbol"), message: i.message.slice(0, 500) }));
  return new TransportError("VALIDATION_ERROR", issues[0]?.message ?? "Invalid request.", {
    status: 422,
    detail: { code: "VALIDATION_ERROR", message: "Invalid request.", retryable: false, issues },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export { STEP_MS };
