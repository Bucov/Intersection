import { z } from "zod";
import { ApproachCountsSchema, ControllerModeSchema, CounterSchema, DemoModeSchema, GeometrySchema, IdSchema, NonnegativeSchema, ScenarioIdSchema, ScenarioParametersSchema, SignalStateSchema, SignalTimingSchema, SimTimeSchema, VehicleStateSchema } from "./domain.js";
import { AgentStatusSchema, ArbitrationRecordSchema, ProviderStatusSchema } from "./coordination.js";

export const SessionStatusSchema = z.enum(["ready", "running", "paused", "completed"]);
export const SessionConfigSchema = z.object({
  mode: ControllerModeSchema, scenarioId: ScenarioIdSchema,
  seed: z.number().int().min(0).max(0xffff_ffff),
  speedMultiplier: z.number().finite().min(0.1).max(20),
  timestepMs: z.literal(100), demoMode: DemoModeSchema,
  signalTiming: SignalTimingSchema, scenario: ScenarioParametersSchema, geometry: GeometrySchema,
});
export const TrafficMetricsSchema = z.object({
  timeAverageQueueLength: NonnegativeSchema.optional(),
  maximumObservedDelayMs: NonnegativeSchema.optional(),
  requestedVehicleCount: CounterSchema, spawnedVehicleCount: CounterSchema,
  completedVehicleCount: CounterSchema, activeVehicleCount: CounterSchema,
  upstreamBacklogCount: CounterSchema, upstreamBacklogByApproach: ApproachCountsSchema,
  waitingVehicleCount: CounterSchema, queueByApproach: ApproachCountsSchema,
  maximumQueueLength: CounterSchema,
  averageCompletedWaitingTimeMs: NonnegativeSchema.nullable(),
  averageCompletedTravelTimeMs: NonnegativeSchema.nullable(),
  totalObservedWaitingTimeMs: NonnegativeSchema,
  activeWaitingTimeMs: NonnegativeSchema, upstreamWaitingTimeMs: NonnegativeSchema,
  throughputVehPerHour: NonnegativeSchema,
  emergencyCompletedCount: CounterSchema,
  averageCompletedEmergencySignalDelayMs: NonnegativeSchema.nullable(),
  activeEmergencySignalDelayMs: NonnegativeSchema,
  signalChangeCount: CounterSchema, geminiRequestCount: CounterSchema, jevDecisionCount: CounterSchema,
  jevConfidenceCounts: z.object({ high: CounterSchema, medium: CounterSchema, low: CounterSchema }),
  geminiLatency: z.object({ sampleCount: CounterSchema, meanMs: NonnegativeSchema.nullable(), maxMs: NonnegativeSchema.nullable() }),
  jevLatency: z.object({ sampleCount: CounterSchema, meanMs: NonnegativeSchema.nullable(), maxMs: NonnegativeSchema.nullable() }),
  deadlineMissCount: CounterSchema, safetyRejectionCount: CounterSchema,
}).superRefine((m, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (m.requestedVehicleCount !== m.spawnedVehicleCount + m.upstreamBacklogCount) issue("Requested = spawned + upstream backlog");
  if (m.spawnedVehicleCount !== m.completedVehicleCount + m.activeVehicleCount) issue("Spawned = completed + active");
  if (Object.values(m.upstreamBacklogByApproach).reduce((a, b) => a + b, 0) !== m.upstreamBacklogCount) issue("Backlog counts must agree");
  if (Object.values(m.queueByApproach).reduce((a, b) => a + b, 0) !== m.waitingVehicleCount || m.waitingVehicleCount > m.activeVehicleCount) issue("Queue counts must agree and cannot exceed active vehicles");
  if (m.maximumQueueLength < m.waitingVehicleCount) issue("Maximum queue must include current queue");
  if ((m.completedVehicleCount === 0) !== (m.averageCompletedWaitingTimeMs === null) || (m.completedVehicleCount === 0) !== (m.averageCompletedTravelTimeMs === null)) issue("Completed averages are null exactly when no trips completed");
  if (m.emergencyCompletedCount > m.completedVehicleCount || (m.emergencyCompletedCount === 0) !== (m.averageCompletedEmergencySignalDelayMs === null)) issue("Emergency completion average needs an emergency sample");
  if (Object.values(m.jevConfidenceCounts).reduce((a, b) => a + b, 0) !== m.jevDecisionCount) issue("Confidence bins must count successful JEV decisions");
  for (const latency of [m.geminiLatency, m.jevLatency]) {
    if ((latency.sampleCount === 0) !== (latency.meanMs === null) || (latency.sampleCount === 0) !== (latency.maxMs === null) || (latency.meanMs !== null && latency.maxMs !== null && latency.meanMs > latency.maxMs)) issue("Latency samples and aggregates must agree");
  }
  if (m.totalObservedWaitingTimeMs < m.activeWaitingTimeMs + m.upstreamWaitingTimeMs) issue("Observed waiting must include incomplete demand");
});
export const MetricsSampleSchema = z.object({ simulationTimeMs: SimTimeSchema, metrics: TrafficMetricsSchema });
export const ControllerStatusSchema = z.object({
  requestedMode: ControllerModeSchema,
  activeController: z.enum(["fixed_time", "adaptive", "deterministic_fallback"]),
  reason: z.string().max(500).nullable(),
});
export const JevStatusSchema = z.object({
  status: z.enum(["idle", "arbitrating", "degraded", "disabled"]),
  pendingArbitrationId: IdSchema.nullable(), lastArbitration: ArbitrationRecordSchema.nullable(),
}).refine(s => (s.status === "arbitrating") === (s.pendingArbitrationId !== null), "Arbitrating requires a pending ID");

