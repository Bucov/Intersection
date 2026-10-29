// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNAL_TIMING,
  SCENARIO_CATALOG,
  ServerEventSchema,
  SimulationSnapshotSchema,
  type ControllerMode,
  type ScenarioDefinition,
  type ServerEvent,
} from "@intersection/shared";
import { MockSimulation } from "./engine";

const WALL_START = Date.parse("2026-10-29T18:00:00.000Z");

function createRun(scenario: ScenarioDefinition, mode: ControllerMode, seed = 42) {
  let wall = WALL_START;
  const sim = new MockSimulation({
    sessionId: `test-${scenario.id}-${mode}`,
    mode,
    scenarioId: scenario.id,
    parameters: scenario.defaults,
    signalTiming: DEFAULT_SIGNAL_TIMING,
    seed,
    wallClock: () => wall,
  });
  const events: ServerEvent[] = [];
  return {
    sim,
    events,
    start() {
      sim.control("start", sim.generation);
      events.push(...sim.drain());
    },
    run(seconds: number, onStep?: () => void) {
      for (let i = 0; i < seconds * 10 && sim.status === "running"; i++) {
        wall += 100;
        sim.advance(1);
        if (i % 5 === 4) sim.broadcastSnapshot();
        events.push(...sim.drain());
        onStep?.();
      }
    },
  };
}

function firstIssue(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  if (result.success || !result.error) return null;
  const issue = result.error.issues[0];
  return `${issue.path.join(".")}: ${issue.message}`;
}

