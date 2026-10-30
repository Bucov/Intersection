import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import type { VehicleType } from "@intersection/shared";
import { buildBrakeLights, buildLightBarHalf, buildVehicleModels } from "./geometry";
import { useFrameData } from "./frameData";

const TYPES: readonly VehicleType[] = ["car", "van", "bus_truck", "ambulance", "police"];
const CAPACITY: Record<VehicleType, number> = { car: 200, van: 60, bus_truck: 30, ambulance: 12, police: 12 };
const TOTAL = Object.values(CAPACITY).reduce((a, b) => a + b, 0);
const EMERGENCY_CAPACITY = CAPACITY.ambulance + CAPACITY.police;
const BRAKE_Y: Record<VehicleType, number> = { car: 0, van: 0.12, bus_truck: 0.25, ambulance: 0.12, police: 0 };

// Muted model-kit paints; colour is a stable function of the vehicle ID.
const CAR_PAINT = ["#d8d9da", "#a3a8ad", "#5d6166", "#2c2f33", "#45597a", "#7c3a33", "#b7a98e", "#5a7462", "#8a8f96"].map(c => new Color(c));
const VAN_PAINT = ["#e2e3e4", "#c9cbcd", "#9aa0a6", "#4b5560"].map(c => new Color(c));
const BUS_PAINT = ["#c79d3a", "#3f6386", "#b8bcc2"].map(c => new Color(c));
const WHITE = new Color(1, 1, 1);
const BRAKE_ON = new Color(4, 0.25, 0.2);
const BRAKE_OFF = new Color(0.32, 0.05, 0.05);
const BAR_DARK = new Color(0.14, 0.15, 0.18);
const BAR_BLUE = new Color(0.45, 0.85, 4.5);
const BAR_RED = new Color(4.2, 0.35, 0.4);

function paintFor(id: string, type: VehicleType): Color {
  if (type === "ambulance" || type === "police") return WHITE;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const palette = type === "car" ? CAR_PAINT : type === "van" ? VAN_PAINT : BUS_PAINT;
  return palette[Math.abs(hash) % palette.length];
}

