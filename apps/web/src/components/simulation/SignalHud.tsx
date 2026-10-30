import { signalLights, type ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { useSimClock } from "@/hooks/useSimClock";
import { formatClock, formatSeconds, formatSpeed, phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { shallowEqual, useStore } from "@/state/store";
import { describeCountdown } from "./signalText";

const LAMP: Record<"red" | "yellow" | "green", string> = {
  red: "bg-signal-red",
  yellow: "bg-signal-amber",
  green: "bg-signal-green",
};

function GroupLight({ label, state }: { label: string; state: "red" | "yellow" | "green" | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 font-mono text-xs">
      <span className={cn("size-2.5 rounded-full", state ? LAMP[state] : "bg-muted")} aria-hidden="true" />
      {label}
      <span className="sr-only">{state ?? "unknown"}</span>
    </span>
  );
}

const STATUS_LABEL = { ready: "Ready", running: "Running", paused: "Paused", completed: "Finished" } as const;

function Stat({ label, value, note, dot, muted, testId, className }: { label: string; value: string; note?: string | null; dot?: string; muted?: boolean; testId?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {dot ? <span className={cn("size-2 rounded-full", dot)} aria-hidden="true" /> : null}
        {label}
      </dt>
      <dd className={cn("text-base font-medium tabular", muted && "text-subtle-foreground")} data-testid={testId}>{value}</dd>
      {note ? <dd className="text-xs text-subtle-foreground">{note}</dd> : null}
    </div>
  );
}

/**
 * `compact` is for the HUD floating over the scene: below xl it keeps only the signal block so the
 * scene stays visible. The counts it drops are in the Metrics tab.
 */
export function SignalHud({ mode, scenarioName, compact = false }: { mode: ControllerMode; scenarioName: string; compact?: boolean }) {
  const { session } = useServices();
  const view = useStore(session.store, s => ({
    signal: s.signal,
    status: s.status,
    speed: s.speedMultiplier,
    controller: s.controller,
    metrics: s.metrics,
    timing: s.snapshot?.config.signalTiming ?? null,
    time: s.simulationTimeMs,
    duration: s.snapshot?.config.scenario.durationMs ?? null,
  }), shallowEqual);
  const opening = useStore(session.meta, m => m.opening);
  const clock = useSimClock();
  const now = Math.max(clock, view.signal?.phaseStartedAtSimMs ?? 0);
  const lights = view.signal ? signalLights(view.signal.phase) : null;
  const countdown = view.signal && view.timing ? describeCountdown(view.signal, view.timing, view.controller, now) : null;
  const m = view.metrics;
  const controllerLabel = view.controller?.activeController === "deterministic_fallback"
    ? "AI controller ⋅ deterministic fallback"
    : mode === "ai" ? "AI controller" : "Fixed-time controller";

  return (
    <section aria-label="Signal and session status" className="pointer-events-auto w-[min(19rem,calc(100vw-2rem))] rounded-xl border bg-panel p-4 shadow-[0_16px_36px_-20px_rgb(0_0_0/0.9)]" data-testid="signal-hud">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <GroupLight label="N/S" state={lights?.north ?? null} />
          <GroupLight label="E/W" state={lights?.east ?? null} />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span data-testid="session-status">{opening ? "Starting…" : view.status ? STATUS_LABEL[view.status] : "No session"}</span>
          <span className="font-mono tabular text-foreground" data-testid="sim-clock">{formatClock(view.time)}</span>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-lg font-semibold leading-tight tracking-[-0.01em]" aria-live="polite" data-testid="signal-phase">{view.signal ? phaseName(view.signal.phase) : "—"}</p>
        {countdown ? (
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="tabular text-foreground">{countdown.primary}</span>
            {countdown.secondary ? <span className="text-subtle-foreground"> ⋅ {countdown.secondary}</span> : null}
          </p>
        ) : null}
      </div>

      <p className="mt-3 text-[0.8125rem] text-muted-foreground">
        {controllerLabel} ⋅ {scenarioName} ⋅ {formatSpeed(view.speed)}
      </p>

      <dl className={cn("mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3", compact && "max-xl:hidden")}>
        <Stat label="Queue N/S" dot="bg-group-ns" testId="queue-ns" value={m ? String(m.queueByApproach.north + m.queueByApproach.south) : "—"} note={m && m.upstreamBacklogByApproach.north + m.upstreamBacklogByApproach.south > 0 ? `+${m.upstreamBacklogByApproach.north + m.upstreamBacklogByApproach.south} upstream` : null} />
        <Stat label="Queue E/W" dot="bg-group-ew" testId="queue-ew" value={m ? String(m.queueByApproach.east + m.queueByApproach.west) : "—"} note={m && m.upstreamBacklogByApproach.east + m.upstreamBacklogByApproach.west > 0 ? `+${m.upstreamBacklogByApproach.east + m.upstreamBacklogByApproach.west} upstream` : null} />
        <Stat label="Completed trips" testId="completed-count" value={m ? String(m.completedVehicleCount) : "—"} />
        <Stat label="On the road" testId="active-count" value={m ? String(m.activeVehicleCount) : "—"} />
        <Stat className="col-span-2" label="Average wait (completed trips)" value={m ? (m.averageCompletedWaitingTimeMs === null ? "No completed trips yet" : formatSeconds(m.averageCompletedWaitingTimeMs)) : "—"} muted={!m || m.averageCompletedWaitingTimeMs === null} />
      </dl>
      {view.status === "completed" && view.duration !== null ? (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-[0.8125rem] text-muted-foreground">The {formatClock(view.duration)} scenario has finished. Reset to run it again.</p>
      ) : null}
    </section>
  );
}

/** One-line signal readout for small screens, where the full HUD sits below the dock. */
export function SignalStrip() {
  const { session } = useServices();
  const view = useStore(session.store, s => ({ signal: s.signal, controller: s.controller, timing: s.snapshot?.config.signalTiming ?? null, time: s.simulationTimeMs }), shallowEqual);
  const clock = useSimClock();
  const now = Math.max(clock, view.signal?.phaseStartedAtSimMs ?? 0);
  const lights = view.signal ? signalLights(view.signal.phase) : null;
  const countdown = view.signal && view.timing ? describeCountdown(view.signal, view.timing, view.controller, now) : null;
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="signal-strip">
      <GroupLight label="N/S" state={lights?.north ?? null} />
      <GroupLight label="E/W" state={lights?.east ?? null} />
      {/* The phase name gets the rest of the row and wraps rather than truncating. */}
      <span className="min-w-0 flex-1 font-medium" aria-live="polite">{view.signal ? phaseName(view.signal.phase) : "—"}</span>
      {countdown ? <span className="shrink-0 text-xs tabular text-muted-foreground">{countdown.short}</span> : null}
    </div>
  );
}
