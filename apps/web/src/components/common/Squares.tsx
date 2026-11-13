import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const COLUMNS = 15;

export interface Part {
  label: string;
  value: number;
  /** A `text-*` colour class: what the squares mean. */
  tone: string;
  hollow?: boolean;
}

/**
 * Squares that place themselves one by one. `start` delays the whole run so
 * sections fill in reading order; long runs speed up so none takes much over a second.
 * `live` drops the stagger, for counts that change while they are on screen.
 */
export function Squares({ parts, unit, start, align = "start", label, columns = COLUMNS, live = false }: { parts: Part[]; unit: number; start: number; align?: "start" | "end"; label: string; columns?: number; live?: boolean }) {
  const cells = parts.flatMap(part => Array.from({ length: Math.round(part.value / unit) }, () => part));
  const step = Math.min(22, 1100 / Math.max(1, cells.length));
  return (
    <div
      role="img"
      aria-label={label}
      className="grid w-fit gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${columns}, 10px)`, direction: align === "end" ? "rtl" : "ltr" } as CSSProperties}
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
            // Live counts change while on screen: a square that arrives later places itself at once.
            style={live ? undefined : { animationDelay: `${Math.round(start + i * step)}ms` }}
          />
        ))
      ) : (
        <span className="size-[10px] bg-(--cell)" />
      )}
    </div>
  );
}
