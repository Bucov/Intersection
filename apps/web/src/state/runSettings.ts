import { z } from "zod";
import {
  ControllerModeSchema, ScenarioIdSchema, ScenarioParametersSchema, SignalTimingSchema,
  type ScenarioId, type SessionConfig,
} from "@intersection/shared";
import { createStore } from "./store";

const seedSchema = z.number().int().min(0).max(0xffff_ffff);
export const RunSettingsSchema = z.object({
  scenarioId: ScenarioIdSchema,
  seed: seedSchema.nullable(),
  speedMultiplier: z.number().finite().min(0.1).max(20),
  signalTiming: SignalTimingSchema.nullable(),
  scenarioOverrides: z.partialRecord(ScenarioIdSchema, ScenarioParametersSchema),
});
export type RunSettings = z.infer<typeof RunSettingsSchema>;
const LastRunSchema = z.object({
  mode: ControllerModeSchema, scenarioId: ScenarioIdSchema, seed: seedSchema,
  speedMultiplier: z.number().finite().min(0.1).max(20),
  signalTiming: SignalTimingSchema, scenario: ScenarioParametersSchema,
});
export type LastRun = z.infer<typeof LastRunSchema>;
export interface RunSettingsState { settings: RunSettings; lastRun: LastRun | null }
export const RUN_SETTINGS_KEY = "intersection.run-settings.v1";

export function defaultRunSettings(): RunSettings {
  return { scenarioId: "normal-traffic", seed: null, speedMultiplier: 1, signalTiming: null, scenarioOverrides: {} };
}

export function loadRunSettings(): RunSettingsState {
  try {
    const raw = JSON.parse(localStorage.getItem(RUN_SETTINGS_KEY) ?? "null");
    const settings = RunSettingsSchema.safeParse(raw?.settings);
    const lastRun = LastRunSchema.safeParse(raw?.lastRun);
    return { settings: settings.success ? settings.data : defaultRunSettings(), lastRun: lastRun.success ? lastRun.data : null };
  } catch {
    return { settings: defaultRunSettings(), lastRun: null };
  }
}

export function createRunSettingsStore() {
  const store = createStore<RunSettingsState>(loadRunSettings());
  store.subscribe(() => {
    try { localStorage.setItem(RUN_SETTINGS_KEY, JSON.stringify(store.getState())); } catch { /* Keep working for this tab when storage is unavailable. */ }
  });
  return store;
}

/** Only send overrides the user explicitly saved; keep server defaults otherwise. */
export function sessionOverrides(settings: RunSettings, scenarioId: ScenarioId) {
  return {
    speedMultiplier: settings.speedMultiplier,
    ...(settings.signalTiming ? { signalTiming: settings.signalTiming } : {}),
    ...(settings.scenarioOverrides[scenarioId] ? { scenarioParameters: settings.scenarioOverrides[scenarioId] } : {}),
  };
}

export function comparisonOverrides(settings: RunSettings, scenarioId: ScenarioId, durationMs: number) {
  return {
    ...(settings.signalTiming ? { signalTiming: settings.signalTiming } : {}),
    ...(settings.scenarioOverrides[scenarioId] ? {
      scenarioParameters: { ...settings.scenarioOverrides[scenarioId], durationMs },
    } : {}),
  };
}

export function rememberRun(config: SessionConfig): LastRun {
  return LastRunSchema.parse(config);
}

export function settingsFromRun(settings: RunSettings, run: LastRun): RunSettings {
  return {
    ...settings, scenarioId: run.scenarioId, seed: run.seed, speedMultiplier: run.speedMultiplier,
    signalTiming: run.signalTiming,
    scenarioOverrides: { ...settings.scenarioOverrides, [run.scenarioId]: run.scenario },
  };
}
