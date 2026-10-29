import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const IdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
export const CounterSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const SimTimeSchema = CounterSchema;
export const EventDurationSchema = SimTimeSchema.min(100).max(600_000).refine(ms => ms % 100 === 0, "Duration must align to 100 ms steps");
export const NonnegativeSchema = z.number().finite().nonnegative();
export const ProbabilitySchema = z.number().finite().min(0).max(1);
export const WallTimeSchema = z.iso.datetime();
export const ApproachSchema = z.enum(["north", "south", "east", "west"]);
export const MovementGroupSchema = z.enum(["NS", "EW"]);
export const ControllerModeSchema = z.enum(["traditional", "ai"]);
export const DemoModeSchema = z.enum(["mock", "live"]);
export const ProvenanceSchema = z.enum(["simulation", "deterministic", "mock", "live"]);
export const PositionSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
export const ApproachCountsSchema = z.object({ north: CounterSchema, south: CounterSchema, east: CounterSchema, west: CounterSchema });
export const ArrivalRatesSchema = z.object({
  north: NonnegativeSchema.max(7200), south: NonnegativeSchema.max(7200),
  east: NonnegativeSchema.max(7200), west: NonnegativeSchema.max(7200),
});
export const VehicleTypeSchema = z.enum(["car", "van", "bus_truck", "ambulance", "police"]);
export const VehicleMixSchema = z.object({
  car: ProbabilitySchema, van: ProbabilitySchema, bus_truck: ProbabilitySchema,
  ambulance: ProbabilitySchema, police: ProbabilitySchema,
}).refine(mix => Math.abs(Object.values(mix).reduce((a, b) => a + b, 0) - 1) < 1e-9, "Vehicle mix must sum to 1");

export const OPPOSITE_APPROACH = { north: "south", south: "north", east: "west", west: "east" } as const;
export const VehicleStateSchema = z.object({
  id: IdSchema,
  type: VehicleTypeSchema,
  approach: ApproachSchema,
  intendedExit: ApproachSchema,
  travelDirection: ApproachSchema,
  laneId: z.enum(["north-inbound", "south-inbound", "east-inbound", "west-inbound"]),
  position: PositionSchema,
  headingRadians: z.number().finite().min(-Math.PI).max(Math.PI),
  velocityMps: NonnegativeSchema.max(60),
  accelerationMps2: z.number().finite().min(-12).max(4),
  desiredSpeedMps: z.number().finite().positive().max(60),
  lengthM: z.number().finite().min(1).max(25),
  requestedAtSimMs: SimTimeSchema,
  spawnedAtSimMs: SimTimeSchema,
  waitingTimeMs: SimTimeSchema,
  signalDelayMs: SimTimeSchema,
  emergency: z.boolean(),
  stopLineEtaSeconds: NonnegativeSchema.nullable(),
  movementState: z.enum(["approaching", "queued", "crossing", "departing"]),
}).superRefine((v, ctx) => {
  if (v.intendedExit !== OPPOSITE_APPROACH[v.approach] || v.travelDirection !== v.intendedExit)
    ctx.addIssue({ code: "custom", path: ["intendedExit"], message: "v1 supports straight-through routes only" });
  if (v.laneId !== `${v.approach}-inbound`)
    ctx.addIssue({ code: "custom", path: ["laneId"], message: "Lane must match approach" });
  if (v.spawnedAtSimMs < v.requestedAtSimMs)
    ctx.addIssue({ code: "custom", path: ["spawnedAtSimMs"], message: "Spawn cannot precede demand" });
  if (v.emergency && v.type !== "ambulance" && v.type !== "police")
    ctx.addIssue({ code: "custom", path: ["emergency"], message: "Only responding emergency vehicle types can request priority" });
});

