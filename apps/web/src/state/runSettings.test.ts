import { beforeEach, describe, expect, it } from "vitest";
import { CreateComparisonRequestSchema, CreateSessionRequestSchema, DEFAULT_SIGNAL_TIMING, SCENARIO_CATALOG } from "@intersection/shared";
import { MockIntersectionTransport } from "@/transport/MockIntersectionTransport";
import { MockSimulation } from "@/transport/mock/engine";
import { comparisonOverrides, createRunSettingsStore, defaultRunSettings, loadRunSettings, rememberRun, RUN_SETTINGS_KEY, RunSettingsSchema, sessionOverrides, settingsFromRun } from "./runSettings";

beforeEach(() => localStorage.removeItem(RUN_SETTINGS_KEY));
const scenario = SCENARIO_CATALOG[0];

function customSettings() {
  return {
    ...defaultRunSettings(), seed: 0, speedMultiplier: 2,
    signalTiming: { ...DEFAULT_SIGNAL_TIMING, fixedGreenMs: 12000 },
    scenarioOverrides: { [scenario.id]: { ...scenario.defaults, durationMs: 20_000, arrivalRatesVehPerHour: { north: 650, south: 0, east: 100, west: 80 } } },
  };
}

describe("saved run settings", () => {
  it("persists zero seeds and custom settings across reloads, without affecting presentation preferences", () => {
    const store = createRunSettingsStore();
    store.setState({ settings: customSettings(), lastRun: null });
    expect(loadRunSettings().settings).toEqual(customSettings());
  });

  it("recovers from malformed or outdated local data", () => {
    localStorage.setItem(RUN_SETTINGS_KEY, "broken json");
    expect(loadRunSettings().settings).toEqual(defaultRunSettings());
    localStorage.setItem(RUN_SETTINGS_KEY, JSON.stringify({ settings: { ...customSettings(), seed: -1 } }));
    expect(loadRunSettings().settings).toEqual(defaultRunSettings());
  });

  it("rejects invalid timing, vehicle mixes, fractional seeds and durations excluding scheduled events", () => {
    expect(RunSettingsSchema.safeParse({ ...customSettings(), seed: 1.2 }).success).toBe(false);
    expect(RunSettingsSchema.safeParse({ ...customSettings(), signalTiming: { ...DEFAULT_SIGNAL_TIMING, fixedGreenMs: 1000 } }).success).toBe(false);
    const surge = SCENARIO_CATALOG.find(s => s.id === "sudden-surge")!;
    expect(RunSettingsSchema.safeParse({ ...customSettings(), scenarioOverrides: { [surge.id]: { ...surge.defaults, durationMs: 1000 } } }).success).toBe(false);
    expect(RunSettingsSchema.safeParse({ ...customSettings(), scenarioOverrides: { [scenario.id]: { ...scenario.defaults, vehicleMix: { ...scenario.defaults.vehicleMix, car: 1 } } } }).success).toBe(false);
  });

  it("sends contract-valid overrides to both simulation and comparison APIs", async () => {
    const settings = customSettings();
    const request = CreateSessionRequestSchema.parse({ requestId: "test-settings", mode: "traditional", scenarioId: scenario.id, seed: settings.seed, ...sessionOverrides(settings, scenario.id) });
    const transport = new MockIntersectionTransport();
    const snapshot = await transport.createSession(request);
    expect(snapshot.config).toMatchObject({ seed: 0, speedMultiplier: 2, signalTiming: settings.signalTiming, scenario: settings.scenarioOverrides[scenario.id] });
    const comparison = CreateComparisonRequestSchema.parse({ requestId: "test-comparison", scenarioId: scenario.id, seed: 0, durationMs: 10_000, execution: "accelerated_mock", speedMultiplier: 20, ...comparisonOverrides(settings, scenario.id, 10_000) });
    expect(comparison.scenarioParameters).toEqual({ ...settings.scenarioOverrides[scenario.id], durationMs: 10_000 });
    expect(sessionOverrides(settings, "rush-hour").scenarioParameters).toBeUndefined();
    expect(comparisonOverrides(defaultRunSettings(), scenario.id, 1000)).toEqual({});
    expect(settings.scenarioOverrides[scenario.id].durationMs).toBe(20_000);
  });

  it("restores the actual seed, scenario and timings of a previous run", async () => {
    const transport = new MockIntersectionTransport();
    const snapshot = await transport.createSession({ requestId: "remember", mode: "traditional", scenarioId: scenario.id, seed: 1234, ...sessionOverrides(customSettings(), scenario.id) });
    const restored = settingsFromRun(defaultRunSettings(), rememberRun(snapshot.config));
    expect(restored.seed).toBe(1234);
    expect(restored.signalTiming).toEqual(snapshot.config.signalTiming);
    expect(restored.scenarioOverrides[scenario.id]).toEqual(snapshot.config.scenario);
  });

  it("reproduces traffic and metrics for a reused seed and custom parameters", () => {
    const settings = customSettings();
    const create = () => new MockSimulation({ sessionId: "repeatable", mode: "traditional", scenarioId: scenario.id, seed: settings.seed, parameters: settings.scenarioOverrides[scenario.id], signalTiming: settings.signalTiming, wallClock: () => 0 });
    const a = create(), b = create();
    for (const sim of [a, b]) { sim.control("start", 0); sim.advance(150); }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot().metrics.requestedVehicleCount).toBeGreaterThan(0);
  });
});
