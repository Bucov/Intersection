import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** How long the squares take to cover, and to clear again. */
export const COVER_MS = 330;
export const REVEAL_MS = 380;

export type WipeStage = "idle" | "cover" | "reveal";

export interface SquareWipeController {
  stage: WipeStage;
  /** Cover the area with squares, run `swap` once it is covered, then clear. */
  run: (swap: () => void) => void;
}

export function useSquareWipe(): SquareWipeController {
  const reduced = useReducedMotion() ?? false;
  const [stage, setStage] = useState<WipeStage>("idle");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(t => window.clearTimeout(t)), []);
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
      }, COVER_MS),
      window.setTimeout(() => setStage("idle"), COVER_MS + REVEAL_MS),
    ];
  }, [reduced]);
  return { stage, run };
}
