import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import type { ComparisonResponse, MetricsSample, ScenarioDefinition, ScenarioId, TrafficMetrics } from "@intersection/shared";
import { useServices } from "@/app/services";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { TimeSeriesChart } from "@/components/metrics/TimeSeriesChart";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createRequestId } from "@/lib/ids";
import { formatClock, formatCount, formatRate, formatSeconds } from "@/lib/format";
import { isTransportError } from "@/transport/IntersectionTransport";
import { useStore } from "@/state/store";

type Phase = { kind: "idle" } | { kind: "running"; comparison: ComparisonResponse | null } | { kind: "done"; comparison: ComparisonResponse; series: { t: number; fixed: number | null; ai: number | null }[] } | { kind: "error"; message: string };

interface MetricRow {
  label: string;
  hint?: string;
  value: (m: TrafficMetrics) => number | null;
  format: (value: number) => string;
  better: "lower" | "higher" | null;
}

const ROWS: MetricRow[] = [
  { label: "Completed trips", value: m => m.completedVehicleCount, format: formatCount, better: "higher" },
  { label: "Average wait", hint: "Completed trips", value: m => m.averageCompletedWaitingTimeMs, format: v => formatSeconds(v), better: "lower" },
  { label: "Average travel time", hint: "Completed trips", value: m => m.averageCompletedTravelTimeMs, format: v => formatSeconds(v), better: "lower" },
  { label: "Waiting accrued, unfinished trips", value: m => m.activeWaitingTimeMs + m.upstreamWaitingTimeMs, format: v => formatSeconds(v, 0), better: "lower" },
  { label: "Longest queue", value: m => m.maximumQueueLength, format: formatCount, better: "lower" },
  { label: "Still waiting upstream", value: m => m.upstreamBacklogCount, format: formatCount, better: "lower" },
  { label: "Throughput", value: m => m.throughputVehPerHour, format: formatRate, better: "higher" },
  { label: "Emergency signal delay", hint: "Completed responding emergencies", value: m => m.averageCompletedEmergencySignalDelayMs, format: v => formatSeconds(v), better: "lower" },
  { label: "Signal changes", value: m => m.signalChangeCount, format: formatCount, better: null },
];

async function allSamples(fetch: (from: number) => Promise<{ samples: MetricsSample[]; nextFromSimMs: number | null }>) {
  const out: MetricsSample[] = [];
  let from: number | null = 0;
  for (let guard = 0; from !== null && guard < 20; guard++) {
    const page = await fetch(from);
    out.push(...page.samples);
    from = page.nextFromSimMs;
  }
  return out;
}

const queueTotal = (m: TrafficMetrics) => m.waitingVehicleCount;

/**
 * Paired comparison through the contract's comparison API: two isolated
 * sessions, same scenario, seed, demand schedule and duration. Results are
 * whatever the runs produce; no winner is assumed.
 */
