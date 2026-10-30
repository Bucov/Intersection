import type { ProviderStatus } from "@intersection/shared";
import type { DataSourceState } from "@/state/dataSource";
import type { ControllerMeta } from "@/state/SessionController";

export type ConnectionTone = "neutral" | "positive" | "warning" | "negative";

export interface ConnectionSummary {
  label: string;
  tone: ConnectionTone;
  pulsing: boolean;
  detail: string;
}

function providerReady(providers: readonly ProviderStatus[] | null | undefined) {
  if (!providers?.length) return null;
  return providers.every(p => p.status === "ready");
}

/** One honest label for the header: where data comes from and whether it is live. */
export function summarizeConnection(source: DataSourceState, meta: ControllerMeta, sessionProviders: readonly ProviderStatus[] | null): ConnectionSummary {
  const connection = meta.connection;
  if (connection?.source === "backend") {
    switch (connection.state) {
      case "connecting":
        return { label: "Connecting…", tone: "warning", pulsing: true, detail: connection.message ?? "Opening the live event stream." };
      case "reconnecting":
        return { label: "Reconnecting…", tone: "warning", pulsing: true, detail: connection.message ?? "The live stream dropped. Data shown is not live." };
      case "error":
        return { label: "Connection error", tone: "negative", pulsing: false, detail: connection.message ?? "The live stream is unavailable." };
      default: {
        const providers = sessionProviders ?? source.health?.providers ?? null;
        const live = providers?.some(p => p.mode === "live");
        const ready = providerReady(providers);
        if (live && ready) return { label: "Backend ⋅ AI live", tone: "positive", pulsing: false, detail: "Connected to the backend. Gemini and JEV are live." };
        if (live) return { label: "Backend ⋅ AI unavailable", tone: "warning", pulsing: false, detail: "Connected, but Gemini or JEV is not ready. The controller falls back to deterministic rules." };
        return { label: "Backend ⋅ mock AI", tone: "neutral", pulsing: false, detail: "Connected to the backend running in mock mode. Model outputs are simulated." };
      }
    }
  }
  if (source.probing) return { label: "Checking backend…", tone: "neutral", pulsing: true, detail: "Looking for the Intersection backend. The offline demo keeps working meanwhile." };
  if (source.blocked) return { label: "Backend unavailable", tone: "negative", pulsing: false, detail: source.backendNote ?? "The backend is required by your settings but cannot be reached." };
  if (source.kind === "backend") {
    const ready = providerReady(source.health?.providers);
    return { label: ready === false ? "Backend ⋅ AI unavailable" : "Backend ready", tone: ready === false ? "warning" : "positive", pulsing: false, detail: "Sessions will use the backend." };
  }
  return { label: "Offline demo", tone: "neutral", pulsing: false, detail: source.backendNote ? `Simulated in this browser. ${source.backendNote}` : "Simulated in this browser. No backend, no model calls." };
}
