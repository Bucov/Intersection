import { z } from "zod";
import { ApproachSchema, CounterSchema, IdSchema, InjectedEventSchema, ProvenanceSchema, SignalStateSchema, SimTimeSchema, VehicleStateSchema, WallTimeSchema } from "./domain.js";
import { AgentStatusSchema, ArbitrationRecordSchema, DecisionOutcomeSchema, FallbackReasonSchema, TrafficProposalSchema } from "./coordination.js";
import { ControllerStatusSchema, SessionStatusSchema, SimulationSnapshotSchema, TrafficMetricsSchema } from "./session.js";

export const ErrorCodeSchema = z.enum([
  "VALIDATION_ERROR", "NOT_FOUND", "INVALID_STATE", "STALE_GENERATION", "IDEMPOTENCY_CONFLICT",
  "EVENT_HISTORY_EXPIRED", "UNSUPPORTED_PROTOCOL", "PAYLOAD_TOO_LARGE", "RATE_LIMITED",
  "CAPACITY_EXCEEDED", "PROVIDER_UNAVAILABLE", "INTERNAL_ERROR",
]);
export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema, message: z.string().min(1).max(1000), retryable: z.boolean(),
  issues: z.array(z.object({ path: z.array(z.union([z.string(), CounterSchema])), message: z.string().max(500) })),
});
export const ErrorEnvelopeSchema = z.object({
  protocolVersion: z.literal(1), requestId: IdSchema, error: ErrorDetailSchema,
});
export const SessionStatusPayloadSchema = z.object({
  status: SessionStatusSchema, speedMultiplier: z.number().finite().min(0.1).max(20),
  controller: ControllerStatusSchema,
});
export const VehicleEventPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("requested"), demandId: IdSchema, approach: ApproachSchema, emergency: z.boolean() }),
  z.object({ kind: z.literal("spawned"), demandId: IdSchema, vehicle: VehicleStateSchema }),
  z.object({ kind: z.literal("completed"), demandId: IdSchema, vehicleId: IdSchema, travelTimeMs: SimTimeSchema, waitingTimeMs: SimTimeSchema, signalDelayMs: SimTimeSchema, emergency: z.boolean() }),
  z.object({ kind: z.literal("emergency_detected"), demandId: IdSchema, vehicleId: IdSchema.nullable(), approach: ApproachSchema, stopLineEtaSeconds: z.number().finite().nonnegative().nullable() }),
]);
export const EventEnvelopeShape = {
  protocolVersion: z.literal(1), eventId: IdSchema, correlationId: IdSchema,
  sessionId: IdSchema, generation: CounterSchema, stateVersion: CounterSchema,
  sequence: CounterSchema, simulationTimeMs: SimTimeSchema, wallTime: WallTimeSchema,
  source: z.enum(["simulation", "controller", "agent-a", "agent-b", "jev", "safety", "api"]),
  provenance: ProvenanceSchema, summary: z.string().min(1).max(500),
};

/** Event discriminants and payloads are shared by the socket and REST trace history. */
export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({ ...EventEnvelopeShape, type: z.literal("simulation.snapshot"), payload: SimulationSnapshotSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("simulation.status"), payload: SessionStatusPayloadSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("simulation.vehicle_event"), payload: VehicleEventPayloadSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("simulation.scenario_event"), payload: z.object({ scheduleId: IdSchema, event: InjectedEventSchema, status: z.enum(["scheduled", "applied", "expired"]) }) }),
  z.object({ ...EventEnvelopeShape, type: z.literal("signal.phase_changed"), payload: z.object({ commandId: IdSchema.nullable().optional(), execution: z.literal("applied").optional(), previousPhase: SignalStateSchema.shape.phase, signal: SignalStateSchema, reason: z.enum(["fixed_cycle", "adaptive_command", "maximum_green", "clearance_complete", "reset", "fallback"]) }) }),
  z.object({ ...EventEnvelopeShape, type: z.literal("agent.status"), payload: AgentStatusSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("agent.proposal"), payload: TrafficProposalSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("arbitration.conflict"), payload: z.object({ proposalIds: z.tuple([IdSchema, IdSchema]), reason: z.enum(["mutually_exclusive_phases", "different_service_plans"]) }) }),
  z.object({ ...EventEnvelopeShape, type: z.literal("jev.arbitration"), payload: ArbitrationRecordSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("arbitration.fallback"), payload: z.object({ arbitrationId: IdSchema.nullable(), reason: FallbackReasonSchema, selectedPhase: z.enum(["NS_GREEN", "EW_GREEN", "HOLD"]), policy: z.literal("emergency-fairness-v1") }) }),
  z.object({ ...EventEnvelopeShape, type: z.literal("decision.outcome"), payload: DecisionOutcomeSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("simulation.metrics"), payload: TrafficMetricsSchema }),
  z.object({ ...EventEnvelopeShape, type: z.literal("simulation.error"), payload: ErrorDetailSchema }),
]).superRefine((e, ctx) => {
  if (e.type === "simulation.snapshot") {
    for (const key of ["sessionId", "generation", "stateVersion", "sequence", "simulationTimeMs"] as const) {
      if (e[key] !== e.payload[key]) ctx.addIssue({ code: "custom", path: ["payload", key], message: "Snapshot and envelope metadata must match" });
    }
  }
  if (e.type === "agent.proposal" || e.type === "jev.arbitration") {
    if (e.sessionId !== e.payload.sessionId || e.generation !== e.payload.generation || e.stateVersion < e.payload.stateVersion || e.correlationId !== e.payload.correlationId)
      ctx.addIssue({ code: "custom", path: ["payload"], message: "Event must correlate to the same session generation and an observed version" });
  }
  if ((e.type === "agent.proposal" || e.type === "agent.status") && e.provenance !== e.payload.provenance)
    ctx.addIssue({ code: "custom", path: ["provenance"], message: "Agent provenance must match envelope" });
  if (e.type === "jev.arbitration" && e.payload.result && e.provenance !== e.payload.result.provenance)
    ctx.addIssue({ code: "custom", path: ["provenance"], message: "JEV result provenance must match envelope" });
  if (e.type === "decision.outcome" && (e.correlationId !== e.payload.correlationId || (e.payload.status === "accepted" && e.stateVersion !== e.payload.committedStateVersion)))
    ctx.addIssue({ code: "custom", path: ["payload"], message: "Accepted decision must correlate to the committed event version" });
});
export const ClientEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ protocolVersion: z.literal(1), type: z.literal("simulation.request_snapshot"), requestId: IdSchema, sessionId: IdSchema }),
  z.strictObject({ protocolVersion: z.literal(1), type: z.literal("ping"), requestId: IdSchema }),
]);
export const SocketQuerySchema = z.strictObject({ protocolVersion: z.literal("1"), sessionId: IdSchema });
export const PongSchema = z.object({ protocolVersion: z.literal(1), type: z.literal("pong"), requestId: IdSchema, wallTime: WallTimeSchema });
export const SocketMessageSchema = z.union([ServerEventSchema, PongSchema]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type ServerEvent = z.infer<typeof ServerEventSchema>;
export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type SocketMessage = z.infer<typeof SocketMessageSchema>;
export type VehicleEventPayload = z.infer<typeof VehicleEventPayloadSchema>;
