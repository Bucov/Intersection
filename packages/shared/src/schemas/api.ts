import { z } from "zod";
import { ArrivalRatesSchema, ControllerModeSchema, CounterSchema, DemoModeSchema, DemandPresetIdSchema, GeometrySchema, IdSchema, InjectedEventSchema, ScenarioDefinitionSchema, ScenarioIdSchema, ScenarioParametersSchema, SignalTimingSchema, SimTimeSchema, WallTimeSchema } from "./domain.js";
import { ConfidencePolicySchema, ProviderStatusSchema } from "./coordination.js";
import { ServerEventSchema } from "./events.js";
import { MetricsSampleSchema, SimulationSnapshotSchema, TrafficMetricsSchema } from "./session.js";

export const HealthResponseSchema = z.object({
  protocolVersion: z.literal(1), status: z.enum(["ok", "degraded"]),
  service: z.literal("intersection-server"), version: z.string().min(1),
  uptimeMs: z.number().finite().nonnegative(), demoMode: DemoModeSchema,
  providers: z.tuple([ProviderStatusSchema, ProviderStatusSchema]),
});
export const RuntimeConfigResponseSchema = z.object({
  protocolVersion: z.literal(1), demoMode: DemoModeSchema,
  timestepMs: z.literal(100), snapshotIntervalMs: SimTimeSchema.min(100), metricsIntervalMs: SimTimeSchema.min(100),
  eventRetentionCount: CounterSchema.positive(), maxSessions: CounterSchema.positive(),
  speedMultiplierRange: z.object({ min: z.literal(0.1), max: z.literal(20), liveRecommended: z.literal(1) }),
  signalTiming: SignalTimingSchema, geometry: GeometrySchema,
  confidencePolicy: ConfidencePolicySchema,
  demandPresets: z.array(z.object({ id: DemandPresetIdSchema, arrivalRatesVehPerHour: ArrivalRatesSchema })).length(5),
  faultInjectionEnabled: z.boolean(),
});
export const ScenariosResponseSchema = z.object({ protocolVersion: z.literal(1), scenarios: z.array(ScenarioDefinitionSchema).length(9) })
  .refine(v => new Set(v.scenarios.map(s => s.id)).size === v.scenarios.length, "Scenario IDs must be unique");
