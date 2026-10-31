import { useMemo, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { ControllerMode } from "@intersection/shared";
import { Diorama } from "@/components/scene/Diorama";
import { createFrameData, FrameDataContext, useFrameData } from "@/components/scene/frameData";
import { readSceneTheme } from "@/components/scene/sceneTheme";
import { TrafficSignals } from "@/components/scene/TrafficSignals";
import { Vehicles } from "@/components/scene/Vehicles";
import type { SessionHistory } from "@/state/replay";

/** Angled three-quarter view that keeps all four approaches in a roughly square frame. */
const CAMERA: [number, number, number] = [50, 94, 92];

/** Draws the recorded run at the playback clock's time, every frame. */
function Playback({ history, clock, mode }: { history: SessionHistory; clock: RefObject<number>; mode: ControllerMode }) {
  const frame = useFrameData();
  useFrame(() => {
    frame.sample = history.sample(clock.current, frame.vehicles);
    frame.fade = 1;
    frame.mode = mode;
  }, -1);
  return null;
}

/**
 * One controller's run as its own small 3D intersection, the same model as the
 * main scene, driven by a recording instead of a live session.
 */
export function ComparisonScene({ history, clock, mode }: { history: SessionHistory; clock: RefObject<number>; mode: ControllerMode }) {
  const theme = useMemo(() => readSceneTheme(), []);
  const frame = useMemo(() => createFrameData(), []);
  return (
    <FrameDataContext.Provider value={frame}>
      <Canvas dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} camera={{ fov: 30, near: 3, far: 1400, position: CAMERA }}>
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
