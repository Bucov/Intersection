import { z } from "zod";
import {
  GroupObservationSchema,
  SignalStateSchema,
  SignalTimingSchema,
} from "@intersection/shared";
export const ProposalSchema = z.strictObject({
  requestedPhase: z.enum(["NS_GREEN", "EW_GREEN"]),
  requestedGreenSeconds: z.number().int().min(1).max(120),
  summary: z.string().min(1).max(500),
});
export const ObservationSchema = z.object({
  simulationTimeMs: z.number().int().nonnegative(),
  signal: SignalStateSchema,
  timing: SignalTimingSchema,
  ns: GroupObservationSchema,
  ew: GroupObservationSchema,
  occupiedVehicleCount: z.number().int().nonnegative(),
});
export type Proposal = z.infer<typeof ProposalSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export const arbitrationInstructions =
  "Which proposed service plan best addresses responding emergencies, waiting traffic and starvation in this observation? Abstain if neither proposal fits. These are recommendations; a deterministic signal controller enforces clearance and green limits.";
export function freezeObservation(observation: Observation): Observation {
  const value = ObservationSchema.parse(observation);
  Object.freeze(value.signal);
  Object.freeze(value.timing);
  Object.freeze(value.ns);
  Object.freeze(value.ew);
  return Object.freeze(value);
}
