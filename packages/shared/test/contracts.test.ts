import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AgentStatusSchema, ArbitrationRecordSchema, ArbitrationResultSchema, ClientEventSchema,
  CreateComparisonRequestSchema, CreateSessionRequestSchema, DEFAULT_CONFIDENCE_POLICY,
  DEFAULT_SIGNAL_TIMING, DecisionOutcomeSchema, ErrorEnvelopeSchema, EventsQuerySchema,
  InferenceIntervalSchema, InjectEventRequestSchema, MetricsQuerySchema, REST_CONTRACT,
  SCENARIO_CATALOG, ScenarioParametersSchema, ScenariosResponseSchema, ServerEventSchema,
  SessionControlRequestSchema, SignalStateSchema, SignalTimingSchema, SimulationSnapshotSchema,
  SocketMessageSchema, SocketQuerySchema, TrafficMetricsSchema, TrafficProposalSchema,
  VehicleMixSchema, VehicleStateSchema, signalLights,
  type CreateSessionRequest, type RestResponse, type ServerEvent, type SimulationSnapshot,
} from "../src/index.js";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../../docs/examples/${name}.json`, import.meta.url), "utf8"));
const snapshot = SimulationSnapshotSchema.parse(fixture("simulation-snapshot"));
const events = ServerEventSchema.array().parse(fixture("server-events"));
const responses = fixture("responses") as Record<string, unknown>;
const requests = fixture("requests") as Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);
const proposal = events.find((e): e is Extract<ServerEvent, { type: "agent.proposal" }> => e.type === "agent.proposal")!.payload;
const arbitration = events.find((e): e is Extract<ServerEvent, { type: "jev.arbitration" }> => e.type === "jev.arbitration" && e.payload.status === "completed")!.payload;

describe("published wire examples and inferred types", () => {
  it("validates every REST success response against its route's schema", () => {
    for (const [name, route] of Object.entries(REST_CONTRACT)) expect(route.response.safeParse(responses[name]).success, name).toBe(true);
    expect(Object.keys(responses).sort()).toEqual(Object.keys(REST_CONTRACT).sort());
  });
  it("validates all request and error fixtures", () => {
    expect(CreateSessionRequestSchema.safeParse(requests.createSession).success).toBe(true);
    expect(SessionControlRequestSchema.safeParse(requests.controlSession).success).toBe(true);
    expect(InjectEventRequestSchema.safeParse(requests.injectEvent).success).toBe(true);
    expect(CreateComparisonRequestSchema.safeParse(requests.createComparison).success).toBe(true);
    expect(ClientEventSchema.safeParse(requests.requestSnapshot).success).toBe(true);
    expect(ErrorEnvelopeSchema.safeParse(fixture("error")).success).toBe(true);
  });
  it("covers every event type and serializes without non-JSON data", () => {
    expect([...new Set(events.map(e => e.type))].sort()).toEqual([
      "simulation.snapshot", "simulation.status", "simulation.vehicle_event", "simulation.scenario_event",
      "signal.phase_changed", "agent.status", "agent.proposal", "arbitration.conflict", "jev.arbitration",
      "arbitration.fallback", "decision.outcome", "simulation.metrics", "simulation.error",
    ].sort());
    expect(ServerEventSchema.array().parse(JSON.parse(JSON.stringify(events)))).toEqual(events);
    expect(SimulationSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });
  it("exports inferred types for discriminant narrowing and request defaults", () => {
    expectTypeOf<RestResponse<"getSession">>().toEqualTypeOf<{ protocolVersion: 1; snapshot: SimulationSnapshot }>();
    const minimal: CreateSessionRequest = { requestId: "request-1", mode: "ai", scenarioId: "normal-traffic", seed: 0 };
    expect(CreateSessionRequestSchema.parse(minimal)).toMatchObject({ speedMultiplier: 1, autoStart: false });
    const event = events[0]!;
    if (event.type === "simulation.snapshot") expectTypeOf(event.payload).toEqualTypeOf<SimulationSnapshot>();
  });
  it("allows additive response fields while rejecting misspelled request fields", () => {
    expect(SimulationSnapshotSchema.safeParse({ ...snapshot, futureField: true }).success).toBe(true);
    expect(CreateSessionRequestSchema.safeParse({ ...requests.createSession as object, speeedMultiplier: 2 }).success).toBe(false);
  });
});

describe("vehicles and snapshot consistency", () => {
  it.each([
    ["reverse route", { intendedExit: "north" }], ["wrong travel direction", { travelDirection: "north" }],
    ["wrong lane", { laneId: "south-inbound" }], ["negative velocity", { velocityMps: -1 }],
    ["infinite position", { position: { x: Infinity, y: 0, z: 0 } }],
    ["unbounded acceleration", { accelerationMps2: 50 }], ["spawn before demand", { requestedAtSimMs: 100, spawnedAtSimMs: 0 }],
    ["ordinary emergency car", { type: "car", emergency: true }], ["negative wait", { waitingTimeMs: -100 }],
  ])("rejects %s", (_name, changes) => {
    expect(VehicleStateSchema.safeParse({ ...snapshot.vehicles[0], ...changes }).success).toBe(false);
  });
  it("allows a police vehicle without emergency priority", () => {
    expect(VehicleStateSchema.safeParse({ ...snapshot.vehicles[0], type: "police", emergency: false }).success).toBe(true);
  });
  it.each([
    ["duplicate vehicle", (s: SimulationSnapshot) => { s.vehicles[1]!.id = s.vehicles[0]!.id; }],
    ["unknown occupancy", (s: SimulationSnapshot) => { s.occupiedVehicleIds = ["absent"]; }],
    ["count mismatch", (s: SimulationSnapshot) => { s.vehicles.pop(); }],
    ["future spawn", (s: SimulationSnapshot) => { s.vehicles[0]!.spawnedAtSimMs = 20000; }],
    ["off-step time", (s: SimulationSnapshot) => { s.simulationTimeMs = 12001; }],
    ["excess wait", (s: SimulationSnapshot) => { s.vehicles[0]!.waitingTimeMs = 50000; }],
    ["wrong agent order", (s: SimulationSnapshot) => { s.agents.reverse(); }],
    ["false live label", (s: SimulationSnapshot) => { s.config.demoMode = "live"; }],
    ["green past maximum", (s: SimulationSnapshot) => { s.simulationTimeMs = 45000; }],
    ["shortened safety minimum", (s: SimulationSnapshot) => { s.signal.earliestEndAtSimMs = 1000; }],
  ])("rejects %s", (_name, change) => {
    const s = clone(snapshot); change(s);
    expect(SimulationSnapshotSchema.safeParse(s).success).toBe(false);
  });
});

describe("signal representation", () => {
  it.each(["NS_GREEN", "NS_YELLOW", "ALL_RED", "EW_GREEN", "EW_YELLOW"] as const)("maps %s to nonconflicting approach lights", phase => {
    const lights = signalLights(phase);
    expect(lights.north).toBe(lights.south); expect(lights.east).toBe(lights.west);
    expect(lights.north === "green" && lights.east === "green").toBe(false);
  });
  it("rejects invalid phases, next-green targets and deadline shapes", () => {
    for (const changes of [{ phase: "BOTH_GREEN" }, { nextGreen: "EW_GREEN" }, { latestEndAtSimMs: null }, { latestEndAtSimMs: 1000 }, { clearanceBlockedByVehicles: true }]) {
      expect(SignalStateSchema.safeParse({ ...snapshot.signal, ...changes }).success).toBe(false);
    }
  });
  it("permits all-red occupancy holds without a forced release deadline", () => {
    expect(SignalStateSchema.safeParse({ ...snapshot.signal, phase: "ALL_RED", latestEndAtSimMs: null, clearanceBlockedByVehicles: true }).success).toBe(true);
  });
  it("requires ordered signal timing and step alignment", () => {
    expect(SignalTimingSchema.safeParse(DEFAULT_SIGNAL_TIMING).success).toBe(true);
    for (const changes of [{ minimumGreenMs: 46000 }, { fixedGreenMs: 46000 }, { yellowMs: 0 }, { allRedMs: 2001 }])
      expect(SignalTimingSchema.safeParse({ ...DEFAULT_SIGNAL_TIMING, ...changes }).success).toBe(false);
  });
});

describe("scenario and control contract", () => {
  it("publishes all nine unique scenarios with validated deterministic triggers", () => {
    expect(ScenariosResponseSchema.safeParse({ protocolVersion: 1, scenarios: SCENARIO_CATALOG }).success).toBe(true);
    expect(SCENARIO_CATALOG.find(s => s.id === "ambulance-priority")!.defaults).toMatchObject({ initialGreen: "EW_GREEN", scheduledEvents: [{ atSimMs: 0, event: { type: "emergency", approach: "north" } }] });
    expect(SCENARIO_CATALOG.find(s => s.id === "jev-failure")!.defaults.scheduledEvents[0]!.event).toMatchObject({ type: "provider_fault", fault: "timeout" });
  });
  it("rejects invalid mixes, out-of-range schedules and duplicate event IDs", () => {
    expect(VehicleMixSchema.safeParse({ car: 1, van: 0.1, bus_truck: 0, ambulance: 0, police: 0 }).success).toBe(false);
    const parameters = clone(snapshot.config.scenario);
    parameters.scheduledEvents[0]!.atSimMs = parameters.durationMs;
    expect(ScenarioParametersSchema.safeParse(parameters).success).toBe(false);
    parameters.scheduledEvents[0]!.atSimMs = 0;
    parameters.scheduledEvents.push(clone(parameters.scheduledEvents[0]!));
    expect(ScenarioParametersSchema.safeParse(parameters).success).toBe(false);
  });
  it("validates all lifecycle actions and prohibits in-place mode switching", () => {
    for (const action of ["start", "pause", "resume", "reset"]) expect(SessionControlRequestSchema.safeParse({ action, requestId: "r", generation: 0 }).success).toBe(true);
    expect(SessionControlRequestSchema.safeParse({ action: "set_speed", speedMultiplier: 20, requestId: "r", generation: 0 }).success).toBe(true);
    expect(SessionControlRequestSchema.safeParse({ action: "set_mode", mode: "ai", requestId: "r", generation: 0 }).success).toBe(false);
    expect(SessionControlRequestSchema.safeParse({ action: "pause", requestId: "r" }).success).toBe(false);
  });
  it("rejects spoofed demo mode, invalid seeds and impossible speeds", () => {
    for (const changes of [{ demoMode: "live" }, { seed: -1 }, { seed: 2 ** 32 }, { speedMultiplier: 0 }, { speedMultiplier: 21 }]) expect(CreateSessionRequestSchema.safeParse({ ...requests.createSession as object, ...changes }).success).toBe(false);
  });
  it("does not accept accelerated runs as real-time comparisons", () => {
    expect(CreateComparisonRequestSchema.safeParse({ ...requests.createComparison as object, execution: "realtime" }).success).toBe(false);
    const comparison = REST_CONTRACT.getComparison.response.parse(responses.getComparison);
    expect(REST_CONTRACT.getComparison.response.safeParse({ ...comparison, demoMode: "live" }).success).toBe(false);
    expect(REST_CONTRACT.getComparison.response.safeParse({ ...comparison, ai: comparison.traditional }).success).toBe(false);
    expect(REST_CONTRACT.getComparison.response.safeParse({ ...comparison, status: "completed", completedAtWallTime: "2026-10-29T18:05:12.000Z" }).success).toBe(false);
  });
});

describe("agent, freshness and JEV wire contracts", () => {
  it("rejects expired-at-creation and malformed proposals", () => {
    for (const changes of [{ expiresAtSimMs: 12000 }, { deadlineWallTime: proposal.createdAtWallTime }, { requestedPhase: "ALL_RED" }, { requestedGreenSeconds: -1 }, { generation: -1 }, { rationale: "" }]) expect(TrafficProposalSchema.safeParse({ ...proposal, ...changes }).success).toBe(false);
  });
  it("records overlapping mock intervals without implying actual inference ran", () => {
    const intervals = events.filter((e): e is Extract<ServerEvent, { type: "agent.status" }> => e.type === "agent.status" && e.payload.lastInference?.outcome === "completed").map(e => e.payload.lastInference!);
    expect(intervals).toHaveLength(2);
    expect(Math.max(...intervals.map(i => Date.parse(i.startedAtWallTime)))).toBeLessThan(Math.min(...intervals.map(i => Date.parse(i.completedAtWallTime!))));
    expect(InferenceIntervalSchema.safeParse({ ...intervals[0], completedAtWallTime: null }).success).toBe(false);
    expect(AgentStatusSchema.safeParse({ ...snapshot.agents[0], group: "EW" }).success).toBe(false);
  });
  it.each([[0.85, "high"], [0.849, "medium"], [0.6, "medium"], [0.599, "low"], [0, "low"], [1, "high"]] as const)("accepts confidence boundary %s as %s", (confidence, confidenceBand) => {
    expect(ArbitrationResultSchema.safeParse({ ...arbitration.result, confidence, confidenceBand, confidencePolicy: DEFAULT_CONFIDENCE_POLICY }).success).toBe(true);
  });
  it("rejects missing confidence, unnormalized distributions and ineligible choices", () => {
    const result = { ...arbitration.result!, confidence: undefined };
    expect(ArbitrationResultSchema.safeParse(result).success).toBe(false);
    expect(ArbitrationResultSchema.safeParse({ ...arbitration.result, probabilities: [{ choice: "GRANT_A", probability: 0.4 }] }).success).toBe(false);
    expect(ArbitrationRecordSchema.safeParse({ ...arbitration, eligibleChoices: ["GRANT_B", "DEFER"] }).success).toBe(false);
    expect(ArbitrationRecordSchema.safeParse({ ...arbitration, proposalA: { ...arbitration.proposalA, generation: 1 } }).success).toBe(false);
  });
  it("represents timeout without a fabricated model result", () => {
    expect(ArbitrationRecordSchema.safeParse({ ...arbitration, status: "failed", result: null, fallbackReason: "timeout" }).success).toBe(true);
    expect(ArbitrationRecordSchema.safeParse({ ...arbitration, status: "failed", result: null }).success).toBe(false);
  });
  it("requires atomic commitment metadata for accepted outcomes", () => {
    const outcome = events.find((e): e is Extract<ServerEvent, { type: "decision.outcome" }> => e.type === "decision.outcome")!.payload;
    expect(DecisionOutcomeSchema.safeParse({ ...outcome, committedStateVersion: null }).success).toBe(false);
  });
});

describe("metrics and reconnection", () => {
  it.each([
    { requestedVehicleCount: 100 }, { spawnedVehicleCount: 100 }, { waitingVehicleCount: 100 },
    { maximumQueueLength: 0 }, { averageCompletedWaitingTimeMs: null }, { emergencyCompletedCount: 2 },
    { totalObservedWaitingTimeMs: 0 }, { jevDecisionCount: 1 },
    { geminiLatency: { sampleCount: 1, meanMs: null, maxMs: null } },
  ])("rejects inconsistent metric aggregates: %j", changes => {
    expect(TrafficMetricsSchema.safeParse({ ...snapshot.metrics, ...changes }).success).toBe(false);
  });
  it("requires matching metadata on reconnect snapshots", () => {
    const event = events[0]!;
    for (const change of [{ sequence: 999 }, { generation: 1 }, { sessionId: "different-session" }, { stateVersion: 0 }]) expect(ServerEventSchema.safeParse({ ...event, ...change }).success).toBe(false);
  });
  it("validates websocket messages, protocol and unknown discriminants", () => {
    expect(SocketQuerySchema.safeParse({ sessionId: "session-demo", protocolVersion: "1" }).success).toBe(true);
    expect(SocketMessageSchema.safeParse({ protocolVersion: 1, type: "pong", requestId: "p", wallTime: "2026-10-29T18:00:00.000Z" }).success).toBe(true);
    expect(ServerEventSchema.safeParse({ ...events[0], protocolVersion: 2 }).success).toBe(false);
    expect(ServerEventSchema.safeParse({ ...events[0], type: "signal.unsafe" }).success).toBe(false);
    expect(ClientEventSchema.safeParse({ protocolVersion: 1, type: "signal.set_green", requestId: "x" }).success).toBe(false);
  });
  it("parses bounded query strings without lossy numeric coercion", () => {
    expect(EventsQuerySchema.parse({ afterSequence: "0", limit: "50" })).toEqual({ afterSequence: 0, limit: 50 });
    for (const limit of ["", "0", "1.5", "-1", "501", "Infinity"]) expect(EventsQuerySchema.safeParse({ limit }).success).toBe(false);
    expect(MetricsQuerySchema.safeParse({ generation: "0", fromSimMs: "100", limit: "1000" }).success).toBe(true);
  });
  it("rejects unordered or cross-session event history", () => {
    const history = REST_CONTRACT.getEvents.response.parse(responses.getEvents);
    expect(REST_CONTRACT.getEvents.response.safeParse({ ...history, events: [...history.events].reverse() }).success).toBe(false);
    expect(REST_CONTRACT.getEvents.response.safeParse({ ...history, sessionId: "elsewhere" }).success).toBe(false);
  });
});
