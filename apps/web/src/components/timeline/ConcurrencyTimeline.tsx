import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { signalLights, type ControllerMode, type SignalPhase, type SignalTiming } from "@intersection/shared";
import { useServices } from "@/app/services";
import { Square } from "@/components/common/Square";
import { useSimClock } from "@/hooks/useSimClock";
import { formatClock, formatLatency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PhaseSegment, TimelineBar, TimelineLane } from "@/state/session";
import { shallowEqual, useStore } from "@/state/store";

// AI: a tight window so second-long inference stays several squares wide. Fixed: show the schedule ahead.
const WINDOW: Record<ControllerMode, { back: number; ahead: number }> = {
  ai: { back: 14_000, ahead: 3_000 },
  traditional: { back: 40_000, ahead: 30_000 },
};
/** Milliseconds a square can stand for; the grid picks the finest that keeps squares legible. */
const QUANTA = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000];
const TARGET_PITCH = 11;
const LABEL_W = 84;
const READOUT_W = 44;
const AXIS_H = 18;
const STRIP_PITCH = 7;

type Light = "red" | "yellow" | "green";
type RowKind = "signal-ns" | "signal-ew" | TimelineLane;
type Row = { key: string; label: string; kind: RowKind; tone?: string };

const AI_ROWS: Row[] = [
  { key: "ns", label: "N/S light", kind: "signal-ns" },
  { key: "ew", label: "E/W light", kind: "signal-ew" },
  { key: "a", label: "Agent A", kind: "agent-a", tone: "text-group-ns" },
  { key: "b", label: "Agent B", kind: "agent-b", tone: "text-group-ew" },
  { key: "jev", label: "JEV", kind: "jev", tone: "text-jev" },
  { key: "safety", label: "Safety", kind: "safety", tone: "text-safety" },
];
const FIXED_ROWS: Row[] = AI_ROWS.slice(0, 2);

const LANE_FILL: Record<TimelineLane, string> = {
  "agent-a": "var(--group-ns)",
  "agent-b": "var(--group-ew)",
  jev: "var(--jev)",
  safety: "var(--safety)",
};
const LANE_NAME: Record<TimelineLane, string> = { "agent-a": "Agent A", "agent-b": "Agent B", jev: "JEV", safety: "Safety gate" };
const LIGHT_FILL: Record<Light, string> = { green: "var(--signal-green)", yellow: "var(--signal-amber)", red: "var(--signal-red)" };

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
  while (start < until && guard++ < 24) {
    index = (index + 1) % order.length;
    out.push({ phase: order[index], startSimMs: start });
    start += duration(order[index]);
  }
  return out;
}

/** Phase in force at time `t` (segments sorted by start), or null before the first. */
function phaseAt(segments: PhaseSegment[], t: number): PhaseSegment | null {
  let lo = 0;
  let hi = segments.length - 1;
  if (hi < 0 || t < segments[0].startSimMs) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid].startSimMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo];
}

type CellState = "active" | "pending" | "failed" | "muted";
const RANK: Record<CellState, number> = { muted: 1, active: 2, pending: 3, failed: 4 };

function barState(bar: TimelineBar): CellState {
  if (bar.endSimMs === null) return "pending";
  if (bar.outcome === "failed" || bar.outcome === "rejected") return "failed";
  if (bar.outcome === "cancelled" || bar.outcome === "stale" || bar.outcome === "unnecessary" || bar.outcome === "duplicate") return "muted";
  return "active";
}

/**
 * The coordination as a unit chart on the simulation clock: one square per
 * time step, a row per signal group and per participant. Overlapping Agent A /
 * Agent B squares are concurrent inference. Below it, the whole session as a
 * strip of squares. While paused the visitor drags either to replay a moment.
 */
