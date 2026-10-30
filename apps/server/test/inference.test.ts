import { afterEach, expect, it } from "vitest";
import { ModelMessageItem, supportedModels } from "@mozaik-ai/core";
import { AIService, type RunnerTask } from "../src/ai/service.js";
import { readConfig } from "../src/ai/config.js";
import { Sessions } from "../src/sessions.js";
const services: AIService[] = [];
afterEach(() => services.splice(0).forEach((s) => s.close()));
const delay = (n: number) => new Promise((r) => setTimeout(r, n));
async function until(test: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (test()) return;
    await delay(5);
  }
  throw Error("not settled");
}
const output = (task: RunnerTask) => ({
  items: [
    ModelMessageItem.rehydrate({
      text: JSON.stringify({
        requestedPhase: task.agentId === "agent-a" ? "NS_GREEN" : "EW_GREEN",
        requestedGreenSeconds: 10,
        summary: "Offline injected runner.",
      }),
    }),
  ],
  tokenUsage: undefined,
  rowResponse: null,
});
function env(a: "gemini" | "claude", b: "gemini" | "claude") {
  const model = (provider: string) =>
    supportedModels.find(
      (m) =>
        m.specification.provider ===
        (provider === "gemini" ? "google" : "anthropic"),
    )!.specification.name;
  return {
    DEMO_MODE: "live",
    JEV_MODE: "mock",
    AGENT_A_PROVIDER: a,
    AGENT_B_PROVIDER: b,
    AGENT_A_MODEL: model(a),
    AGENT_B_MODEL: model(b),
    GEMINI_API_KEY: "test-placeholder",
    ANTHROPIC_API_KEY: "test-placeholder",
  };
}
function session(ai: AIService) {
  const pool = new Sessions(32, ai.config.mode, ai.config.jevMode);
  const entry = pool.create({
    requestId: "r",
    mode: "ai",
    scenarioId: "simultaneous-proposals",
    seed: 42,
    autoStart: false,
    speedMultiplier: 1,
  });
  ai.attach(entry);
  entry.sim.control("start", 0);
  pool.tick(100);
  return { pool, entry, c: ai.coordinators.get(entry.sim.sessionId)! };
}
for (const [a, b] of [
  ["gemini", "gemini"],
  ["claude", "claude"],
  ["gemini", "claude"],
  ["claude", "gemini"],
] as const)
  it(`starts overlapping genuine Mozaik loops with independent ${a}/${b} routing`, async () => {
    let release!: () => void;
    const barrier = new Promise<void>((r) => (release = r));
    const tasks: RunnerTask[] = [];
    const cfg = { ...readConfig(env(a, b)), mockLatencyMs: 0 };
    const ai = new AIService(cfg, async (input, task) => {
      tasks.push(task);
      expect(input.model).toBe(task.config.model);
      if (tasks.length === 2) release();
      await barrier;
      await delay(15);
      return output(task);
    });
    services.push(ai);
    const { c, entry } = session(ai);
    await until(() => c.cycle === null);
    expect(tasks.map((t) => t.config.provider)).toEqual([a, b]);
    expect(tasks[0].observation).toBe(tasks[1].observation);
    expect(Object.isFrozen(tasks[0].observation.ns)).toBe(true);
    expect(tasks[0].startedAt!).toBeLessThan(tasks[1].endedAt!);
    expect(tasks[1].startedAt!).toBeLessThan(tasks[0].endedAt!);
    expect(entry.sim.snapshot().agents.map((a) => a.provider)).toEqual([a, b]);
    expect(ai.activeInference).toBe(0);
    expect(ai.diagnostics).toEqual([]);
  });
it("requires only selected provider keys and explicit supported model IDs", () => {
  const g = env("gemini", "gemini");
  delete (g as Partial<typeof g>).ANTHROPIC_API_KEY;
  expect(readConfig(g).agents.every((a) => a.reason === null)).toBe(true);
  const c = env("claude", "claude");
  delete (c as Partial<typeof c>).GEMINI_API_KEY;
  expect(readConfig(c).agents.every((a) => a.reason === null)).toBe(true);
  expect(readConfig({ ...g, AGENT_B_MODEL: "" }).agents[1].reason).toMatch(
    /manually selected/,
  );
  expect(
    readConfig({ ...g, AGENT_A_MODEL: "unlisted-model" }).agents[0].reason,
  ).toMatch(/not supported/);
  expect(readConfig({ ...c, ANTHROPIC_API_KEY: "" }).agents[0].reason).toMatch(
    /ANTHROPIC_API_KEY/,
  );
  expect(readConfig({}).agents.every((a) => a.reason === null)).toBe(true);
});
for (const status of [429, 503])
  it(`contains provider ${status} failures without stopping physics or leaking error bodies`, async () => {
    const ai = new AIService(readConfig({}), async () => {
      throw Object.assign(Error("secret-provider-body"), { status });
    });
    services.push(ai);
    const { entry, c } = session(ai);
    await until(() => c.cycle === null);
    entry.sim.advance(100);
    const events = entry.sim.drain();
    expect(entry.sim.now()).toBe(10100);
    expect(
      events.some(
        (e) =>
          e.type === "arbitration.fallback" &&
          e.payload.reason ===
            (status === 429 ? "rate_limit" : "provider_error"),
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain("secret-provider-body");
  });
it("contains invalid JSON and one-agent failure", async () => {
  const ai = new AIService(readConfig({}), async (_input, task) =>
    task.agentId === "agent-a"
      ? output(task)
      : {
          items: [ModelMessageItem.rehydrate({ text: "invalid JSON" })],
          tokenUsage: undefined,
          rowResponse: null,
        },
  );
  services.push(ai);
  const { entry, c } = session(ai);
  await until(() => c.cycle === null);
  expect(
    entry.sim
      .drain()
      .some(
        (e) =>
          e.type === "arbitration.fallback" &&
          e.payload.reason === "invalid_response",
      ),
  ).toBe(true);
});
it("deadline falls back while physical runner retains global capacity; late output cannot execute", async () => {
  const cfg = { ...readConfig({}), deadlineMs: 30, maxInference: 2 };
  let releases: (() => void)[] = [];
  const ai = new AIService(cfg, async (_input, task) => {
    await new Promise<void>((r) => releases.push(r));
    return output(task);
  });
  services.push(ai);
  const { entry, c } = session(ai);
  await until(() => c.cycle === null);
  expect(ai.activeInference).toBe(2);
  expect(entry.sim.snapshot().metrics.deadlineMissCount).toBe(1);
  const other = session(ai);
  expect(other.c.cycle).toBeNull();
  expect(ai.activeInference).toBe(2);
  for (const release of releases) release();
  await until(() => ai.activeInference === 0);
  expect(
    entry.sim
      .drain()
      .some(
        (e) => e.type === "decision.outcome" && e.payload.status === "accepted",
      ),
  ).toBe(false);
});
it("traditional sessions never allocate agents or call providers", async () => {
  let calls = 0;
  const ai = new AIService(readConfig({}), async (_input, task) => {
    calls++;
    return output(task);
  });
  services.push(ai);
  const pool = new Sessions();
  const entry = pool.create({
    requestId: "r",
    mode: "traditional",
    scenarioId: "normal-traffic",
    seed: 3,
    autoStart: false,
    speedMultiplier: 1,
  });
  ai.attach(entry);
  entry.sim.control("start", 0);
  entry.sim.advance(600);
  expect(calls).toBe(0);
  expect(ai.coordinators.size).toBe(0);
  expect(ai.bridge.activeCount).toBe(0);
});
