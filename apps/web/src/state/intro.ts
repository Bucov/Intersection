import { createStore } from "./store";

/**
 * The opening sequence: "intersection" and "by MAGI" on the empty room, then a
 * single car drives up out of the dark, through the byline, chasing the title
 * into the header. As it clears the junction the mask wears off and the rest of
 * the intersection appears around it. Runs on initial entry and on a
 * deliberate replay, never on ordinary route changes.
 *
 * - title, byline: type only, the scene is fully masked.
 * - drive: the scene shows the one car through a hole in the mask.
 * - handoff: the mask opens, the fleet fades in, the site appears.
 */
export type IntroPhase = "title" | "byline" | "drive" | "handoff" | "done";

export interface IntroState {
  phase: IntroPhase;
  /** Increments on replay so the sequence restarts cleanly. */
  run: number;
  /** performance.now() when the car started; null when the sequence runs without it. */
  driveStartedAt: number | null;
  /** performance.now() when the mask started to open. */
  revealAt: number | null;
}

export function createIntroStore() {
  const skip = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("skipIntro");
  return createStore<IntroState>({ phase: skip ? "done" : "title", run: 0, driveStartedAt: null, revealAt: null });
}

/** Restart the sequence from the top (Settings → Replay the intro). */
export function replayIntro(state: IntroState): IntroState {
  return { phase: "title", run: state.run + 1, driveStartedAt: null, revealAt: null };
}

/**
 * Where the opening car is on screen, written by the 3D scene every frame and
 * read by the overlay (to cut the mask around it and to know when it reaches
 * the byline). Plain mutable data: nothing here goes through React.
 */
export interface IntroCarProbe {
  visible: boolean;
  /** Screen-space centre and box of the car, in CSS pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createIntroCarProbe(): IntroCarProbe {
  return { visible: false, x: 0, y: 0, width: 0, height: 0 };
}

/**
 * The drive, in world units (metres, X east, north is −Z). The car takes the
 * northbound lane from the south approach. Times are seconds after the drive
 * starts; the overlay and the scene both read them from here.
 */
export const DRIVE = {
  laneX: 1.75,
  startZ: 34,
  /** Metres per second. */
  speed: 16,
  /** The title leaves for the header just before the car reaches the byline. */
  titleLiftAt: 0.75,
  /** Near the far side of the junction: the mask starts to open. */
  revealAt: 2.25,
  /** The car keeps going after the reveal, then hands the road back to the simulation. */
  fadeOutAfterReveal: 1.5,
  fadeOutDuration: 0.8,
} as const;

/** How long the mask takes to open, and when the rest of the site is fully there. */
export const REVEAL = {
  maskMs: 1150,
  doneMs: 1500,
  /** The fleet fades in with the mask, slightly behind it. */
  worldDelay: 0.15,
  worldDuration: 0.9,
} as const;

export function heroZ(elapsedSeconds: number): number {
  return DRIVE.startZ - DRIVE.speed * Math.max(0, elapsedSeconds);
}

const CRANE = {
  from: { position: [4.5, 8, 44], target: [1.5, 0, 16] },
  to: { position: [3, 30, 38], target: [0.8, 0, 4] },
} as const;

/**
 * The camera during the drive: it starts low behind the car and cranes up as
 * the car drives away, so the car keeps climbing the screen and the view tilts
 * down onto the junction just before the mask opens.
 */
export function introCamera(elapsedSeconds: number): { position: [number, number, number]; target: [number, number, number] } {
  const k = Math.min(1, Math.max(0, elapsedSeconds / DRIVE.revealAt));
  const e = k * k * (3 - 2 * k);
  const mix = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + (b[i] - v) * e) as [number, number, number];
  return { position: mix(CRANE.from.position, CRANE.to.position), target: mix(CRANE.from.target, CRANE.to.target) };
}

/** 0 → 1 visibility of everything except the opening car. */
export function worldVisibility(state: IntroState, now: number): number {
  if (state.phase === "done") return 1;
  if (state.phase !== "handoff") return 0;
  if (state.revealAt === null || state.driveStartedAt === null) return 1;
  const t = (now - state.revealAt) / 1000 - REVEAL.worldDelay;
  return Math.min(1, Math.max(0, t / REVEAL.worldDuration));
}
