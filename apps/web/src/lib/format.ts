import type { Approach, ArbitrationChoice, GreenPhase, MovementGroup, SignalPhase, VehicleType } from "@intersection/shared";

/** Simulation clock, e.g. `2:05`. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Simulation timestamp with tenths, e.g. `2:05.3`. */
export function formatTimestamp(ms: number): string {
  const tenths = Math.floor((Math.max(0, ms) % 1000) / 100);
  return `${formatClock(ms)}.${tenths}`;
}

export function formatSeconds(ms: number | null, digits = 1): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(digits)} s`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatRate(vehPerHour: number): string {
  return `${Math.round(vehPerHour).toLocaleString("en-US")} veh/h`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatSpeed(multiplier: number): string {
  return `${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}×`;
}

export const GROUP_NAME: Record<MovementGroup, string> = { NS: "North/South", EW: "East/West" };

export function groupOfPhase(phase: SignalPhase): MovementGroup | null {
  if (phase.startsWith("NS_")) return "NS";
  if (phase.startsWith("EW_")) return "EW";
  return null;
}

export function phaseName(phase: SignalPhase | GreenPhase | "HOLD"): string {
  switch (phase) {
    case "NS_GREEN": return "North/South green";
    case "NS_YELLOW": return "North/South yellow";
    case "EW_GREEN": return "East/West green";
    case "EW_YELLOW": return "East/West yellow";
    case "ALL_RED": return "All red";
    case "HOLD": return "Hold current phase";
  }
}

export function approachName(approach: Approach): string {
  return approach.charAt(0).toUpperCase() + approach.slice(1);
}

export function vehicleTypeName(type: VehicleType): string {
  switch (type) {
    case "car": return "Car";
    case "van": return "Van";
    case "bus_truck": return "Bus or truck";
    case "ambulance": return "Ambulance";
    case "police": return "Police car";
  }
}

export function choiceName(choice: ArbitrationChoice): string {
  switch (choice) {
    case "GRANT_A": return "Grant Agent A";
    case "GRANT_B": return "Grant Agent B";
    case "DEFER": return "Defer";
  }
}

export function humanize(value: string): string {
  const text = value.replaceAll("_", " ").replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
