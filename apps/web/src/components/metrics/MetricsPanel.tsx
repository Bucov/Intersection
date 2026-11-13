import { memo, type ReactNode } from "react";
import type { ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { BoardFigure, BoardHeadline, BoardSection } from "@/components/common/Board";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { Squares } from "@/components/common/Squares";
import { unitFor } from "@/components/common/squareUnits";
import { formatClock, formatCount, formatLatency, formatRate, formatSeconds } from "@/lib/format";
import type { MetricsPoint } from "@/state/session";
import { shallowEqual, useStore } from "@/state/store";
import { TimeSeriesChart } from "./TimeSeriesChart";

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-muted-foreground">
        {label}
        {hint ? <span className="block text-xs text-subtle-foreground">{hint}</span> : null}
      </dt>
      <dd className="shrink-0 text-right font-mono tabular text-foreground">{value}</dd>
    </div>
  );
}

const none = (text: string) => <span className="font-sans text-subtle-foreground">{text}</span>;

/** The two queues as the Statistics board draws a pair: figures out from a shared axis, squares under them. */
function Queues({ ns, ew }: { ns: number; ew: number }) {
  const unit = unitFor(Math.max(ns, ew, 1));
  const side = (value: number, label: string, tone: string, align: "start" | "end") => (
    <div className={align === "end" ? "flex min-w-0 flex-col items-end gap-3" : "flex min-w-0 flex-col items-start gap-3"}>
      <BoardFigure value={value} label={label} tone={tone} align={align} />
      <Squares parts={[{ label, value, tone }]} unit={unit} start={0} align={align} columns={10} live label={`${label}: ${value} queued`} />
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_1px_1fr] gap-x-5">
        {side(ns, "North/South queue", "text-group-ns", "end")}
        <span className="bg-border" aria-hidden="true" />
        {side(ew, "East/West queue", "text-group-ew", "start")}
      </div>
      <p className="text-xs text-subtle-foreground">Stopped before the stop line. One square is {unit} {unit === 1 ? "vehicle" : "vehicles"}.</p>
    </div>
  );
}

/**
 * Charts subscribe to the metric series only, which grows once per simulated
 * second; the clock and live values around them update without redrawing them.
 */
const Charts = memo(function Charts({ mode }: { mode: ControllerMode }) {
  const { session } = useServices();
  const series = useStore(session.store, s => s.series) as MetricsPoint[];
  const controllerColor = mode === "ai" ? "var(--chart-ai)" : "var(--chart-fixed)";
  const controllerLabel = mode === "ai" ? "AI" : "Fixed-time";
  return (
    <>
      <TimeSeriesChart
        variant="board"
        title="Queue length"
        description="Vehicles stopped before the stop line, sampled every simulated second."
        data={series}
        series={[
          { key: "queueNS", label: "North/South", color: "var(--chart-ns)" },
          { key: "queueEW", label: "East/West", color: "var(--chart-ew)" },
        ]}
        format={value => String(Math.round(value))}
      />
      <TimeSeriesChart
        variant="board"
        title="Average wait, completed trips"
        data={series}
        series={[{ key: "avgWaitS", label: controllerLabel, color: controllerColor }]}
        format={value => `${value.toFixed(1)} s`}
        empty="No trips have completed yet."
      />
      <TimeSeriesChart
        variant="board"
        title="Throughput"
        description="Completed trips per hour since the start."
        data={series}
        series={[{ key: "throughput", label: controllerLabel, color: controllerColor }]}
        format={value => String(Math.round(value))}
      />
    </>
  );
});