export function Vehicles({ shadows }: { shadows: boolean }) {
  const frame = useFrameData();
  const models = useMemo(() => buildVehicleModels(), []);
  const brakeGeometry = useMemo(() => buildBrakeLights(), []);
  const barLeftGeometry = useMemo(() => buildLightBarHalf(-1), []);
  const barRightGeometry = useMemo(() => buildLightBarHalf(1), []);
  const bodyMaterial = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.04, transparent: true }), []);
  const trimMaterial = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.08, transparent: true }), []);
  const lampMaterial = useMemo(() => new MeshBasicMaterial({ toneMapped: false, transparent: true }), []);

  const bodies = useRef<Partial<Record<VehicleType, InstancedMesh | null>>>({});
  const trims = useRef<Partial<Record<VehicleType, InstancedMesh | null>>>({});
  const brakes = useRef<InstancedMesh>(null);
  const barsLeft = useRef<InstancedMesh>(null);
  const barsRight = useRef<InstancedMesh>(null);

  const scratch = useMemo(() => ({
    matrix: new Matrix4(),
    local: new Matrix4(),
    position: new Vector3(),
    scale: new Vector3(),
    quaternion: new Quaternion(),
    up: new Vector3(0, 1, 0),
    counts: { car: 0, van: 0, bus_truck: 0, ambulance: 0, police: 0 } as Record<VehicleType, number>,
    lastDebug: 0,
  }), []);

  // Allocate instance colour buffers before the first frame so shaders compile once.
  useLayoutEffect(() => {
    const meshes = [...Object.values(bodies.current), brakes.current, barsLeft.current, barsRight.current];
    for (const mesh of meshes) if (mesh && !mesh.instanceColor) mesh.setColorAt(0, WHITE);
  }, []);

  useEffect(() => () => {
    bodyMaterial.dispose();
    trimMaterial.dispose();
    lampMaterial.dispose();
  }, [bodyMaterial, trimMaterial, lampMaterial]);

  useFrame(({ clock }) => {
    const s = scratch;
    for (const type of TYPES) s.counts[type] = 0;
    let brakeCount = 0;
    let barCount = 0;
    const flashA = Math.floor(clock.elapsedTime * 3.2) % 2 === 0;

    for (let i = 0; i < frame.sample.count; i++) {
      const v = frame.vehicles[i];
      const index = s.counts[v.type];
      if (index >= CAPACITY[v.type]) continue;
      s.counts[v.type] = index + 1;
      const model = models[v.type];
      s.position.set(v.x, 0, v.z);
      s.quaternion.setFromAxisAngle(s.up, v.heading);
      s.scale.set(1, 1, v.lengthM / model.nominalLength);
      s.matrix.compose(s.position, s.quaternion, s.scale);
      const body = bodies.current[v.type];
      const trim = trims.current[v.type];
      if (!body || !trim) continue;
      body.setMatrixAt(index, s.matrix);
      body.setColorAt(index, paintFor(v.id, v.type));
      trim.setMatrixAt(index, s.matrix);

      if (brakes.current && brakeCount < TOTAL) {
        s.local.makeScale(model.width / 1.8, 1, 1).setPosition(0, BRAKE_Y[v.type], -model.nominalLength / 2 - 0.03);
        brakes.current.setMatrixAt(brakeCount, s.local.premultiply(s.matrix));
        brakes.current.setColorAt(brakeCount, v.braking ? BRAKE_ON : BRAKE_OFF);
        brakeCount++;
      }
      if (model.lightBarY !== null && barsLeft.current && barsRight.current && barCount < EMERGENCY_CAPACITY) {
        s.local.makeTranslation(0, model.lightBarY, model.lightBarZ).premultiply(s.matrix);
        barsLeft.current.setMatrixAt(barCount, s.local);
        barsRight.current.setMatrixAt(barCount, s.local);
        barsLeft.current.setColorAt(barCount, v.emergency ? (flashA ? BAR_BLUE : BAR_DARK) : BAR_DARK);
        barsRight.current.setColorAt(barCount, v.emergency ? (flashA ? BAR_DARK : BAR_RED) : BAR_DARK);
        barCount++;
      }
    }

    for (const type of TYPES) {
      for (const mesh of [bodies.current[type], trims.current[type]]) {
        if (!mesh) continue;
        mesh.count = s.counts[type];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    for (const [mesh, count] of [[brakes.current, brakeCount], [barsLeft.current, barCount], [barsRight.current, barCount]] as const) {
      if (!mesh) continue;
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Fade the whole fleet while the scene swaps between the preview and a session.
    bodyMaterial.opacity = frame.fade;
    trimMaterial.opacity = frame.fade;
    lampMaterial.opacity = frame.fade;
    bodyMaterial.depthWrite = frame.fade > 0.98;
    trimMaterial.depthWrite = frame.fade > 0.98;

    // Lightweight observability for tests and debugging (no React involved).
    const now = clock.elapsedTime;
    if (frame.debugElement && now - s.lastDebug > 0.5) {
      s.lastDebug = now;
      frame.debugElement.dataset.vehicles = String(frame.sample.count);
      frame.debugElement.dataset.simTime = String(Math.round(frame.sample.simulationTimeMs));
      frame.debugElement.dataset.phase = frame.sample.phase ?? "";
    }
  });

  return (
    <group>
      {TYPES.map(type => (
        <group key={type}>
          <instancedMesh
            ref={mesh => { bodies.current[type] = mesh; }}
            args={[models[type].body, bodyMaterial, CAPACITY[type]]}
            castShadow={shadows}
            receiveShadow
            frustumCulled={false}
          />
          <instancedMesh
            ref={mesh => { trims.current[type] = mesh; }}
            args={[models[type].trim, trimMaterial, CAPACITY[type]]}
            castShadow={shadows}
            frustumCulled={false}
          />
        </group>
      ))}
      <instancedMesh ref={brakes} args={[brakeGeometry, lampMaterial, TOTAL]} frustumCulled={false} />
      <instancedMesh ref={barsLeft} args={[barLeftGeometry, lampMaterial, EMERGENCY_CAPACITY]} frustumCulled={false} />
      <instancedMesh ref={barsRight} args={[barRightGeometry, lampMaterial, EMERGENCY_CAPACITY]} frustumCulled={false} />
    </group>
  );
}
