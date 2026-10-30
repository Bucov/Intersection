import { createStore } from "./store";

/**
 * The opening sequence: black, "Intersection", "by MAGI", then the title travels
 * to the header while the site appears. It runs on initial entry and on a
 * deliberate replay, never on ordinary route changes.
 */
export type IntroPhase = "title" | "byline" | "handoff" | "done";

export interface IntroState {
  phase: IntroPhase;
  /** Increments on replay so the sequence restarts cleanly. */
  run: number;
}

export function createIntroStore() {
  const skip = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("skipIntro");
  return createStore<IntroState>({ phase: skip ? "done" : "title", run: 0 });
}
