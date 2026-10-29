import type { ReactNode } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ModeCardProps {
  id: string;
  title: string;
  summary: string;
  diagram: ReactNode;
  facts: string[];
  note?: string | null;
  action: string;
  selected: boolean;
  disabled?: boolean;
  onRun: () => void;
  className?: string;
}

/** One side of the controller choice. The diagram shows the mechanism instead of claiming it. */
export function ModeCard({ id, title, summary, diagram, facts, note, action, selected, disabled, onRun, className }: ModeCardProps) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-selected={selected || undefined}
      className={cn(
        "flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-[0_18px_40px_-24px_rgb(0_0_0/0.8)] transition-[border-color,box-shadow] duration-300",
        "data-selected:border-foreground/40",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-title`} className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{summary}</p>
      </div>
      {diagram}
      <ul className="flex flex-col gap-2 text-sm leading-snug">
        {facts.map(fact => (
          <li key={fact} className="flex gap-2.5">
            <span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-subtle-foreground" aria-hidden="true" />
            <span>{fact}</span>
          </li>
        ))}
      </ul>
      {note ? <p className="rounded-md bg-muted px-3 py-2 text-[0.8125rem] leading-snug text-muted-foreground">{note}</p> : null}
      <Button size="lg" className="mt-auto h-11 w-full justify-between px-4 text-[0.9375rem]" onClick={onRun} disabled={disabled || selected} aria-describedby={`${id}-title`}>
        {selected ? "Starting…" : action}
        {selected ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowRight />}
      </Button>
    </section>
  );
}