const CreateFields = {
  requestId: IdSchema, mode: ControllerModeSchema, scenarioId: ScenarioIdSchema,
  seed: z.number().int().min(0).max(0xffff_ffff),
  speedMultiplier: z.number().finite().min(0.1).max(20).default(1),
  autoStart: z.boolean().default(false),
  signalTiming: SignalTimingSchema.optional(),
  scenarioParameters: ScenarioParametersSchema.optional(),
};
export const CreateSessionRequestSchema = z.strictObject(CreateFields);
export const SessionResponseSchema = z.object({ protocolVersion: z.literal(1), snapshot: SimulationSnapshotSchema });
const ControlFields = { requestId: IdSchema, generation: CounterSchema };
export const SessionControlRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...ControlFields, action: z.literal("start") }),
  z.strictObject({ ...ControlFields, action: z.literal("pause") }),
  z.strictObject({ ...ControlFields, action: z.literal("resume") }),
  z.strictObject({ ...ControlFields, action: z.literal("reset") }),
  z.strictObject({ ...ControlFields, action: z.literal("set_speed"), speedMultiplier: z.number().finite().min(0.1).max(20) }),
]);
export const InjectEventRequestSchema = z.strictObject({
  requestId: IdSchema, generation: CounterSchema,
  atSimMs: SimTimeSchema.refine(ms => ms % 100 === 0, "Event time must align to 100 ms steps").optional(), event: InjectedEventSchema,
});
export const InjectEventResponseSchema = z.object({
  protocolVersion: z.literal(1), sessionId: IdSchema, generation: CounterSchema,
  scheduleId: IdSchema, scheduledAtSimMs: SimTimeSchema, sequence: CounterSchema,
});
export const SessionPathSchema = z.strictObject({ id: IdSchema });
// Query strings are decoded without accepting blank, fractional or signed numbers.
const queryCounter = z.string().regex(/^\d+$/).transform(Number).pipe(CounterSchema);
export const EventsQuerySchema = z.strictObject({
  afterSequence: queryCounter.optional(), limit: queryCounter.pipe(z.number().min(1).max(500)).optional(),
});
export const EventsResponseSchema = z.object({
  protocolVersion: z.literal(1), sessionId: IdSchema, events: z.array(ServerEventSchema).max(500),
  oldestAvailableSequence: CounterSchema, latestSequence: CounterSchema,
  nextAfterSequence: CounterSchema, hasMore: z.boolean(),
}).superRefine((r, ctx) => {
  let last = -1;
  for (const event of r.events) {
    if (event.sessionId !== r.sessionId || event.sequence <= last || event.sequence < r.oldestAvailableSequence || event.sequence > r.latestSequence)
      ctx.addIssue({ code: "custom", message: "History events must be ordered and within the advertised session retention range" });
    last = event.sequence;
  }
  if (r.events.length && r.nextAfterSequence !== last)
    ctx.addIssue({ code: "custom", path: ["nextAfterSequence"], message: "Cursor must point to last returned event" });
});
export const MetricsQuerySchema = z.strictObject({
  generation: queryCounter.optional(), fromSimMs: queryCounter.optional(),
  limit: queryCounter.pipe(z.number().min(1).max(1000)).optional(),
});
export const MetricsResponseSchema = z.object({
  protocolVersion: z.literal(1), sessionId: IdSchema, generation: CounterSchema,
  simulationTimeMs: SimTimeSchema, current: TrafficMetricsSchema,
  samples: z.array(MetricsSampleSchema).max(1000), sampleIntervalMs: SimTimeSchema.positive(),
  nextFromSimMs: SimTimeSchema.nullable(), truncatedBeforeSimMs: SimTimeSchema.nullable(),
});
export const CreateComparisonRequestSchema = z.strictObject({
  requestId: IdSchema, scenarioId: ScenarioIdSchema, seed: CreateFields.seed,
  durationMs: SimTimeSchema.min(1000).max(3_600_000),
  execution: z.enum(["realtime", "accelerated_mock"]),
  speedMultiplier: CreateFields.speedMultiplier,
  signalTiming: SignalTimingSchema.optional(), scenarioParameters: ScenarioParametersSchema.optional(),
}).superRefine((r, ctx) => {
  if (r.execution === "realtime" && r.speedMultiplier !== 1)
    ctx.addIssue({ code: "custom", path: ["speedMultiplier"], message: "Realtime comparisons run at 1x" });
  if (r.durationMs % 100 !== 0 || (r.scenarioParameters && r.scenarioParameters.durationMs !== r.durationMs))
    ctx.addIssue({ code: "custom", path: ["durationMs"], message: "Duration must align to timestep and equal scenario override duration" });
});
const ComparisonSideSchema = z.object({ sessionId: IdSchema, generation: CounterSchema, simulationTimeMs: SimTimeSchema, metrics: TrafficMetricsSchema });
export const ComparisonResponseSchema = z.object({
  protocolVersion: z.literal(1), comparisonId: IdSchema,
  status: z.enum(["ready", "running", "completed", "failed"]),
  createdAtWallTime: WallTimeSchema, completedAtWallTime: WallTimeSchema.nullable(),
  execution: z.enum(["realtime", "accelerated_mock"]), demoMode: DemoModeSchema,
  seed: CreateFields.seed, scenarioId: ScenarioIdSchema, durationMs: SimTimeSchema.positive(),
  speedMultiplier: z.number().finite().min(0.1).max(20),
  demandScheduleId: IdSchema, demandScheduleHash: z.string().regex(/^[a-f0-9]{64}$/),
  traditional: ComparisonSideSchema, ai: ComparisonSideSchema,
  limitations: z.array(z.string().min(1)),
}).superRefine((r, ctx) => {
  if (r.traditional.sessionId === r.ai.sessionId) ctx.addIssue({ code: "custom", message: "Comparison sessions must be isolated" });
  if (r.execution === "accelerated_mock" && r.demoMode !== "mock") ctx.addIssue({ code: "custom", message: "Accelerated comparisons require mock mode" });
  if (r.execution === "realtime" && r.speedMultiplier !== 1) ctx.addIssue({ code: "custom", message: "Realtime comparison requires 1x" });
  if ((r.status === "completed" || r.status === "failed") !== (r.completedAtWallTime !== null)) ctx.addIssue({ code: "custom", message: "Finished comparisons require completion time" });
  if (r.traditional.simulationTimeMs > r.durationMs || r.ai.simulationTimeMs > r.durationMs || (r.status === "completed" && (r.traditional.simulationTimeMs !== r.durationMs || r.ai.simulationTimeMs !== r.durationMs))) ctx.addIssue({ code: "custom", message: "Completed sides must reach the same duration" });
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type RuntimeConfigResponse = z.infer<typeof RuntimeConfigResponseSchema>;
export type ScenariosResponse = z.infer<typeof ScenariosResponseSchema>;
export type CreateSessionRequest = z.input<typeof CreateSessionRequestSchema>;
export type ParsedCreateSessionRequest = z.output<typeof CreateSessionRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type SessionControlRequest = z.infer<typeof SessionControlRequestSchema>;
export type InjectEventRequest = z.infer<typeof InjectEventRequestSchema>;
export type InjectEventResponse = z.infer<typeof InjectEventResponseSchema>;
export type EventsQuery = z.input<typeof EventsQuerySchema>;
export type EventsResponse = z.infer<typeof EventsResponseSchema>;
export type MetricsQuery = z.input<typeof MetricsQuerySchema>;
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;
export type CreateComparisonRequest = z.input<typeof CreateComparisonRequestSchema>;
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;
