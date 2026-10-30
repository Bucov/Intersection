import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CanvasTexture, Color, Group, MeshBasicMaterial, MeshStandardMaterial, SpriteMaterial, type Texture } from "three";
import { signalLights, type Approach } from "@intersection/shared";
import { APPROACH_FRAME, LANE_WIDTH, STOP_LINE, laneFrameAt } from "./geometry";
import { useFrameData } from "./frameData";
import type { SceneTheme } from "./sceneTheme";

const APPROACHES: readonly Approach[] = ["north", "south", "east", "west"];
const LAMPS = ["red", "yellow", "green"] as const;
type Lamp = (typeof LAMPS)[number];
const HEAD_SCALE = 2.2;

function glowTexture(): Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

interface LampSet {
  lamp: Record<Lamp, MeshStandardMaterial>;
  glow: Record<Lamp, SpriteMaterial>;
  strip: MeshBasicMaterial;
  zone: MeshBasicMaterial;
}

/** Signal heads, stop-line strips and (in AI mode) the agents' observation zones. */
export function TrafficSignals({ theme }: { theme: SceneTheme }) {
  const frame = useFrameData();
  const texture = useMemo(() => glowTexture(), []);
  const colors = useMemo(() => ({ red: theme.signalRed, yellow: theme.signalAmber, green: theme.signalGreen }), [theme]);
  const groups = useMemo(() => {
    const make = (zoneColor: Color): LampSet => ({
      lamp: {
        red: new MeshStandardMaterial({ color: colors.red.clone().multiplyScalar(0.18), emissive: colors.red, emissiveIntensity: 0, roughness: 0.4 }),
        yellow: new MeshStandardMaterial({ color: colors.yellow.clone().multiplyScalar(0.18), emissive: colors.yellow, emissiveIntensity: 0, roughness: 0.4 }),
        green: new MeshStandardMaterial({ color: colors.green.clone().multiplyScalar(0.18), emissive: colors.green, emissiveIntensity: 0, roughness: 0.4 }),
      },
      glow: {
        red: new SpriteMaterial({ map: texture, color: colors.red, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
        yellow: new SpriteMaterial({ map: texture, color: colors.yellow, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
        green: new SpriteMaterial({ map: texture, color: colors.green, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
      },
      strip: new MeshBasicMaterial({ color: colors.red.clone(), toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false }),
      zone: new MeshBasicMaterial({ color: zoneColor, toneMapped: false, transparent: true, opacity: 0, depthWrite: false }),
    });
    return { NS: make(theme.groupNS), EW: make(theme.groupEW) };
  }, [colors, texture, theme]);
  const zoneOpacity = useRef(0);
  const heads = useRef<Group>(null);

  useFrame((_, delta) => {
    const lights = frame.sample.phase ? signalLights(frame.sample.phase) : null;
    for (const [group, set] of [["NS", groups.NS], ["EW", groups.EW]] as const) {
      const state = lights ? (group === "NS" ? lights.north : lights.east) : null;
      for (const lamp of LAMPS) {
        const on = state === lamp;
        set.lamp[lamp].emissiveIntensity = on ? 3.2 : 0.04;
        set.glow[lamp].opacity = on ? 0.85 : 0;
      }
      set.strip.color.copy(state ? colors[state] : theme.marking);
      set.strip.opacity = state ? 0.95 : 0.15;
    }
    // Observation zones fade in only while an AI session is on screen.
    const target = frame.mode === "ai" ? 0.13 : 0;
    zoneOpacity.current += (target - zoneOpacity.current) * Math.min(1, delta * 3);
    groups.NS.zone.opacity = zoneOpacity.current;
    groups.EW.zone.opacity = zoneOpacity.current;
  });

  return (
    <group>
      <group ref={heads}>
        {APPROACHES.map(approach => {
          const group = approach === "north" || approach === "south" ? groups.NS : groups.EW;
          const [x, z] = laneFrameAt(approach, STOP_LINE + 1.4, LANE_WIDTH / 2 + 1.5);
          const [fx, fz] = APPROACH_FRAME[approach].forward;
          const facing = Math.atan2(-fx, -fz);
          return (
            <group key={approach} position={[x, 0, z]} rotation-y={facing}>
              <mesh position={[0, 2.2 * HEAD_SCALE, 0]} castShadow>
                <cylinderGeometry args={[0.09, 0.11, 4.4 * HEAD_SCALE, 8]} />
                <meshStandardMaterial color={theme.signalHousing} roughness={0.6} />
              </mesh>
              <group position={[0, 4.4 * HEAD_SCALE, 0.18]} scale={HEAD_SCALE}>
                <mesh castShadow>
                  <boxGeometry args={[0.44, 1.2, 0.32]} />
                  <meshStandardMaterial color={theme.signalHousing} roughness={0.55} />
                </mesh>
                {LAMPS.map((lamp, i) => (
                  <group key={lamp} position={[0, 0.37 - i * 0.37, 0.165]}>
                    <mesh material={group.lamp[lamp]}>
                      <circleGeometry args={[0.135, 20]} />
                    </mesh>
                    <sprite material={group.glow[lamp]} scale={[0.95, 0.95, 0.95]} position={[0, 0, 0.05]} />
                  </group>
                ))}
              </group>
            </group>
          );
        })}
      </group>

      {APPROACHES.map(approach => {
        const ns = approach === "north" || approach === "south";
        const set = ns ? groups.NS : groups.EW;
        const [sx, sz] = laneFrameAt(approach, STOP_LINE + 0.95);
        const [zx, zz] = laneFrameAt(approach, STOP_LINE + 1.5 + 30);
        return (
          <group key={approach}>
            <mesh position={[sx, 0.03, sz]} rotation-x={-Math.PI / 2} material={set.strip}>
              <planeGeometry args={ns ? [LANE_WIDTH - 0.35, 0.6] : [0.6, LANE_WIDTH - 0.35]} />
            </mesh>
            <mesh position={[zx, 0.028, zz]} rotation-x={-Math.PI / 2} material={set.zone}>
              <planeGeometry args={ns ? [LANE_WIDTH - 0.5, 60] : [60, LANE_WIDTH - 0.5]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
