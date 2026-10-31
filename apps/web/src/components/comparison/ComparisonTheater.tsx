import { Suspense, lazy, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { signalLights, type ComparisonResponse } from "@intersection/shared";
import { useServices } from "@/app/services";
import { SquareLoader } from "@/components/common/SquareLoader";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { detectWebGL } from "@/lib/webgl";
import { formatClock, formatSpeed, phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SessionHistory } from "@/state/replay";

const ComparisonScene = lazy(() => import("./ComparisonScene").then(m => ({ default: m.ComparisonScene })));

const SPEEDS = [1, 2, 4, 8] as const;
const LIGHT = { green: "var(--signal-green)", yellow: "var(--signal-amber)", red: "var(--signal-red)" } as const;
const SIDES = [
  { key: "traditional", label: "Fixed-time", mode: "traditional", tone: "text-chart-fixed" },
  { key: "ai", label: "AI", mode: "ai", tone: "text-chart-ai" },
] as const;

/** Snapshots from the backend, for a comparison the browser did not compute itself. */
function usePolledRecording(comparison: ComparisonResponse, enabled: boolean) {
  const { dataSource } = useServices();
  // The theater is keyed by comparison, so one recording per mount.
  const [recording] = useState(() => ({ traditional: new SessionHistory(), ai: new SessionHistory() }));
  const finished = comparison.status !== "running" && comparison.status !== "ready";
  useEffect(() => {
    if (!enabled) return;
    const transport = dataSource.transport();
    if (!transport.getSnapshot) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [a, b] = await Promise.all([transport.getSnapshot!(comparison.traditional.sessionId), transport.getSnapshot!(comparison.ai.sessionId)]);
        if (stopped) return;
        recording.traditional.push(a);
        recording.ai.push(b);
      } catch {
        // A missed poll leaves a gap; playback interpolates across it.
      }
      if (!stopped && !finished) timer = setTimeout(poll, 250);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, finished, dataSource, comparison.traditional.sessionId, comparison.ai.sessionId, recording]);
  return recording;
}

/**
 * Both runs of a comparison as two 3D intersections side by side on one clock.
 * While the runs are computed or streamed the playhead follows them; once they
 * finish, the whole run can be played, paused and scrubbed.
 */
