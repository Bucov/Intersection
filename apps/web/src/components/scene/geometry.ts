import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, PlaneGeometry, Shape, ShapeGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DEFAULT_GEOMETRY, type Approach, type VehicleType } from "@intersection/shared";

/*
 * World layout follows the contract: X east, north is −Z, Y up, metres.
 * One 3.5 m lane per direction; stop lines 10 m from the centre.
 */
export const LANE_WIDTH = DEFAULT_GEOMETRY.laneWidthM;
export const ROAD_HALF = LANE_WIDTH;
export const STOP_LINE = DEFAULT_GEOMETRY.stopLineDistanceM;
export const ARM_LENGTH = 230;
export const SIDEWALK_WIDTH = 3.2;
/** Planting strip behind the sidewalk; beyond it are dark, unbuilt lots. */
export const PLANTING_WIDTH = 3.4;
export const CORNER_RADIUS = 4.5;
export const CURB_HEIGHT = 0.16;
const MARK_Y = 0.022;

/** Forward travel vector and right-hand vector for vehicles arriving from `approach`. */
export const APPROACH_FRAME: Record<Approach, { forward: [number, number]; right: [number, number]; laneX: number; laneZ: number }> = {
  north: { forward: [0, 1], right: [-1, 0], laneX: -DEFAULT_GEOMETRY.laneCenterOffsetM, laneZ: 0 },
  south: { forward: [0, -1], right: [1, 0], laneX: DEFAULT_GEOMETRY.laneCenterOffsetM, laneZ: 0 },
  east: { forward: [-1, 0], right: [0, -1], laneX: 0, laneZ: -DEFAULT_GEOMETRY.laneCenterOffsetM },
  west: { forward: [1, 0], right: [0, 1], laneX: 0, laneZ: DEFAULT_GEOMETRY.laneCenterOffsetM },
};

/** Point on an approach lane `distance` metres before the centre (positive = upstream). */
export function laneFrameAt(approach: Approach, distance: number, lateral = 0): [number, number] {
  const f = APPROACH_FRAME[approach];
  return [
    f.laneX - f.forward[0] * distance + f.right[0] * lateral,
    f.laneZ - f.forward[1] * distance + f.right[1] * lateral,
  ];
}

function flatPlane(width: number, depth: number, x: number, z: number, y: number, rotationY = 0): BufferGeometry {
  const plane = new PlaneGeometry(width, depth);
  plane.rotateX(-Math.PI / 2);
  if (rotationY) plane.rotateY(rotationY);
  plane.translate(x, y, z);
  return plane;
}

/** Asphalt cross: one geometry for both roads. */
export function buildAsphalt(): BufferGeometry {
  return mergeGeometries([
    flatPlane(ROAD_HALF * 2, ARM_LENGTH * 2, 0, 0, 0.006),
    flatPlane(ARM_LENGTH * 2, ROAD_HALF * 2, 0, 0, 0.012),
  ]);
}

