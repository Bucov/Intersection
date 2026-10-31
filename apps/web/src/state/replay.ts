import type { SignalPhase, SimulationSnapshot, VehicleType } from "@intersection/shared";
import type { RenderVehicle, SceneSample } from "@/components/scene/interpolation";
import { createStore } from "./store";

/**
 * Rewind is a replay of what this browser received. The authoritative
 * simulation is never rewound: while the session is paused the visitor can
 * scrub back through recorded snapshots, and resuming returns to live.
 */
export interface ReplayState {
  /** Simulation time being replayed; null means the live view. */
  time: number | null;
}

export function createReplayStore() {
  return createStore<ReplayState>({ time: null });
}

interface Recorded {
  id: string;
  type: VehicleType;
  x: number;
  z: number;
  heading: number;
  lengthM: number;
  braking: boolean;
  emergency: boolean;
}

interface HistoryFrame {
  t: number;
  phase: SignalPhase;
  clearanceBlocked: boolean;
  vehicles: Map<string, Recorded>;
}

/** Keep one frame per this much simulation time; the scene interpolates between them. */
const MIN_SPACING_MS = 200;
/** About ten simulated minutes at that spacing. */
const MAX_FRAMES = 3000;

/** Snapshots of the current session generation, for scrubbing back while paused. */
export class SessionHistory {
  private frames: HistoryFrame[] = [];
  private key: string | null = null;

  push(snapshot: SimulationSnapshot) {
    const key = `${snapshot.sessionId}:${snapshot.generation}`;
    if (key !== this.key) {
      this.frames = [];
      this.key = key;
    }
    const t = snapshot.simulationTimeMs;
    const last = this.frames[this.frames.length - 1];
    if (last && t < last.t) return;
    const frame: HistoryFrame = {
      t,
      phase: snapshot.signal.phase,
      clearanceBlocked: snapshot.signal.clearanceBlockedByVehicles,
      vehicles: new Map(snapshot.vehicles.map(v => [v.id, {
        id: v.id,
        type: v.type,
        x: v.position.x,
        z: v.position.z,
        heading: v.headingRadians,
        lengthM: v.lengthM,
        braking: v.accelerationMps2 < -0.6 || v.velocityMps < 0.5,
        emergency: v.emergency,
      }])),
    };
    // The newest frame always tracks the latest snapshot, so the live edge is exact.
    if (last && t - (this.frames[this.frames.length - 2]?.t ?? -Infinity) <= MIN_SPACING_MS) this.frames[this.frames.length - 1] = frame;
    else this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.splice(0, this.frames.length - MAX_FRAMES);
  }

  clear() {
    this.frames = [];
    this.key = null;
  }

  /** Earliest and latest recorded simulation time, or null before the first snapshot. */
  get range(): { start: number; end: number } | null {
    if (!this.frames.length) return null;
    return { start: this.frames[0].t, end: this.frames[this.frames.length - 1].t };
  }

  /** Vehicles and signal at time `t`, interpolated between the recorded frames around it. */
  sample(t: number, out: RenderVehicle[]): SceneSample {
    const frames = this.frames;
    if (!frames.length) return { count: 0, phase: null, clearanceBlocked: false, simulationTimeMs: t };
    let lo = 0;
    let hi = frames.length - 1;
    if (t <= frames[0].t) hi = 0;
    else if (t >= frames[hi].t) lo = hi;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].t <= t) lo = mid;
        else hi = mid;
      }
    }
    const from = frames[lo];
    const to = frames[hi];
    const span = to.t - from.t;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (t - from.t) / span)) : 1;
    let count = 0;
    for (const v of to.vehicles.values()) {
      const previous = from.vehicles.get(v.id);
      // A vehicle that had not yet arrived at `from` appears once it has.
      if (!previous && alpha < 0.5 && from !== to) continue;
      const slot = out[count] ?? (out[count] = { id: "", type: "car", x: 0, z: 0, heading: 0, lengthM: 4.5, braking: false, emergency: false });
      slot.id = v.id;
      slot.type = v.type;
      slot.lengthM = v.lengthM;
      slot.emergency = v.emergency;
      slot.braking = v.braking;
      if (previous) {
        slot.x = previous.x + (v.x - previous.x) * alpha;
        slot.z = previous.z + (v.z - previous.z) * alpha;
        slot.heading = previous.heading + (v.heading - previous.heading) * alpha;
      } else {
        slot.x = v.x;
        slot.z = v.z;
        slot.heading = v.heading;
      }
      count++;
    }
    const signal = alpha < 1 ? from : to;
    return { count, phase: signal.phase, clearanceBlocked: signal.clearanceBlocked, simulationTimeMs: t };
  }

  /** The recorded signal phase at `t` (for the HUD while replaying). */
  phaseAt(t: number): SignalPhase | null {
    const frames = this.frames;
    if (!frames.length) return null;
    let lo = 0;
    let hi = frames.length - 1;
    if (t >= frames[hi].t) return frames[hi].phase;
    if (t <= frames[0].t) return frames[0].phase;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= t) lo = mid;
      else hi = mid;
    }
    return frames[lo].phase;
  }
}
