import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight, HemisphereLight, SpotLight } from "three";
import { PerformanceMonitor } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import { useServices } from "@/app/services";
import { useStore } from "@/state/store";
import { CameraRig } from "./CameraRig";
import { Diorama } from "./Diorama";
import { useFrameData } from "./frameData";
import { readSceneTheme, type SceneTheme } from "./sceneTheme";
import { TrafficSignals } from "./TrafficSignals";
import { Vehicles } from "./Vehicles";

/** Samples the active feed once per frame, before anything draws, and crossfades on swaps. */
function FeedSampler() {
  const services = useServices();
  const frame = useFrameData();
  const view = useStore(services.scene, s => s.view);
  const mode = useStore(services.session.store, s => s.snapshot?.config.mode ?? null);
  const reduced = useReducedMotion() ?? false;
  const swap = useRef({ active: "preview" as "preview" | "session", fade: 1, stage: "steady" as "steady" | "out" | "in" });

  useEffect(() => {
    if (view === "preview") {
      services.preview.start();
      return;
    }
    // Keep the preview running through the fade-out, then stop paying for it.
    const timer = setTimeout(() => services.preview.stop(), 800);
    return () => clearTimeout(timer);
  }, [view, services.preview]);

  useFrame((_, delta) => {
    const desired = view === "simulation" ? "session" : "preview";
    const s = swap.current;
    if (desired !== s.active && s.stage !== "out") s.stage = "out";
    if (s.stage === "out") {
      s.fade = reduced ? 0 : Math.max(0, s.fade - delta / 0.35);
      if (s.fade === 0) {
        s.active = desired;
        s.stage = "in";
      }
    } else if (s.stage === "in") {
      s.fade = reduced ? 1 : Math.min(1, s.fade + delta / 0.55);
      if (s.fade === 1) s.stage = "steady";
    }
    const feed = s.active === "session" ? services.sessionFeed : services.preview;
    frame.sample = feed.sample(performance.now(), frame.vehicles);
    frame.fade = s.fade;
    frame.mode = s.active === "session" ? mode : null;
  }, -1);

  return null;
}

const LAMP = {
  // Home: a tight pool of lamplight on the model, falling off into the dark room.
  preview: { angle: 0.4, penumbra: 0.78, intensity: 3.6, hemisphere: 0.1, fill: 0.08 },
  // Simulation: the lamp opens up so the queues on every approach stay readable.
  simulation: { angle: 0.62, penumbra: 0.6, intensity: 3.0, hemisphere: 0.3, fill: 0.22 },
} as const;

/** The lamp over the model. Its pool widens when the visitor enters the simulation. */
function Lamp({ theme, shadows }: { theme: SceneTheme; shadows: boolean }) {
  const { scene } = useServices();
  const view = useStore(scene, s => s.view);
  const reduced = useReducedMotion() ?? false;
  const spot = useRef<SpotLight>(null);
  const hemisphere = useRef<HemisphereLight>(null);
  const fill = useRef<DirectionalLight>(null);

  useFrame((_, delta) => {
    const target = view === "simulation" ? LAMP.simulation : LAMP.preview;
    const k = reduced ? 1 : 1 - Math.exp(-delta * 2.2);
    const s = spot.current;
    if (s) {
      s.angle += (target.angle - s.angle) * k;
      s.penumbra += (target.penumbra - s.penumbra) * k;
      s.intensity += (target.intensity - s.intensity) * k;
    }
    if (hemisphere.current) hemisphere.current.intensity += (target.hemisphere - hemisphere.current.intensity) * k;
    if (fill.current) fill.current.intensity += (target.fill - fill.current.intensity) * k;
  });

  return (
    <>
      <hemisphereLight ref={hemisphere} args={["#aab4c4", "#121417", LAMP.preview.hemisphere]} />
      <spotLight
        ref={spot}
        position={[40, 180, 56]}
        angle={LAMP.preview.angle}
        penumbra={LAMP.preview.penumbra}
        intensity={LAMP.preview.intensity}
        decay={0}
        color={theme.keyLight}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.035}
        shadow-camera-near={80}
        shadow-camera-far={420}
      />
      <directionalLight ref={fill} position={[-90, 70, -50]} intensity={LAMP.preview.fill} color="#9fb3d1" />
    </>
  );
}

export function IntersectionScene({ quality, onDecline }: { quality: "high" | "low"; onDecline: () => void }) {
  const theme = useMemo(() => readSceneTheme(), []);
  const shadows = quality === "high";

  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 160, 380]} />

      {/* A lamp over the model: lit centre, the periphery falls off into the room. */}
      <Lamp theme={theme} shadows={shadows} />

      <FeedSampler />
      <Diorama theme={theme} />
      <TrafficSignals theme={theme} />
      <Vehicles shadows={shadows} />
      <CameraRig />
      <PerformanceMonitor onDecline={onDecline} flipflops={2} />
    </>
  );
}