export const SimulationSnapshotSchema = z.object({
  protocolVersion: z.literal(1), sessionId: IdSchema, generation: CounterSchema,
  stateVersion: CounterSchema, sequence: CounterSchema,
  decisionStateVersion: CounterSchema.optional(), snapshotSequence: CounterSchema.optional(), eventSequence: CounterSchema.optional(),
  status: SessionStatusSchema, simulationTimeMs: SimTimeSchema,
  config: SessionConfigSchema, signal: SignalStateSchema,
  vehicles: z.array(VehicleStateSchema), occupiedVehicleIds: z.array(IdSchema),
  metrics: TrafficMetricsSchema, controller: ControllerStatusSchema,
  agents: z.tuple([AgentStatusSchema, AgentStatusSchema]),
  providers: z.tuple([ProviderStatusSchema, ProviderStatusSchema]),
  jev: JevStatusSchema,
}).superRefine((s, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const ids = new Set(s.vehicles.map(v => v.id));
  if (ids.size !== s.vehicles.length) issue("Vehicle IDs must be unique");
  if (s.vehicles.length !== s.metrics.activeVehicleCount) issue("Snapshot vehicle count must match metrics");
  if (new Set(s.occupiedVehicleIds).size !== s.occupiedVehicleIds.length || s.occupiedVehicleIds.some(id => !ids.has(id))) issue("Occupancy must reference unique active vehicles");
  if (s.agents[0].agentId !== "agent-a" || s.agents[1].agentId !== "agent-b") issue("Agents must be ordered A, B");
  if (s.providers[0].provider !== "gemini" || s.providers[1].provider !== "jev") issue("Providers must be ordered Gemini, JEV");
  if (s.controller.requestedMode !== s.config.mode) issue("Controller mode must match session config");
  if (s.providers.some(p => p.mode !== s.config.demoMode) || s.agents.some(a => a.provenance !== s.config.demoMode)) issue("Provider and agent provenance must match the session mode");
  if (s.simulationTimeMs % s.config.timestepMs !== 0 || s.simulationTimeMs > s.config.scenario.durationMs) issue("Simulation time must align to timestep and duration");
  if (s.signal.phaseStartedAtSimMs > s.simulationTimeMs) issue("Signal cannot start in the future");
  if (s.signal.latestEndAtSimMs !== null && s.simulationTimeMs >= s.signal.latestEndAtSimMs) issue("Green cannot remain active at or beyond maximum deadline");
  const timing = s.config.signalTiming;
  const minimum = s.signal.phase.endsWith("_GREEN") ? timing.minimumGreenMs : s.signal.phase.endsWith("_YELLOW") ? timing.yellowMs : timing.allRedMs;
  if (s.signal.earliestEndAtSimMs !== s.signal.phaseStartedAtSimMs + minimum) issue("Signal earliest end must match configured safety timing");
  if (s.signal.latestEndAtSimMs !== null && s.signal.latestEndAtSimMs !== s.signal.phaseStartedAtSimMs + timing.maximumGreenMs) issue("Signal maximum must match configured timing");
  for (const v of s.vehicles) {
    if (v.spawnedAtSimMs > s.simulationTimeMs || v.waitingTimeMs > s.simulationTimeMs - v.spawnedAtSimMs || v.signalDelayMs > s.simulationTimeMs - v.spawnedAtSimMs) issue("Vehicle times must fit elapsed simulation time");
  }
  const arbitration = s.jev.lastArbitration;
  if (arbitration && (arbitration.sessionId !== s.sessionId || arbitration.generation !== s.generation)) issue("Arbitration must belong to current session generation");
});

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type TrafficMetrics = z.infer<typeof TrafficMetricsSchema>;
export type MetricsSample = z.infer<typeof MetricsSampleSchema>;
export type ControllerStatus = z.infer<typeof ControllerStatusSchema>;
export type JevStatus = z.infer<typeof JevStatusSchema>;
export type SimulationSnapshot = z.infer<typeof SimulationSnapshotSchema>;
