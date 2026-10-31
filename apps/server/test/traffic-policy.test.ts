import { expect, it } from 'vitest';
import { DEFAULT_SIGNAL_TIMING } from '@intersection/shared';
import { trafficPlan, type PlanningState } from '../src/ai/trafficPolicy.js';
import { ObservationSchema } from '../src/ai/schemas.js';
const demand = (rate: number) => ({ queueLength: 8, approaching: 2, estimatedArrivalRateVehPerHour: rate, maxWaitSeconds: 10, emergencyCount: 0 });
const state = (): PlanningState => ({ simulationTimeMs: 0, phase: 'NS_GREEN', phaseStartedAtSimMs: 0, timing: DEFAULT_SIGNAL_TIMING, ns: demand(1040), ew: demand(340) });
it('allocates more service to rush demand without asking for minimum greens', () => {
  const s = state();
  const first = trafficPlan(s);
  expect(first.requestedPhase).toBe('NS_GREEN');
  expect(first.requestedGreenSeconds).toBeGreaterThan(30);
  const next = trafficPlan({ ...s, simulationTimeMs: 33000 });
  expect(next.requestedPhase).toBe('EW_GREEN');
  expect(next.requestedGreenSeconds).toBeGreaterThanOrEqual(8);
  expect(next.requestedGreenSeconds).toBeLessThan(first.requestedGreenSeconds);
});
it('responds to emergencies and limits starvation on the quieter approach', () => {
  const s = state(); s.ew.emergencyCount = 1;
  expect(trafficPlan(s).requestedPhase).toBe('EW_GREEN');
  s.ew.emergencyCount = 0; s.ew.maxWaitSeconds = 46;
  expect(trafficPlan(s).requestedPhase).toBe('EW_GREEN');
});
it('retains approaching traffic and demand rates in model input validation', () => {
  expect(ObservationSchema.shape.ns.parse({ ...demand(1040), nearestEmergencyEtaSeconds: null, lastServedAtSimMs: 0, totalGreenMs: 0 })).toMatchObject({ approaching: 2, estimatedArrivalRateVehPerHour: 1040 });
});

it('bounds service durations for unusual demand and configured timing', () => {
  for (const elapsed of [0, 7, 30, 44]) for (const rate of [0, 40, 1000, 10000]) {
    const s = state(); s.ns.estimatedArrivalRateVehPerHour = rate; s.simulationTimeMs = elapsed * 1000;
    const p = trafficPlan(s);
    expect(p.requestedGreenSeconds).toBeGreaterThanOrEqual(8);
    expect(p.requestedGreenSeconds).toBeLessThanOrEqual(45);
  }
});
