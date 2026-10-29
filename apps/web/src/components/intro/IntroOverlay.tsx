import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useServices } from "@/app/services";
import { useViewport } from "@/hooks/useViewport";
import type { IntroPhase } from "@/state/intro";
import { shallowEqual, useStore } from "@/state/store";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_TRAVEL = [0.65, 0, 0.35, 1] as const;

/** Milliseconds each phase holds before advancing. Short: the intro covers scene warm-up, nothing more. */
const HOLD: Record<Exclude<IntroPhase, "done">, { full: number; reduced: number }> = {
  title: { full: 950, reduced: 500 },
  byline: { full: 1250, reduced: 1000 },
  handoff: { full: 1150, reduced: 550 },
};

interface Target {
  x: number;
  y: number;
  fontSize: number;
}

function measureSlot(): Target | null {
  const slot = document.querySelector<HTMLElement>("[data-wordmark-slot]");
  if (!slot) return null;
  const rect = slot.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, fontSize: parseFloat(getComputedStyle(slot).fontSize) };
}

/**
 * Black screen → "Intersection" → "by MAGI" → the title travels to the header
 * while the site appears. The travelling title is a single element whose
 * position and size animate continuously into the header slot, where an
 * identical header wordmark takes over without a visible change.
 */
export function IntroOverlay() {
  const { intro } = useServices();
  const { phase, run } = useStore(intro, s => s, shallowEqual);
  const reduced = useReducedMotion() ?? false;
  const viewport = useViewport();
  const [target, setTarget] = useState<Target | null>(null);

  const finish = useCallback(() => intro.setState(s => ({ ...s, phase: "done" })), [intro]);

  useEffect(() => {
    if (phase === "done") return;
    const hold = HOLD[phase][reduced ? "reduced" : "full"];
    const timer = window.setTimeout(() => {
      if (phase === "title") intro.setState(s => ({ ...s, phase: "byline" }));
      else if (phase === "byline") {
        setTarget(measureSlot());
        intro.setState(s => ({ ...s, phase: "handoff" }));
      } else finish();
    }, hold);
    return () => window.clearTimeout(timer);
  }, [phase, run, reduced, intro, finish]);

  // Any key or click skips straight to the site.
  useEffect(() => {
    if (phase === "done") return;
    const skip = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key === "Shift") return;
      finish();
    };
    window.addEventListener("keydown", skip);
    return () => window.removeEventListener("keydown", skip);
  }, [phase, finish]);

  const introSize = Math.min(96, Math.max(46, viewport.width * 0.085));
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2 - introSize * 0.25;
  const travelling = phase === "handoff" && target !== null && !reduced;

  return (
    <AnimatePresence>
      {phase !== "done" ? (
        <motion.div
          key={`intro-${run}`}
          className="fixed inset-0 z-50 cursor-default select-none"
          onClick={finish}
          exit={{ opacity: 0, transition: { duration: 0.2, ease: "easeOut" } }}
          data-testid="intro"
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-black"
            initial={{ opacity: 1 }}
            animate={{ opacity: phase === "handoff" ? 0 : 1 }}
            transition={{ duration: reduced ? 0.5 : 0.95, delay: reduced ? 0 : 0.18, ease: EASE_TRAVEL }}
          />

          <motion.div
            aria-hidden="true"
            className="fixed left-0 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap"
            initial={{ left: centerX, top: centerY, fontSize: introSize }}
            animate={travelling ? { left: target.x, top: target.y, fontSize: target.fontSize } : { left: centerX, top: centerY, fontSize: introSize, opacity: phase === "handoff" && reduced ? 0 : 1 }}
            transition={travelling ? { duration: 1.0, ease: EASE_TRAVEL } : { duration: reduced ? 0.4 : 0 }}
          >
            <motion.span
              className="wordmark block text-foreground"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.22em", filter: "blur(14px)", letterSpacing: "0.05em" }}
              animate={{ opacity: 1, y: "0em", filter: "blur(0px)", letterSpacing: "-0.02em" }}
              transition={{ duration: reduced ? 0.6 : 1.15, delay: 0.12, ease: EASE_OUT }}
            >
              Intersection
            </motion.span>
          </motion.div>

          <motion.p
            aria-hidden="true"
            className="fixed left-1/2 -translate-x-1/2 whitespace-nowrap text-[clamp(1rem,1.5vw,1.3rem)] font-[450] tracking-[0.01em] text-muted-foreground"
            style={{ top: centerY + introSize * 0.62 }}
            initial={{ opacity: 0, y: reduced ? 0 : 10 }}
            animate={phase === "byline" ? { opacity: 1, y: 0 } : phase === "handoff" ? { opacity: 0, y: reduced ? 0 : -6 } : { opacity: 0, y: reduced ? 0 : 10 }}
            transition={{ duration: phase === "handoff" ? 0.3 : 0.7, ease: EASE_OUT }}
          >
            by MAGI
          </motion.p>

          <span className="sr-only" role="status">Intersection, by MAGI</span>
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              finish();
            }}
            className="fixed bottom-5 right-5 rounded-md px-3 py-1.5 text-sm text-subtle-foreground opacity-0 transition-opacity focus-visible:opacity-100"
          >
            Skip intro
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
