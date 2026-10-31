import { useMemo } from "react";
import { PAGE_WIPE, type WipeStage, type WipeTiming } from "@/hooks/useSquareWipe";
import { useViewport } from "@/hooks/useViewport";
import { cn } from "@/lib/utils";

function hash01(n: number): number {
  const x = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return x - Math.floor(x);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The site's transition: squares spawn across the area, a few of them in the
 * meaning colours, cover it, and clear again on the new content. `scatter`
 * (page changes) lands them in a broken-up diagonal sweep; `wave` (panel tabs)
 * rolls them in from the left with a sine-shaped front, and clears them the
 * same way. `fixed` covers the window; otherwise the nearest positioned parent.
 */
const SPREAD = 0.62;
/** How far the wave's front bends, and how ragged its edge is, as shares of the sweep. */
const WAVE_BEND = 0.34;
const WAVE_JITTER = 0.05;
/** Crests down the height of the area. */
const WAVE_CRESTS = 1;
/** The few squares that keep a colour while the rest are room-coloured. */
const ACCENTS = ["var(--signal-green)", "var(--signal-amber)", "var(--signal-red)", "var(--group-ns)", "var(--group-ew)", "var(--jev)", "var(--foreground)"];

const PATTERNS = {
  scatter: { accentShare: 0.12, inset: "30%", coverCell: 170, revealCell: 200 },
  wave: { accentShare: 0.16, inset: "26%", coverCell: 110, revealCell: 130 },
} as const;

export type WipePattern = keyof typeof PATTERNS;

interface SquareWipeProps {
  stage: WipeStage;
  pattern?: WipePattern;
  timing?: WipeTiming;
  fixed?: boolean;
  cell?: number;
  /** Width in px the wave crosses (the area's width); defaults to the window's. */
  span?: number;
  className?: string;
}

export function SquareWipe({ stage, pattern = "scatter", timing = PAGE_WIPE, fixed = false, cell = 52, span, className }: SquareWipeProps) {
  const viewport = useViewport();
  const columns = Math.ceil(Math.max(1, viewport.width) / cell) + 1;
  const rows = Math.ceil(Math.max(1, viewport.height) / cell) + 1;
  const sweep = Math.max(cell, span ?? viewport.width);
  const cells = useMemo(() => {
    const out: { cover: number; reveal: number; accent: string | null }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const n = r * 131 + c;
        const accent = hash01(n + 7) < PATTERNS[pattern].accentShare ? ACCENTS[Math.floor(hash01(n + 3) * ACCENTS.length)] : null;
        if (pattern === "wave") {
          // Left to right, the front bent into a sine; it rolls the other way as it clears.
          const x = clamp01(((c + 0.5) * cell) / sweep);
          const y = (r * cell) / Math.max(cell, viewport.height);
          const front = (phase: number) => 0.5 + 0.5 * Math.sin(y * Math.PI * 2 * WAVE_CRESTS + phase);
          const order = (phase: number) => x * (1 - WAVE_BEND - WAVE_JITTER) + front(phase) * WAVE_BEND + hash01(n + phase) * WAVE_JITTER;
          out.push({ cover: order(0), reveal: order(Math.PI), accent });
        } else {
          // A diagonal sweep, broken up so it reads as squares landing, not a curtain.
          const diagonal = (c / columns + r / rows) / 2;
          const order = diagonal * (1 - SPREAD) + hash01(n) * SPREAD;
          out.push({ cover: order, reveal: order, accent });
        }
      }
    }
    return out;
  }, [columns, rows, pattern, cell, sweep, viewport.height]);

  if (stage === "idle") return null;
  const covering = stage === "cover";
  const { inset, coverCell, revealCell } = PATTERNS[pattern];
  const length = covering ? coverCell : revealCell;
  const stagger = (covering ? timing.cover : timing.reveal) - length;
  return (
    <div
      aria-hidden="true"
      className={cn(fixed ? "fixed inset-0 z-[70]" : "absolute inset-0 z-40", "pointer-events-auto overflow-hidden", className)}
      data-testid="square-wipe"
      data-pattern={pattern}
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, ${cell}px)`, gridAutoRows: `${cell}px` }}>
        {cells.map((c, i) => (
          <span
            key={i}
            className="relative bg-background"
            style={{
              animation: `${covering ? "wipe-in" : "wipe-out"} ${length}ms cubic-bezier(0.16, 1, 0.3, 1) ${Math.round((covering ? c.cover : c.reveal) * stagger)}ms both`,
            }}
          >
            {c.accent ? <span className="absolute" style={{ inset, background: c.accent }} /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
