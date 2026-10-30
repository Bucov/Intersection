import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { signalLights, type ControllerMode, type SignalPhase, type SignalTiming } from "@intersection/shared";
import { useServices } from "@/app/services";
import { useSimClock } from "@/hooks/useSimClock";
import { formatClock, formatLatency, phaseName } from "@/lib/format";
import type { PhaseSegment, TimelineBar, TimelineLane } from "@/state/session";
import { shallowEqual, useStore } from "@/state/store";

// AI: a tighter window so second-long inference bars stay legible. Fixed: show the schedule ahead.
const WINDOW: Record<ControllerMode, { back: number; ahead: number }> = {
  // About 50 px per simulated second on a laptop, so a 0.9 s inference prints its latency.
  ai: { back: 14_000, ahead: 3_000 },
  traditional: { back: 40_000, ahead: 30_000 },
};
const ROW = 18;
const GAP = 4;
const LABEL_W = 74;
const AXIS_H = 18;

type Row = { key: string; label: string; kind: "signal-ns" | "signal-ew" | TimelineLane };

const AI_ROWS: Row[] = [
  { key: "ns", label: "N/S light", kind: "signal-ns" },
  { key: "ew", label: "E/W light", kind: "signal-ew" },
  { key: "a", label: "Agent A", kind: "agent-a" },
  { key: "b", label: "Agent B", kind: "agent-b" },
  { key: "jev", label: "JEV", kind: "jev" },
  { key: "safety", label: "Safety", kind: "safety" },
];
const FIXED_ROWS: Row[] = AI_ROWS.slice(0, 2);

const LANE_FILL: Record<TimelineLane, string> = {
  "agent-a": "var(--group-ns)",
  "agent-b": "var(--group-ew)",
  jev: "var(--jev)",
  safety: "var(--safety)",
};
const LIGHT_FILL = { green: "var(--signal-green)", yellow: "var(--signal-amber)", red: "color-mix(in oklch, var(--signal-red) 62%, transparent)" } as const;

/** Upcoming fixed-time phases, so the fixed schedule is visible ahead of "now". */
function projectFixedSchedule(last: PhaseSegment | undefined, timing: SignalTiming, until: number, nextGreen: "NS_GREEN" | "EW_GREEN"): PhaseSegment[] {
  if (!last) return [];
  const order: SignalPhase[] = ["NS_GREEN", "NS_YELLOW", "ALL_RED", "EW_GREEN", "EW_YELLOW", "ALL_RED"];
  const duration = (phase: SignalPhase) => (phase.endsWith("_GREEN") ? timing.fixedGreenMs : phase.endsWith("_YELLOW") ? timing.yellowMs : timing.allRedMs);
  let index = order.indexOf(last.phase);
  // All red precedes either group; the signal says which one is next.
  if (last.phase === "ALL_RED") index = nextGreen === "EW_GREEN" ? 2 : 5;
  let start = last.startSimMs + duration(last.phase);
  const out: PhaseSegment[] = [];
  let guard = 0;
  while (start < until && guard++ < 12) {
    index = (index + 1) % order.length;
    out.push({ phase: order[index], startSimMs: start });
    start += duration(order[index]);
  }
  return out;
}

/**
 * Signal-timing chart of the coordination: the two signal groups on top, then
 * each participant's activity on the same simulation-time axis. Overlapping
 * Agent A / Agent B bars are concurrent inference.
 */
