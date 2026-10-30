import type { ReactNode } from "react";
import type { ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { formatCount, formatLatency, formatRate, formatSeconds } from "@/lib/format";
import { shallowEqual, useStore } from "@/state/store";
import { TimeSeriesChart } from "./TimeSeriesChart";

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-1.5">
      <dt className="text-muted-foreground">
        {label}
        {hint ? <span className="block text-xs text-subtle-foreground">{hint}</span> : null}
      </dt>
      <dd className="text-right font-mono tabular">{value}</dd>
    </div>
  );
}

const none = (text: string) => <span className="font-sans text-subtle-foreground">{text}</span>;

export function MetricsPanel({ mode }: { mode: ControllerMode }) {
  const { session } = useServices();
  const { metrics: m, series, demoMode, time } = useStore(session.store, s => ({ metrics: s.metrics, series: s.series, demoMode: s.snapshot?.config.demoMode ?? null, time: s.simulationTimeMs }), shallowEqual);
  const controllerColor = mode === "ai" ? "var(--chart-ai)" : "var(--chart-fixed)";
  const controllerLabel = mode === "ai" ? "AI" : "Fixed-time";
  const simulated = m?.inferenceTiming === "wall" ? " (measured wall time)" : demoMode !== "live" ? " (simulated)" : "";

  if (!m) return <p className="text-sm text-muted-foreground">Metrics appear once the session starts.</p>;

  return (
    <div className="flex flex-col gap-6" data-testid="metrics-panel">
      <section aria-labelledby="metrics-now" className="flex flex-col gap-1">
        <h3 id="metrics-now" className="text-[0.9375rem] font-semibold">Right now</h3>
        <dl className="divide-y text-sm">
          <Row label="On the road" value={formatCount(m.activeVehicleCount)} />
          <Row label="Waiting upstream" hint="Requested but not yet able to enter" value={formatCount(m.upstreamBacklogCount)} />
          <Row label="Queue North/South ⋅ East/West" hint="Stopped before the stop line" value={`${m.queueByApproach.north + m.queueByApproach.south} ⋅ ${m.queueByApproach.east + m.queueByApproach.west}`} />
          {m.timeAverageQueueLength !== undefined ? <Row label="Time-average queue" hint="Queue integral / elapsed simulation time" value={m.timeAverageQueueLength.toFixed(1)} /> : null}
          {m.maximumObservedDelayMs !== undefined ? <Row label="Maximum accrued wait" hint="Includes incomplete trips" value={formatSeconds(m.maximumObservedDelayMs)} /> : null}
          <Row label="Longest queue so far" value={formatCount(m.maximumQueueLength)} />
          <Row label="Completed trips" value={formatCount(m.completedVehicleCount)} />
          <Row label="Average wait" hint="Completed trips only" value={m.averageCompletedWaitingTimeMs === null ? none("No completed trips") : formatSeconds(m.averageCompletedWaitingTimeMs)} />
          <Row label="Average travel time" hint="Completed trips, from request to exit" value={m.averageCompletedTravelTimeMs === null ? none("No completed trips") : formatSeconds(m.averageCompletedTravelTimeMs)} />
          <Row label="Waiting accrued, unfinished trips" hint="On the road plus upstream" value={formatSeconds(m.activeWaitingTimeMs + m.upstreamWaitingTimeMs, 0)} />
          <Row label="Throughput" hint={`${m.completedVehicleCount} completions in ${Math.round(time / 1000)} s; early values swing`} value={formatRate(m.throughputVehPerHour)} />
          <Row label="Emergency signal delay" hint="Completed responding emergencies" value={m.averageCompletedEmergencySignalDelayMs === null ? none("None completed yet") : formatSeconds(m.averageCompletedEmergencySignalDelayMs)} />
          {m.activeEmergencySignalDelayMs > 0 ? <Row label="Emergency delay, still on the road" value={formatSeconds(m.activeEmergencySignalDelayMs)} /> : null}
          <Row label="Signal changes" hint="Includes yellow and all red" value={formatCount(m.signalChangeCount)} />
        </dl>
      </section>

      <TimeSeriesChart
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
        title="Average wait, completed trips"
        data={series}
        series={[{ key: "avgWaitS", label: controllerLabel, color: controllerColor }]}
        format={value => `${value.toFixed(1)} s`}
        empty="No trips have completed yet."
      />
      <TimeSeriesChart
        title="Throughput"
        description="Completed trips per hour since the start."
        data={series}
        series={[{ key: "throughput", label: controllerLabel, color: controllerColor }]}
        format={value => String(Math.round(value))}
      />

      {mode === "ai" ? (
        <section aria-labelledby="metrics-ai" className="flex flex-col gap-1">
          <h3 id="metrics-ai" className="text-[0.9375rem] font-semibold">AI activity</h3>
          <dl className="divide-y text-sm">
            <Row label="Agent requests started" value={formatCount(m.geminiRequestCount)} />
            <Row label="Agent latency, mean ⋅ max" hint={`${m.geminiLatency.sampleCount} attempts${simulated}`} value={m.geminiLatency.meanMs === null ? none("No attempts yet") : `${formatLatency(m.geminiLatency.meanMs)} ⋅ ${formatLatency(m.geminiLatency.maxMs)}`} />
            <Row label="JEV decisions" hint="Parsed responses: high ⋅ medium ⋅ low confidence" value={`${m.jevDecisionCount} (${m.jevConfidenceCounts.high} ⋅ ${m.jevConfidenceCounts.medium} ⋅ ${m.jevConfidenceCounts.low})`} />
            <Row label="JEV latency, mean ⋅ max" hint={`${m.jevLatency.sampleCount} attempts${simulated}`} value={m.jevLatency.meanMs === null ? none("No attempts yet") : `${formatLatency(m.jevLatency.meanMs)} ⋅ ${formatLatency(m.jevLatency.maxMs)}`} />
            <Row label="Deadline misses" value={formatCount(m.deadlineMissCount)} />
            <Row label="Safety rejections" value={formatCount(m.safetyRejectionCount)} />
          </dl>
        </section>
      ) : null}
    </div>
  );
}
