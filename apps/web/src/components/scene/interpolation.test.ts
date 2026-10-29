// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_TIMING, SCENARIO_CATALOG, type SimulationSnapshot } from "@intersection/shared";
import { MockSimulation } from "@/transport/mock/engine";
import { SnapshotInterpolator, type RenderVehicle } from "./interpolation";

function frames(count: number, scenarioId: "normal-traffic" | "simultaneous-proposals" = "normal-traffic") {
  const scenario = SCENARIO_CATALOG.find(s => s.id === scenarioId)!;
  const sim = new MockSimulation({ sessionId: "interp", mode: "traditional", scenarioId, parameters: { ...scenario.defaults, arrivalRatesVehPerHour: { north: 900, south: 900, east: 900, west: 900 } }, signalTiming: DEFAULT_SIGNAL_TIMING, seed: 9, wallClock: () => 0, retainEvents: 0 });
  sim.control("start", 0);
  const out: SimulationSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    sim.advance(1);
    sim.drain();
    out.push(sim.snapshot());
  }
  return out;
}

describe("SnapshotInterpolator", () => {
  it("interpolates between received snapshots and never runs ahead of the latest", () => {
    const [a, b] = frames(400).slice(-2);
    const interp = new SnapshotInterpolator();
    interp.push(a, 1000);
    interp.push(b, 1100);
    const out: RenderVehicle[] = [];
    // Long after the last snapshot the clock clamps at the newest authoritative time.
    let sample = interp.sample(1100, out);
    for (let t = 1110; t <= 3000; t += 16) sample = interp.sample(t, out);
    expect(sample.simulationTimeMs).toBe(b.simulationTimeMs);
    const moving = b.vehicles.find(v => v.velocityMps > 5 && a.vehicles.some(p => p.id === v.id))!;
    const rendered = out.slice(0, sample.count).find(v => v.id === moving.id)!;
    expect(rendered.x).toBeCloseTo(moving.position.x, 5);
    expect(rendered.z).toBeCloseTo(moving.position.z, 5);
  });

  it("renders a position between two frames mid-interval", () => {
    const [a, b] = frames(300).slice(-2);
    const interp = new SnapshotInterpolator();
    interp.push(a, 0);
    interp.push(b, 0);
    const out: RenderVehicle[] = [];
    // Start one interval behind the newest frame, then advance half an interval.
    interp.sample(0, out);
    const sample = interp.sample(50, out);
    expect(sample.simulationTimeMs).toBeGreaterThan(a.simulationTimeMs);
    expect(sample.simulationTimeMs).toBeLessThan(b.simulationTimeMs);
    const id = b.vehicles.find(v => v.velocityMps > 5 && a.vehicles.some(p => p.id === v.id))!.id;
    const from = a.vehicles.find(v => v.id === id)!;
    const to = b.vehicles.find(v => v.id === id)!;
    const got = out.find(v => v.id === id)!;
    const lo = Math.min(from.position.x, to.position.x) - 1e-6;
    const hi = Math.max(from.position.x, to.position.x) + 1e-6;
    expect(got.x).toBeGreaterThanOrEqual(lo);
    expect(got.x).toBeLessThanOrEqual(hi);
  });

  it("freezes on the latest state when the data is not live", () => {
    const [a, b] = frames(200).slice(-2);
    const interp = new SnapshotInterpolator();
    interp.push(a, 0);
    interp.push(b, 100);
    interp.setLive(false);
    const out: RenderVehicle[] = [];
    let t = 0;
    for (let now = 100; now < 2000; now += 16) t = interp.sample(now, out).simulationTimeMs;
    expect(t).toBe(b.simulationTimeMs);
  });

  it("starts over when the generation changes", () => {
    const [a, b] = frames(50).slice(-2);
    const interp = new SnapshotInterpolator();
    interp.push(a, 0);
    interp.push({ ...b, generation: 1, simulationTimeMs: 0 }, 10);
    expect(interp.latestSimTime).toBe(0);
  });

  it("samples a busy junction cheaply enough for 60 FPS", () => {
    // Twelve queued per approach plus heavy arrivals: a rush-hour-sized junction.
    const snaps = frames(1200, "simultaneous-proposals");
    const busiest = snaps.reduce((best, s) => (s.vehicles.length > best.vehicles.length ? s : best));
    const index = snaps.indexOf(busiest);
    const interp = new SnapshotInterpolator();
    interp.push(snaps[index - 1], 0);
    interp.push(busiest, 100);
    const out: RenderVehicle[] = [];
    const iterations = 2000;
    const started = performance.now();
    for (let i = 0; i < iterations; i++) interp.sample(100 + (i % 100), out);
    const perFrame = (performance.now() - started) / iterations;
    expect(busiest.vehicles.length).toBeGreaterThan(60);
    // A frame at 60 FPS has 16.7 ms; sampling must stay a small fraction of that.
    expect(perFrame).toBeLessThan(0.5);
  });
});
