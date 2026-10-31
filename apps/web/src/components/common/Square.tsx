import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * The interface's one mark: a small crisp square whose colour means one thing
 * (a signal state, a participant, a status). Colour comes from `text-*` on the
 * square or its parent. Hollow means "not real" (mock output, an empty slot).
 */
export function Square({ className, hollow = false, blink = false, style }: { className?: string; hollow?: boolean; blink?: boolean; style?: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        "inline-block size-2 shrink-0",
        hollow ? "border-[1.5px] border-current" : "bg-current",
        blink && "animate-[square-blink_1.1s_ease-in-out_infinite] motion-reduce:animate-none",
        className,
      )}
    />
  );
}
