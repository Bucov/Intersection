import type { ServerEvent } from "@intersection/shared";
import { STEP_MS, type MockSimulation } from "./engine";

const MAX_STEPS_PER_TICK = 50;

/**
 * Advances a mock simulation in real time (scaled by its speed multiplier) and
 * publishes the events it emits plus one broadcast snapshot per tick, mimicking
 * the backend's snapshot stream. Paused sessions emit nothing, as in the contract.
 */
export class MockDriver {
  private readonly sim: MockSimulation;
  private readonly publish: (events: ServerEvent[]) => void;
  private readonly tickMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private accumulator = 0;

  constructor(sim: MockSimulation, publish: (events: ServerEvent[]) => void, tickMs = 100) {
    this.sim = sim;
    this.publish = publish;
    this.tickMs = tickMs;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start() {
    if (this.timer) return;
    this.last = performance.now();
    this.accumulator = 0;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Publish anything emitted outside a tick (controls, injections) immediately. */
  flush() {
    const events = this.sim.drain();
    if (events.length) this.publish(events);
  }

  private tick() {
    const now = performance.now();
    const elapsed = now - this.last;
    this.last = now;
    if (this.sim.status === "running") {
      this.accumulator += elapsed * this.sim.speedMultiplier;
      let steps = Math.floor(this.accumulator / STEP_MS);
      this.accumulator -= steps * STEP_MS;
      if (steps > MAX_STEPS_PER_TICK) {
        // A throttled background tab must not fast-forward the demo on return.
        steps = MAX_STEPS_PER_TICK;
        this.accumulator = 0;
      }
      if (steps > 0) {
        this.sim.advance(steps, STEP_MS / this.sim.speedMultiplier);
        this.sim.broadcastSnapshot();
      }
    } else {
      this.accumulator = 0;
    }
    this.flush();
  }
}
