import "dotenv/config";
import assert from "node:assert/strict";
import { AIService } from "../src/ai/service.js";
import { readConfig } from "../src/ai/config.js";
import { Sessions } from "../src/sessions.js";
if (process.env.RUN_LIVE_SMOKE !== "1") {
  console.log(
    "SKIPPED: set RUN_LIVE_SMOKE=1 explicitly to send synthetic traffic observations to the configured providers and TypeSafe.",
  );
  process.exit(0);
}
const config = readConfig({
  ...process.env,
  DEMO_MODE: "live",
  JEV_MODE: "live",
});
if (config.agents.some((a) => a.reason) || !process.env.TYPESAFE_API_KEY) {
  console.log(
    "SKIPPED: both manually selected supported agent models, their provider keys, and TYPESAFE_API_KEY are required.",
  );
  process.exit(0);
}
const ai = new AIService(config);
const sessions = new Sessions(2, "live", "live");
const entry = sessions.create({
  requestId: "live-smoke",
  mode: "ai",
  scenarioId: "simultaneous-proposals",
  seed: 42,
  autoStart: false,
  speedMultiplier: 1,
});
ai.attach(entry);
entry.sim.control("start", 0);
let conflict = false,
  liveJev = false,
  selected = false,
  overlap = false;
let cycles = 0;
try {
  const end = Date.now() + 35000;
  while (Date.now() < end && (!liveJev || !overlap) && cycles < 3) {
    sessions.tick(100);
    await new Promise((r) => setTimeout(r, 100));
    const history = entry.sim.eventHistory(undefined, 500).events;
    conflict = history.some((e) => e.type === "arbitration.conflict");
    liveJev = history.some(
      (e) =>
        e.type === "jev.arbitration" &&
        e.payload.adapterResult?.source === "jev" &&
        e.payload.adapterResult.measurements === "model",
    );
    selected = history.some(
      (e) =>
        e.type === "jev.arbitration" &&
        e.payload.adapterResult?.source === "jev" &&
        e.payload.adapterResult.status === "selected",
    );
    const agents = entry.sim.snapshot().agents.map((a) => a.lastInference);
    if (agents.every((a) => a?.outcome === "completed")) {
      const [a, b] = agents;
      overlap =
        Date.parse(a!.startedAtWallTime) <
          Date.parse(b!.completedAtWallTime!) &&
        Date.parse(b!.startedAtWallTime) < Date.parse(a!.completedAtWallTime!);
    }
    cycles = Math.floor(entry.sim.geminiRequests / 2);
    if (cycles >= 3 && ai.coordinators.get(entry.sim.sessionId)?.cycle)
      cycles = 2;
  }
  console.log(
    JSON.stringify(
      {
        mode: "live",
        providers: config.agents.map((a) => ({
          provider: a.provider,
          model: a.model,
        })),
        conflict,
        liveJev,
        selected,
        overlap,
        intervals: entry.sim.snapshot().agents.map((a) => a.lastInference),
      },
      null,
      2,
    ),
  );
  assert(
    conflict,
    "No actual conflicting cycle observed. No live arbitration proof.",
  );
  assert(liveJev, "No measured live JEV response observed.");
  assert(overlap, "No completed overlapping provider intervals observed.");
} finally {
  ai.close();
  sessions.close();
}