export function ComparisonPanel({ scenarioId, seed, scenarios }: { scenarioId: ScenarioId; seed: number; scenarios: readonly ScenarioDefinition[] }) {
  const services = useServices();
  const source = useStore(services.dataSource.store, s => s);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [durationMs, setDurationMs] = useState(120_000);
  const cancelled = useRef(false);
  const scenario = scenarios.find(s => s.id === scenarioId);
  // Every scheduled scenario event must fall inside the comparison window.
  const latestEvent = Math.max(0, ...(scenario?.defaults.scheduledEvents.map(e => e.atSimMs) ?? [0]));
  const durations = [60_000, 120_000, 300_000].filter(d => d > latestEvent && (!scenario || d <= scenario.defaults.durationMs));
  const effectiveDuration = durations.includes(durationMs) ? durationMs : durations[0] ?? 300_000;
  const demoMode = source.catalog?.config.demoMode ?? "mock";
  const execution = demoMode === "mock" ? "accelerated_mock" : "realtime";

  // Reset on mount too: StrictMode runs cleanup once in development before remounting.
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = async () => {
    const transport = services.dataSource.transport();
    setPhase({ kind: "running", comparison: null });
    try {
      let comparison = await transport.createComparison({
        requestId: createRequestId("compare"),
        scenarioId,
        seed,
        durationMs: effectiveDuration,
        execution,
        speedMultiplier: execution === "accelerated_mock" ? 20 : 1,
      });
      while (comparison.status === "running" || comparison.status === "ready") {
        if (cancelled.current) return;
        setPhase({ kind: "running", comparison });
        await new Promise(resolve => setTimeout(resolve, execution === "realtime" ? 1000 : 250));
        comparison = await transport.getComparison(comparison.comparisonId);
      }
      if (comparison.status === "failed") {
        setPhase({ kind: "error", message: "The comparison failed on the server." });
        return;
      }
      const [fixed, ai] = await Promise.all([
        allSamples(from => transport.getMetrics(comparison.traditional.sessionId, { fromSimMs: String(from), limit: "1000" })),
        allSamples(from => transport.getMetrics(comparison.ai.sessionId, { fromSimMs: String(from), limit: "1000" })),
      ]);
      const aiByTime = new Map(ai.map(s => [s.simulationTimeMs, s.metrics]));
      const series = fixed.map(s => ({ t: s.simulationTimeMs, fixed: queueTotal(s.metrics), ai: aiByTime.has(s.simulationTimeMs) ? queueTotal(aiByTime.get(s.simulationTimeMs)!) : null }));
      if (!cancelled.current) setPhase({ kind: "done", comparison, series });
    } catch (error) {
      if (!cancelled.current) setPhase({ kind: "error", message: isTransportError(error) ? error.message : "The comparison could not be run." });
    }
  };

  const running = phase.kind === "running";
  const progress = phase.kind === "running" && phase.comparison
    ? Math.min(phase.comparison.traditional.simulationTimeMs, phase.comparison.ai.simulationTimeMs) / phase.comparison.durationMs
    : 0;

  return (
    <div className="flex flex-col gap-5" data-testid="comparison">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Fixed-time vs AI</h3>
          <p className="mt-1 text-[0.8125rem] leading-snug text-muted-foreground">
            Runs both controllers on {scenario?.name ?? "this scenario"} with seed {seed}: identical arrivals, initial queues and safety timings, in two isolated sessions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup value={[String(effectiveDuration)]} onValueChange={v => v[0] && setDurationMs(Number(v[0]))} variant="outline" size="sm" spacing={0} aria-label="Comparison duration" disabled={running}>
            {durations.map(d => (
              <ToggleGroupItem key={d} value={String(d)} className="h-8 px-2.5 font-mono text-xs">{formatClock(d)}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button size="sm" className="h-8" onClick={() => void run()} disabled={running || source.blocked}>
            {running ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Play />}
            {running ? "Running…" : phase.kind === "done" ? "Run again" : "Run comparison"}
          </Button>
        </div>
        <p className="text-xs leading-snug text-subtle-foreground">
          {execution === "accelerated_mock"
            ? "Mock adapters, computed faster than real time. It demonstrates the control logic, not live model performance."
            : `Live models run in real time, so this takes about ${formatClock(effectiveDuration)}.`}
        </p>
        {running ? (
          <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Comparison progress">
            <div className="h-full rounded-full bg-foreground/70 transition-[width]" style={{ width: `${Math.max(4, progress * 100)}%` }} />
          </div>
        ) : null}
        {phase.kind === "error" ? <p className="text-sm text-destructive" role="alert">{phase.message}</p> : null}
      </section>

      {phase.kind === "done" ? (
        <>
          <section aria-labelledby="comparison-results" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h4 id="comparison-results" className="text-[0.8125rem] font-medium">After {formatClock(phase.comparison.durationMs)}</h4>
              <ProvenanceBadge provenance={phase.comparison.demoMode === "mock" ? "mock" : "live"} />
            </div>
            <table className="w-full border-collapse text-[0.8125rem]">
              <thead>
                <tr className="text-left text-xs text-subtle-foreground">
                  <th className="py-1.5 pr-2 font-normal">Metric</th>
                  <th className="py-1.5 pr-2 text-right font-normal"><span className="mr-1 inline-block h-0.5 w-3 rounded-full bg-chart-fixed align-middle" aria-hidden="true" />Fixed</th>
                  <th className="py-1.5 text-right font-normal"><span className="mr-1 inline-block h-0.5 w-3 rounded-full bg-chart-ai align-middle" aria-hidden="true" />AI</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(row => {
                  const a = row.value(phase.comparison.traditional.metrics);
                  const b = row.value(phase.comparison.ai.metrics);
                  return (
                    <tr key={row.label} className="border-t align-baseline">
                      <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">
                        {row.label}
                        {row.hint ? <span className="block text-xs text-subtle-foreground">{row.hint}</span> : null}
                      </th>
                      <td className="py-1.5 pr-2 text-right font-mono tabular">{a === null ? <span className="font-sans text-xs text-subtle-foreground">None</span> : row.format(a)}</td>
                      <td className="py-1.5 text-right font-mono tabular">{b === null ? <span className="font-sans text-xs text-subtle-foreground">None</span> : row.format(b)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <TimeSeriesChart
            title="Total queue over time"
            description="Vehicles stopped before the stop lines, both controllers on the same arrivals."
            data={phase.series}
            series={[
              { key: "fixed", label: "Fixed-time", color: "var(--chart-fixed)" },
              { key: "ai", label: "AI", color: "var(--chart-ai)" },
            ]}
            format={value => String(Math.round(value))}
          />
          <section aria-labelledby="comparison-limits" className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <h4 id="comparison-limits" className="text-[0.8125rem] font-medium text-foreground">Limitations</h4>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {phase.comparison.limitations.map(item => <li key={item}>{item}</li>)}
            </ul>
            <p className="font-mono text-[0.6875rem] text-subtle-foreground">Demand schedule {phase.comparison.demandScheduleId} ⋅ {phase.comparison.demandScheduleHash.slice(0, 12)}…</p>
          </section>
        </>
      ) : phase.kind === "idle" ? (
        <p className="rounded-md border border-dashed p-3 text-[0.8125rem] leading-snug text-muted-foreground">No comparison yet. Run one to see both controllers side by side. Nothing is shown until both runs finish.</p>
      ) : null}
    </div>
  );
}
