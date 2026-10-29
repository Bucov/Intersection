import { ArrowRight } from "lucide-react";
import type { SignalTiming } from "@intersection/shared";
import { cn } from "@/lib/utils";

/**
 * One fixed-time cycle drawn as a traffic-engineering signal timing chart:
 * a row per movement group, green / yellow / red over the cycle.
 */
export function FixedCycleDiagram({ timing, marker }: { timing: SignalTiming; /** Milliseconds into the cycle, starting at N/S green. */ marker?: number }) {
  const green = timing.fixedGreenMs;
  const yellow = timing.yellowMs;
  const red = timing.allRedMs;
  const cycle = 2 * (green + yellow + red);
  const pct = (ms: number) => `${(ms / cycle) * 100}%`;
  const half = green + yellow + red;
  const rows = [
    { label: "N/S", segments: [["green", green], ["yellow", yellow], ["red", red + half]] as const },
    { label: "E/W", segments: [["red", half], ["green", green], ["yellow", yellow], ["red", red]] as const },
  ];
  const color = { green: "bg-signal-green", yellow: "bg-signal-amber", red: "bg-signal-red/70" } as const;
  return (
    <figure className="flex flex-col gap-2" aria-label={`Fixed cycle: ${green / 1000} s green per direction, ${yellow / 1000} s yellow, ${red / 1000} s all red`}>
      {rows.map(row => (
        <div key={row.label} className="grid grid-cols-[2.25rem_1fr] items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{row.label}</span>
          <div className="relative">
            <div className="flex h-2.5 overflow-hidden rounded-[3px]">
              {row.segments.map(([kind, ms], i) => (
                <span key={i} className={cn("h-full", color[kind], i > 0 && "border-l border-background")} style={{ width: pct(ms) }} />
              ))}
            </div>
            {marker !== undefined ? <span className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground" style={{ left: pct(Math.min(cycle, Math.max(0, marker))) }} aria-hidden="true" /> : null}
          </div>
        </div>
      ))}
      <figcaption className="grid grid-cols-[2.25rem_1fr] gap-2 text-xs text-subtle-foreground">
        <span />
        <span className="flex justify-between font-mono tabular">
          <span>0 s</span>
          <span>{cycle / 1000} s cycle, repeating</span>
        </span>
      </figcaption>
    </figure>
  );
}

/** The AI controller's pipeline: two parallel agents, then JEV, then the safety gate. */
export function DecisionPipelineDiagram() {
  const node = "flex min-w-0 items-center justify-center rounded-md border px-2 py-1.5 text-center text-xs leading-tight";
  return (
    <figure className="flex items-center gap-1.5" aria-label="Agent A and Agent B propose in parallel, JEV arbitrates, the safety gate validates, then the signal changes">
      <div className="flex flex-1 flex-col gap-1.5">
        <div className={cn(node, "border-group-ns/45 text-group-ns")}>Agent A ⋅ N/S</div>
        <div className={cn(node, "border-group-ew/45 text-group-ew")}>Agent B ⋅ E/W</div>
      </div>
      <ArrowRight className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
      <div className={cn(node, "border-jev/40 text-jev")}>JEV</div>
      <ArrowRight className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
      <div className={cn(node, "border-safety/40 text-safety")}>Safety gate</div>
    </figure>
  );
}
