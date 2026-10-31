import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** How long the squares take to cover, and to clear again. */
export interface WipeTiming {
  cover: number;
  reveal: number;
}

/** Page changes: a quick scattered cover. */
export const PAGE_WIPE: WipeTiming = { cover: 330, reveal: 380 };
/** Panel tabs: a little longer, so the wave can be seen travelling. */
export const WAVE_WIPE: WipeTiming = { cover: 420, reveal: 480 };

export type WipeStage = "idle" | "cover" | "reveal";

export interface SquareWipeController {
  stage: WipeStage;
  /** Cover the area with squares, run `swap` once it is covered, then clear. */
  run: (swap: () => void) => void;
}

export function useSquareWipe(timing: WipeTiming = PAGE_WIPE): SquareWipeController {
  const reduced = useReducedMotion() ?? false;
  const [stage, setStage] = useState<WipeStage>("idle");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
  const { cover, reveal } = timing;
  const run = useCallback((swap: () => void) => {
    timers.current.forEach(t => window.clearTimeout(t));
    if (reduced) {
      swap();
      return;
    }
    setStage("cover");
    timers.current = [
      window.setTimeout(() => {
        swap();
        setStage("reveal");
      }, cover),
      window.setTimeout(() => setStage("idle"), cover + reveal),
    ];
  }, [reduced, cover, reveal]);
  return { stage, run };
}
