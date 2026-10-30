import { z } from "zod";
import { CounterSchema, GreenPhaseSchema, IdSchema, NonnegativeSchema, ProbabilitySchema, SignalPhaseSchema, SimTimeSchema, WallTimeSchema } from "./domain.js";

export const AgentIdSchema = z.enum(["agent-a", "agent-b"]);
export const ProviderStatusSchema = z.object({
  provider: z.enum(["gemini", "jev"]),
  mode: z.enum(["mock", "live"]),
  status: z.enum(["ready", "missing_credentials", "degraded", "unavailable", "disabled"]),
  model: z.string().min(1).nullable(),
  reason: z.string().max(500).nullable(),
});
export const InferenceIntervalSchema = z.object({
  inferenceId: IdSchema, correlationId: IdSchema,
  startedAtWallTime: WallTimeSchema, completedAtWallTime: WallTimeSchema.nullable(),
  startedAtSimMs: SimTimeSchema, completedAtSimMs: SimTimeSchema.nullable(),
  latencyMs: NonnegativeSchema.nullable(),
  outcome: z.enum(["pending", "completed", "failed", "cancelled", "stale"]),
}).superRefine((v, ctx) => {
  const pending = v.outcome === "pending";
  if (pending !== (v.completedAtWallTime === null) || pending !== (v.completedAtSimMs === null) || pending !== (v.latencyMs === null))
    ctx.addIssue({ code: "custom", message: "Pending intervals have no completion fields; finished intervals require them" });
  if (v.completedAtWallTime !== null && Date.parse(v.completedAtWallTime) < Date.parse(v.startedAtWallTime))
    ctx.addIssue({ code: "custom", message: "Wall completion must follow start" });
  if (v.completedAtSimMs !== null && v.completedAtSimMs < v.startedAtSimMs)
    ctx.addIssue({ code: "custom", message: "Simulation completion must follow start" });
});
export const AgentStatusSchema = z.object({
  provider: z.enum(["gemini", "claude", "mock"]).optional(),
  latencyMeasurement: z.enum(["wall", "synthetic"]).optional(),
  agentId: AgentIdSchema,
  group: z.enum(["NS", "EW"]),
  status: z.enum(["idle", "inference", "proposal_pending", "cooldown", "error", "disabled"]),
  provenance: z.enum(["mock", "live"]),
  model: z.string().min(1).nullable(),
  lastInference: InferenceIntervalSchema.nullable(),
  latestProposalId: IdSchema.nullable(),
  requestCount: CounterSchema,
  message: z.string().max(500).nullable(),
}).refine(v => v.group === (v.agentId === "agent-a" ? "NS" : "EW"), "Agent group must match identity");

export const TrafficProposalSchema = z.object({
  proposalId: IdSchema, correlationId: IdSchema, agentId: AgentIdSchema,
  sessionId: IdSchema, generation: CounterSchema, stateVersion: CounterSchema,
  createdAtSimMs: SimTimeSchema, expiresAtSimMs: SimTimeSchema,
  createdAtWallTime: WallTimeSchema, deadlineWallTime: WallTimeSchema,
  requestedPhase: GreenPhaseSchema,
  requestedGreenSeconds: z.number().finite().min(1).max(120),
  urgency: z.enum(["low", "normal", "high", "emergency"]),
  observations: z.object({
    queueLength: CounterSchema, maxWaitSeconds: NonnegativeSchema,
    emergencyCount: CounterSchema, estimatedArrivalRateVehPerHour: NonnegativeSchema,
  }),
  rationale: z.string().min(1).max(500),
  provenance: z.enum(["mock", "live"]),
}).superRefine((p, ctx) => {
  if (p.expiresAtSimMs <= p.createdAtSimMs)
    ctx.addIssue({ code: "custom", path: ["expiresAtSimMs"], message: "Proposal must expire after creation" });
  if (Date.parse(p.deadlineWallTime) <= Date.parse(p.createdAtWallTime))
    ctx.addIssue({ code: "custom", path: ["deadlineWallTime"], message: "Wall deadline must follow creation" });
});