function quadrantShape(inset: number, radius: number): Shape {
  // Built in shape space for the +X / −Z quadrant (shape y maps to world −z).
  const start = ROAD_HALF + inset;
  const end = ARM_LENGTH;
  const r = Math.max(0.5, radius);
  const shape = new Shape();
  shape.moveTo(start + r, start);
  shape.lineTo(end, start);
  shape.lineTo(end, end);
  shape.lineTo(start, end);
  shape.lineTo(start, start + r);
  shape.absarc(start + r, start + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function fourQuadrants(build: () => BufferGeometry): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = build();
    g.rotateY((Math.PI / 2) * i);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/** Raised sidewalks with rounded curbs at the four corners. */
export function buildSidewalks(): BufferGeometry {
  return fourQuadrants(() => {
    const g = new ExtrudeGeometry(quadrantShape(0, CORNER_RADIUS), { depth: CURB_HEIGHT, bevelEnabled: false, curveSegments: 10 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
}

/** L-shaped planting strips that follow the roads behind the sidewalks. */
export function buildPlanting(): BufferGeometry {
  return fourQuadrants(() => {
    const strip = quadrantShape(SIDEWALK_WIDTH, Math.max(1, CORNER_RADIUS - SIDEWALK_WIDTH * 0.6));
    strip.holes.push(quadrantShape(SIDEWALK_WIDTH + PLANTING_WIDTH, 1));
    const g = new ShapeGeometry(strip, 8);
    g.rotateX(-Math.PI / 2);
    g.translate(0, CURB_HEIGHT + 0.012, 0);
    return g;
  });
}

/** Dark lots filling each block behind the planting strips. */
export function buildLots(): BufferGeometry {
  return fourQuadrants(() => {
    const g = new ShapeGeometry(quadrantShape(SIDEWALK_WIDTH + PLANTING_WIDTH, 1), 2);
    g.rotateX(-Math.PI / 2);
    g.translate(0, CURB_HEIGHT + 0.01, 0);
    return g;
  });
}

function arrowShape(): Shape {
  // Straight-ahead arrow, pointing toward +y in shape space.
  const s = new Shape();
  const shaft = 0.16;
  const head = 0.55;
  s.moveTo(-shaft, -2.4);
  s.lineTo(shaft, -2.4);
  s.lineTo(shaft, 0.6);
  s.lineTo(head, 0.6);
  s.lineTo(0, 2.1);
  s.lineTo(-head, 0.6);
  s.lineTo(-shaft, 0.6);
  s.closePath();
  return s;
}

/** Lane markings: centre lines, stop lines, zebra crossings and direction arrows. */
export function buildMarkings(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const along = (x: number, z: number, width: number, length: number, ns: boolean) =>
    parts.push(flatPlane(ns ? width : length, ns ? length : width, x, z, MARK_Y));

  for (const sign of [-1, 1]) {
    // Solid centre line near the junction, dashed beyond.
    along(0, sign * (STOP_LINE + 0.5 + 15), 0.15, 30, true);
    along(sign * (STOP_LINE + 0.5 + 15), 0, 0.15, 30, false);
    for (let d = STOP_LINE + 33; d < ARM_LENGTH; d += 9) {
      along(0, sign * (d + 1.5), 0.13, 3, true);
      along(sign * (d + 1.5), 0, 0.13, 3, false);
    }
    // Edge lines.
    for (const edge of [-1, 1]) {
      const off = edge * (ROAD_HALF - 0.25);
      along(off, sign * (STOP_LINE + 0.5 + (ARM_LENGTH - STOP_LINE) / 2), 0.12, ARM_LENGTH - STOP_LINE - 1, true);
      along(sign * (STOP_LINE + 0.5 + (ARM_LENGTH - STOP_LINE) / 2), off, 0.12, ARM_LENGTH - STOP_LINE - 1, false);
    }
  }

  // Stop lines across each inbound lane, just upstream of the contract line.
  for (const approach of ["north", "south", "east", "west"] as const) {
    const [x, z] = laneFrameAt(approach, STOP_LINE + 0.25);
    const ns = approach === "north" || approach === "south";
    parts.push(flatPlane(ns ? LANE_WIDTH - 0.2 : 0.45, ns ? 0.45 : LANE_WIDTH - 0.2, x, z, MARK_Y + 0.001));
  }

  // Zebra crossings between the stop lines and the junction.
  const crossNear = 6.2;
  const crossFar = 9.2;
  const crossMid = (crossNear + crossFar) / 2;
  const crossLen = crossFar - crossNear;
  for (let i = -3; i <= 3; i++) {
    const offset = i * 0.95;
    for (const sign of [-1, 1]) {
      parts.push(flatPlane(0.5, crossLen, offset, sign * crossMid, MARK_Y));
      parts.push(flatPlane(crossLen, 0.5, sign * crossMid, offset, MARK_Y));
    }
  }

  // Straight-ahead arrows on each inbound lane.
  const arrow = arrowShape();
  for (const approach of ["north", "south", "east", "west"] as const) {
    for (const distance of [24, 52]) {
      const g = new ShapeGeometry(arrow);
      g.rotateX(-Math.PI / 2);
      // Shape +y now points to world −z; rotate (0, −1) onto the travel direction.
      const [fx, fz] = APPROACH_FRAME[approach].forward;
      g.rotateY(Math.atan2(-fx, -fz));
      const [x, z] = laneFrameAt(approach, distance);
      g.translate(x, MARK_Y, z);
      parts.push(g);
    }
  }
  return mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)));
}

// -----------------------------------------------------------------------------
// Vehicles: local forward is +Z, centred on the vehicle's geometric centre at y = 0.

export interface VehicleModel {
  /** Paintable parts; vertex colours are multiplied by the per-instance colour. */
  body: BufferGeometry;
  /** Glass, tyres, bumpers and lamps; never tinted. */
  trim: BufferGeometry;
  nominalLength: number;
  width: number;
  /** Roof height for the emergency light bar (null when the type has none). */
  lightBarY: number | null;
  lightBarZ: number;
}

function coloured(geometry: BufferGeometry, color: Color): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.deleteAttribute("uv");
  return g;
}

function box(w: number, h: number, l: number, x: number, y: number, z: number, color: Color): BufferGeometry {
  const g = new BoxGeometry(w, h, l);
  g.translate(x, y, z);
  return coloured(g, color);
}

function wheels(width: number, length: number, radius: number, axleInset: number, color: Color, rearAxles = 1): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const zFront = length / 2 - axleInset;
  const zRear = -length / 2 + axleInset;
  const axles = [zFront, zRear, ...(rearAxles > 1 ? [zRear + radius * 2.3] : [])];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      const g = new CylinderGeometry(radius, radius, 0.26, 12);
      g.rotateZ(Math.PI / 2);
      g.translate(side * (width / 2 - 0.1), radius, z);
      parts.push(coloured(g, color));
    }
  }
  return parts;
}

const WHITE = new Color(1, 1, 1);
const GLASS = new Color("#1d2630");
const TYRE = new Color("#121315");
const TRIM = new Color("#2b2e33");
const LAMP = new Color("#f3ecd2");
const STRIPE_RED = new Color("#c4372f");
const POLICE_BLUE = new Color("#1f3d73");

