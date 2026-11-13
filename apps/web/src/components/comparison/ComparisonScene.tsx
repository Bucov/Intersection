import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { ControllerMode } from "@intersection/shared";
import { Diorama } from "@/components/scene/Diorama";
import { createFrameData, FrameDataContext, useFrameData } from "@/components/scene/frameData";
import { readSceneTheme } from "@/components/scene/sceneTheme";
import { TrafficSignals } from "@/components/scene/TrafficSignals";
import { Vehicles } from "@/components/scene/Vehicles";
import { useServices } from "@/app/services";
import type { SessionHistory } from "@/state/replay";
import { useStore } from "@/state/store";

/** Angled three-quarter view that keeps all four approaches in a roughly square frame. */
const CAMERA: [number, number, number] = [50, 94, 92];

/** Long enough for the observation zones to ease in after the view mounts. */
const SETTLE_MS = 3000;

/**
 * Draws the recorded run at the playback clock's time. The canvas renders on
 * demand: a frame is requested whenever the playhead moves, the recording grows,
 * the view settles after mounting, or an emergency light bar is flashing. While
 * playback is paused and nothing moves, nothing is drawn. Orbiting and resizing
 * request their own frames.
 */
function Playback({ history, clock, mode }: { history: SessionHistory; clock: RefObject<number>; mode: ControllerMode }) {
  const frame = useFrameData();
  const invalidate = useThree(state => state.invalidate);
  const flashing = useRef(false);

  useFrame(() => {
    frame.sample = history.sample(clock.current, frame.vehicles);
    frame.fade = 1;
    frame.mode = mode;
    let emergency = false;
    for (let i = 0; i < frame.sample.count && !emergency; i++) emergency = frame.vehicles[i].emergency;
    flashing.current = emergency;
  }, -1);

  useEffect(() => {
    let request = 0;
    let lastClock = Number.NaN;
    let lastEnd = Number.NaN;
    const settleUntil = performance.now() + SETTLE_MS;
    const tick = (now: number) => {
      const t = clock.current;
      const end = history.range?.end ?? -1;
      if (t !== lastClock || end !== lastEnd || now < settleUntil || flashing.current) {
        lastClock = t;
        lastEnd = end;
        invalidate();
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [history, clock, invalidate]);

  return null;
}

/**
 * One controller's run as its own small 3D intersection, the same model as the
 * main scene, driven by a recording instead of a live session.
 */
export function ComparisonScene({ history, clock, mode }: { history: SessionHistory; clock: RefObject<number>; mode: ControllerMode }) {
  const services = useServices();
  const autoQuality = useStore(services.scene, s => s.quality);
  const preference = useStore(services.preferences, p => p.quality);
  const quality = preference === "auto" ? autoQuality : preference;
  const theme = useMemo(() => readSceneTheme(), []);
  const frame = useMemo(() => createFrameData(), []);
  return (
    <FrameDataContext.Provider value={frame}>
      <Canvas frameloop="demand" dpr={quality === "low" ? 1 : [1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} camera={{ fov: 30, near: 3, far: 1400, position: CAMERA }}>
        <color attach="background" args={[theme.background]} />
        <fog attach="fog" args={[theme.background, 170, 320]} />
        <hemisphereLight args={["#c4beb4", "#1a1816", 0.45]} />
        <spotLight position={[40, 180, 56]} angle={0.62} penumbra={0.6} intensity={3} decay={0} color={theme.keyLight} />
        <directionalLight position={[-90, 70, -50]} intensity={0.2} color="#cfc6b8" />
        <Playback history={history} clock={clock} mode={mode} />
        <Diorama theme={theme} />
        <TrafficSignals theme={theme} />
        <Vehicles shadows={false} />
        <OrbitControls enablePan={false} minDistance={60} maxDistance={220} maxPolarAngle={1.3} target={[0, 0, 0]} />
      </Canvas>
    </FrameDataContext.Provider>
  );
}