export const GreenPhaseSchema = z.enum(["NS_GREEN", "EW_GREEN"]);
export const SignalPhaseSchema = z.enum(["NS_GREEN", "NS_YELLOW", "ALL_RED", "EW_GREEN", "EW_YELLOW"]);
export const SignalTimingSchema = z.strictObject({
  minimumGreenMs: SimTimeSchema.min(1000),
  maximumGreenMs: SimTimeSchema.min(1000),
  yellowMs: SimTimeSchema.min(1000),
  allRedMs: SimTimeSchema.min(1000),
  fixedGreenMs: SimTimeSchema.min(1000),
}).superRefine((s, ctx) => {
  if (s.minimumGreenMs > s.fixedGreenMs || s.fixedGreenMs > s.maximumGreenMs)
    ctx.addIssue({ code: "custom", path: ["fixedGreenMs"], message: "Require minimumGreenMs <= fixedGreenMs <= maximumGreenMs" });
  for (const [key, value] of Object.entries(s)) {
    if (value % 100 !== 0) ctx.addIssue({ code: "custom", path: [key], message: "Timing must align to 100 ms steps" });
  }
});
export const SignalStateSchema = z.object({
  phase: SignalPhaseSchema,
  phaseStartedAtSimMs: SimTimeSchema,
  earliestEndAtSimMs: SimTimeSchema,
  latestEndAtSimMs: SimTimeSchema.nullable(),
  nextGreen: GreenPhaseSchema,
  activeCommandId: IdSchema.nullable(),
  clearanceBlockedByVehicles: z.boolean(),
}).superRefine((s, ctx) => {
  if (s.earliestEndAtSimMs <= s.phaseStartedAtSimMs ||
      (s.latestEndAtSimMs !== null && s.latestEndAtSimMs < s.earliestEndAtSimMs))
    ctx.addIssue({ code: "custom", message: "Signal deadlines must be ordered" });
  const green = s.phase.endsWith("_GREEN");
  if (green !== (s.latestEndAtSimMs !== null))
    ctx.addIssue({ code: "custom", path: ["latestEndAtSimMs"], message: "Only green phases have a maximum deadline; clearance can be held for occupancy" });
  if ((s.phase.startsWith("NS_") && s.nextGreen !== "EW_GREEN") || (s.phase.startsWith("EW_") && s.nextGreen !== "NS_GREEN"))
    ctx.addIssue({ code: "custom", path: ["nextGreen"], message: "Next green must serve the other group" });
  if (s.clearanceBlockedByVehicles && s.phase !== "ALL_RED")
    ctx.addIssue({ code: "custom", path: ["clearanceBlockedByVehicles"], message: "Occupancy hold applies only to ALL_RED" });
});

/** Pure presentation mapping; never an independent mutable signal state. */
export function signalLights(phase: z.infer<typeof SignalPhaseSchema>) {
  const ns = phase === "NS_GREEN" ? "green" : phase === "NS_YELLOW" ? "yellow" : "red";
  const ew = phase === "EW_GREEN" ? "green" : phase === "EW_YELLOW" ? "yellow" : "red";
  return { north: ns, south: ns, east: ew, west: ew } as const;
}

