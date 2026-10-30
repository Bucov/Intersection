import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { buildAsphalt, buildLots, buildMarkings, buildPlanting, buildSidewalks, PLANTING_WIDTH, ROAD_HALF, SIDEWALK_WIDTH } from "./geometry";
import type { SceneTheme } from "./sceneTheme";

/** Deterministic pseudo-random in [0, 1) so the model looks the same on every load. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

interface Placement {
  x: number;
  z: number;
  scale: number;
  height?: number;
  width?: number;
  depth?: number;
}

function treePlacements(): Placement[] {
  const trees: Placement[] = [];
  const offset = ROAD_HALF + SIDEWALK_WIDTH + PLANTING_WIDTH / 2;
  let n = 0;
  for (let d = 16; d <= 118; d += 11) {
    for (const side of [-1, 1]) {
      for (const sign of [-1, 1]) {
        n++;
        const jitter = (hash01(n) - 0.5) * 2.4;
        const scale = 0.8 + hash01(n + 50) * 0.55;
        trees.push({ x: side * (offset + (hash01(n + 9) - 0.5) * 0.8), z: sign * (d + jitter), scale });
        trees.push({ x: sign * (d + jitter), z: side * (offset + (hash01(n + 19) - 0.5) * 0.8), scale: scale * 0.95 });
      }
    }
  }
  return trees;
}

function buildingPlacements(): Placement[] {
  const blocks: Placement[] = [];
  let n = 0;
  // Only on the far (north) side of the default views, so blocks frame rather than occlude.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      n++;
      const width = 9 + hash01(n) * 7;
      const depth = 8 + hash01(n + 3) * 6;
      blocks.push({
        x: sx * (24 + i * 24 + hash01(n + 7) * 6),
        z: -(26 + depth / 2 + hash01(n + 11) * 14),
        scale: 1,
        width,
        depth,
        height: 3 + hash01(n + 13) * 6,
      });
    }
  }
  return blocks;
}

function useInstances(ref: React.RefObject<InstancedMesh | null>, placements: Placement[], kind: "trunk" | "canopy" | "block") {
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    placements.forEach((p, i) => {
      if (kind === "trunk") {
        position.set(p.x, 1.1 * p.scale, p.z);
        scale.set(p.scale, p.scale, p.scale);
      } else if (kind === "canopy") {
        position.set(p.x, 3.1 * p.scale, p.z);
        scale.set(p.scale, p.scale * 1.15, p.scale);
        rotation.setFromAxisAngle(new Vector3(0, 1, 0), hash01(i + 77) * Math.PI);
      } else {
        position.set(p.x, (p.height ?? 6) / 2 + 0.16, p.z);
        scale.set(p.width ?? 10, p.height ?? 6, p.depth ?? 10);
      }
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [ref, placements, kind]);
}

/** Static model: base, roads, sidewalks, markings and a sparse backdrop. */
export function Diorama({ theme }: { theme: SceneTheme }) {
  const asphalt = useMemo(() => buildAsphalt(), []);
  const sidewalks = useMemo(() => buildSidewalks(), []);
  const planting = useMemo(() => buildPlanting(), []);
  const lots = useMemo(() => buildLots(), []);
  const markings = useMemo(() => buildMarkings(), []);
  const trees = useMemo(() => treePlacements(), []);
  const blocks = useMemo(() => buildingPlacements(), []);
  const trunks = useRef<InstancedMesh>(null);
  const canopies = useRef<InstancedMesh>(null);
  const buildings = useRef<InstancedMesh>(null);
  useInstances(trunks, trees, "trunk");
  useInstances(canopies, trees, "canopy");
  useInstances(buildings, blocks, "block");

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[700, 700]} />
        <meshStandardMaterial color={theme.base} roughness={1} />
      </mesh>
      <mesh geometry={asphalt} receiveShadow>
        <meshStandardMaterial color={theme.asphalt} roughness={0.95} />
      </mesh>
      <mesh geometry={sidewalks} receiveShadow castShadow>
        <meshStandardMaterial color={theme.sidewalk} roughness={0.9} />
      </mesh>
      <mesh geometry={lots} receiveShadow>
        <meshStandardMaterial color={theme.base} roughness={1} />
      </mesh>
      <mesh geometry={planting} receiveShadow>
        <meshStandardMaterial color={theme.planting} roughness={1} />
      </mesh>
      <mesh geometry={markings} receiveShadow>
        <meshStandardMaterial color={theme.marking} roughness={0.75} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.22, 2.2, 6]} />
        <meshStandardMaterial color={theme.building} roughness={1} />
      </instancedMesh>
      <instancedMesh ref={canopies} args={[undefined, undefined, trees.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[1.7, 0]} />
        <meshStandardMaterial color={theme.foliage} roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={buildings} args={[undefined, undefined, blocks.length]} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={theme.building} roughness={0.9} />
      </instancedMesh>
    </group>
  );
}
