import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGNAL_TIMING,
  SCENARIO_CATALOG,
  ServerEventSchema,
  SimulationSnapshotSchema,
  type VehicleState,
} from "@intersection/shared";
import { Simulation } from "../src/simulation/engine.js";
const make = (seed = 42, mode: "ai" | "traditional" = "traditional") =>
  new Simulation({
    sessionId: "test",
    mode,
    seed,
    scenarioId: "competing-priorities",
    parameters: SCENARIO_CATALOG[5].defaults,
    signalTiming: DEFAULT_SIGNAL_TIMING,
    wallClock: () => 1800000000000,
  });
const along = (v: VehicleState) =>
  v.approach === "north"
    ? v.position.z
    : v.approach === "south"
      ? -v.position.z
      : v.approach === "east"
        ? -v.position.x
        : v.position.x;
function run(sim: Simulation, n = 1800) {
  sim.control("start", 0);
  for (let i = 0; i < n; i++) {
    sim.advance(1);
    sim.drain();
  }
  return sim.snapshot();
}
describe("authoritative simulation", () => {
  it("replays same seed, changes demand with a different seed, and resets deterministically", () => {
    const a = make();
    const first = run(a);
    expect(run(make())).toEqual(first);
    expect(run(make(43)).vehicles).not.toEqual(first.vehicles);
    a.control("reset", 0);
    a.drain();
    a.control("start", 1);
    a.advance(1800);
    expect(a.currentMetrics()).toEqual(first.metrics);
  });
  it("preserves demand and traits across independent controllers", () => {
    const traces = (mode: "ai" | "traditional") => {
      const s = make(17, mode);
      s.control("start", 0);
      const events = [];
      for (let i = 0; i < 1800; i++) {
        s.advance(1);
        events.push(...s.drain());
      }
      return events
        .filter(
          (e) =>
            e.type === "simulation.vehicle_event" &&
            e.payload.kind === "requested",
        )
        .map((e) => [e.simulationTimeMs, e.payload]);
    };
    expect(traces("ai")).toEqual(traces("traditional"));
  });
  it("enforces nonnegative speed, lane gaps and strict green entry over every step", () => {
    const s = make();
    s.control("start", 0);
    let previous = s.snapshot();
    const edges = new Set<string>();
    for (let i = 0; i < 2400; i++) {
      s.advance(1);
      const current = s.snapshot();
      expect(SimulationSnapshotSchema.safeParse(current).success).toBe(true);
      for (const e of s.drain()) {
        expect(ServerEventSchema.safeParse(e).success, e.type).toBe(true);
        if (e.type === "signal.phase_changed")
          edges.add(`${e.payload.previousPhase}:${e.payload.signal.phase}`);
      }
      for (const v of current.vehicles) {
        expect(v.velocityMps).toBeGreaterThanOrEqual(0);
        const old = previous.vehicles.find((p) => p.id === v.id);
        if (
          old &&
          along(old) + old.lengthM / 2 <= -10 &&
          along(v) + v.lengthM / 2 > -10
        )
          expect(current.signal.phase).toBe(
            v.approach === "north" || v.approach === "south"
              ? "NS_GREEN"
              : "EW_GREEN",
          );
      }
      for (const a of ["north", "south", "east", "west"]) {
        const lane = current.vehicles
          .filter((v) => v.approach === a)
          .sort((a, b) => along(b) - along(a));
        for (let j = 1; j < lane.length; j++)
          expect(
            along(lane[j - 1]) -
              lane[j - 1].lengthM / 2 -
              along(lane[j]) -
              lane[j].lengthM / 2,
          ).toBeGreaterThanOrEqual(1.998);
      }
      previous = current;
    }
    expect([...edges].sort()).toEqual([
      "ALL_RED:EW_GREEN",
      "ALL_RED:NS_GREEN",
      "EW_GREEN:EW_YELLOW",
      "EW_YELLOW:ALL_RED",
      "NS_GREEN:NS_YELLOW",
      "NS_YELLOW:ALL_RED",
    ]);
  });
  it("bounds requests and respects minimum green and clearance", () => {
    const s = make(42, "ai");
    s.control("start", 0);
    expect(s.requestGreen("EW_GREEN", 100, "bad")).toBeNull();
    expect(s.requestGreen("EW_GREEN", 8000, "one")).toBe(8000);
    expect(s.requestGreen("EW_GREEN", 8000, "one")).toBeNull();
    s.advance(79);
    expect(s.snapshot().signal.phase).toBe("EW_GREEN"); // scenario starts EW; keep request above
    s.advance(1);
    expect(s.snapshot().signal.phase).toBe("EW_YELLOW");
    expect(s.requestGreen("NS_GREEN", 8000, "clearance")).toBeNull();
    s.advance(30);
    expect(s.snapshot().signal.phase).toBe("ALL_RED");
    s.advance(20);
    expect(s.snapshot().signal.phase).toBe("NS_GREEN");
  });
  it("pauses without logical movement and separates decision revision from tick version", () => {
    const s = make();
    s.control("start", 0);
    const revision = s.decisionStateVersion;
    s.advance(10);
    expect(s.decisionStateVersion).toBe(revision);
    expect(s.stateVersion).toBeGreaterThan(0);
    s.control("pause", 0);
    const before = s.snapshot();
    s.advance(100);
    expect(s.snapshot()).toEqual(before);
    s.control("resume", 0);
    s.advance(1);
    expect(s.now()).toBe(1100);
  });
});

it("serves an accepted opposite-group duration after full clearance and reports application", () => {
  const s = make(42, "ai");
  s.control("start", 0);
  expect(s.requestGreen("NS_GREEN", 10000, "duration-request")).toBe(8000);
  s.advance(130);
  expect(s.snapshot().signal.phase).toBe("NS_GREEN");
  s.advance(99);
  expect(s.snapshot().signal.phase).toBe("NS_GREEN");
  s.advance(1);
  expect(s.snapshot().signal.phase).toBe("NS_YELLOW");
  expect(
    s
      .drain()
      .some(
        (e) =>
          e.type === "signal.phase_changed" &&
          e.payload.commandId === "duration-request" &&
          e.payload.execution === "applied",
      ),
  ).toBe(true);
});