/** The live numbers: they follow the session clock, which ticks far more often than the charts change. */
function Live({ mode }: { mode: ControllerMode }) {
  const { session } = useServices();
  const { metrics: m, demoMode, second, roundedSecond } = useStore(
    session.store,
    s => ({ metrics: s.metrics, demoMode: s.snapshot?.config.demoMode ?? null, second: Math.floor(s.simulationTimeMs / 1000), roundedSecond: Math.round(s.simulationTimeMs / 1000) }),
    shallowEqual,
  );
  if (!m) return null;
  const simulated = m.inferenceTiming === "wall" ? " (measured wall time)" : demoMode !== "live" ? " (simulated)" : "";

  return (
    <>
      <BoardHeadline
        context={
          <>
            <span>{mode === "ai" ? "AI controller" : "Fixed-time controller"} ⋅ live</span>
            {demoMode ? <ProvenanceBadge provenance={demoMode} /> : null}
          </>
        }
      >
        {formatClock(second * 1000)} in: {formatCount(m.activeVehicleCount)} on the road, {formatCount(m.completedVehicleCount)} {m.completedVehicleCount === 1 ? "trip" : "trips"} completed.
      </BoardHeadline>

      <BoardSection title="Right now" note="Live values, updated as the simulation runs." id="metrics-now">
        <Queues ns={m.queueByApproach.north + m.queueByApproach.south} ew={m.queueByApproach.east + m.queueByApproach.west} />
        <dl className="flex flex-col gap-3 text-sm">
          <Row label="On the road" value={formatCount(m.activeVehicleCount)} />
          <Row label="Waiting upstream" hint="Requested but not yet able to enter" value={formatCount(m.upstreamBacklogCount)} />
          {m.timeAverageQueueLength !== undefined ? <Row label="Time-average queue" hint="Queue integral / elapsed simulation time" value={m.timeAverageQueueLength.toFixed(1)} /> : null}
          {m.maximumObservedDelayMs !== undefined ? <Row label="Maximum accrued wait" hint="Includes incomplete trips" value={formatSeconds(m.maximumObservedDelayMs)} /> : null}
          <Row label="Longest queue so far" value={formatCount(m.maximumQueueLength)} />
          <Row label="Completed trips" value={formatCount(m.completedVehicleCount)} />
          <Row label="Average wait" hint="Completed trips only" value={m.averageCompletedWaitingTimeMs === null ? none("No completed trips") : formatSeconds(m.averageCompletedWaitingTimeMs)} />
          <Row label="Average travel time" hint="Completed trips, from request to exit" value={m.averageCompletedTravelTimeMs === null ? none("No completed trips") : formatSeconds(m.averageCompletedTravelTimeMs)} />
          <Row label="Waiting accrued, unfinished trips" hint="On the road plus upstream" value={formatSeconds(m.activeWaitingTimeMs + m.upstreamWaitingTimeMs, 0)} />
          <Row label="Throughput" hint={`${m.completedVehicleCount} completions in ${roundedSecond} s; early values swing`} value={formatRate(m.throughputVehPerHour)} />
          <Row label="Emergency signal delay" hint="Completed responding emergencies" value={m.averageCompletedEmergencySignalDelayMs === null ? none("None completed yet") : formatSeconds(m.averageCompletedEmergencySignalDelayMs)} />
          {m.activeEmergencySignalDelayMs > 0 ? <Row label="Emergency delay, still on the road" value={formatSeconds(m.activeEmergencySignalDelayMs)} /> : null}
          <Row label="Signal changes" hint="Includes yellow and all red" value={formatCount(m.signalChangeCount)} />
        </dl>
      </BoardSection>

      <Charts mode={mode} />

      {mode === "ai" ? (
        <BoardSection title="AI activity" note={`Agent and JEV calls in this session${simulated}.`} id="metrics-ai">
          <dl className="flex flex-col gap-3 text-sm">
            <Row label="Agent requests started" value={formatCount(m.geminiRequestCount)} />
            <Row label="Agent latency, mean ⋅ max" hint={`${m.geminiLatency.sampleCount} attempts${simulated}`} value={m.geminiLatency.meanMs === null ? none("No attempts yet") : `${formatLatency(m.geminiLatency.meanMs)} ⋅ ${formatLatency(m.geminiLatency.maxMs)}`} />
            <Row label="JEV decisions" hint="Parsed responses: high ⋅ medium ⋅ low confidence" value={`${m.jevDecisionCount} (${m.jevConfidenceCounts.high} ⋅ ${m.jevConfidenceCounts.medium} ⋅ ${m.jevConfidenceCounts.low})`} />
            <Row label="JEV latency, mean ⋅ max" hint={`${m.jevLatency.sampleCount} attempts${simulated}`} value={m.jevLatency.meanMs === null ? none("No attempts yet") : `${formatLatency(m.jevLatency.meanMs)} ⋅ ${formatLatency(m.jevLatency.maxMs)}`} />
            <Row label="Deadline misses" value={formatCount(m.deadlineMissCount)} />
            <Row label="Safety rejections" value={formatCount(m.safetyRejectionCount)} />
          </dl>
        </BoardSection>
      ) : null}
    </>
  );
}

export function MetricsPanel({ mode }: { mode: ControllerMode }) {
  const { session } = useServices();
  const ready = useStore(session.store, s => s.metrics !== null);
  if (!ready) return <p className="text-sm text-muted-foreground">Metrics appear once the session starts.</p>;
  return (
    <div className="flex flex-col gap-8 pb-4" data-testid="metrics-panel">
      <Live mode={mode} />
    </div>
  );
}