export function buildVehicleModels(): Record<VehicleType, VehicleModel> {
  const merge = (parts: BufferGeometry[]) => mergeGeometries(parts);

  const car = (length: number, width: number, bodyColor: Color, accent?: Color): VehicleModel => ({
    body: merge([
      box(width, 0.62, length, 0, 0.58, 0, bodyColor),
      box(width - 0.18, 0.06, length * 0.47, 0, 1.4, -0.12, bodyColor),
      ...(accent ? [box(width + 0.02, 0.2, length * 0.62, 0, 0.66, -0.05, accent)] : []),
    ]),
    trim: merge([
      box(width - 0.14, 0.48, length * 0.5, 0, 1.14, -0.12, GLASS),
      box(width + 0.02, 0.16, 0.12, 0, 0.36, length / 2 - 0.02, TRIM),
      box(width + 0.02, 0.16, 0.12, 0, 0.36, -length / 2 + 0.02, TRIM),
      box(0.36, 0.12, 0.05, -(width / 2 - 0.3), 0.74, length / 2 + 0.01, LAMP),
      box(0.36, 0.12, 0.05, width / 2 - 0.3, 0.74, length / 2 + 0.01, LAMP),
      ...wheels(width, length, 0.33, 0.85, TYRE),
    ]),
    nominalLength: length,
    width,
    lightBarY: null,
    lightBarZ: 0,
  });

  const van: VehicleModel = {
    body: merge([
      box(1.95, 0.95, 5.4, 0, 0.78, 0, WHITE),
      box(1.95, 0.95, 4.2, 0, 1.72, -0.6, WHITE),
    ]),
    trim: merge([
      box(1.9, 0.62, 0.06, 0, 1.62, 1.52, GLASS),
      box(1.97, 0.5, 1.0, 0, 1.68, 1.0, GLASS),
      box(1.97, 0.16, 0.12, 0, 0.38, 2.69, TRIM),
      box(0.34, 0.12, 0.05, -0.7, 0.86, 2.71, LAMP),
      box(0.34, 0.12, 0.05, 0.7, 0.86, 2.71, LAMP),
      ...wheels(1.95, 5.4, 0.36, 0.95, TYRE),
    ]),
    nominalLength: 5.4,
    width: 1.95,
    lightBarY: null,
    lightBarZ: 0,
  };

  const bus: VehicleModel = {
    body: merge([box(2.5, 2.55, 11, 0, 1.72, 0, WHITE)]),
    trim: merge([
      box(2.52, 0.95, 9.6, 0, 2.15, -0.45, GLASS),
      box(2.3, 1.3, 0.06, 0, 2.0, 5.52, GLASS),
      box(2.52, 0.22, 0.12, 0, 0.55, 5.5, TRIM),
      box(0.4, 0.14, 0.05, -0.9, 0.85, 5.53, LAMP),
      box(0.4, 0.14, 0.05, 0.9, 0.85, 5.53, LAMP),
      ...wheels(2.5, 11, 0.5, 1.8, TYRE, 2),
    ]),
    nominalLength: 11,
    width: 2.5,
    lightBarY: null,
    lightBarZ: 0,
  };

  const ambulance: VehicleModel = {
    body: merge([
      box(2.1, 1.25, 1.7, 0, 0.98, 2.15, WHITE),
      box(2.1, 2.05, 4.3, 0, 1.4, -0.85, WHITE),
      box(2.12, 0.28, 4.32, 0, 1.25, -0.85, STRIPE_RED),
      box(2.12, 0.2, 1.72, 0, 0.92, 2.15, STRIPE_RED),
    ]),
    trim: merge([
      box(1.96, 0.55, 0.06, 0, 1.36, 3.0, GLASS),
      box(2.12, 0.42, 0.9, 0, 1.36, 2.35, GLASS),
      box(2.12, 0.16, 0.12, 0, 0.4, 2.99, TRIM),
      box(0.34, 0.12, 0.05, -0.75, 0.82, 3.02, LAMP),
      box(0.34, 0.12, 0.05, 0.75, 0.82, 3.02, LAMP),
      ...wheels(2.1, 6, 0.38, 1.0, TYRE),
    ]),
    nominalLength: 6,
    width: 2.1,
    lightBarY: 1.69,
    lightBarZ: 2.2,
  };

  const police = car(4.9, 1.85, WHITE, POLICE_BLUE);
  police.lightBarY = 1.47;
  police.lightBarZ = -0.25;

  return {
    car: car(4.5, 1.8, WHITE),
    van,
    bus_truck: bus,
    ambulance,
    police,
  };
}

/** Rear brake-lamp pair for a nominal 1.8 m wide vehicle; instances scale it to the real width. */
export function buildBrakeLights(): BufferGeometry {
  return mergeGeometries([
    box(0.34, 0.13, 0.05, -0.62, 0.76, 0, WHITE),
    box(0.34, 0.13, 0.05, 0.62, 0.76, 0, WHITE),
  ]);
}

/** One half of a roof light bar (left or right); instances flash them alternately. */
export function buildLightBarHalf(side: -1 | 1): BufferGeometry {
  return box(0.62, 0.14, 0.32, side * 0.36, 0.07, 0, WHITE);
}
