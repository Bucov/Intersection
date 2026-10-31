import { z } from 'zod';
import type { ServerEvent } from './schemas/events.js';

const count = z.number().int().nonnegative();
const agent = z.object({ proposals: count, agreement: count, selected: count, accepted: count, assignedAccepted: count, servedAssigned: count, realized: count, failures: count, latencyCount: count, latencySum: z.number().nonnegative() });
export const DecisionStatsSchema = z.object({
  policy: z.object({ highThreshold: z.number(), mediumThreshold: z.number() }),
  accepted: z.object({ agreement: count, jev: count, fallback: count }),
  jevAcceptedBands: z.object({ high: count, medium: count, low: count, unmeasured: count }),
  fallback: z.object({ invocations: count, accepted: count, held: count, rejected: count, reasons: z.record(z.string(), count) }),
  jev: z.object({ requests: count, terminal: count, selectedA: count, selectedB: count, abstained: count, high: count, medium: count, low: count, unmeasured: count, policyRejected: count, validationRejected: count, timeouts: count, errors: count, latencyCount: count, latencySum: z.number().nonnegative(), latencyMax: z.number().nonnegative() }),
  agents: z.tuple([agent, agent]),
  singleAgentAccepted: count,
  fixedGreenStarts: count,
  automaticGreenStarts: count,
  recent: z.array(z.object({ time: z.number(), id: z.string(), source: z.string(), direction: z.string(), seconds: z.number().nullable(), confidence: z.number().nullable(), outcome: z.string(), reason: z.string().nullable() })).max(80),
});
export type DecisionStats = z.infer<typeof DecisionStatsSchema>;
export function emptyDecisionStats(): DecisionStats {
  const a = () => ({ proposals: 0, agreement: 0, selected: 0, accepted: 0, assignedAccepted: 0, servedAssigned: 0, realized: 0, failures: 0, latencyCount: 0, latencySum: 0 });
  return { policy: { highThreshold: 0.85, mediumThreshold: 0.6 }, accepted: { agreement: 0, jev: 0, fallback: 0 }, jevAcceptedBands: { high: 0, medium: 0, low: 0, unmeasured: 0 }, fallback: { invocations: 0, accepted: 0, held: 0, rejected: 0, reasons: {} }, jev: { requests: 0, terminal: 0, selectedA: 0, selectedB: 0, abstained: 0, high: 0, medium: 0, low: 0, unmeasured: 0, policyRejected: 0, validationRejected: 0, timeouts: 0, errors: 0, latencyCount: 0, latencySum: 0, latencyMax: 0 }, agents: [a(), a()], singleAgentAccepted: 0, fixedGreenStarts: 0, automaticGreenStarts: 0, recent: [] };
}

