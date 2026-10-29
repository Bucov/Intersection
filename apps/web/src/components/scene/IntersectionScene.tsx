import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useReducedMotion } from "motion/react";
import { useServices } from "@/app/services";
import { useStore } from "@/state/store";
import { CameraRig } from "./CameraRig";
import { Diorama } from "./Diorama";
import { useFrameData } from "./frameData";
import { readSceneTheme } from "./sceneTheme";
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

export function IntersectionScene({ quality, onDecline }: { quality: "high" | "low"; onDecline: () => void }) {
  const theme = useMemo(() => readSceneTheme(), []);
  const shadows = quality === "high";

  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 160, 380]} />

      {/* A lamp over the model: lit centre, the periphery falls off into the room. */}
      <hemisphereLight args={["#aab4c4", "#121417", 0.42]} />
      <spotLight
        position={[46, 175, 64]}
        angle={0.66}
        penumbra={0.62}
        intensity={3.1}
        decay={0}
        color={theme.keyLight}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.035}
        shadow-camera-near={80}
        shadow-camera-far={420}
      />
      <directionalLight position={[-90, 70, -50]} intensity={0.24} color="#9fb3d1" />

      <FeedSampler />
      <Diorama theme={theme} />
      <TrafficSignals theme={theme} />
      <Vehicles shadows={shadows} />
      <CameraRig />
      <PerformanceMonitor onDecline={onDecline} flipflops={2} />
    </>
  );
}