describe("offline demo engine", () => {
  for (const scenario of SCENARIO_CATALOG) {
    for (const mode of scenario.supportedModes) {
      it(`emits contract-valid events and snapshots for ${scenario.id} (${mode})`, () => {
        const run = createRun(scenario, mode);
        expect(firstIssue(SimulationSnapshotSchema.safeParse(run.sim.snapshot()))).toBeNull();
        run.start();
        run.run(90, () => {
          if (run.sim.simulationTimeMs % 2000 === 0) {
            expect(firstIssue(SimulationSnapshotSchema.safeParse(run.sim.snapshot()))).toBeNull();
          }
        });
        let previous = 0;
        for (const event of run.events) {
          const issue = firstIssue(ServerEventSchema.safeParse(event));
          expect(issue, `${event.type} #${event.sequence}`).toBeNull();
          expect(event.sequence).toBe(previous + 1);
          previous = event.sequence;
        }
      });
    }
  }

  it("never lets a vehicle cross its stop line on red", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "rush-hour")!;
    for (const mode of ["traditional", "ai"] as const) {
      const run = createRun(scenario, mode, 7);
      run.start();
      let previous = new Map(run.sim.snapshot().vehicles.map(v => [v.id, v]));
      run.run(240, () => {
        const snapshot = run.sim.snapshot();
        const { phase, phaseStartedAtSimMs } = snapshot.signal;
        for (const vehicle of snapshot.vehicles) {
          const before = previous.get(vehicle.id);
          if (!before) continue;
          const frontBefore = alongTravel(before) + before.lengthM / 2;
          const frontNow = alongTravel(vehicle) + vehicle.lengthM / 2;
          if (frontBefore <= -10 && frontNow > -10) {
            const group = vehicle.approach === "north" || vehicle.approach === "south" ? "NS" : "EW";
            const ownPhase = phase.startsWith(group);
            const lateYellowCommit = phase === "ALL_RED" && snapshot.simulationTimeMs - phaseStartedAtSimMs <= 2000;
            expect(ownPhase || lateYellowCommit, `${vehicle.id} crossed during ${phase} at ${snapshot.simulationTimeMs}`).toBe(true);
          }
        }
        previous = new Map(snapshot.vehicles.map(v => [v.id, v]));
      });
    }
  });

  it("is deterministic for the same seed", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "simultaneous-proposals")!;
    const a = createRun(scenario, "ai", 99);
    const b = createRun(scenario, "ai", 99);
    a.start();
    b.start();
    a.run(60);
    b.run(60);
    const strip = (s: ReturnType<MockSimulation["snapshot"]>) => ({ ...s, sessionId: "x" });
    expect(strip(a.sim.snapshot())).toEqual(strip(b.sim.snapshot()));
  });

  it("gives traditional and AI sessions the same demand schedule", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "normal-traffic")!;
    const requests = (mode: ControllerMode) => {
      const run = createRun(scenario, mode, 2026);
      run.start();
      run.run(180);
      return run.events
        .filter(e => e.type === "simulation.vehicle_event" && e.payload.kind === "requested")
        .map(e => [e.simulationTimeMs, e.type === "simulation.vehicle_event" && e.payload.kind === "requested" ? e.payload.approach : ""]);
    };
    const traditional = requests("traditional");
    expect(traditional.length).toBeGreaterThan(20);
    expect(requests("ai")).toEqual(traditional);
  });

  it("runs the AI pipeline: concurrent inference, arbitration and a safety decision", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "simultaneous-proposals")!;
    const run = createRun(scenario, "ai");
    run.start();
    run.run(30);
    const types = new Set(run.events.map(e => e.type));
    for (const type of ["agent.status", "agent.proposal", "arbitration.conflict", "jev.arbitration", "decision.outcome", "signal.phase_changed"] as const) {
      expect(types.has(type), type).toBe(true);
    }
    // Both agents start inference at the same simulation time (overlapping intervals).
    const starts = run.events.filter(e => e.type === "agent.status" && e.payload.status === "inference");
    expect(starts[0].simulationTimeMs).toBe(starts[1].simulationTimeMs);
    expect(new Set(starts.slice(0, 2).map(e => e.source))).toEqual(new Set(["agent-a", "agent-b"]));
    // Every model output in the offline demo is labeled mock.
    for (const event of run.events) {
      if (event.source === "agent-a" || event.source === "agent-b" || event.source === "jev") expect(event.provenance).toBe("mock");
    }
  });

  it("falls back deterministically when JEV times out", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "jev-failure")!;
    const run = createRun(scenario, "ai");
    run.start();
    run.run(30);
    const failed = run.events.find(e => e.type === "jev.arbitration" && e.payload.status === "failed");
    expect(failed).toBeDefined();
    const fallback = run.events.find(e => e.type === "arbitration.fallback");
    expect(fallback?.type === "arbitration.fallback" && fallback.payload.reason).toBe("timeout");
    expect(run.sim.snapshot().metrics.jevDecisionCount).toBe(0);
  });

  it("reports injected low confidence as low-band mock output and falls back", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "jev-uncertainty")!;
    const run = createRun(scenario, "ai");
    run.start();
    run.run(30);
    const completed = run.events.find(e => e.type === "jev.arbitration" && e.payload.status === "completed");
    expect(completed?.type === "jev.arbitration" && completed.payload.result?.confidenceBand).toBe("low");
    expect(completed?.type === "jev.arbitration" && completed.payload.result?.provenance).toBe("mock");
    expect(run.events.some(e => e.type === "arbitration.fallback" && e.payload.reason === "low_confidence")).toBe(true);
  });

  it("pauses, resumes and resets with contract semantics", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "competing-priorities")!;
    const run = createRun(scenario, "ai");
    run.start();
    run.run(5);
    run.sim.control("pause", 0);
    const pausedAt = run.sim.simulationTimeMs;
    run.sim.advance(10);
    expect(run.sim.simulationTimeMs).toBe(pausedAt);
    expect(() => run.sim.control("pause", 0)).toThrow(/Cannot pause/);
    run.sim.control("resume", 0);
    run.run(2);
    const sequenceBefore = run.sim.latestSequence;
    const versionBefore = run.sim.stateVersion;
    run.sim.control("reset", 0);
    const events = run.sim.drain();
    expect(events[0].type).toBe("simulation.snapshot");
    expect(events[0].generation).toBe(1);
    expect(events[0].sequence).toBe(sequenceBefore + 1);
    const snapshot = run.sim.snapshot();
    expect(snapshot.status).toBe("ready");
    expect(snapshot.simulationTimeMs).toBe(0);
    expect(snapshot.stateVersion).toBeGreaterThan(versionBefore);
    expect(snapshot.vehicles).toHaveLength(24);
    expect(() => run.sim.control("start", 0)).toThrow(/Generation 0/);
  });

  it("schedules an injected ambulance and spawns it", () => {
    const scenario = SCENARIO_CATALOG.find(s => s.id === "normal-traffic")!;
    const run = createRun(scenario, "traditional");
    run.start();
    run.run(2);
    const response = run.sim.inject({ type: "emergency", approach: "east", vehicleType: "ambulance", responding: true }, 0);
    expect(response.scheduledAtSimMs).toBe(run.sim.simulationTimeMs + 100);
    run.run(3);
    expect(run.sim.snapshot().vehicles.some(v => v.type === "ambulance" && v.emergency && v.approach === "east")).toBe(true);
  });
});

function alongTravel(v: { approach: string; position: { x: number; z: number } }): number {
  switch (v.approach) {
    case "north": return v.position.z;
    case "south": return -v.position.z;
    case "east": return -v.position.x;
    default: return v.position.x;
  }
}
