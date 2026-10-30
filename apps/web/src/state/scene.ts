import { createStore } from "./store";

/** Which framing the shared 3D scene is in. One canvas serves Home and the simulation. */
export type SceneView = "preview" | "simulation" | "hidden";
export type CameraView = "angled" | "top";

/** Screen space covered by UI, so the camera centres the intersection in what is left. */
export interface SceneInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type WebGLState = "unknown" | "ok" | "unavailable" | "lost";

export interface SceneState {
  view: SceneView;
  cameraView: CameraView;
  insets: SceneInsets;
  /** Increment to return the camera to the current preset. */
  recenter: number;
  webgl: WebGLState;
  /** Resolved render quality (auto preference resolved by the performance monitor). */
  quality: "high" | "low";
}

export function createSceneStore() {
  return createStore<SceneState>({
    view: "preview",
    cameraView: "angled",
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    recenter: 0,
    webgl: "unknown",
    quality: "high",
  });
}

export function sameInsets(a: SceneInsets, b: SceneInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}
