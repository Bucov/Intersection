// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ComparisonResponseSchema,
  EventsResponseSchema,
  MetricsResponseSchema,
  RuntimeConfigResponseSchema,
  ScenariosResponseSchema,
  SimulationSnapshotSchema,
  type ServerEvent,
} from "@intersection/shared";
import { MOCK_RUNTIME_CONFIG, MockIntersectionTransport } from "./MockIntersectionTransport";

const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

async function open(transport = new MockIntersectionTransport(), mode: "ai" | "traditional" = "ai", scenarioId: "normal-traffic" | "simultaneous-proposals" = "normal-traffic") {
  const received: ServerEvent[] = [];
  transport.subscribe(e => received.push(e));
  const snapshot = await transport.createSession({ requestId: `create-${mode}-${scenarioId}`, mode, scenarioId, seed: 3 });
  await transport.connect(snapshot.sessionId);
  await nextTick();
  return { transport, snapshot, received };
}

describe("MockIntersectionTransport", () => {
  it("publishes a contract-valid runtime config and catalog", async () => {
    const transport = new MockIntersectionTransport();
    expect(RuntimeConfigResponseSchema.safeParse(MOCK_RUNTIME_CONFIG).success).toBe(true);
    const catalog = await transport.loadCatalog();
    expect(ScenariosResponseSchema.safeParse({ protocolVersion: 1, scenarios: catalog.scenarios }).success).toBe(true);
    expect(catalog.config.demoMode).toBe("mock");
  });

  it("creates a session and sends a checkpoint first on connect", async () => {
    const { snapshot, received } = await open();
    expect(SimulationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.status).toBe("ready");
    expect(received[0].type).toBe("simulation.snapshot");
    expect(received[0].sequence).toBe(snapshot.sequence);
  });

  it("returns the same session for a retried creation request", async () => {
    const transport = new MockIntersectionTransport();
    const a = await transport.createSession({ requestId: "same-id", mode: "ai", scenarioId: "normal-traffic", seed: 1 });
    const b = await transport.createSession({ requestId: "same-id", mode: "ai", scenarioId: "normal-traffic", seed: 1 });
    expect(b.sessionId).toBe(a.sessionId);
  });

  it("rejects invalid requests with contract error codes", async () => {
    const transport = new MockIntersectionTransport();
    await expect(transport.createSession({ requestId: "x", mode: "traditional", scenarioId: "jev-failure", seed: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(transport.createSession({ requestId: "bad id!", mode: "ai", scenarioId: "normal-traffic", seed: 1 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const { snapshot } = await open(transport);
    await expect(transport.sendCommand({ kind: "control", sessionId: snapshot.sessionId, body: { requestId: "p-1", generation: 0, action: "pause" } })).rejects.toMatchObject({ code: "INVALID_STATE", status: 409 });
    await expect(transport.sendCommand({ kind: "control", sessionId: snapshot.sessionId, body: { requestId: "s-1", generation: 7, action: "start" } })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    await expect(transport.sendCommand({ kind: "control", sessionId: "missing", body: { requestId: "s-2", generation: 0, action: "start" } })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("runs controls and injections through the contract shapes", async () => {
    const { transport, snapshot, received } = await open();
    const started = await transport.sendCommand({ kind: "control", sessionId: snapshot.sessionId, body: { requestId: "start-1", generation: 0, action: "start" } });
    expect(started.kind === "control" && started.snapshot.status).toBe("running");
    const injected = await transport.sendCommand({
      kind: "inject",
      sessionId: snapshot.sessionId,
      body: { requestId: "amb-1", generation: 0, event: { type: "emergency", approach: "west", vehicleType: "ambulance", responding: true } },
    });
    // Running sessions schedule injections at the next 100 ms step (contract).
    expect(injected.kind === "inject" && injected.response.scheduledAtSimMs).toBe(100);
    expect(received.some(e => e.type === "simulation.scenario_event" && e.payload.status === "scheduled")).toBe(true);
    const reset = await transport.sendCommand({ kind: "control", sessionId: snapshot.sessionId, body: { requestId: "reset-1", generation: 0, action: "reset" } });
    expect(reset.kind === "control" && reset.snapshot.generation).toBe(1);
    expect(received.at(-1)?.type).toBe("simulation.snapshot");
    await transport.disconnect();
  });

  it("serves history and metrics in the contract shapes", async () => {
    const { transport, snapshot } = await open();
    await transport.sendCommand({ kind: "control", sessionId: snapshot.sessionId, body: { requestId: "start-2", generation: 0, action: "start" } });
    const history = await transport.getEvents(snapshot.sessionId, { limit: "5" });
    expect(EventsResponseSchema.safeParse(history).success).toBe(true);
    const metrics = await transport.getMetrics(snapshot.sessionId);
    expect(MetricsResponseSchema.safeParse(metrics).success).toBe(true);
    await expect(transport.getMetrics(snapshot.sessionId, { generation: "4" })).rejects.toMatchObject({ code: "STALE_GENERATION" });
    await transport.disconnect();
  });

  it("runs a paired comparison with isolated, read-only sessions", async () => {
    const transport = new MockIntersectionTransport();
    const created = await transport.createComparison({ requestId: "cmp-1", scenarioId: "rush-hour", seed: 11, durationMs: 60_000, execution: "accelerated_mock", speedMultiplier: 20 });
    expect(ComparisonResponseSchema.safeParse(created).success).toBe(true);
    let result = created;
    for (let i = 0; i < 200 && result.status !== "completed"; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      result = await transport.getComparison(created.comparisonId);
    }
    expect(result.status).toBe("completed");
    expect(ComparisonResponseSchema.safeParse(result).success).toBe(true);
    expect(result.traditional.simulationTimeMs).toBe(60_000);
    expect(result.ai.simulationTimeMs).toBe(60_000);
    // Same seed and schedule: identical demand on both sides.
    expect(result.traditional.metrics.requestedVehicleCount).toBe(result.ai.metrics.requestedVehicleCount);
    expect(result.limitations.length).toBeGreaterThan(0);
    await expect(transport.sendCommand({ kind: "control", sessionId: result.ai.sessionId, body: { requestId: "x-1", generation: 0, action: "pause" } }))
      .rejects.toMatchObject({ code: "INVALID_STATE" });
    const samples = await transport.getMetrics(result.traditional.sessionId, { limit: "1000" });
    expect(samples.samples.length).toBeGreaterThanOrEqual(60);
  });
});