export const GeometrySchema = z.object({
  id: z.literal("four-way-straight-v1"),
  laneWidthM: z.literal(3.5),
  laneCenterOffsetM: z.literal(1.75),
  spawnDistanceM: z.literal(120),
  stopLineDistanceM: z.literal(10),
  occupancyHalfExtentM: z.literal(8),
  despawnDistanceM: z.literal(140),
});
export const DemandPresetIdSchema = z.enum(["light", "normal", "rush-hour", "reverse-rush", "heavy-all-round"]);
export const ScenarioIdSchema = z.enum([
  "normal-traffic", "rush-hour", "reverse-rush", "sudden-surge", "ambulance-priority",
  "competing-priorities", "simultaneous-proposals", "jev-uncertainty", "jev-failure",
]);
export const FaultKindSchema = z.enum(["timeout", "provider_error", "rate_limit", "invalid_response", "low_confidence"]);
export const InjectedEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("emergency"), approach: ApproachSchema, vehicleType: z.enum(["ambulance", "police"]), responding: z.boolean() }),
  z.strictObject({ type: z.literal("demand_surge"), approach: ApproachSchema, multiplier: z.number().finite().min(1).max(10), durationMs: EventDurationSchema }),
  z.strictObject({ type: z.literal("temporary_congestion"), approach: ApproachSchema, speedFactor: z.number().finite().min(0.1).max(1), durationMs: EventDurationSchema }),
  z.strictObject({ type: z.literal("provider_fault"), provider: z.enum(["gemini", "jev"]), fault: FaultKindSchema, durationMs: EventDurationSchema }),
  z.strictObject({ type: z.literal("decision_boundary"), reason: z.enum(["simultaneous_proposals", "ambiguous_arbitration"]) }),
]);
export const ScheduledEventSchema = z.object({ id: IdSchema, atSimMs: SimTimeSchema, event: InjectedEventSchema });
export const RandomEventsSchema = z.strictObject({
  enabled: z.boolean(), intervalMs: SimTimeSchema.min(100),
  surgeProbability: ProbabilitySchema, congestionProbability: ProbabilitySchema,
});
export const ScenarioParametersSchema = z.strictObject({
  durationMs: SimTimeSchema.min(1000).max(3_600_000),
  demandPreset: DemandPresetIdSchema,
  arrivalRatesVehPerHour: ArrivalRatesSchema,
  vehicleMix: VehicleMixSchema,
  policeRespondingProbability: ProbabilitySchema,
  initialQueueByApproach: z.strictObject({ north: CounterSchema.max(12), south: CounterSchema.max(12), east: CounterSchema.max(12), west: CounterSchema.max(12) }),
  randomEvents: RandomEventsSchema,
  initialGreen: GreenPhaseSchema,
  scheduledEvents: z.array(ScheduledEventSchema).max(100),
}).superRefine((s, ctx) => {
  const ids = new Set<string>();
  s.scheduledEvents.forEach((event, index) => {
    if (event.atSimMs >= s.durationMs || event.atSimMs % 100 !== 0)
      ctx.addIssue({ code: "custom", path: ["scheduledEvents", index, "atSimMs"], message: "Event must occur before duration and align to a simulation step" });
    if (ids.has(event.id)) ctx.addIssue({ code: "custom", path: ["scheduledEvents", index, "id"], message: "Duplicate scheduled event ID" });
    ids.add(event.id);
  });
  if (s.durationMs % 100 !== 0 || s.randomEvents.intervalMs % 100 !== 0)
    ctx.addIssue({ code: "custom", message: "Duration and random interval must align to 100 ms steps" });
});
export const ScenarioDefinitionSchema = z.object({
  id: ScenarioIdSchema, name: z.string().min(1), description: z.string().min(1),
  demonstrationCondition: z.string().min(1),
  supportedModes: z.array(ControllerModeSchema).min(1),
  defaults: ScenarioParametersSchema,
  guarantee: z.enum(["scheduled_input", "mock_only"]),
});

export type Approach = z.infer<typeof ApproachSchema>;
export type MovementGroup = z.infer<typeof MovementGroupSchema>;
export type ControllerMode = z.infer<typeof ControllerModeSchema>;
export type DemoMode = z.infer<typeof DemoModeSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Position = z.infer<typeof PositionSchema>;
export type ArrivalRates = z.infer<typeof ArrivalRatesSchema>;
export type VehicleType = z.infer<typeof VehicleTypeSchema>;
export type VehicleState = z.infer<typeof VehicleStateSchema>;
export type VehicleMix = z.infer<typeof VehicleMixSchema>;
export type SignalPhase = z.infer<typeof SignalPhaseSchema>;
export type GreenPhase = z.infer<typeof GreenPhaseSchema>;
export type SignalState = z.infer<typeof SignalStateSchema>;
export type SignalTiming = z.infer<typeof SignalTimingSchema>;
export type Geometry = z.infer<typeof GeometrySchema>;
export type DemandPresetId = z.infer<typeof DemandPresetIdSchema>;
export type ScenarioId = z.infer<typeof ScenarioIdSchema>;
export type ScenarioParameters = z.infer<typeof ScenarioParametersSchema>;
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;
export type InjectedEvent = z.infer<typeof InjectedEventSchema>;
export type ScheduledEvent = z.infer<typeof ScheduledEventSchema>;