export function ComparisonTheater({ comparison }: { comparison: ComparisonResponse }) {
  const { dataSource } = useServices();
  const local = dataSource.transport().getComparisonRecording?.(comparison.comparisonId) ?? null;
  const polled = usePolledRecording(comparison, local === null);
  const recording = local ?? polled;
  const [webgl] = useState(detectWebGL);
  const clock = useRef(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [recorded, setRecorded] = useState(0);
  const finished = comparison.status === "completed";
  const duration = comparison.durationMs;

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(250, now - last);
      last = now;
      const end = Math.min(recording.traditional.range?.end ?? 0, recording.ai.range?.end ?? 0);
      if (playing) clock.current = Math.min(end, clock.current + dt * speed);
      if (playing && finished && clock.current >= end && end > 0) setPlaying(false);
      if (now - lastUi > 80) {
        lastUi = now;
        setTime(clock.current);
        setRecorded(end);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, finished, recording]);

  const seek = (t: number) => {
    clock.current = Math.min(recorded, Math.max(0, t));
    setTime(clock.current);
  };
  const atEnd = finished && time >= recorded - 50 && recorded > 0;

  return (
    <section aria-label="Both controllers in 3D" className="flex flex-col gap-4" data-testid="comparison-theater">
      <div className="grid gap-3 md:grid-cols-2">
        {SIDES.map(side => {
          const history = recording[side.key];
          const phase = history.phaseAt(time);
          const counts = history.countsAt(time);
          return (
            <figure key={side.key} className="relative flex flex-col border bg-card">
              <figcaption className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
                <span className={cn("flex items-center gap-2 text-[0.9375rem] font-semibold", side.tone)}>
                  <span className="size-2.5 bg-current" aria-hidden="true" />
                  <span className="text-foreground">{side.label}</span>
                </span>
                <span className="text-sm text-muted-foreground" aria-live="off">{phase ? phaseName(phase) : "—"}</span>
              </figcaption>
              <div className="relative aspect-[16/9] w-full" aria-hidden="true">
                {webgl ? (
                  <Suspense fallback={<div className="grid h-full place-items-center"><SquareLoader label="Loading the 3D view" /></div>}>
                    <ComparisonScene history={history} clock={clock} mode={side.mode} />
                  </Suspense>
                ) : (
                  <p className="grid h-full place-items-center px-6 text-center text-sm text-subtle-foreground">3D view unavailable on this device.</p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5 text-sm">
                <span className="text-muted-foreground"><span className="font-mono text-foreground">{counts?.completed ?? "—"}</span> trips completed</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="flex max-w-[12rem] flex-wrap gap-[2px]" aria-hidden="true">
                    {Array.from({ length: Math.min(40, counts?.waiting ?? 0) }, (_, i) => <span key={i} className={cn("size-[6px] bg-current", side.tone)} />)}
                  </span>
                  <span><span className="font-mono text-foreground">{counts?.waiting ?? "—"}</span> waiting</span>
                </span>
              </div>
            </figure>
          );
        })}
      </div>

      <div className="flex flex-col gap-2.5 border bg-panel px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="h-9 min-w-[6.5rem]"
            onClick={() => {
              if (atEnd) seek(0);
              setPlaying(p => (atEnd ? true : !p));
            }}
            data-testid="comparison-playback"
          >
            {atEnd ? <RotateCcw /> : playing ? <Pause /> : <Play />}
            {atEnd ? "Replay" : playing ? "Pause" : "Play"}
          </Button>
          <ToggleGroup value={[String(speed)]} onValueChange={v => v[0] && setSpeed(Number(v[0]))} variant="outline" size="sm" spacing={0} aria-label="Playback speed">
            {SPEEDS.map(s => <ToggleGroupItem key={s} value={String(s)} className="h-9 px-2.5 font-mono text-xs" aria-label={`${s} times speed`}>{formatSpeed(s)}</ToggleGroupItem>)}
          </ToggleGroup>
          <span className="ml-auto font-mono text-sm text-muted-foreground" data-testid="comparison-clock">
            <span className="text-foreground">{formatClock(time)}</span> / {formatClock(duration)}
          </span>
        </div>
        <PlaybackStrip recording={recording} time={time} recorded={recorded} duration={duration} onSeek={t => { setPlaying(false); seek(t); }} />
        <p className="text-xs text-subtle-foreground">
          {finished
            ? "Both runs are complete. Play them back or drag the strip to any moment; both intersections stay on the same clock."
            : local
              ? "Computed in this browser faster than real time; playback follows at the speed you choose."
              : "Streamed from the server as it runs. Only the part watched on this page is recorded for scrubbing."}
          {" "}Drag to orbit either view.
        </p>
      </div>
    </section>
  );
}

/** The whole comparison as squares: each run's North/South light, one row per controller. */
function PlaybackStrip({ recording, time, recorded, duration, onSeek }: { recording: { traditional: SessionHistory; ai: SessionHistory }; time: number; recorded: number; duration: number; onSeek: (t: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const dragging = useRef(false);
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, Math.round(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const count = Math.max(30, Math.floor(width / 8));
  const step = duration / count;
  const pitch = width / count;
  const size = Math.max(3, pitch - 2);
  const bucket = Math.floor(recorded / 1000);
  const rows = useMemo(
    () => SIDES.map(side => Array.from({ length: count }, (_, i) => {
      const mid = (i + 0.5) * step;
      const phase = mid <= bucket * 1000 ? recording[side.key].phaseAt(mid) : null;
      return phase ? signalLights(phase).north : null;
    })),
    // Recompute as the recording grows (once a second of simulated time is enough).
    [recording, count, step, bucket],
  );
  const at = (px: number) => (px / width) * duration;
  const move = (event: PointerEvent<HTMLDivElement>) => onSeek(at(event.clientX - event.currentTarget.getBoundingClientRect().left));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const jump = event.shiftKey ? 10_000 : 2000;
    if (event.key === "ArrowLeft") onSeek(time - jump);
    else if (event.key === "ArrowRight") onSeek(time + jump);
    else if (event.key === "Home") onSeek(0);
    else if (event.key === "End") onSeek(recorded);
    else return;
    event.preventDefault();
  };
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={wrap}
        role="slider"
        tabIndex={0}
        aria-label="Comparison playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(time / 1000)}
        aria-valuetext={`${formatClock(time)} of ${formatClock(duration)}`}
        className="relative h-[24px] w-full cursor-ew-resize touch-none select-none outline-offset-4 [contain:inline-size]"
        onKeyDown={onKey}
        onPointerDown={event => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={event => {
          if (dragging.current) move(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        data-testid="comparison-strip"
      >
        <svg width={width} height={24} className="absolute inset-0 block" aria-hidden="true">
          {rows.map((row, r) => row.map((light, i) => (
            <rect key={`${r}-${i}`} x={i * pitch + (pitch - size) / 2} y={r * (size + 3) + 3} width={size} height={size} fill={light ? LIGHT[light] : "var(--cell)"} opacity={light && (i + 0.5) * step > time ? 0.42 : 1} />
          )))}
          <rect x={Math.min(width - 2, Math.max(0, (time / duration) * width - 1))} y={0} width={2} height={24} className="fill-foreground" />
        </svg>
      </div>
      <div className="flex justify-between font-mono text-[11px] text-subtle-foreground" aria-hidden="true">
        <span>Fixed-time above, AI below</span>
        <span>{recorded < duration ? `recorded to ${formatClock(recorded)}` : formatClock(duration)}</span>
      </div>
    </div>
  );
}
