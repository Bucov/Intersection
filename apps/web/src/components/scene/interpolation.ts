import type { SessionStatus, SignalPhase, SimulationSnapshot, VehicleState, VehicleType } from "@intersection/shared";

export interface RenderVehicle {
  id: string;
  type: VehicleType;
  x: number;
  z: number;
  heading: number;
  lengthM: number;
  braking: boolean;
  emergency: boolean;
}

export interface SceneSample {
  count: number;
  phase: SignalPhase | null;
  clearanceBlocked: boolean;
  simulationTimeMs: number;
}

/** Anything the 3D scene can draw: the home preview or the active session. */
export interface SceneFeed {
  sample(now: number, out: RenderVehicle[]): SceneSample;
}

interface Frame {
  simTime: number;
  receivedAt: number;
  vehicles: Map<string, VehicleState>;
  phase: SignalPhase;
  clearanceBlocked: boolean;
}

const MAX_FRAMES = 4;

/**
 * Turns discrete authoritative snapshots into smooth motion.
 *
 * Rendering runs about one snapshot interval behind the newest frame and only
 * interpolates between frames it has received: it never simulates arrivals,
 * signal changes or motion beyond the latest snapshot. Pauses and disconnects
 * freeze the clock on the latest authoritative state.
 */
export class SnapshotInterpolator implements SceneFeed {
  private frames: Frame[] = [];
  private key: string | null = null;
  private status: SessionStatus = "ready";
  private speed = 1;
  private live = true;
  private clock: { t: number; at: number } | null = null;

  push(snapshot: SimulationSnapshot, receivedAt: number) {
    const key = `${snapshot.sessionId}:${snapshot.generation}`;
    if (key !== this.key) {
      this.frames = [];
      this.clock = null;
      this.key = key;
    }
    const last = this.frames[this.frames.length - 1];
    if (last && snapshot.simulationTimeMs < last.simTime) return;
    const frame: Frame = {
      simTime: snapshot.simulationTimeMs,
      receivedAt,
      vehicles: new Map(snapshot.vehicles.map(v => [v.id, v])),
      phase: snapshot.signal.phase,
      clearanceBlocked: snapshot.signal.clearanceBlockedByVehicles,
    };
    if (last && last.simTime === snapshot.simulationTimeMs) this.frames[this.frames.length - 1] = frame;
    else this.frames.push(frame);
    if (this.frames.length > MAX_FRAMES) this.frames.shift();
    this.status = snapshot.status;
    this.speed = snapshot.config.speedMultiplier;
  }

  /** Stop advancing when the data is not live (reconnecting, error). */
  setLive(live: boolean) {
    this.live = live;
  }

  clear() {
    this.frames = [];
    this.clock = null;
    this.key = null;
  }

  get latestSimTime(): number {
    return this.frames[this.frames.length - 1]?.simTime ?? 0;
  }

  /** The render clock as of the last sampled frame (for HUD countdowns). */
  get currentTime(): number {
    return this.clock?.t ?? this.latestSimTime;
  }

  /** Smoothed render time in simulation ms. */
  renderTime(now: number): number {
    const latest = this.frames[this.frames.length - 1];
    if (!latest) return 0;
    const oldest = this.frames[0];
    const advancing = this.status === "running" && this.live;
    let target = latest.simTime;
    if (advancing && this.frames.length > 1) {
      const previous = this.frames[this.frames.length - 2];
      const interval = Math.min(2000, Math.max(50, latest.simTime - previous.simTime));
      target = latest.simTime - interval + (now - latest.receivedAt) * this.speed;
    }
    if (!this.clock) this.clock = { t: target, at: now };
    const dt = Math.max(0, Math.min(250, now - this.clock.at));
    const predicted = advancing ? this.clock.t + dt * this.speed : this.clock.t;
    // Converge on the target in roughly 150 ms without stepping backwards.
    let t = predicted + (target - predicted) * Math.min(1, dt / 150);
    if (advancing) t = Math.max(t, this.clock.t);
    t = Math.min(latest.simTime, Math.max(oldest.simTime, t));
    this.clock = { t, at: now };
    return t;
  }

  sample(now: number, out: RenderVehicle[]): SceneSample {
    const t = this.renderTime(now);
    const frames = this.frames;
    if (!frames.length) return { count: 0, phase: null, clearanceBlocked: false, simulationTimeMs: 0 };
    let b = frames.length - 1;
    while (b > 0 && frames[b - 1].simTime >= t) b--;
    const to = frames[b];
    const from = b > 0 ? frames[b - 1] : to;
    const span = to.simTime - from.simTime;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (t - from.simTime) / span)) : 1;
    let count = 0;
    for (const vehicle of to.vehicles.values()) {
      const previous = from.vehicles.get(vehicle.id);
      const slot = out[count] ?? (out[count] = { id: "", type: "car", x: 0, z: 0, heading: 0, lengthM: 4.5, braking: false, emergency: false });
      slot.id = vehicle.id;
      slot.type = vehicle.type;
      slot.lengthM = vehicle.lengthM;
      slot.emergency = vehicle.emergency;
      slot.heading = vehicle.headingRadians;
      if (previous) {
        slot.x = previous.position.x + (vehicle.position.x - previous.position.x) * alpha;
        slot.z = previous.position.z + (vehicle.position.z - previous.position.z) * alpha;
        slot.heading = lerpAngle(previous.headingRadians, vehicle.headingRadians, alpha);
      } else {
        slot.x = vehicle.position.x;
        slot.z = vehicle.position.z;
      }
      slot.braking = vehicle.accelerationMps2 < -0.6 || vehicle.velocityMps < 0.5;
      count++;
    }
    // The signal shown matches the frame being drawn, so lights and cars agree.
    const signalFrame = alpha < 1 ? from : to;
    return { count, phase: signalFrame.phase, clearanceBlocked: signalFrame.clearanceBlocked, simulationTimeMs: t };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