export const ArbitrationChoiceSchema = z.enum(["GRANT_A", "GRANT_B", "DEFER"]);
export const ConfidenceBandSchema = z.enum(["high", "medium", "low"]);
export const FallbackReasonSchema = z.enum([
  "missing_credentials", "timeout", "rate_limit", "provider_error", "invalid_response",
  "low_confidence", "medium_confidence_deferred", "stale_result", "deadline_missed", "no_valid_proposal",
]);
export const ConfidencePolicySchema = z.strictObject({
  highThreshold: ProbabilitySchema, mediumThreshold: ProbabilitySchema,
}).refine(p => p.mediumThreshold < p.highThreshold, "Medium threshold must be below high threshold");
export const ArbitrationResultSchema = z.object({
  choice: ArbitrationChoiceSchema,
  probabilities: z.array(z.object({ choice: ArbitrationChoiceSchema, probability: ProbabilitySchema })).min(1).max(3),
  confidence: ProbabilitySchema,
  confidenceBand: ConfidenceBandSchema,
  confidencePolicy: ConfidencePolicySchema,
  model: z.string().min(1).nullable(),
  modelVersion: z.string().min(1).nullable(),
  latencyMs: NonnegativeSchema,
  provenance: z.enum(["mock", "live"]),
}).superRefine((r, ctx) => {
  const choices = r.probabilities.map(p => p.choice);
  if (new Set(choices).size !== choices.length || !choices.includes(r.choice))
    ctx.addIssue({ code: "custom", path: ["probabilities"], message: "Unique probabilities must include selected choice" });
  if (Math.abs(r.probabilities.reduce((n, p) => n + p.probability, 0) - 1) > 1e-6)
    ctx.addIssue({ code: "custom", path: ["probabilities"], message: "Choice probabilities must sum to 1" });
  const band = r.confidence >= r.confidencePolicy.highThreshold ? "high" : r.confidence >= r.confidencePolicy.mediumThreshold ? "medium" : "low";
  if (r.confidenceBand !== band)
    ctx.addIssue({ code: "custom", path: ["confidenceBand"], message: "Band must reflect reported confidence and policy" });
});
export const GroupObservationSchema = z.object({
  queueLength: CounterSchema, maxWaitSeconds: NonnegativeSchema, emergencyCount: CounterSchema,
  nearestEmergencyEtaSeconds: NonnegativeSchema.nullable(),
  lastServedAtSimMs: SimTimeSchema.nullable(), totalGreenMs: SimTimeSchema,
});
export const ArbitrationContextSchema = z.object({
  currentPhase: SignalPhaseSchema,
  ns: GroupObservationSchema, ew: GroupObservationSchema,
  minimumGreenRemainingMs: SimTimeSchema, maximumGreenRemainingMs: SimTimeSchema,
});
/** Lossless adapter boundary. Values are preserved, never synthesized from UI choices. */
export const AdapterResultSchema = z.object({
  requestId: IdSchema, sessionId: IdSchema, cycleId: IdSchema,
  generation: CounterSchema, stateVersion: CounterSchema,
  status: z.enum(["selected", "abstained", "timeout", "error"]),
  selectedCandidateId: IdSchema.nullable(), source: z.enum(["jev", "mock"]),
  measurements: z.enum(["model", "synthetic", "none"]),
  confidence: ProbabilitySchema.nullable(),
  probabilities: z.record(z.string(), ProbabilitySchema).nullable(),
  abstainProbability: ProbabilitySchema.nullable(), latencyMs: NonnegativeSchema,
  errorCode: z.string().optional(),
});
export const ArbitrationRecordSchema = z.object({
  adapterResult: AdapterResultSchema.optional(),
  bridgePhase: z.enum(["started", "completed", "abstained", "failed", "timed_out", "discarded"]).optional(),
  bridgeReason: z.string().optional(),
  decisionStateVersion: CounterSchema.optional(),
  arbitrationId: IdSchema, correlationId: IdSchema, sessionId: IdSchema,
  generation: CounterSchema, stateVersion: CounterSchema,
  proposalA: TrafficProposalSchema, proposalB: TrafficProposalSchema,
  eligibleChoices: z.array(ArbitrationChoiceSchema).min(1).max(3),
  context: ArbitrationContextSchema,
  requestedAtSimMs: SimTimeSchema, requestedAtWallTime: WallTimeSchema,
  deadlineWallTime: WallTimeSchema,
  completedAtWallTime: WallTimeSchema.nullable(),
  status: z.enum(["pending", "completed", "failed", "stale"]),
  result: ArbitrationResultSchema.nullable(),
  fallbackReason: FallbackReasonSchema.nullable(),
}).superRefine((r, ctx) => {
  if (new Set(r.eligibleChoices).size !== r.eligibleChoices.length)
    ctx.addIssue({ code: "custom", path: ["eligibleChoices"], message: "Choices must be unique" });
  if (r.proposalA.agentId !== "agent-a" || r.proposalB.agentId !== "agent-b")
    ctx.addIssue({ code: "custom", message: "Proposal slots must match agent identities" });
  for (const p of [r.proposalA, r.proposalB]) {
    if (p.sessionId !== r.sessionId || p.generation !== r.generation || p.stateVersion > r.stateVersion || p.createdAtSimMs > r.requestedAtSimMs || p.expiresAtSimMs <= r.requestedAtSimMs)
      ctx.addIssue({ code: "custom", message: "Arbitration proposals must belong to this generation and be current at request time" });
  }
  if (Date.parse(r.deadlineWallTime) <= Date.parse(r.requestedAtWallTime))
    ctx.addIssue({ code: "custom", path: ["deadlineWallTime"], message: "Deadline must follow request" });
  if (r.completedAtWallTime !== null && Date.parse(r.completedAtWallTime) < Date.parse(r.requestedAtWallTime))
    ctx.addIssue({ code: "custom", path: ["completedAtWallTime"], message: "Completion cannot precede request" });
  if ((r.status === "pending") !== (r.completedAtWallTime === null) || (r.status === "pending" && (r.result !== null || r.fallbackReason !== null)))
    ctx.addIssue({ code: "custom", message: "Pending arbitration has no completion or result" });
  if (r.status === "completed" && r.result === null && !r.adapterResult)
    ctx.addIssue({ code: "custom", path: ["result"], message: "Completed arbitration requires a provider result" });
  if (r.status === "failed" && r.result !== null)
    ctx.addIssue({ code: "custom", path: ["result"], message: "Provider failure cannot contain a successful result" });
  if ((r.status === "failed" || r.status === "stale") && r.fallbackReason === null)
    ctx.addIssue({ code: "custom", path: ["fallbackReason"], message: "Failed or stale arbitration requires a reason" });
  if (r.result && (r.result.probabilities.length !== r.eligibleChoices.length || r.result.probabilities.some(p => !r.eligibleChoices.includes(p.choice))))
    ctx.addIssue({ code: "custom", path: ["result"], message: "Distribution must cover exactly the eligible actions" });
});
export const DecisionOutcomeSchema = z.object({
  commandId: IdSchema, correlationId: IdSchema,
  proposalIds: z.array(IdSchema).max(2), arbitrationId: IdSchema.nullable(),
  status: z.enum(["accepted", "rejected", "duplicate", "unnecessary"]),
  requestedPhase: GreenPhaseSchema,
  reason: z.enum(["authorized", "stale_generation", "stale_version", "expired", "unsafe_transition", "minimum_green", "maximum_green", "already_scheduled", "duplicate_command", "invalid_proposal", "deadline_missed"]),
  committedStateVersion: CounterSchema.nullable(),
  scheduledAfterSimMs: SimTimeSchema.nullable(),
  summary: z.string().min(1).max(500),
}).refine(v => v.status !== "accepted" || (v.committedStateVersion !== null && v.scheduledAfterSimMs !== null && v.reason === "authorized"), "Accepted decisions require commitment metadata");

export type AgentId = z.infer<typeof AgentIdSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export type InferenceInterval = z.infer<typeof InferenceIntervalSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type TrafficProposal = z.infer<typeof TrafficProposalSchema>;
export type ArbitrationChoice = z.infer<typeof ArbitrationChoiceSchema>;
export type ArbitrationResult = z.infer<typeof ArbitrationResultSchema>;
export type ArbitrationRecord = z.infer<typeof ArbitrationRecordSchema>;
export type ConfidencePolicy = z.infer<typeof ConfidencePolicySchema>;
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;
export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
