import { randomUUID } from "node:crypto";
import {
  DEFAULT_SIGNAL_TIMING,
  SCENARIO_CATALOG,
  type ParsedCreateSessionRequest,
  type ServerEvent,
} from "@intersection/shared";
import { Simulation, SimulationError } from "./simulation/engine.js";
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ManagedSession {
  sim: Simulation;
  accumulator: number;
  readOnly: boolean;
  listeners: Set<(event: ServerEvent) => void>;
  poll?: () => void;
  dispose?: () => void;
  settle?: () => Promise<void>;
  externallyDriven?: boolean;
}
export class Sessions {
  readonly entries = new Map<string, ManagedSession>();
  readonly receipts = new Map<string, { body: string; response: unknown }>();
  constructor(
    readonly maxSessions = 32,
    readonly demoMode: "mock" | "live" = "mock",
    readonly jevMode: "mock" | "live" = demoMode,
  ) {}
  get(id: string) {
    const entry = this.entries.get(id);
    if (!entry)
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Unknown session. Sessions do not survive server restarts.",
      );
    return entry;
  }
  create(body: ParsedCreateSessionRequest, readOnly = false) {
    if (this.entries.size >= this.maxSessions)
      throw new ApiError(
        "CAPACITY_EXCEEDED",
        429,
        "Session capacity reached. Restart the local demo server to clear retained sessions.",
      );
    const scenario = SCENARIO_CATALOG.find((s) => s.id === body.scenarioId)!;
    if (!readOnly && !scenario.supportedModes.includes(body.mode))
      throw new ApiError(
        "VALIDATION_ERROR",
        422,
        "Scenario does not support this controller.",
      );
    const sim = new Simulation({
      sessionId: `s-${randomUUID()}`,
      mode: body.mode,
      scenarioId: body.scenarioId,
      parameters: body.scenarioParameters ?? scenario.defaults,
      signalTiming: body.signalTiming ?? DEFAULT_SIGNAL_TIMING,
      seed: body.seed,
      speedMultiplier: body.speedMultiplier,
      demoMode: this.demoMode,
      jevMode: this.jevMode,
    });
    const entry: ManagedSession = {
      sim,
      accumulator: 0,
      readOnly,
      listeners: new Set(),
    };
    this.entries.set(sim.sessionId, entry);
    return entry;
  }
  idempotent<T>(
    scope: string,
    body: { requestId: string },
    action: () => T,
  ): T {
    const key = `${scope}:${body.requestId}`,
      fingerprint = JSON.stringify(body),
      old = this.receipts.get(key);
    if (old) {
      if (old.body !== fingerprint)
        throw new ApiError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "Request ID already used with different content.",
        );
      return structuredClone(old.response) as T;
    }
    if (this.receipts.size >= 20000)
      throw new ApiError(
        "CAPACITY_EXCEEDED",
        429,
        "Idempotency receipt capacity reached; restart the demo server.",
      );
    const response = action();
    this.receipts.set(key, {
      body: fingerprint,
      response: structuredClone(response),
    });
    return response;
  }
  flush(entry: ManagedSession) {
    for (const event of entry.sim.drain())
      for (const listener of entry.listeners) listener(event);
  }
  tick(elapsedMs: number) {
    for (const entry of this.entries.values()) {
      if (entry.externallyDriven) continue;
      if (entry.sim.status === "running") {
        entry.accumulator +=
          Math.min(250, Math.max(0, elapsedMs)) * entry.sim.speedMultiplier;
        const steps = Math.floor(entry.accumulator / 100);
        entry.accumulator -= steps * 100;
        for (let i = 0; i < steps; i++) {
          entry.sim.advance(1);
          entry.poll?.();
        }
      } else entry.accumulator = 0;
      entry.poll?.();
      this.flush(entry);
    }
  }
  snapshots() {
    for (const e of this.entries.values())
      if (e.sim.status === "running") {
        e.sim.broadcastSnapshot();
        this.flush(e);
      }
  }
  close() {
    for (const e of this.entries.values()) {
      e.dispose?.();
      e.listeners.clear();
    }
    this.entries.clear();
    this.receipts.clear();
  }
}
export function writable(entry: ManagedSession) {
  if (entry.readOnly)
    throw new ApiError(
      "INVALID_STATE",
      409,
      "Comparison sessions are read-only.",
    );
}
export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SimulationError)
    return new ApiError(
      error.code,
      error.code === "VALIDATION_ERROR" ? 422 : 409,
      error.message,
    );
  return new ApiError("INTERNAL_ERROR", 500, "Internal server error.");
}
