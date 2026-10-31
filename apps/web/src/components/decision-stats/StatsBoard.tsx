import type { CSSProperties, ReactNode } from "react";
import type { ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { formatClock, formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PhaseSegment } from "@/state/session";
import { shallowEqual, useStore } from "@/state/store";

/** Most squares one side of a comparison may draw before each square stands for more than one unit. */
const MAX_SQUARES = 120;
const UNITS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
const COLUMNS = 15;

/** One unit per square when it fits, otherwise the smallest round number that keeps the larger side under the cap. */
function unitFor(max: number): number {
  return UNITS.find(u => max / u <= MAX_SQUARES) ?? Math.ceil(max / MAX_SQUARES);
}

/** `"vehicle|vehicles"` picks the form for `n`; a plain label is used as is. */
function noun(label: string, n: number): string {
  const [one, many] = label.split("|");
  return many === undefined ? one : n === 1 ? one : many;
}

function greenSeconds(phases: PhaseSegment[], now: number): { ns: number; ew: number } {
  let ns = 0;
  let ew = 0;
  phases.forEach((segment, i) => {
    const end = Math.min(phases[i + 1]?.startSimMs ?? now, now);
    const length = Math.max(0, end - segment.startSimMs);
    if (segment.phase === "NS_GREEN") ns += length;
    if (segment.phase === "EW_GREEN") ew += length;
  });
  return { ns: ns / 1000, ew: ew / 1000 };
}

interface Part {
  label: string;
  value: number;
  /** A `text-*` colour class: what the squares mean. */
  tone: string;
  hollow?: boolean;
}

/**
 * Squares that place themselves one by one. `start` delays the whole run so
 * sections fill in reading order; long runs speed up so none takes much over a second.
 */
function Squares({ parts, unit, start, align = "start", label }: { parts: Part[]; unit: number; start: number; align?: "start" | "end"; label: string }) {
  const cells = parts.flatMap(part => Array.from({ length: Math.round(part.value / unit) }, () => part));
  const step = Math.min(22, 1100 / Math.max(1, cells.length));
  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-fit gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${COLUMNS}, 10px)`, direction: align === "end" ? "rtl" : "ltr" } as CSSProperties}
    >
      {cells.length ? (
        cells.map((part, i) => (
          <span
            key={i}
            className={cn(
              "size-[10px] animate-[square-in_0.42s_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none",
              part.tone,
              part.hollow ? "border-[1.5px] border-current" : "bg-current",
            )}
            style={{ animationDelay: `${Math.round(start + i * step)}ms` }}
          />
        ))
      ) : (
        <span className="size-[10px] bg-(--cell)" />
      )}
    </div>
  );
}

function Section({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-5 border-t pt-5", className)}>
      <header className="flex flex-col gap-1">
        <h3 className="text-lg font-[600] tracking-[-0.02em]">{title}</h3>
        {note ? <p className="text-[0.8125rem] leading-snug text-subtle-foreground">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

interface Side {
  label: string;
  value: number;
  tone: string;
  display?: string;
}

/**
 * Two sides of one measurement, growing outward from a shared axis. Both use the
 * same unit, so a side with twice the value draws twice the squares.
 */
function Versus({ title, note, a, b, unitLabel, start }: { title: string; note?: ReactNode; a: Side; b: Side; unitLabel: string; start: number }) {
  const unit = unitFor(Math.max(a.value, b.value, 1));
  const side = (s: Side, align: "start" | "end", delay: number) => (
    <div className={cn("flex min-w-0 flex-col gap-3", align === "end" ? "items-end text-right" : "items-start")}>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[2.25rem] font-[600] leading-none tracking-[-0.03em]">{s.display ?? s.value}</span>
        <span className={cn("text-sm", s.tone)}>{s.label}</span>
      </div>
      <Squares parts={[{ label: s.label, value: s.value, tone: s.tone }]} unit={unit} start={delay} align={align} label={`${s.label}: ${s.value} ${noun(unitLabel, s.value)}`} />
    </div>
  );
  return (
    <Section title={title} note={<>{note}{note ? " " : null}One square is {unit} {noun(unitLabel, unit)}.</>}>
      <div className="grid grid-cols-[1fr_1px_1fr] gap-x-5">
        {side(a, "end", start)}
        <span className="bg-border" aria-hidden="true" />
        {side(b, "start", start + 120)}
      </div>
    </Section>
  );
}

/** One quantity split into its parts, each part its own colour of square, with a legend. */
function Tally({ title, note, parts, unitLabel, start }: { title: string; note?: ReactNode; parts: Part[]; unitLabel: string; start: number }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const unit = unitFor(Math.max(total, 1));
  return (
    <Section title={title} note={<>{note}{note ? " " : null}One square is {unit} {noun(unitLabel, unit)}.</>}>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Squares parts={parts} unit={unit} start={start} label={parts.map(p => `${p.label}: ${p.value}`).join(", ")} />
        <dl className="flex min-w-[11rem] flex-col gap-2 text-sm">
          {parts.map(part => (
            <div key={part.label} className="flex items-center justify-between gap-6">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <span className={cn("size-[9px]", part.tone, part.hollow ? "border-[1.5px] border-current" : "bg-current")} aria-hidden="true" />
                {part.label}
              </dt>
              <dd className="font-mono text-foreground">{part.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

/**
 * The run at a glance, for presenting: what happened and how much, every
 * quantity drawn in squares. Opened from the rail's Statistics tab, which
 * pauses the session so the numbers hold still.
 */
export function StatsBoard({ mode, scenarioName }: { mode: ControllerMode; scenarioName: string }) {
  const { session } = useServices();
  const view = useStore(session.store, s => ({
    snapshot: s.snapshot,
    metrics: s.metrics,
    phases: s.phases,
    series: s.series,
    time: s.simulationTimeMs,
    status: s.status,
  }), shallowEqual);
  const m = view.metrics;
  const stats = view.snapshot?.decisionStats;
  if (!m || !view.snapshot) return <p className="text-sm text-muted-foreground">Statistics appear once the session starts.</p>;

  const green = greenSeconds(view.phases, view.time);
  const peakNS = view.series.reduce((max, p) => Math.max(max, p.queueNS), 0);
  const peakEW = view.series.reduce((max, p) => Math.max(max, p.queueEW), 0);
  const ai = mode === "ai" && stats;
  const accepted = stats ? stats.accepted.agreement + stats.accepted.jev + stats.accepted.fallback : 0;
  const delay = (i: number) => 250 + i * 160;

  return (
    <div className="flex flex-col gap-8 pb-6" data-testid="stats-board">
      <header className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{mode === "ai" ? "AI controller" : "Fixed-time controller"} ⋅ {scenarioName}</span>
          <ProvenanceBadge provenance={view.snapshot.config.demoMode} />
          {view.status === "paused" ? <span>Paused to read</span> : null}
        </p>
        <h2 className="text-[clamp(1.75rem,2.6vw,2.5rem)] font-[620] leading-[1.05] tracking-[-0.04em] text-balance">
          {formatClock(view.time)} of traffic: {m.completedVehicleCount} trips completed, {m.signalChangeCount} signal changes
          {ai ? `, ${accepted} decisions accepted` : ""}.
        </h2>
        <p className="text-[0.9375rem] text-muted-foreground">
          Average wait for completed trips: <span className="font-mono text-foreground">{m.averageCompletedWaitingTimeMs === null ? "no completed trips yet" : formatSeconds(m.averageCompletedWaitingTimeMs)}</span>
          {m.maximumObservedDelayMs !== undefined ? <> ⋅ longest delay <span className="font-mono text-foreground">{formatSeconds(m.maximumObservedDelayMs)}</span></> : null}
        </p>
      </header>

      <div className="grid gap-x-12 gap-y-9 xl:grid-cols-2">
        <Versus
          title="Green time served"
          note="Seconds of green each direction received."
          a={{ label: "North/South", value: Math.round(green.ns), display: `${Math.round(green.ns)} s`, tone: "text-group-ns" }}
          b={{ label: "East/West", value: Math.round(green.ew), display: `${Math.round(green.ew)} s`, tone: "text-group-ew" }}
          unitLabel="s"
          start={delay(0)}
        />
        <Versus
          title="Longest queue"
          note="The most vehicles waiting at once on each axis."
          a={{ label: "North/South", value: peakNS, tone: "text-group-ns" }}
          b={{ label: "East/West", value: peakEW, tone: "text-group-ew" }}
          unitLabel="vehicle|vehicles"
          start={delay(1)}
        />
        <Tally
          title="Vehicles"
          note="Every vehicle that asked to enter the scene."
          parts={[
            { label: "Completed", value: m.completedVehicleCount, tone: "text-foreground" },
            { label: "On the road", value: m.activeVehicleCount, tone: "text-subtle-foreground" },
            { label: "Waiting to enter", value: m.upstreamBacklogCount, tone: "text-subtle-foreground", hollow: true },
          ]}
          unitLabel="vehicle|vehicles"
          start={delay(2)}
        />
        {ai ? (
          <>
            <Versus
              title="Proposals"
              note="Plans each agent sent, working at the same time."
              a={{ label: "Agent A", value: stats.agents[0].proposals, tone: "text-group-ns" }}
              b={{ label: "Agent B", value: stats.agents[1].proposals, tone: "text-group-ew" }}
              unitLabel="proposal|proposals"
              start={delay(3)}
            />
            <Tally
              title="Where accepted decisions came from"
              parts={[
                { label: "Agents agreed", value: stats.accepted.agreement, tone: "text-positive" },
                { label: "JEV arbitration", value: stats.accepted.jev, tone: "text-jev" },
                { label: "Deterministic fallback", value: stats.accepted.fallback, tone: "text-warning" },
              ]}
              unitLabel="decision|decisions"
              start={delay(4)}
            />
            <Versus
              title="JEV's choices"
              note={`When the agents disagreed. ${stats.jev.abstained ? `It deferred ${stats.jev.abstained} time${stats.jev.abstained === 1 ? "" : "s"}.` : ""}`}
              a={{ label: "Granted Agent A", value: stats.jev.selectedA, tone: "text-group-ns" }}
              b={{ label: "Granted Agent B", value: stats.jev.selectedB, tone: "text-group-ew" }}
              unitLabel="choice|choices"
              start={delay(5)}
            />
            <Tally
              title="JEV confidence"
              note={`High is ${Math.round(stats.policy.highThreshold * 100)}% or more, medium ${Math.round(stats.policy.mediumThreshold * 100)}% or more.`}
              parts={[
                { label: "High", value: stats.jev.high, tone: "text-positive" },
                { label: "Medium", value: stats.jev.medium, tone: "text-warning" },
                { label: "Low", value: stats.jev.low, tone: "text-destructive" },
                { label: "Not measured", value: stats.jev.unmeasured, tone: "text-subtle-foreground", hollow: true },
              ]}
              unitLabel="arbitration|arbitrations"
              start={delay(6)}
            />
          </>
        ) : (
          <Section title="Decisions" note="The fixed-time controller follows its schedule. Nothing is observed, proposed or arbitrated.">
            <p className="text-[0.9375rem] text-muted-foreground">
              <span className="font-mono text-foreground">{stats?.fixedGreenStarts ?? "—"}</span> scheduled green starts, no AI called.
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}
