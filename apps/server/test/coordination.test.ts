import { afterEach, expect, it } from "vitest";
import { ModelMessageItem } from "@mozaik-ai/core";
import { MockJevAdapter, type MockFixture } from "mozaik-jev-adapter";
import * as C from "@intersection/shared";
import { AIService, type AgentRunner } from "../src/ai/service.js";
import { readConfig } from "../src/ai/config.js";
import { ObservationSchema, ProposalSchema } from "../src/ai/schemas.js";
import { buildApp } from "../src/app.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});
export async function settle(condition: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Timed out waiting for cycle");
}
async function setup(
  fixture: MockFixture = "agent-a",
  runner?: AgentRunner,
  latency = 0,
) {
  const cfg = { ...readConfig({}), fixture, mockLatencyMs: 10 };
  const provider = latency
    ? new MockJevAdapter({
        stateSchema: ObservationSchema,
        proposalSchema: ProposalSchema,
        fixture,
        latencyMs: latency,
      })
    : undefined;
  const ai = new AIService(cfg, runner, provider);
  const x = await buildApp({
    timers: false,
    setup: (e) => ai.attach(e),
    providers: () => ai.providers(),
  });
  await x.app.ready();
  cleanups.push(async () => {
    ai.close();
    await x.app.close();
  });
  const res = await x.app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: {
      requestId: "create",
      mode: "ai",
      scenarioId: "simultaneous-proposals",
      seed: 42,
      autoStart: true,
    },
  });
  const id = res.json().snapshot.sessionId;
  const entry = x.sessions.get(id),
    events: C.ServerEvent[] = [];
  entry.listeners.add((e) => events.push(e));
  return { ...x, ai, id, entry, events };
}
for (const [fixture, phase] of [
  ["agent-a", "completed"],
  ["agent-b", "completed"],
  ["abstain", "abstained"],
  ["low-confidence", "completed"],
  ["timeout", "timed_out"],
  ["error", "failed"],
] as const)
  it(`runs actual adapter bridge ${fixture} through REST and WS`, async () => {
    const { app, sessions, ai, id, entry, events } = await setup(fixture);
    const frames: C.ServerEvent[] = [];
    const ws = await app.injectWS(
      `/ws?sessionId=${id}&protocolVersion=1`,
      {},
      {
        onInit: (ws) =>
          ws.on("message", (b) =>
            frames.push(C.ServerEventSchema.parse(JSON.parse(b.toString()))),
          ),
      },
    );
    sessions.tick(100);
    await settle(() => ai.coordinators.get(id)?.cycle === null);
    sessions.flush(entry);
    await new Promise((r) => setTimeout(r, 5));
    expect(events.some((e) => e.type === "arbitration.conflict")).toBe(true);
    const result = events.find(
      (e) => e.type === "jev.arbitration" && e.payload.bridgePhase === phase,
    );
    expect(result).toBeDefined();
    for (const e of events)
      expect(
        C.ServerEventSchema.safeParse(e).success,
        `${e.type}: ${JSON.stringify(C.ServerEventSchema.safeParse(e))}`,
      ).toBe(true);
    if (fixture.startsWith("agent-"))
      expect(
        events.some(
          (e) =>
            e.type === "decision.outcome" && e.payload.status === "accepted",
        ),
      ).toBe(true);
    else
      expect(events.some((e) => e.type === "arbitration.fallback")).toBe(true);
    expect(
      frames.some(
        (e) => e.type === "jev.arbitration" && e.payload.bridgePhase === phase,
      ),
    ).toBe(true);
    expect(ai.diagnostics).toEqual([]);
    C.SessionResponseSchema.parse(
      (await app.inject(`/api/sessions/${id}`)).json(),
    );
    ws.terminate();
  });
it("discards stale bridge completion when decision revision changes but ticks alone remain current", async () => {
  const { sessions, ai, id, entry, events } = await setup(
    "agent-a",
    undefined,
    70,
  );
  sessions.tick(100);
  await settle(() => ai.bridge.pendingCount === 1);
  entry.sim.advance(2);
  expect(ai.bridge.pendingCount).toBe(1);
  entry.sim.inject(
    { type: "decision_boundary", reason: "simultaneous_proposals" },
    0,
  );
  await settle(() => ai.coordinators.get(id)?.cycle === null);
  sessions.flush(entry);
  expect(
    events.some(
      (e) =>
        e.type === "jev.arbitration" &&
        e.payload.bridgePhase === "discarded" &&
        e.payload.bridgeReason === "stale",
    ),
  ).toBe(true);
  expect(
    events.some(
      (e) => e.type === "decision.outcome" && e.payload.status === "accepted",
    ),
  ).toBe(false);
});
it("bypasses JEV on effective agreement while retaining FSM validation", async () => {
  const { sessions, ai, id, entry, events } = await setup(
    "agent-a",
    async () => ({
      items: [
        ModelMessageItem.rehydrate({
          text: JSON.stringify({
            requestedPhase: "NS_GREEN",
            requestedGreenSeconds: 10,
            summary: "Same plan.",
          }),
        }),
      ],
      tokenUsage: undefined,
      rowResponse: null,
    }),
  );
  sessions.tick(100);
  await settle(() => ai.coordinators.get(id)?.cycle === null);
  sessions.flush(entry);
  expect(
    events.some(
      (e) => e.type === "decision.outcome" && e.payload.status === "accepted",
    ),
  ).toBe(true);
  expect(events.some((e) => e.type === "jev.arbitration")).toBe(false);
});
it("reset prevents old agent and bridge callbacks from repopulating the new generation", async () => {
  const { sessions, ai, id, entry, events } = await setup(
    "agent-a",
    undefined,
    80,
  );
  sessions.tick(100);
  await settle(() => ai.bridge.pendingCount === 1);
  entry.sim.control("reset", 0);
  sessions.flush(entry);
  await new Promise((r) => setTimeout(r, 100));
  sessions.flush(entry);
  expect(entry.sim.generation).toBe(1);
  expect(entry.sim.snapshot().jev.lastArbitration).toBeNull();
  expect(events.filter((e) => e.generation === 1).map((e) => e.type)).toEqual([
    "simulation.snapshot",
  ]);
});
