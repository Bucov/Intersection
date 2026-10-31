import { afterEach, expect, it } from "vitest";
import * as C from "@intersection/shared";
import { buildApp } from "../src/app.js";
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const { app } of apps.splice(0)) await app.close();
});
async function setup(maxSessions = 32) {
  const x = await buildApp({ timers: false, maxSessions });
  apps.push(x);
  await x.app.ready();
  return x;
}
const create = {
  requestId: "create",
  mode: "traditional",
  scenarioId: "normal-traffic",
  seed: 42,
};
it("serves schema-valid catalog, session controls, metrics and errors with immutable idempotency", async () => {
  const { app, sessions } = await setup();
  for (const [url, schema] of [
    ["/api/health", C.HealthResponseSchema],
    ["/api/config", C.RuntimeConfigResponseSchema],
    ["/api/scenarios", C.ScenariosResponseSchema],
  ] as const)
    expect(schema.safeParse((await app.inject(url)).json()).success).toBe(true);
  const created = await app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: create,
  });
  expect(created.statusCode).toBe(201);
  const first = C.SessionResponseSchema.parse(created.json()),
    id = first.snapshot.sessionId;
  const control = async (action: string, generation = 0, extra = {}) =>
    app.inject({
      method: "POST",
      url: `/api/sessions/${id}/control`,
      payload: { requestId: action, generation, action, ...extra },
    });
  expect((await control("start")).statusCode).toBe(200);
  sessions.tick(200);
  sessions.snapshots();
  expect(sessions.get(id).sim.now()).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: create,
      })
    ).json(),
  ).toEqual(created.json());
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { ...create, seed: 3 },
      })
    ).statusCode,
  ).toBe(409);
  const reset = await control("reset");
  expect(reset.statusCode).toBe(200);
  expect((await control("reset")).json()).toEqual(reset.json());
  const stale = await app.inject({
    method: "POST",
    url: `/api/sessions/${id}/control`,
    payload: { requestId: "stale", action: "start", generation: 0 },
  });
  expect(stale.statusCode).toBe(409);
  expect(C.ErrorEnvelopeSchema.parse(stale.json()).error.code).toBe(
    "STALE_GENERATION",
  );
  expect(
    C.MetricsResponseSchema.safeParse(
      (await app.inject(`/api/sessions/${id}/metrics`)).json(),
    ).success,
  ).toBe(true);
  expect(
    C.EventsResponseSchema.safeParse(
      (await app.inject(`/api/sessions/${id}/events`)).json(),
    ).success,
  ).toBe(true);
  expect(
    (await app.inject(`/api/sessions/${id}/events?limit=0`)).statusCode,
  ).toBe(422);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: { "content-type": "application/json" },
        payload: "{",
      })
    ).statusCode,
  ).toBe(400);
});
it("isolates sessions, bounds capacity, handles injection and reports history expiration", async () => {
  const { app, sessions } = await setup(2);
  const ids = [];
  for (const requestId of ["one", "two"])
    ids.push(
      (
        await app.inject({
          method: "POST",
          url: "/api/sessions",
          payload: { ...create, requestId },
        })
      ).json().snapshot.sessionId,
    );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/sessions",
        payload: { ...create, requestId: "three" },
      })
    ).statusCode,
  ).toBe(429);
  const a = sessions.get(ids[0]).sim,
    b = sessions.get(ids[1]).sim;
  a.control("start", 0);
  a.advance(300);
  expect(b.now()).toBe(0);
  const inject = await app.inject({
    method: "POST",
    url: `/api/sessions/${ids[0]}/inject`,
    payload: {
      requestId: "ambulance",
      generation: 0,
      event: {
        type: "emergency",
        approach: "east",
        vehicleType: "ambulance",
        responding: true,
      },
    },
  });
  expect(inject.statusCode).toBe(202);
  C.InjectEventResponseSchema.parse(inject.json());
  a.advance(1);
  expect(a.snapshot().vehicles.some((v) => v.emergency)).toBe(true);
  for (let i = 0; i < 2100; i++) a.broadcastSnapshot();
  expect(
    (await app.inject(`/api/sessions/${ids[0]}/events?afterSequence=0`))
      .statusCode,
  ).toBe(410);
});
it("streams full checkpoints, movement, heartbeat, reset and reconnect through actual WebSocket handlers", async () => {
  const { app, sessions } = await setup();
  const id = (
    await app.inject({ method: "POST", url: "/api/sessions", payload: create })
  ).json().snapshot.sessionId;
  const frames: C.SocketMessage[] = [];
  const ws = await app.injectWS(
    `/ws?sessionId=${id}&protocolVersion=1`,
    {},
    {
      onInit: (ws) =>
        ws.on("message", (b) =>
          frames.push(C.SocketMessageSchema.parse(JSON.parse(b.toString()))),
        ),
    },
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(frames[0]?.type).toBe("simulation.snapshot");
  const s = sessions.get(id);
  s.sim.control("start", 0);
  sessions.tick(200);
  sessions.snapshots();
  ws.send(
    JSON.stringify({ protocolVersion: 1, type: "ping", requestId: "ping" }),
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(frames.some((e) => e.type === "pong")).toBe(true);
  expect(
    frames.some(
      (e) => e.type === "simulation.snapshot" && e.simulationTimeMs === 200,
    ),
  ).toBe(true);
  s.sim.control("reset", 0);
  sessions.flush(s);
  await new Promise((r) => setTimeout(r, 5));
  expect(
    frames.some((e) => e.type === "simulation.snapshot" && e.generation === 1),
  ).toBe(true);
  ws.terminate();
  let checkpoint!: C.ServerEvent;
  const again = await app.injectWS(
    `/ws?sessionId=${id}&protocolVersion=1`,
    {},
    {
      onInit: (ws) =>
        ws.once("message", (b) => {
          checkpoint = JSON.parse(b.toString());
        }),
    },
  );
  expect(checkpoint.generation).toBe(1);
  expect(checkpoint.sequence).toBe(s.sim.latestSequence);
  again.terminate();
});

it("applies custom traffic and signal settings and replays a seed, including zero", async () => {
  const { app, sessions } = await setup();
  const parameters = {
    ...C.SCENARIO_CATALOG[0].defaults,
    durationMs: 20_000,
    arrivalRatesVehPerHour: { north: 650, south: 0, east: 100, west: 80 },
  };
  const timing = { ...C.DEFAULT_SIGNAL_TIMING, fixedGreenMs: 12000 };
  const make = async (requestId: string) => {
    const response = await app.inject({ method: "POST", url: "/api/sessions", payload: {
      ...create, requestId, seed: 0, speedMultiplier: 2,
      scenarioParameters: parameters, signalTiming: timing,
    } });
    expect(response.statusCode).toBe(201);
    const snapshot = C.SessionResponseSchema.parse(response.json()).snapshot;
    expect(snapshot.config).toMatchObject({ seed: 0, speedMultiplier: 2, signalTiming: timing, scenario: parameters });
    return sessions.get(snapshot.sessionId).sim;
  };
  const a = await make("custom-a"), b = await make("custom-b");
  for (const sim of [a, b]) { sim.control("start", 0); sim.advance(150); }
  const demand = (sim: typeof a) => sim.drain().filter(e => e.type === "simulation.vehicle_event" && e.payload.kind === "requested").map(e => ({ at: e.simulationTimeMs, payload: e.payload }));
  expect(demand(a)).toEqual(demand(b));
  expect(a.snapshot().metrics.requestedVehicleCount).toBeGreaterThan(0);
  expect(a.snapshot().metrics).toEqual(b.snapshot().metrics);
  a.control("reset", 0);
  expect(a.snapshot().config).toMatchObject({ seed: 0, signalTiming: timing, scenario: parameters });
  expect(a.snapshot().simulationTimeMs).toBe(0);
});