/** Engine-owned lifetime counters. Only bounded correlation caches, never transcript parsing. */
export class DecisionStatsCollector {
  constructor(private thresholds = { highThreshold: 0.85, mediumThreshold: 0.6 }) { this.value.policy = { ...thresholds }; }
  value = emptyDecisionStats();
  private pendingService = new Map<string, { credited: number[]; phase: string; cycle: string }>();
  private seen = new Set<string>();
  private proposals = new Map<string, { agent: number; phase: string; seconds: number }>();
  private arbitrations = new Map<string, { selected: number | null; confidence: number | null; band: 'high' | 'medium' | 'low' | 'unmeasured' }>();
  private once(key: string) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  observe(e: ServerEvent) {
    const s = this.value;
    if (e.type === 'agent.proposal' && this.once(`p:${e.payload.proposalId}`)) {
      const p = e.payload, i = p.agentId === 'agent-a' ? 0 : 1;
      s.agents[i].proposals++;
      this.proposals.set(p.proposalId, { agent: i, phase: p.requestedPhase, seconds: p.requestedGreenSeconds });
      if (this.proposals.size > 256) this.proposals.delete(this.proposals.keys().next().value!);
    }
    if (e.type === 'agent.status') {
      const r = e.payload.lastInference;
      if (r && r.outcome !== 'pending' && this.once(`i:${r.inferenceId}`)) {
        const a = s.agents[e.payload.agentId === 'agent-a' ? 0 : 1];
        if (r.outcome === 'failed') a.failures++;
        if (r.latencyMs !== null) { a.latencyCount++; a.latencySum += r.latencyMs; }
      }
    }
    if (e.type === 'jev.arbitration') {
      const r = e.payload, j = s.jev;
      if (this.once(`jr:${r.arbitrationId}`)) j.requests++;
      if (r.status !== 'pending' && this.once(`jt:${r.arbitrationId}`)) {
        j.terminal++;
        const confidence = r.adapterResult?.confidence ?? r.result?.confidence ?? null;
        const band = confidence === null ? 'unmeasured' : confidence >= this.thresholds.highThreshold ? 'high' : confidence >= this.thresholds.mediumThreshold ? 'medium' : 'low';
        const candidate = r.adapterResult?.selectedCandidateId;
        const selected = candidate ? candidate === r.proposalA.proposalId ? 0 : candidate === r.proposalB.proposalId ? 1 : null : r.result?.choice === 'GRANT_A' ? 0 : r.result?.choice === 'GRANT_B' ? 1 : null;
        this.arbitrations.set(r.arbitrationId, { selected, confidence, band });
        if (this.arbitrations.size > 128) this.arbitrations.delete(this.arbitrations.keys().next().value!);
        j[band]++;
        if (selected !== null) { j[selected === 0 ? 'selectedA' : 'selectedB']++; s.agents[selected].selected++; }
        else if (r.result?.choice === 'DEFER' || r.adapterResult?.status === 'abstained') j.abstained++;
        if (selected !== null && r.fallbackReason && this.once(`excluded:${r.arbitrationId}`)) j.policyRejected++;
        if (r.fallbackReason === 'timeout' || r.bridgePhase === 'timed_out') j.timeouts++;
        else if (r.status === 'failed') j.errors++;
        const latency = r.adapterResult?.latencyMs ?? r.result?.latencyMs ?? (r.completedAtWallTime ? Date.parse(r.completedAtWallTime) - Date.parse(r.requestedAtWallTime) : null);
        if (latency !== null) { j.latencyCount++; j.latencySum += Math.max(0, latency); j.latencyMax = Math.max(j.latencyMax, latency); }
      }
    }
    if (e.type === 'arbitration.fallback' && this.once(`f:${e.eventId}`)) {
      s.fallback.invocations++;
      const arbitrationId = e.payload.arbitrationId;
      if (arbitrationId && this.arbitrations.get(arbitrationId)?.selected != null && this.once(`excluded:${arbitrationId}`)) s.jev.policyRejected++;
      s.fallback.reasons[e.payload.reason] = (s.fallback.reasons[e.payload.reason] ?? 0) + 1;
      if (e.payload.selectedPhase === 'HOLD') s.fallback.held++;
      this.row(e, 'fallback', e.payload.selectedPhase, null, null, e.payload.selectedPhase === 'HOLD' ? 'held' : 'invoked', e.payload.reason);
    }
    if (e.type === 'decision.outcome' && this.once(`d:${e.payload.commandId}`)) {
      const p = e.payload, arb = p.arbitrationId ? this.arbitrations.get(p.arbitrationId) : null;
      const source = p.decisionSource ?? (p.arbitrationId ? 'jev' : p.proposalIds.length === 2 ? 'agreement' : 'single_agent');
      const credited = source === 'agreement' ? [0, 1] : source === 'jev' && arb?.selected !== null && arb?.selected !== undefined ? [arb.selected] : source === 'single_agent' ? p.proposalIds.map(id => this.proposals.get(id)?.agent).filter((i): i is number => i !== undefined) : [];
      if (p.status === 'accepted') {
        if (source === 'single_agent') s.singleAgentAccepted++;
        else s.accepted[source]++;
        if (source === 'fallback') s.fallback.accepted++;
        if (source === 'jev') s.jevAcceptedBands[arb?.band ?? 'unmeasured']++;
        this.pendingService.set(p.commandId, { credited, phase: p.requestedPhase, cycle: e.correlationId });
        if (this.pendingService.size > 128) this.pendingService.delete(this.pendingService.keys().next().value!);
        for (const i of credited) {
          const a = s.agents[i];
          if (source === 'agreement') a.agreement++;
          if (source === 'jev') a.accepted++;
          if (p.requestedPhase === (i === 0 ? 'NS_GREEN' : 'EW_GREEN')) a.assignedAccepted++;
        }
      } else {
        if (source === 'fallback') s.fallback[p.status === 'rejected' ? 'rejected' : 'held']++;
        if (source === 'jev' && arb?.selected !== null) s.jev.validationRejected++;
      }
      this.row(e, source, p.requestedPhase, p.requestedGreenSeconds ?? null, arb?.confidence ?? null, p.status === 'unnecessary' ? 'held' : p.status, p.reason);
      if (p.status === "accepted" && p.realizedExtension) this.realize(p.commandId);
    }
    if (e.type === 'signal.phase_changed' && e.payload.signal.phase.endsWith('_GREEN') && this.once(`s:${e.eventId}`)) {
      if (e.payload.commandId && this.pendingService.get(e.payload.commandId)?.phase === e.payload.signal.phase) this.realize(e.payload.commandId);
      if (e.payload.reason === 'fixed_cycle' || e.payload.reason === 'clearance_complete' && e.source === 'controller') s.fixedGreenStarts++;
      else if (!e.payload.commandId) s.automaticGreenStarts++;
    }
  }
  private realize(id: string) {
    const request = this.pendingService.get(id);
    if (!request) return;
    this.pendingService.delete(id);
    for (const i of request.credited) {
      this.value.agents[i].realized++;
      if (request.phase === (i === 0 ? 'NS_GREEN' : 'EW_GREEN')) this.value.agents[i].servedAssigned++;
    }
    const row = [...this.value.recent].reverse().find(r => r.id === request.cycle && r.outcome === 'accepted');
    if (row) row.outcome = 'realized';
  }
  private row(e: ServerEvent, source: string, direction: string, seconds: number | null, confidence: number | null, outcome: string, reason: string | null) {
    this.value.recent.push({ time: e.simulationTimeMs, id: e.correlationId, source, direction, seconds, confidence, outcome, reason });
    if (this.value.recent.length > 80) this.value.recent.shift();
  }
}
