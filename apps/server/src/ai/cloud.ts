import { readCachedCredentials } from "@mozaik-ai/cloud-sdk";

export interface CloudStatus {
  enabled: boolean;
  message: string;
}

const DEFAULT_ENDPOINT = "https://api.app.jigjoy.ai";
let filtered = false;

// Mozaik core 4.1 opens a cloud client for every agent loop and logs one line per
// loop (a "watching live" URL when connected, a "no API key" warning otherwise).
// Two loops start per decision cycle, so those lines are collapsed into the single
// startup message returned here.
export function configureMozaikCloud(
  env: NodeJS.ProcessEnv = process.env,
): CloudStatus {
  const requested = env.MOZAIK_CLOUD?.trim().toLowerCase() === "on";
  const endpoint = (env.MOZAIK_CLOUD_ENDPOINT ?? DEFAULT_ENDPOINT).replace(
    /\/$/,
    "",
  );
  const key =
    env.MOZAIK_API_KEY?.trim() ||
    env.MOZAIK_PROJECT_KEY?.trim() ||
    readCachedCredentials(endpoint)?.projectKey ||
    "";
  const enabled = requested && Boolean(key);
  // Core's per-loop clients read MOZAIK_API_KEY first. Pinning it means a blank
  // line in .env cannot hide paired credentials, and an explicit empty key keeps
  // anything from leaving the process unless MOZAIK_CLOUD=on.
  env.MOZAIK_API_KEY = enabled ? key : "";
  silencePerLoopLogs();
  const appUrl = (env.MOZAIK_CLOUD_APP_URL ?? "https://app.jigjoy.ai").replace(
    /\/$/,
    "",
  );
  return {
    enabled,
    message: enabled
      ? `Mozaik cloud: streaming agent loops to ${appUrl} (one cloud session per agent loop).`
      : requested
        ? "Mozaik cloud: MOZAIK_CLOUD=on but no key found. Run `npx @mozaik-ai/cloud-sdk pair` or set MOZAIK_API_KEY in apps/server/.env. Telemetry disabled."
        : "Mozaik cloud: off (set MOZAIK_CLOUD=on to stream agent loops to app.jigjoy.ai).",
  };
}

function silencePerLoopLogs() {
  if (filtered) return;
  filtered = true;
  const { log, warn } = console;
  console.log = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("▶ mozaik cloud — watching live:")
    )
      return;
    log(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].startsWith("mozaik cloud: no API key")
    )
      return;
    warn(...args);
  };
}
