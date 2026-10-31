import type { GreenPhase, SignalTiming } from '@intersection/shared';

export interface Demand {
  queueLength: number;
  approaching: number;
  estimatedArrivalRateVehPerHour: number;
  maxWaitSeconds: number;
  emergencyCount: number;
}
export interface PlanningState {
  simulationTimeMs: number;
  phase: string;
  phaseStartedAtSimMs: number;
  timing: SignalTiming;
  ns: Demand;
  ew: Demand;
}

/** A transparent numerical reference for both agents and backup control. */
export function trafficPlan(s: PlanningState) {
  const current: GreenPhase = s.phase === 'EW_GREEN' ? 'EW_GREEN' : 'NS_GREEN';
  const other: GreenPhase = current === 'NS_GREEN' ? 'EW_GREEN' : 'NS_GREEN';
  const cur = current === 'NS_GREEN' ? s.ns : s.ew;
  const opp = current === 'NS_GREEN' ? s.ew : s.ns;
  const elapsed = (s.simulationTimeMs - s.phaseStartedAtSimMs) / 1000;
  const min = s.timing.minimumGreenMs / 1000;
  const max = s.timing.maximumGreenMs / 1000;
  const clamp = (n: number) => Math.round(Math.max(min, Math.min(max, n)));
  // A 60-second target cycle includes both clearance intervals. Demand estimates
  // allocate green without mistaking a busy approach's discharged queue for no demand.
  const greenBudget = Math.max(2 * min, 60 - 2 * (s.timing.yellowMs + s.timing.allRedMs) / 1000);
  const totalRate = s.ns.estimatedArrivalRateVehPerHour + s.ew.estimatedArrivalRateVehPerHour;
  const allocation = (d: Demand) => clamp(greenBudget * (totalRate ? d.estimatedArrivalRateVehPerHour / totalRate : 0.5));
  let phase = current;
  let reason = 'serve_demand_in_batches';
  if (opp.emergencyCount > cur.emergencyCount) { phase = other; reason = 'responding_emergency'; }
  else if (cur.emergencyCount > opp.emergencyCount) reason = 'responding_emergency';
  else if (opp.queueLength > 0 && opp.maxWaitSeconds >= 45) { phase = other; reason = 'waiting_limit'; }
  else if (opp.queueLength + opp.approaching > 0 && (elapsed >= allocation(cur) - 6 || cur.queueLength + cur.approaching === 0 && elapsed >= min)) {
    phase = other; reason = 'next_service_batch';
  }
  return {
    requestedPhase: phase,
    requestedGreenSeconds: phase === current ? clamp(allocation(cur) - elapsed) : allocation(opp),
    reason,
    clearanceCostSeconds: (s.timing.yellowMs + s.timing.allRedMs) / 1000,
  };
}

export const agentInstructions = (focus: string) => `You are a traffic engineer reviewing ${focus}, with a shared objective: minimize total waiting and unfinished queues across BOTH directions. Your focus is an observation responsibility, not a demand to always give your direction green. Use approaching vehicles and arrival rates as well as stopped queues. Each switch loses the stated yellow/all-red clearance time. Avoid repeatedly requesting minimum greens or reversing a recently committed service batch. committedGreenUntilSimMs states the current commitment; an opposite-direction plan normally waits for that time before clearance. A zero stopped queue on green does not mean there is no demand. Prioritize responding emergencies and prevent excessive waits on either approach. The referencePlan is computed from demand and timing; follow it unless the observations justify a better plan. When agreeing, use its exact whole-second duration. Explain any departure using queue counts, arrival rates, waits, and clearance cost in a short public summary. requestedGreenSeconds means remaining service from now for the current green, or service duration after clearance for the other green. Return only JSON: requestedPhase (NS_GREEN or EW_GREEN), requestedGreenSeconds (whole seconds within timing limits), summary. Never change signals directly.`;
