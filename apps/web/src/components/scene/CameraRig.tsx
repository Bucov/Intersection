import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, type CameraControlsImpl } from "@react-three/drei";
import { Box3, Fog, PerspectiveCamera, Vector3 } from "three";
import { useReducedMotion } from "motion/react";
import { useServices } from "@/app/services";
import { introCamera } from "@/state/intro";
import { sameInsets, type CameraView, type SceneInsets, type SceneView } from "@/state/scene";
import { useStore } from "@/state/store";

interface Pose {
  position: Vector3;
  target: Vector3;
  azimuth: number;
  polar: number;
}

const PRESETS: Record<"preview" | CameraView, { azimuth: number; polar: number; radius: number; foreshorten: number }> = {
  // Elevated three-quarter view that keeps all four approaches in frame.
  preview: { azimuth: 0.62, polar: 0.96, radius: 50, foreshorten: 0.86 },
  angled: { azimuth: 0.5, polar: 0.84, radius: 58, foreshorten: 0.84 },
  top: { azimuth: 0, polar: 0.0001, radius: 62, foreshorten: 1 },
};

/** Distance at which a ground disc of `radius` fits the screen area left free by the UI. */
function poseFor(view: SceneView, cameraView: CameraView, width: number, height: number, insets: SceneInsets, fovDeg: number): Pose {
  const preset = PRESETS[view === "preview" ? "preview" : cameraView];
  const safeW = Math.max(160, width - insets.left - insets.right);
  const safeH = Math.max(160, height - insets.top - insets.bottom);
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const fitTan = Math.min((tanHalf * safeH) / height, (tanHalf * safeW) / height);
  const distance = Math.min(320, Math.max(60, (preset.radius / fitTan) * preset.foreshorten));
  const target = new Vector3(0, 0, 0);
  const position = new Vector3(
    distance * Math.sin(preset.polar) * Math.sin(preset.azimuth),
    distance * Math.cos(preset.polar),
    distance * Math.sin(preset.polar) * Math.cos(preset.azimuth),
  ).add(target);
  return { position, target, azimuth: preset.azimuth, polar: preset.polar };
}

export function CameraRig() {
  const services = useServices();
  const view = useStore(services.scene, s => s.view);
  const cameraView = useStore(services.scene, s => s.cameraView);
  const recenter = useStore(services.scene, s => s.recenter);
  const insets = useStore(services.scene, s => s.insets, sameInsets);
  const introPhase = useStore(services.intro, s => s.phase);
  // Before the reveal the intro owns the camera (and the screen is masked anyway).
  const scripted = introPhase === "title" || introPhase === "byline" || introPhase === "drive";
  const reduced = useReducedMotion() ?? false;
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree(state => state.camera) as PerspectiveCamera;
  const size = useThree(state => state.size);
  const scene = useThree(state => state.scene);
  const offset = useRef({ x: 0, y: 0, ready: false });
  const posed = useRef(false);
  const pose = useRef<Pose | null>(null);
  const fog = useRef({ near: -5, far: 150 });
  /** The intro's car drive moved the camera; the reveal pulls back out from there. */
  const drove = useRef(false);
  const sway = useRef(0);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.minDistance = 40;
    c.maxDistance = 330;
    c.minPolarAngle = 0;
    c.maxPolarAngle = 1.3;
    c.dollyToCursor = false;
    c.setBoundary(new Box3(new Vector3(-80, 0, -80), new Vector3(80, 4, 80)));
  }, []);

  // Interaction is only offered in the simulation; the home preview is a picture.
  useEffect(() => {
    const c = controls.current;
    if (c) c.enabled = view === "simulation";
  }, [view]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const next = poseFor(view, cameraView, size.width, size.height, insets, camera.fov);
    pose.current = next;
    if (scripted) return;
    // After the drive the camera pulls back from the car to the model, slowly enough to read as one move.
    const pullOut = drove.current && !reduced;
    const animate = (posed.current || pullOut) && !reduced;
    c.smoothTime = pullOut ? 1.05 : view === "simulation" ? 0.75 : 0.6;
    void c.setLookAt(next.position.x, next.position.y, next.position.z, next.target.x, next.target.y, next.target.z, animate);
    posed.current = true;
    drove.current = false;
    sway.current = 0;
  }, [view, cameraView, recenter, insets, size.width, size.height, camera.fov, reduced, scripted]);

  useFrame((_, delta) => {
    const c = controls.current;
    const p = pose.current;
    const intro = services.intro.getState();
    if (c && !reduced && (intro.phase === "title" || intro.phase === "byline" || (intro.phase === "drive" && intro.driveStartedAt !== null))) {
      // Behind the mask the camera waits at the start of the drive, so the car's first frame is already framed.
      const elapsed = intro.phase === "drive" && intro.driveStartedAt !== null ? (performance.now() - intro.driveStartedAt) / 1000 : 0;
      const shot = introCamera(elapsed);
      void c.setLookAt(...shot.position, ...shot.target, false);
      drove.current = true;
    } else if (c && p && view === "preview" && !reduced && intro.phase === "done") {
      // A slow sway keeps the preview alive without spinning the viewer. It starts from the pose itself.
      sway.current += delta;
      const t = sway.current;
      c.rotateTo(p.azimuth + Math.sin(t * 0.07) * 0.2, p.polar + Math.sin(t * 0.05) * 0.03, true);
    }

    // Shift the projection so the junction sits in the centre of the uncovered area.
    // The intro is framed on the whole window, where its type sits.
    const targetX = scripted ? 0 : (insets.left - insets.right) / 2;
    const targetY = scripted ? 0 : (insets.top - insets.bottom) / 2;
    const o = offset.current;
    const k = reduced || !o.ready ? 1 : 1 - Math.exp(-delta * 3.5);
    o.x += (targetX - o.x) * k;
    o.y += (targetY - o.y) * k;
    o.ready = true;
    camera.setViewOffset(size.width, size.height, -o.x, -o.y, size.width, size.height);
    camera.updateProjectionMatrix();

    // Fog follows the camera so the model fades into the room at every zoom level;
    // it closes in on Home so the miniature floats in black.
    if (c && scene.fog instanceof Fog) {
      const target = view === "preview" ? { near: -5, far: 150 } : { near: 35, far: 240 };
      const f = fog.current;
      const fk = reduced ? 1 : 1 - Math.exp(-delta * 2.2);
      f.near += (target.near - f.near) * fk;
      f.far += (target.far - f.far) * fk;
      scene.fog.near = c.distance + f.near;
      scene.fog.far = c.distance + f.far;
    }
  });

  return <CameraControls ref={controls} makeDefault />;
}