export function ConcurrencyTimeline({ mode }: { mode: ControllerMode }) {
  const { session, replay, history } = useServices();
  const data = useStore(session.store, s => ({
    phases: s.phases,
    bars: s.timeline,
    timing: s.snapshot?.config.signalTiming ?? null,
    duration: s.snapshot?.config.scenario.durationMs ?? null,
    demoMode: s.snapshot?.config.demoMode ?? null,
    wallMeasured: s.snapshot?.metrics.inferenceTiming === "wall",
    controller: s.controller?.activeController ?? null,
    nextGreen: s.signal?.nextGreen ?? "EW_GREEN",
    speed: s.speedMultiplier,
    status: s.status,
    live: s.simulationTimeMs,
  }), shallowEqual);
  const replaying = useStore(replay, r => r.time);
  const clock = useSimClock(15);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  /** Window start held still while the visitor drags across the grid. */
  const [held, setHeld] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(320, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = mode === "ai" ? AI_ROWS : FIXED_ROWS;
  const scrubbable = data.status === "paused" || data.status === "completed";
  const liveNow = Math.max(replaying === null ? clock : data.live, data.phases[data.phases.length - 1]?.startSimMs ?? 0);
  const playhead = replaying ?? liveNow;
  const span = WINDOW[mode].back + WINDOW[mode].ahead;
  // The axis starts at 0:00 and fills up before it starts to scroll; a drag holds it still.
  const start = held ?? Math.max(0, playhead - WINDOW[mode].back);
  const end = start + span;
  const plotW = width - LABEL_W - READOUT_W;
  const quantum = QUANTA.find(q => (plotW / (span / q)) >= TARGET_PITCH) ?? QUANTA[QUANTA.length - 1];
  const pitch = plotW / (span / quantum);
  const size = Math.max(4, Math.min(12, pitch - (pitch > 9 ? 2.5 : 1.5)));
  // Rows keep room for their labels even when the steps are narrow.
  const rowPitch = Math.max(size + 3.5, 13.5, Math.min(16, pitch));
  const gridH = rows.length * rowPitch;
  const height = gridH + AXIS_H;
  const x = (t: number) => LABEL_W + ((t - start) / span) * plotW;
  const timeAt = (px: number) => start + ((px - LABEL_W) / plotW) * span;

  const projected = useMemo(
    () => (data.controller === "fixed_time" && data.timing ? projectFixedSchedule(data.phases[data.phases.length - 1], data.timing, end + span, data.nextGreen) : []),
    [data.controller, data.timing, data.phases, data.nextGreen, end, span],
  );
  const segments = useMemo(() => [...data.phases, ...projected], [data.phases, projected]);

  const first = Math.floor(start / quantum);
  const last = Math.ceil(end / quantum);
  const cells: number[] = [];
  for (let k = first; k < last; k++) cells.push(k);

  // Which squares each participant fills inside the window.
  const laneCells = useMemo(() => {
    const out: Record<TimelineLane, Map<number, { state: CellState; bar: TimelineBar }>> = { "agent-a": new Map(), "agent-b": new Map(), jev: new Map(), safety: new Map() };
    for (const bar of data.bars) {
      const to = bar.endSimMs ?? liveNow;
      if (to < start - quantum || bar.startSimMs > end) continue;
      const state = barState(bar);
      const from = Math.floor(bar.startSimMs / quantum);
      const until = Math.max(from, Math.ceil(to / quantum) - 1);
      for (let k = from; k <= until; k++) {
        const current = out[bar.lane].get(k);
        if (!current || RANK[state] > RANK[current.state]) out[bar.lane].set(k, { state, bar });
      }
    }
    return out;
  }, [data.bars, liveNow, start, end, quantum]);

  // The newest measured latency per lane, as of the playhead.
  const latest = useMemo(() => {
    const out: Partial<Record<TimelineLane, number>> = {};
    for (const bar of data.bars) {
      if (bar.latencyMs === null || bar.endSimMs === null || bar.endSimMs > playhead) continue;
      out[bar.lane] = bar.latencyMs;
    }
    return out;
  }, [data.bars, playhead]);

  const ticks: number[] = [];
  const tickStep = span <= 20_000 ? 5_000 : 10_000;
  for (let t = Math.ceil(start / tickStep) * tickStep; t <= end; t += tickStep) ticks.push(t);

  const seek = (t: number) => {
    const earliest = history.range?.start ?? 0;
    const clamped = Math.min(liveNow, Math.max(earliest, t));
    replay.setState({ time: liveNow - clamped < quantum / 2 ? null : clamped });
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!scrubbable) return;
    const box = event.currentTarget.getBoundingClientRect();
    setHeld(start);
    event.currentTarget.setPointerCapture(event.pointerId);
    seek(timeAt(event.clientX - box.left));
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (held === null) return;
    const box = event.currentTarget.getBoundingClientRect();
    seek(timeAt(event.clientX - box.left));
  };
  const onPointerUp = () => setHeld(null);

  const cellTitle = (k: number, label: string) => `${label} ⋅ ${formatClock(k * quantum)}`;
  const fade = (k: number) => {
    const mid = (k + 0.5) * quantum;
    // Beyond the live edge only the fixed schedule exists, as a promise; after a replayed moment, what came next.
    if (mid > liveNow) return 0.28;
    if (replaying !== null && mid > replaying) return 0.42;
    return 1;
  };

  return (
    <figure className="flex flex-col gap-2.5" aria-label="Coordination timeline" data-testid="timeline">
      {/* Inline-size containment keeps the SVG's own width out of the layout, so the observer can shrink it. */}
      <div ref={wrap} className="w-full [contain:inline-size]">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={mode === "ai" ? "Signal phases with Agent A, Agent B, JEV and safety activity, one square per time step" : "Signal phases and the fixed schedule ahead, one square per time step"}
          className={cn("block touch-none select-none", scrubbable && "cursor-ew-resize")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <defs>
            <clipPath id={`plot-${mode}`}>
              <rect x={LABEL_W - 1} y={-2} width={plotW + 2} height={gridH + 4} />
            </clipPath>
          </defs>

          {rows.map((row, i) => (
            <g key={row.key} transform={`translate(0 ${i * rowPitch})`}>
              <text x={0} y={rowPitch / 2 + 4} className="fill-muted-foreground text-[11.5px]">{row.label}</text>
              {row.kind !== "signal-ns" && row.kind !== "signal-ew" && latest[row.kind] !== undefined ? (
                <text x={width - 2} y={rowPitch / 2 + 4} textAnchor="end" className="fill-subtle-foreground font-mono text-[11px]">{formatLatency(latest[row.kind]!)}</text>
              ) : null}
            </g>
          ))}

          <g clipPath={`url(#plot-${mode})`}>
            {rows.map((row, i) => {
              const y = i * rowPitch + (rowPitch - size) / 2;
              return (
                <g key={row.key}>
                  {cells.map(k => {
                    const cx = x(k * quantum) + (pitch - size) / 2;
                    if (row.kind === "signal-ns" || row.kind === "signal-ew") {
                      const mid = (k + 0.5) * quantum;
                      // Ahead of the live edge only a fixed schedule is known; an adaptive controller's next change is not.
                      const segment = mid > liveNow && !projected.length ? null : phaseAt(segments, mid);
                      if (!segment) return <rect key={k} x={cx} y={y} width={size} height={size} fill="var(--cell)" />;
                      const light = signalLights(segment.phase)[row.kind === "signal-ns" ? "north" : "east"];
                      return (
                        <rect key={k} x={cx} y={y} width={size} height={size} fill={LIGHT_FILL[light]} opacity={fade(k)}>
                          <title>{cellTitle(k, `${row.label} ${light}`)}</title>
                        </rect>
                      );
                    }
                    const cell = laneCells[row.kind].get(k);
                    if (!cell) return <rect key={k} x={cx} y={y} width={size} height={size} fill="var(--cell)" />;
                    const outline = cell.state === "failed" || cell.state === "muted";
                    const inset = outline ? 0.75 : 0;
                    return (
                      <rect
                        key={k}
                        x={cx + inset}
                        y={y + inset}
                        width={size - inset * 2}
                        height={size - inset * 2}
                        fill={outline ? "transparent" : LANE_FILL[row.kind]}
                        fillOpacity={cell.state === "pending" ? 0.6 : 1}
                        stroke={cell.state === "failed" ? "var(--destructive)" : cell.state === "muted" ? "var(--subtle-foreground)" : "none"}
                        strokeWidth={1.5}
                        opacity={fade(k)}
                        className={cell.state === "pending" ? "animate-[square-blink_1.1s_ease-in-out_infinite] motion-reduce:animate-none" : undefined}
                      >
                        <title>{`${LANE_NAME[row.kind]} ⋅ ${cell.bar.outcome}${cell.bar.latencyMs !== null ? ` ⋅ ${formatLatency(cell.bar.latencyMs)}` : ""} ⋅ ${formatClock(cell.bar.startSimMs)}`}</title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* The live edge, and the replayed moment when there is one. */}
          {replaying !== null && liveNow >= start && liveNow <= end ? (
            <line x1={x(liveNow)} x2={x(liveNow)} y1={-2} y2={gridH} className="stroke-foreground/35" strokeWidth={1} strokeDasharray="2 2" />
          ) : null}
          {playhead >= start && playhead <= end ? (
            <g transform={`translate(${x(playhead)} 0)`}>
              <line y1={-3} y2={gridH + 2} className="stroke-foreground" strokeWidth={1.5} />
              {scrubbable ? <rect x={-4} y={gridH + 1} width={8} height={8} className="fill-foreground" /> : null}
            </g>
          ) : null}
          {ticks.map(t => (
            <text key={t} x={x(t)} y={gridH + 15} textAnchor="middle" className="fill-subtle-foreground font-mono text-[11px]">{formatClock(t)}</text>
          ))}
        </svg>
      </div>

      <SessionStrip
        phases={segments}
        liveNow={liveNow}
        playhead={playhead}
        replaying={replaying}
        duration={data.duration}
        scrubbable={scrubbable}
        earliest={history.range?.start ?? 0}
        onSeek={seek}
      />

      <figcaption className="text-xs leading-snug text-subtle-foreground">
        {mode === "ai"
          ? data.demoMode === "live" || data.wallMeasured
            ? `Squares use the backend's recorded start and end times on the simulation clock${data.speed !== 1 ? ` (running at ${data.speed}×, so wall-clock latency spans more simulated time)` : ""}.`
            : "Offline demo: square runs are simulated latencies from the mock adapters, not measured model calls. Overlap shows the two agents working at the same time."
          : "Fixed schedule: the faded squares after the line are the same cycle repeating. No AI is called."}
        {" "}One square is {quantum >= 1000 ? `${quantum / 1000} s` : `${quantum} ms`}.
      </figcaption>
    </figure>
  );
}

interface StripProps {
  phases: PhaseSegment[];
  liveNow: number;
  playhead: number;
  replaying: number | null;
  duration: number | null;
  scrubbable: boolean;
  earliest: number;
  onSeek: (t: number) => void;
}

/** The whole session as two rows of squares (N/S and E/W light); drag or use the arrow keys to rewind while paused. */
function SessionStrip({ phases, liveNow, playhead, replaying, duration, scrubbable, earliest, onSeek }: StripProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const total = Math.max(duration ?? 0, liveNow, 1000);
  const count = Math.max(20, Math.floor(width / STRIP_PITCH));
  const step = total / count;
  const pitch = width / count;
  const size = Math.max(3, pitch - 2);
  const at = (t: number) => (t / total) * width;
  const timeAt = (px: number) => (px / width) * total;

  const cells = useMemo(() => {
    const out: { ns: Light | null; ew: Light | null; recorded: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      const mid = (i + 0.5) * step;
      const segment = mid <= liveNow ? phaseAt(phases, mid) : null;
      const lights = segment ? signalLights(segment.phase) : null;
      out.push({ ns: lights?.north ?? null, ew: lights?.east ?? null, recorded: mid >= earliest });
    }
    return out;
  }, [phases, liveNow, count, step, earliest]);

  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(timeAt(event.clientX - box.left));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!scrubbable) return;
    const jump = event.shiftKey ? 5000 : 1000;
    if (event.key === "ArrowLeft") onSeek(playhead - jump);
    else if (event.key === "ArrowRight") onSeek(playhead + jump);
    else if (event.key === "Home") onSeek(earliest);
    else if (event.key === "End") onSeek(liveNow);
    else return;
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite" data-testid="replay-status">
          {replaying !== null ? (
            <>
              <Square className="size-[7px] text-foreground" hollow />
              <span>
                Replaying <span className="font-mono text-foreground">{formatClock(replaying)}</span> ⋅ the simulation is paused at <span className="font-mono">{formatClock(liveNow)}</span>
              </span>
            </>
          ) : (
            <>
              <Square className="size-[7px] text-foreground" blink={!scrubbable} />
              <span>{scrubbable ? "Drag the timeline or use ← → to rewind" : "Live ⋅ pause to rewind"}</span>
            </>
          )}
        </span>
        {replaying !== null ? (
          <button type="button" onClick={() => onSeek(liveNow)} className="inline-flex items-center gap-1.5 text-foreground underline decoration-foreground/40 underline-offset-[0.25em] hover:decoration-foreground">
            Back to {formatClock(liveNow)}
          </button>
        ) : null}
      </div>
      <div
        ref={wrap}
        role="slider"
        tabIndex={scrubbable ? 0 : -1}
        aria-label="Session position"
        aria-valuemin={0}
        aria-valuemax={Math.round(liveNow / 1000)}
        aria-valuenow={Math.round(playhead / 1000)}
        aria-valuetext={replaying !== null ? `Replaying ${formatClock(replaying)} of ${formatClock(liveNow)}` : `Live at ${formatClock(liveNow)}`}
        aria-disabled={!scrubbable}
        className={cn("relative h-[19px] w-full touch-none select-none outline-offset-4 [contain:inline-size]", scrubbable && "cursor-ew-resize")}
        onKeyDown={onKey}
        onPointerDown={event => {
          if (!scrubbable) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          seekAt(event);
        }}
        onPointerMove={event => {
          if (dragging.current) seekAt(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        data-testid="session-strip"
      >
        <svg width={width} height={19} className="absolute inset-0 block" aria-hidden="true">
          {cells.map((cell, i) =>
            (["ns", "ew"] as const).map((group, row) => {
              const light = cell[group];
              return (
                <rect
                  key={`${group}-${i}`}
                  x={i * pitch + (pitch - size) / 2}
                  y={row * (size + 2) + 2}
                  width={size}
                  height={size}
                  fill={light ? LIGHT_FILL[light] : "var(--cell)"}
                  opacity={light ? (cell.recorded ? ((i + 0.5) * step > playhead ? 0.42 : 0.9) : 0.3) : 1}
                />
              );
            }),
          )}
          {replaying !== null ? <rect x={at(liveNow) - 0.5} y={0} width={1} height={19} className="fill-foreground/40" /> : null}
          <rect x={Math.min(width - 2, Math.max(0, at(playhead) - 1))} y={0} width={2} height={19} className="fill-foreground" />
        </svg>
      </div>
      <div className="flex justify-between font-mono text-[11px] text-subtle-foreground" aria-hidden="true">
        <span>0:00</span>
        <span>{duration ? formatClock(duration) : formatClock(total)}</span>
      </div>
    </div>
  );
}
