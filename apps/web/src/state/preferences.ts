import { createStore } from "./store";

export type DataSourcePreference = "auto" | "mock" | "backend";
export type QualityPreference = "auto" | "high" | "low";

/** Local presentation preferences. Simulation parameters are not stored here. */
export interface Preferences {
  dataSource: DataSourcePreference;
  quality: QualityPreference;
}

const STORAGE_KEY = "intersection.preferences.v1";

function envDataSource(): DataSourcePreference {
  const value = import.meta.env.VITE_DATA_SOURCE;
  return value === "mock" || value === "backend" ? value : "auto";
}

export function defaultPreferences(): Preferences {
  return { dataSource: envDataSource(), quality: "auto" };
}

export function loadPreferences(): Preferences {
  const defaults = defaultPreferences();
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      dataSource: parsed.dataSource === "mock" || parsed.dataSource === "backend" || parsed.dataSource === "auto" ? parsed.dataSource : defaults.dataSource,
      quality: parsed.quality === "high" || parsed.quality === "low" || parsed.quality === "auto" ? parsed.quality : defaults.quality,
    };
  } catch {
    return defaults;
  }
}

export function createPreferencesStore() {
  const store = createStore<Preferences>(loadPreferences());
  store.subscribe(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState()));
    } catch {
      // Storage may be unavailable (private mode); preferences then last for the tab.
    }
  });
  return store;
}
