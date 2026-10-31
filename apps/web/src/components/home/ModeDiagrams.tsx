import type { SignalTiming } from "@intersection/shared";
import { cn } from "@/lib/utils";

const LIGHT = { green: "bg-signal-green", yellow: "bg-signal-amber", red: "bg-signal-red" } as const;

/**
 * One fixed-time cycle as a unit chart: one square per second, coloured by
 * that second's light. Each movement group gets two rows, one per half-cycle
 * (its own service, then the other group's), so a row reads as one turn.
 * `marker` (ms into the cycle, starting at N/S green) outlines the current second.
 */
export function FixedCycleDiagram({ timing, marker }: { timing: SignalTiming; marker?: number }) {
  const green = Math.round(timing.fixedGreenMs / 1000);
  const yellow = Math.round(timing.yellowMs / 1000);
  const red = Math.round(timing.allRedMs / 1000);
  const half = green + yellow + red;
  const cycle = 2 * half;
  const at = (offset: number, second: number): keyof typeof LIGHT => {
    const s = (second - offset + cycle) % cycle;
    return s < green ? "green" : s < green + yellow ? "yellow" : "red";
  };
  const groups = [
    { label: "N/S", offset: 0 },
    { label: "E/W", offset: half },
  ];
  const now = marker === undefined ? null : Math.min(cycle - 1, Math.max(0, Math.floor(marker / 1000)));

  return (
    <figure className="flex flex-col gap-3" aria-label={`Fixed cycle: ${green} s green per direction, ${yellow} s yellow, ${red} s all red, ${cycle} s in all`}>
      {groups.map(group => (
        <div key={group.label} className="grid grid-cols-[2.25rem_1fr] items-start gap-2">
          <span className="font-mono text-xs leading-none text-muted-foreground">{group.label}</span>
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${half}, minmax(0, 1fr))` }} aria-hidden="true">
            {Array.from({ length: cycle }, (_, second) => (
              <span
                key={second}
                className={cn("aspect-square", LIGHT[at(group.offset, second)], now !== null && second > now && "opacity-35", now === second && "outline-[1.5px] outline-offset-1 outline-foreground")}
              />
            ))}
          </div>
        </div>
      ))}
      <figcaption className="grid grid-cols-[2.25rem_1fr] gap-2 text-xs text-subtle-foreground">
        <span />
        <span className="flex justify-between tabular">
          <span>1 square = 1 s, {half} per row</span>
          <span>{cycle} s cycle, repeating</span>
        </span>
      </figcaption>
    </figure>
  );
}
