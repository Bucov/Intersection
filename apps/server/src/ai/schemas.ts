import { z } from "zod";
import {
  GroupObservationSchema,
  VehicleStateSchema,
  SignalStateSchema,
  SignalTimingSchema,
} from "@intersection/shared";
export const ProposalSchema = z.strictObject({
  requestedPhase: z.enum(["NS_GREEN", "EW_GREEN"]),
  requestedGreenSeconds: z.number().int().min(1).max(120),
  summary: z.string().min(1).max(500),
});
export const ObservationSchema = z.object({
  agentPlans: z.array(ProposalSchema).optional(),
  simulationTimeMs: z.number().int().nonnegative(),
  signal: SignalStateSchema,
  timing: SignalTimingSchema,
  ns: GroupObservationSchema.extend({ approaching: z.number().nonnegative().optional(), estimatedArrivalRateVehPerHour: z.number().nonnegative().optional() }),
  ew: GroupObservationSchema.extend({ approaching: z.number().nonnegative().optional(), estimatedArrivalRateVehPerHour: z.number().nonnegative().optional() }),
  committedGreenUntilSimMs: z.number().nonnegative().nullable().optional(),
  referencePlan: z.object({ requestedPhase: z.enum(["NS_GREEN", "EW_GREEN"]), requestedGreenSeconds: z.number(), reason: z.string(), clearanceCostSeconds: z.number() }).optional(),
  vehicles: z.array(VehicleStateSchema).optional(),
  upstreamBacklog: z.record(z.string(), z.number().nonnegative()).optional(),
  occupiedVehicleCount: z.number().int().nonnegative(),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export const arbitrationInstructions =
  "Which concrete controller action better serves the observed traffic over the next service batch? Use the supplied referencePlan, approaching vehicles, arrival rates and waiting times. Prefer a plan that avoids unnecessary clearance losses while serving responding emergencies and preventing long waits. Both directions share the objective of reducing total delay. Similar useful plans are both acceptable; abstain only if neither is suitable. Signal safety is enforced by code.";
export function freezeObservation(observation: Observation): Observation {
  const value = ObservationSchema.parse(observation);
  Object.freeze(value.signal);
  Object.freeze(value.timing);
  Object.freeze(value.ns);
  Object.freeze(value.ew);
  if (value.referencePlan) Object.freeze(value.referencePlan);
  for (const vehicle of value.vehicles ?? []) { Object.freeze(vehicle.position); Object.freeze(vehicle); }
  if (value.vehicles) Object.freeze(value.vehicles);
  for (const plan of value.agentPlans ?? []) Object.freeze(plan);
  if (value.agentPlans) Object.freeze(value.agentPlans);
  if (value.upstreamBacklog) Object.freeze(value.upstreamBacklog);
  return Object.freeze(value);
}
