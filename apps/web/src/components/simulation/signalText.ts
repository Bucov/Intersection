import type { ControllerStatus, SignalState, SignalTiming } from "@intersection/shared";

export interface Countdown {
  primary: string;
  secondary: string | null;
  /** Compact form for the one-line phone readout, which already names the phase. */
  short: string;
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
    if (signal.clearanceBlockedByVehicles) return { primary: "All red, held", secondary: "Vehicles are still inside the junction", short: "held" };
    return { primary: `All red ⋅ ${secs(signal.earliestEndAtSimMs - now)}`, secondary: "Clearance before the next green", short: `${secs(signal.earliestEndAtSimMs - now)} left` };
  }
  if (signal.phase.endsWith("_YELLOW")) {
    return { primary: `Yellow ⋅ ${secs(signal.earliestEndAtSimMs - now)}`, secondary: "Then all red", short: `${secs(signal.earliestEndAtSimMs - now)} left` };
  }
  if (controller?.activeController === "fixed_time") {
    const left = secs(signal.phaseStartedAtSimMs + timing.fixedGreenMs - now);
    return { primary: `Switches in ${left}`, secondary: `Fixed ${timing.fixedGreenMs / 1000} s green`, short: `${left} left` };
  }
  const minLeft = signal.earliestEndAtSimMs - now;
  const maxLeft = (signal.latestEndAtSimMs ?? now) - now;
  return {
    primary: minLeft > 0 ? `Minimum green ⋅ ${secs(minLeft)} left` : `Green for ${secs(elapsed)}`,
    secondary: `Must change within ${secs(maxLeft)}`,
    short: minLeft > 0 ? `at least ${secs(minLeft)}` : `for ${secs(elapsed)}`,
  };
}
