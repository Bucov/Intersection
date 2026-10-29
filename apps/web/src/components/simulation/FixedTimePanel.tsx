import type { SignalPhase, SignalState, SignalTiming } from "@intersection/shared";
import { useServices } from "@/app/services";
import { FixedCycleDiagram } from "@/components/home/ModeDiagrams";
import { useSimClock } from "@/hooks/useSimClock";
import { phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { shallowEqual, useStore } from "@/state/store";

const ORDER: { phase: SignalPhase; key: string }[] = [
  { phase: "NS_GREEN", key: "ns-green" },
  { phase: "NS_YELLOW", key: "ns-yellow" },
  { phase: "ALL_RED", key: "red-after-ns" },
  { phase: "EW_GREEN", key: "ew-green" },
  { phase: "EW_YELLOW", key: "ew-yellow" },
  { phase: "ALL_RED", key: "red-after-ew" },
];

function duration(phase: SignalPhase, timing: SignalTiming) {
  return phase.endsWith("_GREEN") ? timing.fixedGreenMs : phase.endsWith("_YELLOW") ? timing.yellowMs : timing.allRedMs;
}

function currentIndex(signal: SignalState): number {
  if (signal.phase === "ALL_RED") return signal.nextGreen === "EW_GREEN" ? 2 : 5;
  return ORDER.findIndex(o => o.phase === signal.phase);
}

/** The traditional controller's whole logic: one schedule, repeating, blind to traffic. */
export function FixedTimePanel() {
  const { session } = useServices();
  const { signal, timing } = useStore(session.store, s => ({ signal: s.signal, timing: s.snapshot?.config.signalTiming ?? null }), shallowEqual);
  const clock = useSimClock();
  if (!signal || !timing) return <p className="text-sm text-muted-foreground">The schedule appears once the session starts.</p>;

  const index = currentIndex(signal);
  const elapsed = Math.max(0, clock - signal.phaseStartedAtSimMs);
  const before = ORDER.slice(0, index).reduce((sum, o) => sum + duration(o.phase, timing), 0);
  const marker = before + Math.min(elapsed, duration(signal.phase, timing));
  const cycle = ORDER.reduce((sum, o) => sum + duration(o.phase, timing), 0);
  const remaining = Math.max(0, duration(signal.phase, timing) - elapsed);
  const next = ORDER[(index + 1) % ORDER.length].phase;

  return (
    <div className="flex flex-col gap-5" data-testid="fixed-time-panel">
      <section className="flex flex-col gap-2">
        <h3 className="text-[0.9375rem] font-semibold">Fixed-time controller</h3>
        <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
          This schedule repeats for the whole run. Queue lengths, waiting times and emergency vehicles have no effect on it. No AI is called in this mode.
        </p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border bg-card p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.8125rem] text-muted-foreground">Next change</span>
          <span className="text-sm">
            <span className="font-medium">{phaseName(next)}</span>
            <span className="font-mono tabular text-muted-foreground"> in {(remaining / 1000).toFixed(1)} s</span>
          </span>
        </div>
        <FixedCycleDiagram timing={timing} marker={marker} />
        {signal.clearanceBlockedByVehicles ? <p className="text-xs text-warning">All red is being held: vehicles are still inside the junction.</p> : null}
      </section>

      <table className="w-full border-collapse text-[0.8125rem]">
        <caption className="pb-2 text-left text-xs text-subtle-foreground">One cycle, {cycle / 1000} s</caption>
        <thead>
          <tr className="text-left text-xs text-subtle-foreground">
            <th className="py-1.5 font-normal">Phase</th>
            <th className="py-1.5 text-right font-normal">Duration</th>
          </tr>
        </thead>
        <tbody>
          {ORDER.map((o, i) => (
            <tr key={o.key} className={cn("border-t", i === index && "bg-muted/60")} aria-current={i === index ? "step" : undefined}>
              <td className={cn("py-1.5 pl-2", i === index ? "font-medium text-foreground" : "text-muted-foreground")}>{phaseName(o.phase)}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular">{duration(o.phase, timing) / 1000} s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
