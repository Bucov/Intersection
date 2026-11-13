import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The reading-board type shared by Statistics, Metrics and the Transcript: a
 * hairline above, a large tight title, a quiet note under it, then the content.
 */
export function BoardSection({ title, note, children, className, id }: { title: string; note?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn("flex flex-col gap-5 border-t pt-5", className)} aria-labelledby={id}>
      <header className="flex flex-col gap-1">
        <h3 id={id} className="text-lg font-[600] tracking-[-0.02em]">{title}</h3>
        {note ? <p className="text-[0.8125rem] leading-snug text-subtle-foreground">{note}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** The board's lead: a quiet context line above one sentence set large. */
export function BoardHeadline({ context, children, className }: { context?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {context ? <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">{context}</p> : null}
      <h2 className="text-[1.625rem] font-[620] leading-[1.08] tracking-[-0.035em] text-balance">{children}</h2>
    </header>
  );
}

/** A large figure with its label under it; `tone` is a `text-*` class for what the figure stands for. */
export function BoardFigure({ value, label, tone = "text-muted-foreground", size = "lg", align = "start" }: { value: ReactNode; label: ReactNode; tone?: string; size?: "lg" | "md"; align?: "start" | "end" }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", align === "end" && "items-end text-right")}>
      <span className={cn("font-mono font-[600] leading-none tracking-[-0.03em]", size === "lg" ? "text-[2.25rem]" : "text-[1.75rem]")}>{value}</span>
      <span className={cn("text-sm", tone)}>{label}</span>
    </div>
  );
}
