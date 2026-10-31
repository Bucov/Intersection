import { describe, it, expect } from 'vitest';
import { DecisionStatsCollector, DecisionStatsSchema } from '../src/decisionStats.js';
import type { ServerEvent } from '../src/schemas/events.js';

function harness() {
  const c = new DecisionStatsCollector(); let sequence = 0;
  const send = (type: string, payload: unknown, correlationId = 'cycle') => c.observe({ type, payload, sequence: ++sequence, eventId: `e${sequence}`, correlationId, simulationTimeMs: sequence * 100 } as ServerEvent);
  const proposal = (agentId: string, requestedPhase = 'NS_GREEN') => send('agent.proposal', { agentId, proposalId: agentId, requestedPhase, requestedGreenSeconds: 15 });
  const decision = (source: string, status = 'accepted', extension = false, commandId = 'command') => send('decision.outcome', { decisionSource: source, status, commandId, proposalIds: ['agent-a', 'agent-b'], arbitrationId: source === 'jev' ? 'arb' : null, requestedPhase: 'NS_GREEN', requestedGreenSeconds: 15, realizedExtension: extension, reason: 'authorized' });
  const arbitration = (confidence: number | null, choice = 'GRANT_A', fallbackReason: string | null = null, status = 'completed') => send('jev.arbitration', { arbitrationId: 'arb', status, proposalA: { proposalId: 'agent-a' }, proposalB: { proposalId: 'agent-b' }, result: confidence === null ? null : { choice, confidence, latencyMs: 20 }, adapterResult: confidence === null ? { confidence: null, selectedCandidateId: 'agent-a', status: 'selected', latencyMs: 20 } : undefined, fallbackReason });
  return { c, send, proposal, decision, arbitration };
}
describe('authoritative decision statistics', () => {
  it('credits agreement twice and counts a single accepted decision, with actual direction service', () => {
    const h = harness(); h.proposal('agent-a'); h.proposal('agent-b'); h.decision('agreement', 'accepted', true);
    expect(h.c.value.accepted).toEqual({ agreement: 1, jev: 0, fallback: 0 });
    expect(h.c.value.agents.map(a => a.agreement)).toEqual([1, 1]);
    expect(h.c.value.agents.map(a => a.servedAssigned)).toEqual([1, 0]);
    expect(h.c.value.agents.map(a => a.realized)).toEqual([1, 1]);
    DecisionStatsSchema.parse(h.c.value);
  });
  it.each([0.95, 0.7, 0.2, null])('keeps confidence %s and observed acceptance separate from selection', confidence => {
    const h = harness(); h.arbitration(confidence); h.arbitration(confidence);
    h.decision('jev', confidence !== null && confidence >= 0.6 ? 'accepted' : 'rejected');
    expect(h.c.value.jev.requests).toBe(1); expect(h.c.value.jev.terminal).toBe(1);
    expect(h.c.value.accepted.jev).toBe(confidence !== null && confidence >= 0.6 ? 1 : 0);
    expect(h.c.value.jev.unmeasured).toBe(confidence === null ? 1 : 0);
  });
  it('does not treat pending arbitration as failure; counts abstention and timeout separately', () => {
    const h = harness(); h.arbitration(0.9, 'DEFER', null, 'pending');
    expect(h.c.value.jev.terminal).toBe(0); expect(h.c.value.jev.errors).toBe(0);
    h.arbitration(0.9, 'DEFER', 'timeout', 'failed');
    expect(h.c.value.jev.abstained).toBe(1); expect(h.c.value.jev.timeouts).toBe(1);
  });
  it.each(['low_confidence', 'medium_confidence_deferred', 'stale_result', 'provider_error', 'timeout'])('preserves %s and separates fallback commands from holds', reason => {
    const h = harness();
    h.send('arbitration.fallback', { reason, selectedPhase: 'HOLD', arbitrationId: null });
    h.send('arbitration.fallback', { reason, selectedPhase: 'NS_GREEN', arbitrationId: null });
    h.decision('fallback'); h.decision('fallback'); // same command replay
    expect(h.c.value.fallback).toMatchObject({ invocations: 2, held: 1, accepted: 1, rejected: 0 });
    expect(h.c.value.accepted.fallback).toBe(1);
  });
  it('counts accepted service only after a correlated start, deduplicates it, and leaves unserved requests pending', () => {
    const h = harness(); h.proposal('agent-a'); h.proposal('agent-b'); h.decision('agreement');
    expect(h.c.value.agents[0].realized).toBe(0);
    h.send('signal.phase_changed', { commandId: 'command', signal: { phase: 'NS_GREEN' }, reason: 'clearance_complete' });
    h.send('signal.phase_changed', { commandId: 'command', signal: { phase: 'NS_GREEN' }, reason: 'clearance_complete' });
    expect(h.c.value.agents[0].realized).toBe(1);
    const checkpoint = structuredClone(h.c.value); h.send('simulation.snapshot', { decisionStats: checkpoint });
    expect(h.c.value).toEqual(checkpoint);
    expect(new DecisionStatsCollector().value.accepted.agreement).toBe(0);
  });
});
