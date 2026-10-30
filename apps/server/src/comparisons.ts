import { createHash, randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import {
  CreateComparisonRequestSchema,
  ScenarioParametersSchema,
  SCENARIO_CATALOG,
  type ComparisonResponse,
} from "@intersection/shared";
import { ApiError, Sessions, type ManagedSession } from "./sessions.js";
import type { z } from "zod";
export class Comparisons {
  readonly entries = new Map<
    string,
    {
      response: ComparisonResponse;
      traditional: ManagedSession;
      ai: ManagedSession;
    }
  >();
  private closed = false;
  constructor(
    readonly sessions: Sessions,
    readonly setup?: (entry: ManagedSession) => void,
  ) {}
  create(
    body: z.output<typeof CreateComparisonRequestSchema>,
  ): ComparisonResponse {
    if (
      this.entries.size >= 16 ||
      this.sessions.entries.size + 2 > this.sessions.maxSessions
    )
      throw new ApiError(
        "CAPACITY_EXCEEDED",
        429,
        "Comparison capacity reached.",
      );
    if (
      body.execution === "accelerated_mock" &&
      (this.sessions.demoMode !== "mock" || this.sessions.jevMode !== "mock")
    )
      throw new ApiError(
        "VALIDATION_ERROR",
        422,
        "Accelerated comparisons require mock proposal agents and mock JEV.",
      );
    const scenario = SCENARIO_CATALOG.find((s) => s.id === body.scenarioId)!;
    const parsed = ScenarioParametersSchema.safeParse(
      body.scenarioParameters ?? {
        ...scenario.defaults,
        durationMs: body.durationMs,
      },
    );
    if (!parsed.success)
      throw new ApiError(
        "VALIDATION_ERROR",
        422,
        "Comparison duration must include all scheduled scenario events.",
      );
    const parameters = parsed.data,
      id = `compare-${randomUUID()}`;
    const create = (mode: "traditional" | "ai") => {
      const entry = this.sessions.create(
        {
          requestId: `${id}-${mode}`,
          mode,
          scenarioId: body.scenarioId,
          seed: body.seed,
          scenarioParameters: parameters,
          signalTiming: body.signalTiming,
          speedMultiplier: body.speedMultiplier,
          autoStart: false,
        },
        true,
      );
      this.setup?.(entry);
      entry.externallyDriven = body.execution === "accelerated_mock";
      entry.sim.control("start", 0);
      this.sessions.flush(entry);
      return entry;
    };
    const traditional = create("traditional"),
      ai = create("ai");
    // Hash immutable input, never either controller's mutable traffic state. Stable JSON
    // key order is given by the schema and documented in PROJECT_OVERVIEW.md.
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          engine: "sfc32-idm-strict-v1",
          seed: body.seed,
          scenario: parameters,
        }),
      )
      .digest("hex");
    const response: ComparisonResponse = {
      protocolVersion: 1,
      comparisonId: id,
      status: "running",
      createdAtWallTime: new Date().toISOString(),
      completedAtWallTime: null,
      execution: body.execution,
      demoMode: this.sessions.demoMode,
      seed: body.seed,
      scenarioId: body.scenarioId,
      durationMs: body.durationMs,
      speedMultiplier: body.speedMultiplier,
      demandScheduleId: `schedule-${hash.slice(0, 24)}`,
      demandScheduleHash: hash,
      traditional: side(traditional),
      ai: side(ai),
      limitations: [
        "Identical seed, independent demand/trait streams, scenario, horizon and physics; mutable sessions are isolated. This is one simplified simulation, not a traffic benchmark.",
        "Completed-trip averages exclude unfinished trips. Accrued active/upstream wait and backlog remain visible.",
        body.execution === "accelerated_mock"
          ? "Reproducible offline control comparison: actual adapter mock choices; physics pauses between steps at decision boundaries until mock work settles. Wall inference latency is measured, but not simulated as traffic delay. Speed is an acceleration request, not a wall-duration guarantee."
          : "Wall-paced comparison. Live inference timing and decisions can vary; this run is not repeatable. Decision events are retained for inspection.",
        "Demand hash identifies schema-ordered input plus engine version; arrivals and traits are generated independently of controller decisions. No AI advantage is assumed.",
      ],
    };
    const entry = { response, traditional, ai };
    this.entries.set(id, entry);
    if (body.execution === "accelerated_mock")
      void this.run(entry).catch(() => {
        entry.response.status = "failed";
        entry.response.completedAtWallTime = new Date().toISOString();
      });
    return structuredClone(response);
  }
  get(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new ApiError("NOT_FOUND", 404, "Unknown comparison.");
    this.refresh(entry);
    return structuredClone(entry.response);
  }
  private refresh(entry: {
    response: ComparisonResponse;
    traditional: ManagedSession;
    ai: ManagedSession;
  }) {
    entry.response.traditional = side(entry.traditional);
    entry.response.ai = side(entry.ai);
    if (
      entry.traditional.sim.status === "completed" &&
      entry.ai.sim.status === "completed"
    ) {
      entry.response.status = "completed";
      entry.response.completedAtWallTime ??= new Date().toISOString();
    }
  }
  private async run(entry: {
    response: ComparisonResponse;
    traditional: ManagedSession;
    ai: ManagedSession;
  }) {
    let steps = 0;
    while (!this.closed && entry.response.status === "running") {
      // Provider waits belong to the comparison driver, never to a physics tick.
      for (const e of [entry.traditional, entry.ai]) {
        e.sim.advance(1);
        e.poll?.();
        await e.settle?.();
        this.sessions.flush(e);
      }
      this.refresh(entry);
      if (++steps % 50 === 0) await yieldTurn();
    }
  }
  close() {
    this.closed = true;
  }
}
function side(entry: ManagedSession) {
  return {
    sessionId: entry.sim.sessionId,
    generation: entry.sim.generation,
    simulationTimeMs: entry.sim.now(),
    metrics: entry.sim.currentMetrics(),
  };
}
