import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { cn } from "@/lib/utils";
import { detectWebGL } from "@/lib/webgl";
import { useServices } from "@/app/services";
import { useStore } from "@/state/store";
import { createFrameData, FrameDataContext } from "./frameData";
import { IntersectionScene } from "./IntersectionScene";
import { SceneFallback } from "./SceneFallback";

class SceneErrorBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[intersection] 3D scene failed; showing the 2D schematic instead.", error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The single persistent canvas behind every page. Home and the simulation are
 * two framings of this scene; Settings and About hide it and pause rendering.
 */
export function IntersectionCanvas() {
  const services = useServices();
  const view = useStore(services.scene, s => s.view);
  const webgl = useStore(services.scene, s => s.webgl);
  const autoQuality = useStore(services.scene, s => s.quality);
  const preference = useStore(services.preferences, p => p.quality);
  const quality = preference === "auto" ? autoQuality : preference;
  const frame = useMemo(() => createFrameData(), []);
  const container = useRef<HTMLDivElement>(null);
  const [supported] = useState(detectWebGL);
  const [failed, setFailed] = useState(false);
  const hidden = view === "hidden";

  useEffect(() => {
    frame.debugElement = container.current;
  }, [frame]);

  useEffect(() => {
    if (!supported) services.scene.setState(s => ({ ...s, webgl: "unavailable" }));
  }, [supported, services.scene]);

  const status = !supported ? "unavailable" : failed ? "error" : webgl === "lost" ? "lost" : webgl === "ok" ? "ok" : "starting";

  return (
    <div
      ref={container}
      data-testid="scene"
      data-webgl={status}
      className={cn("fixed inset-0 z-0 transition-opacity duration-500 ease-out", hidden && "pointer-events-none opacity-0")}
      aria-hidden="true"
    >
      {supported ? (
        <SceneErrorBoundary fallback={<SceneFallback reason="error" />} onError={() => setFailed(true)}>
          <FrameDataContext.Provider value={frame}>
            <Canvas
              frameloop={hidden ? "never" : "always"}
              dpr={quality === "low" ? 1 : [1, 1.75]}
              shadows="percentage"
              gl={{ antialias: true, powerPreference: "high-performance" }}
              camera={{ fov: 30, near: 3, far: 1400, position: [90, 110, 140] }}
              onCreated={({ gl }) => {
                services.scene.setState(s => ({ ...s, webgl: "ok" }));
                gl.domElement.addEventListener("webglcontextlost", event => {
                  event.preventDefault();
                  services.scene.setState(s => ({ ...s, webgl: "lost" }));
                });
                gl.domElement.addEventListener("webglcontextrestored", () => {
                  services.scene.setState(s => ({ ...s, webgl: "ok" }));
                });
              }}
            >
              <Suspense fallback={null}>
                <IntersectionScene quality={quality} onDecline={() => services.scene.setState(s => ({ ...s, quality: "low" }))} />
              </Suspense>
            </Canvas>
          </FrameDataContext.Provider>
          {webgl === "lost" ? <SceneFallback reason="lost" overlay /> : null}
        </SceneErrorBoundary>
      ) : (
        <SceneFallback reason="unsupported" />
      )}
    </div>
  );
}
