import { ArrowRight } from "lucide-react";
import { Square } from "@/components/common/Square";
import { cn } from "@/lib/utils";

export interface LegendRow {
  /** A `text-*` colour class: the square's meaning. */
  tone: string;
  label?: string;
  /** Hollow rows continue the column past the labelled ones: the cycle repeating, not yet run. */
  faint?: boolean;
}

export interface ModeCardProps {
  id: string;
  title: string;
  summary: string;
  legend: LegendRow[];
  /** One plain line under the legend. */
  fact?: string | null;
  note?: string | null;
  action: string;
  /** Which side of the intersection the block stands on; its squares face the scene. */
  side: "left" | "right";
  selected: boolean;
  disabled?: boolean;
  onRun: () => void;
  className?: string;
}

/**
 * One side of the controller choice: a title, a column of squares that spells
 * out the mechanism, and the run action. The whole block is the hit area.
 */
export function ModeCard({ id, title, summary, legend, fact, note, action, side, selected, disabled, onRun, className }: ModeCardProps) {
  const left = side === "left";
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-selected={selected || undefined}
      className={cn(
        "group/mode relative flex flex-col gap-5",
        // Wide screens and tablets: the left block reads toward the scene, ending at its squares.
        left && "md:items-end md:text-right",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-title`} className="text-[clamp(2.25rem,3.4vw,3.25rem)] font-[620] leading-[0.95] tracking-[-0.045em]">{title}</h2>
        <p className="text-base leading-snug text-muted-foreground">{summary}</p>
      </div>

      <ol className="flex flex-col gap-[5px]" aria-label={`How the ${title} controller works`}>
        {legend.map((row, i) => (
          <li
            key={i}
            className={cn("flex items-center gap-3 text-sm leading-none", left && "md:flex-row-reverse", row.faint && "opacity-60")}
            aria-hidden={row.label ? undefined : true}
          >
            <Square
              hollow={row.faint}
              className={cn(
                "size-[9px] transition-[opacity,translate] duration-300 ease-out",
                row.tone,
                // On hover the column runs once, top to bottom: the mechanism in motion.
                "group-hover/mode:animate-[legend-run_0.9s_ease-out_both] motion-reduce:group-hover/mode:animate-none",
                selected && "animate-[square-blink_0.9s_ease-in-out_infinite] motion-reduce:animate-none",
              )}
              style={{ animationDelay: `${i * 55}ms` }}
            />
            {row.label ? <span className="text-foreground/88">{row.label}</span> : null}
          </li>
        ))}
      </ol>

      {fact || note ? (
        <div className="flex max-w-[22rem] flex-col gap-1.5 text-[0.8125rem] leading-snug">
          {fact ? <p className="text-muted-foreground">{fact}</p> : null}
          {note ? <p className="text-subtle-foreground">{note}</p> : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onRun}
        disabled={disabled || selected}
        aria-describedby={`${id}-title`}
        className={cn(
          "inline-flex items-center gap-2.5 text-lg font-[560] tracking-[-0.02em] text-foreground disabled:cursor-default",
          // The whole block is the hit area.
          "after:absolute after:-inset-3 after:content-['']",
          "focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring",
          disabled && !selected && "opacity-40",
        )}
      >
        <span className="underline decoration-foreground/0 decoration-1 underline-offset-[0.3em] transition-[text-decoration-color] duration-200 group-hover/mode:decoration-foreground/70">
          {selected ? "Starting…" : action}
        </span>
        <ArrowRight className="size-[1.1em] transition-transform duration-300 ease-out group-hover/mode:translate-x-1" aria-hidden="true" />
      </button>
    </section>
  );
}
