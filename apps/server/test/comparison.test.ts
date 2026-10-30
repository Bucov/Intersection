import { expect, it } from "vitest";
import {
  ComparisonResponseSchema,
  MetricsResponseSchema,
  type TrafficMetrics,
} from "@intersection/shared";
import { AIService } from "../src/ai/service.js";
import { readConfig } from "../src/ai/config.js";
import { buildApp } from "../src/app.js";
it("compares independent equal-demand sessions reproducibly, preserving read-only sides and idempotency", async () => {
  const ai = new AIService({ ...readConfig({}), mockLatencyMs: 0 });
  const { app, sessions } = await buildApp({
    timers: false,
    setup: (e) => ai.attach(e),
  });
  try {
    const results = [];
    for (const requestId of ["one", "two"]) {
      const body = {
        requestId,
        scenarioId: "competing-priorities",
        seed: 42,
        durationMs: 60000,
        execution: "accelerated_mock",
        speedMultiplier: 20,
      };
      const created = await app.inject({
        method: "POST",
        url: "/api/comparisons",
        payload: body,
      });
      expect(created.statusCode).toBe(202);
      const initial = ComparisonResponseSchema.parse(created.json());
      let result = initial;
      for (let i = 0; i < 300 && result.status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 5));
        result = ComparisonResponseSchema.parse(
          (await app.inject(`/api/comparisons/${initial.comparisonId}`)).json(),
        );
      }
      expect(result.status).toBe("completed");
      expect(result.ai.simulationTimeMs).toBe(60000);
      expect(result.traditional.simulationTimeMs).toBe(60000);
      expect(result.ai.metrics.requestedVehicleCount).toBe(
        result.traditional.metrics.requestedVehicleCount,
      );
      expect(sessions.get(result.ai.sessionId).sim.parameters).not.toBe(
        sessions.get(result.traditional.sessionId).sim.parameters,
      );
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/sessions/${result.ai.sessionId}/control`,
            payload: { requestId: "reset", generation: 0, action: "reset" },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/comparisons",
            payload: body,
          })
        ).json(),
      ).toEqual(created.json());
      const samples = MetricsResponseSchema.parse(
        (
          await app.inject(
            `/api/sessions/${result.ai.sessionId}/metrics?limit=1000`,
          )
        ).json(),
      );
      expect(samples.samples.at(-1)?.simulationTimeMs).toBe(60000);
      results.push(result);
    }
    const physical = (m: TrafficMetrics) => ({
      completed: m.completedVehicleCount,
      wait: m.totalObservedWaitingTimeMs,
      queue: m.timeAverageQueueLength,
      signal: m.signalChangeCount,
      max: m.maximumObservedDelayMs,
    });
    expect(results[0].demandScheduleHash).toBe(results[1].demandScheduleHash);
    for (const mode of ["ai", "traditional"] as const)
      expect(physical(results[0][mode].metrics)).toEqual(
        physical(results[1][mode].metrics),
      );
    const trace = (id: string) =>
      ai.coordinators
        .get(id)!
        .decisionTrace.map(({ cycleId: _id, ...rest }) => rest);
    expect(trace(results[0].ai.sessionId)).toEqual(
      trace(results[1].ai.sessionId),
    );
  } finally {
    ai.close();
    await app.close();
  }
});
it("rejects accelerated live comparisons and event schedules beyond the horizon", async () => {
  const { app } = await buildApp({ timers: false, demoMode: "live" });
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/comparisons",
          payload: {
            requestId: "live",
            scenarioId: "normal-traffic",
            seed: 1,
            durationMs: 60000,
            execution: "accelerated_mock",
          },
        })
      ).statusCode,
    ).toBe(422);
  } finally {
    await app.close();
  }
  const x = await buildApp({ timers: false });
  try {
    expect(
      (
        await x.app.inject({
          method: "POST",
          url: "/api/comparisons",
          payload: {
            requestId: "short",
            scenarioId: "sudden-surge",
            seed: 1,
            durationMs: 10000,
            execution: "accelerated_mock",
          },
        })
      ).statusCode,
    ).toBe(422);
  } finally {
    await x.app.close();
  }
});
