import type { ControllerStatus, SignalState, SignalTiming } from "@intersection/shared";

export interface Countdown {
  primary: string;
  secondary: string | null;
}

const secs = (ms: number) => `${Math.max(0, ms / 1000).toFixed(1)} s`;

/**
 * What the next signal change looks like, phrased per controller. Fixed-time
 * greens have a known end; adaptive greens only have safety bounds, and an
 * accepted proposal is a schedule, not a promise of an exact switch time.
 */
export function describeCountdown(signal: SignalState, timing: SignalTiming, controller: ControllerStatus | null, now: number): Countdown {
  const elapsed = now - signal.phaseStartedAtSimMs;
  if (signal.phase === "ALL_RED") {
    if (signal.clearanceBlockedByVehicles) return { primary: "All red, held", secondary: "Vehicles are still inside the junction" };
    return { primary: `All red ⋅ ${secs(signal.earliestEndAtSimMs - now)}`, secondary: "Clearance before the next green" };
  }
  if (signal.phase.endsWith("_YELLOW")) {
    return { primary: `Yellow ⋅ ${secs(signal.earliestEndAtSimMs - now)}`, secondary: "Then all red" };
  }
  if (controller?.activeController === "fixed_time") {
    return { primary: `Switches in ${secs(signal.phaseStartedAtSimMs + timing.fixedGreenMs - now)}`, secondary: `Fixed ${timing.fixedGreenMs / 1000} s green` };
  }
  const minLeft = signal.earliestEndAtSimMs - now;
  const maxLeft = (signal.latestEndAtSimMs ?? now) - now;
  return {
    primary: minLeft > 0 ? `Minimum green ⋅ ${secs(minLeft)} left` : `Green for ${secs(elapsed)}`,
    secondary: `Must change within ${secs(maxLeft)}`,
  };
}
