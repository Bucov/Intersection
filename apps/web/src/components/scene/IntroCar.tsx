import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, Group, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from "three";
import { useServices } from "@/app/services";
import { DRIVE, heroZ } from "@/state/intro";
import { buildBrakeLights, buildVehicleModels } from "./geometry";
import { useFrameData } from "./frameData";
import type { SceneTheme } from "./sceneTheme";

const TAIL_LIGHT = new Color(3.4, 0.28, 0.2);
/** Half extents of the car's box, for its on-screen bounds. */
const HALF = { x: 0.95, z: 2.3, top: 1.5 } as const;

/**
 * The opening car. It exists only during the intro: it drives up the
 * northbound lane on its own clock, while the rest of the scene is masked,
 * and reports where it is on screen so the overlay can cut the mask around it.
 */
export function IntroCar({ theme, shadows }: { theme: SceneTheme; shadows: boolean }) {
  const { intro, introCar } = useServices();
  const frame = useFrameData();
  const model = useMemo(() => buildVehicleModels().car, []);
  const tail = useMemo(() => buildBrakeLights(), []);
  const body = useMemo(() => new MeshStandardMaterial({ vertexColors: true, color: theme.marking, roughness: 0.38, metalness: 0.06, transparent: true }), [theme]);
  const trim = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.08, transparent: true }), []);
  const lamp = useMemo(() => new MeshBasicMaterial({ color: TAIL_LIGHT, toneMapped: false, transparent: true }), []);
  const group = useRef<Group>(null);
  const corner = useMemo(() => new Vector3(), []);

  useEffect(() => () => {
    body.dispose();
    trim.dispose();
    lamp.dispose();
    introCar.visible = false;
    frame.hero.active = false;
  }, [body, trim, lamp, introCar, frame]);

  useFrame(({ camera, size }) => {
    const g = group.current;
    if (!g) return;
    const state = intro.getState();
    const driving = state.driveStartedAt !== null && (state.phase === "drive" || state.phase === "handoff");
    if (!driving) {
      g.visible = false;
      introCar.visible = false;
      frame.hero.active = false;
      return;
    }

    const now = performance.now();
    const elapsed = (now - state.driveStartedAt!) / 1000;
    const z = heroZ(elapsed);
    let opacity = 1;
    if (state.revealAt !== null) {
      const after = (now - state.revealAt) / 1000 - DRIVE.fadeOutAfterReveal;
      opacity = 1 - Math.min(1, Math.max(0, after / DRIVE.fadeOutDuration));
    }
    g.visible = opacity > 0;
    g.position.set(DRIVE.laneX, 0, z);
    body.opacity = trim.opacity = lamp.opacity = opacity;
    body.depthWrite = trim.depthWrite = opacity > 0.98;
    frame.hero.active = opacity > 0;
    frame.hero.x = DRIVE.laneX;
    frame.hero.z = z;

    // Screen-space bounds of the car's box, in CSS pixels of the full-window canvas.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0.05, HALF.top]) {
          corner.set(DRIVE.laneX + sx * HALF.x, y, z + sz * HALF.z).project(camera);
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minY = Math.min(minY, corner.y);
          maxY = Math.max(maxY, corner.y);
        }
      }
    }
    // The projection uses the last rendered camera; give it a beat to settle on the drive's framing.
    introCar.visible = opacity > 0 && elapsed > 0.08;
    introCar.x = ((minX + maxX) / 4 + 0.5) * size.width;
    introCar.y = (0.5 - (minY + maxY) / 4) * size.height;
    introCar.width = ((maxX - minX) / 2) * size.width;
    introCar.height = ((maxY - minY) / 2) * size.height;
  }, -1);

  return (
    // Heading π: the model's front (+Z) points north (−Z), up the screen.
    <group ref={group} rotation-y={Math.PI} visible={false}>
      <mesh geometry={model.body} material={body} castShadow={shadows} receiveShadow />
      <mesh geometry={model.trim} material={trim} castShadow={shadows} />
      <mesh geometry={tail} material={lamp} position={[0, 0, -model.nominalLength / 2 - 0.03]} />
    </group>
  );
}
