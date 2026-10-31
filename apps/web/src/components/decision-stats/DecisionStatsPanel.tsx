import { useServices } from '@/app/services';
import { useStore } from '@/state/store';
import { formatClock, humanize } from '@/lib/format';
import { ProvenanceBadge } from '@/components/common/ProvenanceBadge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const mean = (sum: number, count: number) => count ? `${Math.round(sum / count)} ms (${count} samples)` : '—';
function Definition({ children, text }: { children: React.ReactNode; text: string }) {
  return <Tooltip><TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">{children}</TooltipTrigger><TooltipContent className="max-w-72">{text}</TooltipContent></Tooltip>;
}
export function DecisionStatsPanel() {
  const { session } = useServices();
  const snapshot = useStore(session.store, s => s.snapshot);
  const stats = snapshot?.decisionStats;
  if (!snapshot || !stats) return <p className="text-sm text-muted-foreground">Decision statistics are not available for this session yet.</p>;
  const ai = snapshot.config.mode === 'ai';
  const total = Object.values(stats.accepted).reduce((a, b) => a + b, 0);
  const j = stats.jev;
  const sources = [ ['fallback', 'Deterministic fallback', 'bg-warning'], ['jev', 'JEV arbitration', 'bg-jev'], ['agreement', 'Agent agreement', 'bg-positive'] ] as const;
  const policy = stats.policy;
  return <div className="flex flex-col gap-7 text-sm" aria-label="Decision statistics">
    <section className="space-y-3">
      <h2 className="font-semibold">Decision sources</h2>
      <p className="text-muted-foreground">Session totals · reset with the simulation. <ProvenanceBadge provenance={snapshot.config.demoMode} /> agents · <ProvenanceBadge provenance={snapshot.providers[1].mode} /> JEV</p>
      {!ai ? <p>Fixed controller: {stats.fixedGreenStarts} green starts. AI statistics are not applicable.</p> : <>
        <p><strong className="text-xl tabular-nums">{total}</strong> accepted decisions from the three sources</p>
        <div className="flex h-3 overflow-hidden rounded-sm bg-muted" role="img" aria-label={sources.map(([key, label]) => `${label}: ${stats.accepted[key]}`).join(', ')}>
          {sources.map(([key, , color]) => <span key={key} className={color} style={{ width: `${total ? stats.accepted[key] / total * 100 : 0}%` }} />)}
        </div>
        <dl className="space-y-2">{sources.map(([key, label]) => <div key={key} className="flex justify-between gap-3"><dt>{label}</dt><dd className="tabular-nums">{stats.accepted[key]} · {total ? `${(100 * stats.accepted[key] / total).toFixed(1)}%` : '—'}</dd></div>)}</dl>
        <p className="text-xs text-muted-foreground">JEV accepted: {stats.jevAcceptedBands.high} high confidence; {stats.jevAcceptedBands.medium} medium confidence. Single-agent requests accepted separately: {stats.singleAgentAccepted}. All accepted requests: {total + stats.singleAgentAccepted}.</p>
        <p className="text-xs text-muted-foreground">Automatic green starts without a command: {stats.automaticGreenStarts}. These are not fallback commands.</p>
      </>}
    </section>
    {ai && <>
      <section className="space-y-3">
        <h2 className="font-semibold">Fallback diagnostics</h2>
        <p><Definition text="Backup rules ran. They may retain the plan without issuing a new command.">{stats.fallback.invocations} invocations</Definition> · {stats.fallback.accepted} accepted · {stats.fallback.held} held · {stats.fallback.rejected} rejected</p>
        {Object.keys(stats.fallback.reasons).length ? <dl className="space-y-2">{Object.entries(stats.fallback.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => <div key={reason} className="flex justify-between gap-3"><dt>{humanize(reason)} <span className="block text-xs text-muted-foreground">{reason}</span></dt><dd>{n}</dd></div>)}</dl> : <p className="text-muted-foreground">No fallback invocations yet.</p>}
        <p className="text-xs text-muted-foreground">A fallback invocation can retain the current plan. Reason codes preserve the engine's evidence; low confidence can include missing confidence.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">JEV performance</h2>
        <p>{j.requests} requests · {j.terminal} terminal · {j.requests - j.terminal} pending</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 tabular-nums">
          <dt>Selected A / B / abstained</dt><dd>{j.selectedA} / {j.selectedB} / {j.abstained}</dd>
          <dt>High / medium / low / unmeasured</dt><dd>{j.high} / {j.medium} / {j.low} / {j.unmeasured}</dd>
          <dt>Accepted / selected proposals</dt><dd>{stats.accepted.jev} / {j.selectedA + j.selectedB}</dd>
          <dt>Policy/freshness exclusions at arbitration</dt><dd>{j.policyRejected}</dd>
          <dt>Controller/freshness rejections after selection</dt><dd>{j.validationRejected}</dd>
          <dt>Timeouts / other errors</dt><dd>{j.timeouts} / {j.errors}</dd>
          <dt>Average latency</dt><dd>{mean(j.latencySum, j.latencyCount)}</dd>
          <dt>Maximum latency</dt><dd>{j.latencyCount ? `${Math.round(j.latencyMax)} ms` : '—'}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">High ≥ {policy.highThreshold * 100}%; medium ≥ {policy.mediumThreshold * 100}%. {session.activeTransport?.source === 'mock' ? 'Offline: medium confidence passes only when the deterministic check agrees; agreement compares direction.' : 'Backend: medium confidence is deferred; agreement requires matching direction and duration.'} Missing confidence is unmeasured. Mock latencies and results are synthetic.</p>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Agent comparison</h2>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Agent proposals, acceptance and realized service</caption><thead><tr><th className="py-2">Measurement</th><th className="p-2">A · N/S</th><th className="p-2">B · E/W</th></tr></thead><tbody>
          {([['Proposals submitted', 'proposals'], ['Accepted agreement credit', 'agreement'], ['Selected by JEV', 'selected'], ['JEV selection accepted', 'accepted'], ['Accepted requests for assigned direction', 'assignedAccepted'], ['Realized requests for assigned direction', 'servedAssigned'], ['Realized starts/extensions (any direction)', 'realized'], ['Inference failures (includes reported timeouts)', 'failures']] as const).map(([label, key]) => <tr key={key} className="border-t border-border"><th className="py-2 pr-3 font-normal">{label}</th>{stats.agents.map((a, i) => <td key={i} className="p-2 tabular-nums">{a[key]}</td>)}</tr>)}
          <tr className="border-t border-border"><th className="py-2 pr-3 font-normal">Average inference latency</th>{stats.agents.map((a, i) => <td key={i} className="p-2">{mean(a.latencySum, a.latencyCount)}</td>)}</tr>
        </tbody></table></div>
        <p className="text-xs text-muted-foreground">Agreement credits both agents but counts once globally. Assigned-direction service follows the actual request, not the agent's name. Acceptance is not green delivery. Realized counts require a correlated green start or an accepted extension; cancelled or pending work is not a failure.</p>
      </section>
    </>}
    <section className="space-y-3">
      <h2 className="font-semibold">Recent decision history</h2>
      <p className="text-xs text-muted-foreground">Last 80 records; totals cover the whole generation. Cycle IDs match Transcript details. An invocation and its command outcome are separate records.</p>
      {stats.recent.length ? <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Time / cycle', 'Source', 'Request', 'Confidence', 'Outcome / reason'].map(t => <th key={t} className="p-2">{t}</th>)}</tr></thead><tbody>{[...stats.recent].reverse().map((r, i) => <tr key={i} className="border-t border-border"><td className="p-2">{formatClock(r.time)}<span className="block max-w-40 break-words text-muted-foreground">{r.id}</span></td><td className="p-2">{humanize(r.source)}</td><td className="p-2">{humanize(r.direction)}{r.seconds !== null && ` · ${r.seconds}s`}</td><td className="p-2">{r.confidence === null ? '—' : `${(r.confidence * 100).toFixed(1)}%`}</td><td className="p-2">{humanize(r.outcome)}<span className="block text-muted-foreground">{r.reason}</span></td></tr>)}</tbody></table></div> : <p className="text-muted-foreground">No decision requests yet.</p>}
    </section>
  </div>;
}