export function ConcurrencyTimeline({ mode }: { mode: ControllerMode }) {
  const { session } = useServices();
  const data = useStore(session.store, s => ({
    phases: s.phases,
    bars: s.timeline,
    timing: s.snapshot?.config.signalTiming ?? null,
    demoMode: s.snapshot?.config.demoMode ?? null,
    controller: s.controller?.activeController ?? null,
    nextGreen: s.signal?.nextGreen ?? "EW_GREEN",
    speed: s.speedMultiplier,
  }), shallowEqual);
  const clock = useSimClock(15);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(320, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = mode === "ai" ? AI_ROWS : FIXED_ROWS;
  const now = Math.max(clock, data.phases[data.phases.length - 1]?.startSimMs ?? 0);
  // The axis starts at 0:00 and fills up before it starts to scroll.
  const span = WINDOW[mode].back + WINDOW[mode].ahead;
  const start = Math.max(0, now - WINDOW[mode].back);
  const end = start + span;
  const plotW = width - LABEL_W - 8;
  const x = (t: number) => LABEL_W + ((t - start) / (end - start)) * plotW;
  const height = rows.length * (ROW + GAP) + AXIS_H;
  const rowY = (i: number) => i * (ROW + GAP);

  const projected = useMemo(
    () => (data.controller === "fixed_time" && data.timing ? projectFixedSchedule(data.phases[data.phases.length - 1], data.timing, end, data.nextGreen) : []),
    [data.controller, data.timing, data.phases, data.nextGreen, end],
  );

  const ticks: number[] = [];
  const tickStep = span <= 20_000 ? 5_000 : 10_000;
  for (let t = Math.ceil(start / tickStep) * tickStep; t <= end; t += tickStep) ticks.push(t);

  const signalSegments = (group: "north" | "east") => {
    const out: { from: number; to: number; state: "red" | "yellow" | "green"; future: boolean; phase: SignalPhase }[] = [];
    const all = [...data.phases.map(p => ({ ...p, future: false })), ...projected.map(p => ({ ...p, future: true }))];
    all.forEach((segment, i) => {
      const next = all[i + 1];
      const from = Math.max(segment.startSimMs, start);
      const to = Math.min(next ? next.startSimMs : now, end);
      if (to <= from) return;
      out.push({ from, to, state: signalLights(segment.phase)[group], future: segment.future, phase: segment.phase });
    });
    return out;
  };

  const lanes: Record<TimelineLane, TimelineBar[]> = { "agent-a": [], "agent-b": [], jev: [], safety: [] };
  for (const bar of data.bars) {
    const to = bar.endSimMs ?? now;
    if (to < start || bar.startSimMs > end) continue;
    lanes[bar.lane].push(bar);
  }

  return (
    <figure className="flex flex-col gap-1.5" aria-label="Coordination timeline">
      {/* Inline-size containment keeps the SVG's own width out of the layout, so the observer can shrink it. */}
      <div ref={wrap} className="w-full [contain:inline-size]">
        <svg width={width} height={height} role="img" aria-label={mode === "ai" ? "Signal phases with Agent A, Agent B, JEV and safety activity over the last minute" : "Signal phases over the last minute and the fixed schedule ahead"} className="block overflow-visible">
          {rows.map((row, i) => (
            <g key={row.key} transform={`translate(0 ${rowY(i)})`}>
              <text x={0} y={ROW / 2 + 4} className="fill-muted-foreground text-[12px]">{row.label}</text>
              <rect x={LABEL_W} y={0} width={plotW} height={ROW} rx={3} className="fill-muted/40" />
            </g>
          ))}

          {(["north", "east"] as const).map((group, i) =>
            signalSegments(group).map((segment, j) => (
              <rect
                key={`${group}-${j}-${segment.from}`}
                x={x(segment.from)}
                y={rowY(i) + 2}
                width={Math.max(1, x(segment.to) - x(segment.from) - 1)}
                height={ROW - 4}
                rx={2}
                fill={LIGHT_FILL[segment.state]}
                opacity={segment.future ? 0.32 : 1}
              >
                <title>{`${phaseName(segment.phase)}${segment.future ? " (scheduled)" : ""} ⋅ ${formatClock(segment.from)}`}</title>
              </rect>
            )),
          )}

          {mode === "ai"
            ? (["agent-a", "agent-b", "jev", "safety"] as const).map((lane, laneIndex) =>
                lanes[lane].map(bar => {
                  const from = Math.max(bar.startSimMs, start);
                  const to = Math.min(bar.endSimMs ?? now, end);
                  const pending = bar.endSimMs === null;
                  const failed = bar.outcome === "failed" || bar.outcome === "rejected";
                  const muted = bar.outcome === "cancelled" || bar.outcome === "stale" || bar.outcome === "unnecessary" || bar.outcome === "duplicate";
                  const w = Math.max(3, x(to) - x(from));
                  const y = rowY(laneIndex + 2) + 2;
                  const label = bar.latencyMs !== null ? formatLatency(bar.latencyMs) : pending ? "running" : null;
                  return (
                    <g key={`${lane}-${bar.id}`}>
                      <rect
                        x={x(from)}
                        y={y}
                        width={w}
                        height={ROW - 4}
                        rx={2}
                        fill={failed || muted ? "transparent" : LANE_FILL[lane]}
                        fillOpacity={pending ? 0.55 : 0.9}
                        stroke={failed ? "var(--destructive)" : muted ? "var(--subtle-foreground)" : "none"}
                        strokeDasharray={muted ? "3 2" : undefined}
                        className={pending ? "animate-pulse motion-reduce:animate-none" : undefined}
                      >
                        <title>{`${lane === "jev" ? "JEV" : lane === "safety" ? "Safety gate" : lane === "agent-a" ? "Agent A" : "Agent B"} ⋅ ${bar.outcome}${bar.latencyMs !== null ? ` ⋅ ${formatLatency(bar.latencyMs)}` : ""} ⋅ ${formatClock(bar.startSimMs)}`}</title>
                      </rect>
                      {label && w > 42 ? (
                        <text x={x(from) + 4} y={y + ROW / 2 + 2.5} className="pointer-events-none fill-background font-mono text-[11px] font-medium">{label}</text>
                      ) : null}
                    </g>
                  );
                }),
              )
            : null}

          <line x1={x(now)} x2={x(now)} y1={-2} y2={rows.length * (ROW + GAP)} className="stroke-foreground" strokeWidth={1} />
          {ticks.map(t => (
            <g key={t} transform={`translate(${x(t)} ${rows.length * (ROW + GAP)})`}>
              <line y1={0} y2={4} className="stroke-subtle-foreground" />
              <text y={15} textAnchor="middle" className="fill-subtle-foreground font-mono text-[11px]">{formatClock(t)}</text>
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="text-xs text-subtle-foreground">
        {mode === "ai"
          ? data.demoMode === "live"
            ? `Bars use the backend's recorded start and end times on the simulation clock${data.speed !== 1 ? ` (running at ${data.speed}×, so wall-clock latency spans more simulated time)` : ""}.`
            : "Offline demo: bar lengths are simulated latencies from the mock adapters, not measured model calls. Overlap shows the two agents working at the same time."
          : "Fixed schedule: the faded segments after the line are the same cycle repeating. No AI is called."}
      </figcaption>
    </figure>
  );
}
