import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AlwaysDepth, Color, Group, MeshBasicMaterial, type Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from "three";
import { useServices } from "@/app/services";
import { DRIVE, REVEAL, heroZ, type IntroState } from "@/state/intro";
import { buildBrakeLights, buildVehicleModels } from "./geometry";
import { useFrameData } from "./frameData";
import type { SceneTheme } from "./sceneTheme";

const TAIL_LIGHT = new Color(3.4, 0.28, 0.2);
/** Half extents of the car's box, for its on-screen bounds. */
const HALF = { x: 0.95, z: 2.3, top: 1.5 } as const;
/** The room is drawn after the world and before the car, so only the car's own pixels show through it. */
const ORDER = { room: 9998, car: 9999 } as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The room as a full-screen layer inside the scene: it paints the background
 * colour over everything drawn so far and resets depth, so the car drawn after
 * it is the only thing on screen. At the reveal a soft-edged hole opens from the
 * car outward, on the same curve as the overlay's mask.
 */
function createRoomMaterial(color: Color) {
  return new ShaderMaterial({
    uniforms: { color: { value: color }, center: { value: new Vector2() }, radius: { value: 0 } },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform vec2 center;
      uniform float radius;
      void main() {
        float alpha = 1.0;
        if (radius > 0.0) alpha = clamp((distance(gl_FragCoord.xy, center) - radius * 0.55) / (radius * 0.45), 0.0, 1.0);
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthFunc: AlwaysDepth,
    depthWrite: true,
    toneMapped: false,
    fog: false,
  });
}

/** Radius of the room's hole in CSS pixels, or null when the room is not drawn at all. */
function roomHole(state: IntroState, now: number, width: number, height: number): number | null {
  if (state.phase === "title" || state.phase === "byline" || state.phase === "drive") return 0;
  if (state.phase !== "handoff" || state.revealAt === null) return null;
  const k = easeInOut(clamp01((now - state.revealAt) / REVEAL.maskMs));
  return k >= 1 ? null : Math.hypot(width, height) * 1.15 * k;
}

/**
 * The opening car. It exists only during the intro: it drives up the
 * northbound lane on its own clock while the room covers the rest of the scene,
 * so the car's model is the only thing on screen, and reports where it is so
 * the overlay can follow it and open the room around it at the reveal.
 */
export function IntroCar({ theme, shadows }: { theme: SceneTheme; shadows: boolean }) {
  const { intro, introCar } = useServices();
  const frame = useFrameData();
  const model = useMemo(() => buildVehicleModels().car, []);
  const tail = useMemo(() => buildBrakeLights(), []);
  const body = useMemo(() => new MeshStandardMaterial({ vertexColors: true, color: theme.marking, roughness: 0.38, metalness: 0.06, transparent: true }), [theme]);
  const trim = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.08, transparent: true }), []);
  const lamp = useMemo(() => new MeshBasicMaterial({ color: TAIL_LIGHT, toneMapped: false, transparent: true }), []);
  const room = useMemo(() => createRoomMaterial(theme.background), [theme]);
  const screen = useMemo(() => new PlaneGeometry(2, 2), []);
  const roomMesh = useRef<Mesh>(null);
  const group = useRef<Group>(null);
  const corner = useMemo(() => new Vector3(), []);

  useEffect(() => () => {
    body.dispose();
    trim.dispose();
    lamp.dispose();
    room.dispose();
    screen.dispose();
    introCar.visible = false;
    frame.hero.active = false;
  }, [body, trim, lamp, room, screen, introCar, frame]);

  useFrame(({ camera, size, viewport }) => {
    const g = group.current;
    if (!g) return;
    const state = intro.getState();
    const now = performance.now();

    // The room around the car. It follows the car's last reported position, like the overlay's mask.
    const cover = roomMesh.current;
    if (cover) {
      const hole = roomHole(state, now, size.width, size.height);
      cover.visible = hole !== null;
      if (hole !== null) {
        const dpr = viewport.dpr;
        room.uniforms.radius.value = hole * dpr;
        (room.uniforms.center.value as Vector2).set(introCar.x * dpr, (size.height - introCar.y) * dpr);
      }
    }

    const driving = state.driveStartedAt !== null && (state.phase === "drive" || state.phase === "handoff");
    if (!driving) {
      g.visible = false;
      introCar.visible = false;
      frame.hero.active = false;
      return;
    }

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
    <>
      <mesh ref={roomMesh} geometry={screen} material={room} renderOrder={ORDER.room} frustumCulled={false} visible={false} />
      {/* Heading π: the model's front (+Z) points north (−Z), up the screen. */}
      <group ref={group} rotation-y={Math.PI} visible={false}>
        <mesh geometry={model.body} material={body} castShadow={shadows} receiveShadow renderOrder={ORDER.car} />
        <mesh geometry={model.trim} material={trim} castShadow={shadows} renderOrder={ORDER.car} />
        <mesh geometry={tail} material={lamp} position={[0, 0, -model.nominalLength / 2 - 0.03]} renderOrder={ORDER.car} />
      </group>
    </>
  );
}
