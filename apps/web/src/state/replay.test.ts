import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_TIMING, SCENARIO_CATALOG, type SimulationSnapshot } from "@intersection/shared";
import type { RenderVehicle } from "@/components/scene/interpolation";
import { MockSimulation } from "@/transport/mock/engine";
import { SessionHistory } from "./replay";

function record(seconds: number) {
  const scenario = SCENARIO_CATALOG.find(s => s.id === "normal-traffic")!;
  const sim = new MockSimulation({ sessionId: "replay", mode: "traditional", scenarioId: scenario.id, parameters: scenario.defaults, signalTiming: DEFAULT_SIGNAL_TIMING, seed: 3 });
  const history = new SessionHistory();
  const snapshots: SimulationSnapshot[] = [];
  sim.control("start", 0);
  for (let i = 0; i < seconds * 10; i++) {
    sim.advance(1);
    const snapshot = sim.snapshot();
    snapshots.push(snapshot);
    history.push(snapshot);
  }
  return { history, snapshots };
}

describe("SessionHistory", () => {
  it("replays the recorded vehicles and signal at an earlier moment", () => {
    const { history, snapshots } = record(30);
    const past = snapshots.find(s => s.simulationTimeMs === 12_000)!;
    const out: RenderVehicle[] = [];
    const sample = history.sample(12_000, out);
    expect(sample.phase).toBe(past.signal.phase);
    // Frames are kept every 200 ms and interpolated, so a vehicle arriving in between may be one frame late.
    expect(Math.abs(sample.count - past.vehicles.length)).toBeLessThanOrEqual(1);
    const drawn = out.slice(0, sample.count);
    for (const vehicle of past.vehicles) {
      const match = drawn.find(v => v.id === vehicle.id);
      if (!match) continue;
      expect(Math.abs(match.x - vehicle.position.x)).toBeLessThan(0.5);
      expect(Math.abs(match.z - vehicle.position.z)).toBeLessThan(0.5);
    }
    expect(drawn.filter(v => past.vehicles.some(p => p.id === v.id)).length).toBeGreaterThanOrEqual(past.vehicles.length - 1);
  });

  it("keeps the live edge exact while thinning older frames", () => {
    const { history, snapshots } = record(10);
    const latest = snapshots[snapshots.length - 1];
    expect(history.range).toEqual({ start: snapshots[0].simulationTimeMs, end: latest.simulationTimeMs });
    expect(history.phaseAt(latest.simulationTimeMs)).toBe(latest.signal.phase);
  });

  it("starts over when the session is reset", () => {
    const { history, snapshots } = record(5);
    history.push({ ...snapshots[0], generation: snapshots[0].generation + 1, simulationTimeMs: 0 });
    expect(history.range).toEqual({ start: 0, end: 0 });
  });
});
