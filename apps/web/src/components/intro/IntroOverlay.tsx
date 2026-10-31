import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useServices } from "@/app/services";
import { useViewport } from "@/hooks/useViewport";
import { DRIVE, REVEAL } from "@/state/intro";
import { shallowEqual, useStore } from "@/state/store";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** The title leaves quickly, ahead of the car, and settles gently into the header. */
const EASE_LIFT = [0.55, 0, 0.15, 1] as const;

/** Milliseconds each phase holds before advancing. */
const HOLD = {
  title: { full: 950, reduced: 500 },
  byline: { full: 750, reduced: 1000 },
  /** Handoff without the car (reduced motion, no WebGL, or a scene that never got ready). */
  handoff: { full: 1150, reduced: 550 },
} as const;
/** How long the byline waits for the 3D scene before the intro goes on without the car. */
const SCENE_WAIT_MS = 2500;
const BYLINE = "by MAGI";

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

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * "intersection" and "by MAGI" on the empty room; then one car drives up out
 * of the dark through a hole in the mask, breaks through the byline and chases
 * the title into the header. Near the far side of the junction the mask opens
 * outward from the car and the site appears. The title is a single element that
 * travels by transform into the header slot, where an identical wordmark takes over.
 */
export function IntroOverlay() {
  const { intro, scene, introCar } = useServices();
  const { phase, run } = useStore(intro, s => ({ phase: s.phase, run: s.run }), shallowEqual);
  const reduced = useReducedMotion() ?? false;
  const viewport = useViewport();
  const [landing, setLanding] = useState<{ run: number; target: Target | null } | null>(null);
  const target = landing?.run === run ? landing.target : null;
  const mask = useRef<HTMLDivElement>(null);
  const letters = useRef<(HTMLSpanElement | null)[]>([]);
  const lifted = useRef(false);
  const hit = useRef(new Set<number>());

  const finish = useCallback(() => intro.setState(s => ({ ...s, phase: "done" })), [intro]);
  const lift = useCallback(() => {
    if (lifted.current) return;
    lifted.current = true;
    setLanding({ run: intro.getState().run, target: measureSlot() });
  }, [intro]);

  useEffect(() => {
    if (phase === "title") {
      lifted.current = false;
      hit.current = new Set();
      const timer = window.setTimeout(() => intro.setState(s => ({ ...s, phase: "byline" })), HOLD.title[reduced ? "reduced" : "full"]);
      return () => window.clearTimeout(timer);
    }
    if (phase === "byline") {
      const started = performance.now();
      let timer = 0;
      const next = () => {
        const waited = performance.now() - started;
        const stage = scene.getState();
        const ready = stage.ready && stage.webgl === "ok";
        // The car needs the scene on screen; Settings and About hide it.
        if (!reduced && ready && stage.view !== "hidden") {
          intro.setState(s => ({ ...s, phase: "drive", driveStartedAt: performance.now(), revealAt: null }));
        } else if (reduced || stage.view === "hidden" || stage.webgl === "unavailable" || waited > SCENE_WAIT_MS) {
          lift();
          intro.setState(s => ({ ...s, phase: "handoff", driveStartedAt: null, revealAt: null }));
        } else {
          timer = window.setTimeout(next, 100);
        }
      };
      timer = window.setTimeout(next, HOLD.byline[reduced ? "reduced" : "full"]);
      return () => window.clearTimeout(timer);
    }
    if (phase === "handoff") {
      const withCar = intro.getState().driveStartedAt !== null;
      const timer = window.setTimeout(finish, withCar ? REVEAL.doneMs : HOLD.handoff[reduced ? "reduced" : "full"]);
      return () => window.clearTimeout(timer);
    }
  }, [phase, run, reduced, intro, scene, finish, lift]);

  // While the car drives: cut the mask around it, let it break through the byline, then open the mask.
  useEffect(() => {
    if (phase !== "drive" && phase !== "handoff") return;
    if (intro.getState().driveStartedAt === null) return;
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      const state = intro.getState();
      if (state.driveStartedAt === null) return;
      const t = (now - state.driveStartedAt) / 1000;
      const car = introCar;

      const element = mask.current;
      if (element) {
        let radius = car.visible ? Math.max(car.width, car.height) * 0.95 : 0;
        if (state.phase === "handoff" && state.revealAt !== null) {
          const k = easeInOut(clamp01((now - state.revealAt) / REVEAL.maskMs));
          radius += (Math.hypot(window.innerWidth, window.innerHeight) * 1.15 - radius) * k;
        }
        element.style.setProperty("--hole-x", `${car.x}px`);
        element.style.setProperty("--hole-y", `${car.y}px`);
        element.style.setProperty("--hole-r", `${radius}px`);
      }

      if (t >= DRIVE.titleLiftAt) lift();

      if (car.visible) {
        const front = car.y - car.height * 0.42;
        letters.current.forEach((letter, i) => {
          if (!letter || hit.current.has(i)) return;
          const rect = letter.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          if (front > rect.top + rect.height / 2 || Math.abs(cx - car.x) > car.width * 0.62 + rect.width) return;
          hit.current.add(i);
          // Pushed aside by the bonnet: away from the car's centre line and forward, out of focus.
          const side = cx >= car.x ? 1 : -1;
          const spread = 0.35 + Math.abs(cx - car.x) / Math.max(1, car.width);
          letter.animate(
            [
              { transform: "translate(0, 0) rotate(0deg)", opacity: 1, filter: "blur(0px)" },
              { transform: `translate(${side * (18 + 46 * spread)}px, ${-(10 + 26 * spread)}px) rotate(${side * (8 + 16 * spread)}deg)`, opacity: 0, filter: "blur(7px)" },
            ],
            { duration: 620, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
          );
        });
      }

      if (state.phase === "drive" && t >= DRIVE.revealAt) intro.setState(s => ({ ...s, phase: "handoff", revealAt: now }));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, run, intro, introCar, lift]);

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

  // Large enough to read as the page's first sentence: the wordmark set at poster scale.
  const introSize = Math.round(Math.min(208, Math.max(52, viewport.width * 0.13)));
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2 - introSize * 0.12;
  const travelling = target !== null && !reduced;
  const withCar = phase === "drive" || (phase === "handoff" && intro.getState().driveStartedAt !== null);

  return (
    <AnimatePresence>
      {phase !== "done" ? (
        <motion.div
          key={`intro-${run}`}
          className="fixed inset-0 z-50 cursor-default select-none"
          onClick={finish}
          exit={{ opacity: 0, transition: { duration: 0.2, ease: "easeOut" } }}
          data-testid="intro"
          data-phase={phase}
        >
          {/* The room. During the drive it has a hole that follows the car; at the reveal the hole opens to the edges. */}
          <motion.div
            ref={mask}
            aria-hidden="true"
            className="absolute inset-0 bg-background"
            style={withCar ? { maskImage: HOLE, WebkitMaskImage: HOLE } : undefined}
            initial={{ opacity: 1 }}
            animate={{ opacity: phase === "handoff" && !withCar ? 0 : 1 }}
            transition={{ duration: reduced ? 0.5 : 0.95, delay: reduced ? 0 : 0.18, ease: EASE_LIFT }}
          />

          <motion.div
            aria-hidden="true"
            className="fixed -translate-x-1/2 -translate-y-1/2 whitespace-nowrap will-change-transform"
            style={{ left: centerX, top: centerY, fontSize: introSize }}
            initial={{ x: 0, y: 0, scale: 1 }}
            // FLIP: the title keeps its layout and travels by transform only, landing exactly on the header slot.
            animate={travelling ? { x: target.x - centerX, y: target.y - centerY, scale: target.fontSize / introSize } : { x: 0, y: 0, scale: 1, opacity: phase === "handoff" && reduced ? 0 : 1 }}
            transition={travelling ? { duration: 1.05, ease: EASE_LIFT } : { duration: reduced ? 0.4 : 0 }}
          >
            <motion.span
              className="wordmark block text-foreground"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: "0.18em", filter: "blur(18px)" }}
              animate={{ opacity: 1, y: "0em", filter: "blur(0px)" }}
              transition={{ duration: reduced ? 0.6 : 1.15, delay: 0.12, ease: EASE_OUT }}
            >
              intersection
            </motion.span>
          </motion.div>

          <motion.p
            aria-hidden="true"
            className="fixed left-1/2 -translate-x-1/2 whitespace-nowrap text-[clamp(1rem,1.45vw,1.375rem)] font-[450] tracking-[-0.01em] text-muted-foreground"
            style={{ top: centerY + introSize * 0.56 }}
            initial={{ opacity: 0, y: reduced ? 0 : 10 }}
            animate={phase === "title" ? { opacity: 0, y: reduced ? 0 : 10 } : phase === "handoff" ? { opacity: 0, y: 0 } : { opacity: 1, y: 0 }}
            transition={{ duration: phase === "handoff" ? 0.35 : 0.7, ease: EASE_OUT }}
          >
            {[...BYLINE].map((char, i) => (
              <span key={`${run}-${i}`} ref={el => { letters.current[i] = el; }} className="inline-block whitespace-pre will-change-transform">
                {char}
              </span>
            ))}
          </motion.p>

          <span className="sr-only" role="status">Intersection, by MAGI</span>
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              finish();
            }}
            className="fixed bottom-5 right-5 px-3 py-1.5 text-sm text-subtle-foreground opacity-0 transition-opacity focus-visible:opacity-100"
          >
            skip intro
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** A soft-edged hole in the room at the car, sized by the overlay every frame. */
const HOLE = "radial-gradient(circle at var(--hole-x, 50%) var(--hole-y, 120%), transparent calc(var(--hole-r, 0px) * 0.55), black var(--hole-r, 0px))";
