import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import { Comparisons } from "./comparisons.js";
import { z } from "zod";
import * as C from "@intersection/shared";
import {
  ApiError,
  Sessions,
  mapError,
  writable,
  type ManagedSession,
} from "./sessions.js";
export interface AppOptions {
  timers?: boolean;
  demoMode?: "mock" | "live";
  jevMode?: "mock" | "live";
  maxSessions?: number;
  setup?: (entry: ManagedSession) => void;
  providers?: () => [C.ProviderStatus, C.ProviderStatus];
}
export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });
  const sessions = new Sessions(
    options.maxSessions ?? 32,
    options.demoMode ?? "mock",
    options.jevMode ?? options.demoMode ?? "mock",
  );
  const comparisons = new Comparisons(sessions, options.setup);
  const start = Date.now();
  const providers =
    options.providers ??
    (() =>
      [
        {
          provider: "gemini",
          mode: sessions.demoMode,
          status: "unavailable",
          model: null,
          reason: "Agent coordinator not configured.",
        },
        {
          provider: "jev",
          mode: sessions.jevMode,
          status: "unavailable",
          model: null,
          reason: "Arbitration coordinator not configured.",
        },
      ] as [C.ProviderStatus, C.ProviderStatus]);
  const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
    const p = schema.safeParse(input);
    if (!p.success)
      throw new ApiError(
        "VALIDATION_ERROR",
        422,
        p.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
          .slice(0, 900),
      );
    return p.data;
  };
  const get = (params: unknown) =>
    sessions.get(parse(C.SessionPathSchema, params).id);
  const response = (entry: ManagedSession) => ({
    protocolVersion: 1 as const,
    snapshot: entry.sim.snapshot(),
  });
  app.setErrorHandler((error, request, reply) => {
    let e = mapError(error);
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (
      code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      code === "FST_ERR_CTP_EMPTY_JSON_BODY"
    )
      e = new ApiError("VALIDATION_ERROR", 400, "Malformed JSON body.");
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE")
      e = new ApiError("PAYLOAD_TOO_LARGE", 413, "Request exceeds 64 KiB.");
    const id = C.IdSchema.safeParse(
      (request.body as { requestId?: unknown } | null)?.requestId,
    );
    reply
      .code(e.statusCode)
      .send({
        protocolVersion: 1,
        requestId: id.success ? id.data : `r-${randomUUID()}`,
        error: {
          code: e.code,
          message: e.message,
          retryable: e.statusCode >= 500 || e.statusCode === 429,
          issues: [],
        },
      });
  });
  app.setNotFoundHandler(() => {
    throw new ApiError("NOT_FOUND", 404, "Unknown route.");
  });
  await app.register(websocket, { options: { maxPayload: 16384 } });
  app.get("/api/health", () => ({
    protocolVersion: 1,
    status: providers().every((p) => p.status === "ready") ? "ok" : "degraded",
    service: "intersection-server",
    version: "0.2.0",
    uptimeMs: Date.now() - start,
    demoMode: sessions.demoMode,
    providers: providers(),
  }));
  app.get("/api/config", () => ({
    protocolVersion: 1,
    demoMode: sessions.demoMode,
    timestepMs: 100,
    snapshotIntervalMs: 200,
    metricsIntervalMs: 1000,
    eventRetentionCount: 2000,
    maxSessions: sessions.maxSessions,
    speedMultiplierRange: { min: 0.1, max: 20, liveRecommended: 1 },
    signalTiming: C.DEFAULT_SIGNAL_TIMING,
    geometry: C.DEFAULT_GEOMETRY,
    confidencePolicy: C.DEFAULT_CONFIDENCE_POLICY,
    demandPresets: Object.entries(C.DEMAND_PRESETS).map(
      ([id, arrivalRatesVehPerHour]) => ({ id, arrivalRatesVehPerHour }),
    ),
    faultInjectionEnabled: true,
  }));
  app.get("/api/scenarios", () => ({
    protocolVersion: 1,
    scenarios: C.SCENARIO_CATALOG,
  }));
  app.post("/api/sessions", (req, reply) => {
    const body = parse(C.CreateSessionRequestSchema, req.body);
    const result = sessions.idempotent("create", body, () => {
      const entry = sessions.create(body);
      options.setup?.(entry);
      if (body.autoStart) entry.sim.control("start", 0);
      sessions.flush(entry);
      return response(entry);
    });
    reply.code(201);
    return result;
  });
  app.get("/api/sessions/:id", (req) => response(get(req.params)));
  app.post("/api/sessions/:id/control", (req) => {
    const entry = get(req.params),
      body = parse(C.SessionControlRequestSchema, req.body);
    writable(entry);
    return sessions.idempotent(`control:${entry.sim.sessionId}`, body, () => {
      entry.sim.control(
        body.action,
        body.generation,
        body.action === "set_speed" ? body.speedMultiplier : undefined,
      );
      entry.accumulator = 0;
      sessions.flush(entry);
      return response(entry);
    });
  });
  app.post("/api/sessions/:id/inject", (req, reply) => {
    const entry = get(req.params),
      body = parse(C.InjectEventRequestSchema, req.body);
    writable(entry);
    if (
      body.event.type === "provider_fault" &&
      body.event.fault === "low_confidence" &&
      sessions.jevMode === "live"
    )
      throw new ApiError(
        "VALIDATION_ERROR",
        422,
        "Low-confidence fixtures require mock JEV.",
      );
    const result = sessions.idempotent(
      `inject:${entry.sim.sessionId}`,
      body,
      () => {
        const accepted = entry.sim.inject(
          body.event,
          body.generation,
          body.atSimMs,
        );
        sessions.flush(entry);
        return {
          protocolVersion: 1,
          sessionId: entry.sim.sessionId,
          generation: entry.sim.generation,
          ...accepted,
        };
      },
    );
    reply.code(202);
    return result;
  });
  app.get("/api/sessions/:id/events", (req) => {
    const { sim } = get(req.params),
      q = parse(C.EventsQuerySchema, req.query);
    if (q.afterSequence !== undefined && q.afterSequence > sim.latestSequence)
      throw new ApiError(
        "VALIDATION_ERROR",
        422,
        "Cursor exceeds latest event.",
      );
    const h = sim.eventHistory(q.afterSequence, q.limit ?? 100);
    if (h.expired)
      throw new ApiError(
        "EVENT_HISTORY_EXPIRED",
        410,
        "Requested events have expired.",
      );
    return {
      protocolVersion: 1,
      sessionId: sim.sessionId,
      ...h,
      nextAfterSequence:
        h.events.at(-1)?.sequence ?? q.afterSequence ?? h.latestSequence,
    };
  });
  app.get("/api/sessions/:id/metrics", (req) => {
    const { sim } = get(req.params),
      q = parse(C.MetricsQuerySchema, req.query);
    if (q.generation !== undefined && q.generation !== sim.generation)
      throw new ApiError(
        "STALE_GENERATION",
        409,
        "Metrics belong to the current generation only.",
      );
    const all = sim
        .metricsSamples()
        .filter((s) => s.simulationTimeMs >= (q.fromSimMs ?? 0)),
      samples = all.slice(0, q.limit ?? 300);
    return {
      protocolVersion: 1,
      sessionId: sim.sessionId,
      generation: sim.generation,
      simulationTimeMs: sim.now(),
      current: sim.currentMetrics(),
      samples,
      sampleIntervalMs: 1000,
      nextFromSimMs: all[samples.length]?.simulationTimeMs ?? null,
      truncatedBeforeSimMs: sim.metricsSamples()[0]?.simulationTimeMs || null,
    };
  });
  app.post("/api/comparisons", (req, reply) => {
    const body = parse(C.CreateComparisonRequestSchema, req.body);
    const result = sessions.idempotent("comparison", body, () =>
      comparisons.create(body),
    );
    reply.code(202);
    return result;
  });
  app.get("/api/comparisons/:id", (req) =>
    comparisons.get(parse(C.SessionPathSchema, req.params).id),
  );
  let socketCount = 0;
  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (req) => {
        const raw = req.query as { protocolVersion?: unknown };
        if (raw.protocolVersion !== "1")
          throw new ApiError(
            "UNSUPPORTED_PROTOCOL",
            400,
            "Expected protocolVersion=1.",
          );
        const q = parse(C.SocketQuerySchema, req.query),
          e = sessions.get(q.sessionId);
        if (e.listeners.size >= 8 || socketCount >= 128)
          throw new ApiError(
            "CAPACITY_EXCEEDED",
            429,
            "WebSocket capacity reached.",
          );
      },
    },
    (socket, req) => {
      const q = parse(C.SocketQuerySchema, req.query),
        entry = sessions.get(q.sessionId);
      socketCount++;
      const send = (value: unknown) => {
        if (socket.readyState !== 1) return;
        if (socket.bufferedAmount > 512 * 1024) {
          socket.close(1013, "Slow consumer");
          return;
        }
        socket.send(JSON.stringify(value));
      };
      const listener = (event: C.ServerEvent) => send(event);
      entry.listeners.add(listener);
      send(entry.sim.checkpointEvent());
      let invalid = 0;
      socket.on("message", (data: { toString(): string }) => {
        try {
          const frame = C.ClientEventSchema.parse(JSON.parse(data.toString()));
          if (frame.type === "ping")
            send({
              protocolVersion: 1,
              type: "pong",
              requestId: frame.requestId,
              wallTime: new Date().toISOString(),
            });
          else if (frame.sessionId === q.sessionId)
            send(entry.sim.checkpointEvent());
          else throw Error("session");
        } catch {
          invalid++;
          entry.sim.emit(
            "simulation.error",
            {
              code: "VALIDATION_ERROR",
              message: "Invalid socket frame.",
              retryable: false,
              issues: [],
            },
            {
              source: "api",
              provenance: "deterministic",
              summary: "Invalid socket frame.",
            },
          );
          sessions.flush(entry);
          if (invalid >= 3) socket.close(1008, "Invalid frames");
        }
      });
      const shutdown = () => socket.close(1001, "Server shutdown");
      app.server.once("close", shutdown);
      socket.on("close", () => {
        entry.listeners.delete(listener);
        socketCount--;
        app.server.off("close", shutdown);
      });
    },
  );
  let previous = performance.now();
  const timers: ReturnType<typeof setInterval>[] = [];
  if (options.timers !== false) {
    timers.push(
      setInterval(() => {
        const now = performance.now();
        sessions.tick(now - previous);
        previous = now;
      }, 25),
      setInterval(() => sessions.snapshots(), 200),
    );
    timers.forEach((t) => t.unref());
  }
  app.addHook("onClose", async () => {
    timers.forEach(clearInterval);
    comparisons.close();
    sessions.close();
  });
  return { app, sessions, comparisons, parse, setup: options.setup };
}
