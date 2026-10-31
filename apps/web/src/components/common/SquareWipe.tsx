import { useMemo } from "react";
import { COVER_MS, REVEAL_MS, type WipeStage } from "@/hooks/useSquareWipe";
import { useViewport } from "@/hooks/useViewport";
import { cn } from "@/lib/utils";

function hash01(n: number): number {
  const x = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The site's transition: squares spawn across the area in a scattered sweep,
 * a few of them in the meaning colours, cover it, and clear again on the new
 * content. `fixed` covers the window; otherwise the nearest positioned parent.
 */
const SPREAD = 0.62;
/** The few squares that keep a colour while the rest are room-coloured. */
const ACCENTS = ["var(--signal-green)", "var(--signal-amber)", "var(--signal-red)", "var(--group-ns)", "var(--group-ew)", "var(--jev)", "var(--foreground)"];

export function SquareWipe({ stage, fixed = false, cell = 52, className }: { stage: WipeStage; fixed?: boolean; cell?: number; className?: string }) {
  const viewport = useViewport();
  const columns = Math.ceil(Math.max(1, viewport.width) / cell) + 1;
  const rows = Math.ceil(Math.max(1, viewport.height) / cell) + 1;
  const cells = useMemo(() => {
    const out: { delay: number; accent: string | null }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const n = r * 131 + c;
        // A diagonal sweep, broken up so it reads as squares landing, not a curtain.
        const diagonal = (c / columns + r / rows) / 2;
        const order = diagonal * (1 - SPREAD) + hash01(n) * SPREAD;
        out.push({ delay: order, accent: hash01(n + 7) < 0.12 ? ACCENTS[Math.floor(hash01(n + 3) * ACCENTS.length)] : null });
      }
    }
    return out;
  }, [columns, rows]);

  if (stage === "idle") return null;
  const covering = stage === "cover";
  return (
    <div
      aria-hidden="true"
      className={cn(fixed ? "fixed inset-0 z-[70]" : "absolute inset-0 z-40", "pointer-events-auto overflow-hidden", className)}
      data-testid="square-wipe"
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, ${cell}px)`, gridAutoRows: `${cell}px` }}>
        {cells.map((c, i) => (
          <span
            key={i}
            className="relative bg-background"
            style={{
              animation: `${covering ? "wipe-in" : "wipe-out"} ${covering ? 170 : 200}ms cubic-bezier(0.16, 1, 0.3, 1) ${Math.round(c.delay * (covering ? COVER_MS - 170 : REVEAL_MS - 200))}ms both`,
            }}
          >
            {c.accent ? <span className="absolute inset-[30%]" style={{ background: c.accent }} /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
