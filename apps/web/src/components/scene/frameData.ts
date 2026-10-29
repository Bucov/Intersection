import { createContext, useContext } from "react";
import type { ControllerMode } from "@intersection/shared";
import type { RenderVehicle, SceneSample } from "./interpolation";

/**
 * Mutable per-frame buffer shared by the scene's useFrame callbacks. The feed
 * sampler fills it first each frame; vehicles and signals read it. Nothing in
 * here goes through React state, so the frame loop never re-renders components.
 */
export interface FrameData {
  vehicles: RenderVehicle[];
  sample: SceneSample;
  /** 0–1 visibility of the fleet while the scene swaps between preview and session. */
  fade: number;
  /** Controller of the session being drawn (null for the preview). */
  mode: ControllerMode | null;
  /** Container element that receives test/debug attributes. */
  debugElement: HTMLElement | null;
}

export function createFrameData(): FrameData {
  return {
    vehicles: [],
    sample: { count: 0, phase: null, clearanceBlocked: false, simulationTimeMs: 0 },
    fade: 1,
    mode: null,
    debugElement: null,
  };
}

export const FrameDataContext = createContext<FrameData | null>(null);

export function useFrameData(): FrameData {
  const frame = useContext(FrameDataContext);
  if (!frame) throw new Error("useFrameData must be used inside the intersection scene.");
  return frame;
}
