import type { ArrivalRates, DemandPresetId, Geometry, ScenarioDefinition, ScenarioParameters, SignalTiming, VehicleMix } from "../schemas/domain.js";
import type { ConfidencePolicy } from "../schemas/coordination.js";

export const DEFAULT_SIGNAL_TIMING = {
  minimumGreenMs: 8000, maximumGreenMs: 45000, yellowMs: 3000, allRedMs: 2000, fixedGreenMs: 30000,
} as const satisfies SignalTiming;
export const DEFAULT_GEOMETRY = {
  id: "four-way-straight-v1", laneWidthM: 3.5, laneCenterOffsetM: 1.75,
  spawnDistanceM: 120, stopLineDistanceM: 10, occupancyHalfExtentM: 8, despawnDistanceM: 140,
} as const satisfies Geometry;
export const DEFAULT_VEHICLE_MIX = {
  car: 0.845, van: 0.1, bus_truck: 0.05, ambulance: 0.003, police: 0.002,
} as const satisfies VehicleMix;
export const DEFAULT_CONFIDENCE_POLICY = { highThreshold: 0.85, mediumThreshold: 0.6 } as const satisfies ConfidencePolicy;
export const DEMAND_PRESETS = {
  light: { north: 100, south: 100, east: 80, west: 80 },
  normal: { north: 240, south: 240, east: 180, west: 180 },
  "rush-hour": { north: 520, south: 520, east: 170, west: 170 },
  "reverse-rush": { north: 170, south: 170, east: 520, west: 520 },
  "heavy-all-round": { north: 420, south: 420, east: 420, west: 420 },
} as const satisfies Record<DemandPresetId, ArrivalRates>;

const normal: ScenarioParameters = {
  durationMs: 300_000, demandPreset: "normal", arrivalRatesVehPerHour: DEMAND_PRESETS.normal,
  vehicleMix: DEFAULT_VEHICLE_MIX, policeRespondingProbability: 0.2,
  initialQueueByApproach: { north: 0, south: 0, east: 0, west: 0 },
  randomEvents: { enabled: false, intervalMs: 600_000, surgeProbability: 0.15, congestionProbability: 0.1 },
  initialGreen: "NS_GREEN", scheduledEvents: [],
};

/** Declarative demo inputs only. No scenario runner or simulation is implemented here. */
export const SCENARIO_CATALOG: readonly ScenarioDefinition[] = [
  {
    id: "normal-traffic", name: "Normal Traffic", description: "Moderate demand on all four approaches.",
    demonstrationCondition: "Balanced input rates; realized counts vary with seed.", supportedModes: ["traditional", "ai"],
    defaults: normal, guarantee: "scheduled_input",
  },
  {
    id: "rush-hour", name: "Rush Hour", description: "Higher North/South arrival intensity.",
    demonstrationCondition: "NS rates exceed EW rates throughout the run.", supportedModes: ["traditional", "ai"],
    defaults: { ...normal, demandPreset: "rush-hour", arrivalRatesVehPerHour: DEMAND_PRESETS["rush-hour"] }, guarantee: "scheduled_input",
  },
  {
    id: "reverse-rush", name: "Reverse Rush", description: "Higher East/West arrival intensity.",
    demonstrationCondition: "EW rates exceed NS rates throughout the run.", supportedModes: ["traditional", "ai"],
    defaults: { ...normal, demandPreset: "reverse-rush", arrivalRatesVehPerHour: DEMAND_PRESETS["reverse-rush"] }, guarantee: "scheduled_input",
  },
  {
    id: "sudden-surge", name: "Sudden Surge", description: "A scheduled North arrival-rate increase after one minute.",
    demonstrationCondition: "North arrival rate multiplies by 4 at 60 s for 120 s.", supportedModes: ["traditional", "ai"],
    defaults: { ...normal, scheduledEvents: [{ id: "surge-north", atSimMs: 60_000, event: { type: "demand_surge", approach: "north", multiplier: 4, durationMs: 120_000 } }] }, guarantee: "scheduled_input",
  },
  {
    id: "ambulance-priority", name: "Ambulance Priority", description: "A responding North ambulance is requested while NS is red.",
    demonstrationCondition: "EW starts green; North ambulance request at time zero, without random chance.", supportedModes: ["traditional", "ai"],
    defaults: { ...normal, initialGreen: "EW_GREEN", scheduledEvents: [{ id: "ambulance-north", atSimMs: 0, event: { type: "emergency", approach: "north", vehicleType: "ambulance", responding: true } }] }, guarantee: "scheduled_input",
  },
  {
    id: "competing-priorities", name: "Competing Priorities", description: "North emergency demand competes with a preloaded EW queue.",
    demonstrationCondition: "Twelve cars start queued East and twelve West; North ambulance request at time zero.", supportedModes: ["traditional", "ai"],
    defaults: { ...normal, initialGreen: "EW_GREEN", initialQueueByApproach: { north: 0, south: 0, east: 12, west: 12 }, scheduledEvents: [{ id: "competing-ambulance", atSimMs: 0, event: { type: "emergency", approach: "north", vehicleType: "ambulance", responding: true } }] }, guarantee: "scheduled_input",
  },
  {
    id: "simultaneous-proposals", name: "Simultaneous Proposals", description: "Queues in both groups and a shared inference trigger.",
    demonstrationCondition: "Both mock agents request their own group at the 8 s decision boundary. Live proposals remain model-dependent.", supportedModes: ["ai"],
    defaults: { ...normal, initialQueueByApproach: { north: 12, south: 12, east: 12, west: 12 }, scheduledEvents: [{ id: "parallel-trigger", atSimMs: 8000, event: { type: "decision_boundary", reason: "simultaneous_proposals" } }] }, guarantee: "mock_only",
  },
  {
    id: "jev-uncertainty", name: "JEV Uncertainty", description: "A valid competing-proposal fixture with explicitly injected low confidence.",
    demonstrationCondition: "Mock JEV returns a low-confidence distribution at the scheduled conflict; no live confidence is fabricated.", supportedModes: ["ai"],
    defaults: { ...normal, initialQueueByApproach: { north: 12, south: 12, east: 12, west: 12 }, scheduledEvents: [
      { id: "uncertainty-fault", atSimMs: 0, event: { type: "provider_fault", provider: "jev", fault: "low_confidence", durationMs: 60_000 } },
      { id: "uncertainty-trigger", atSimMs: 8000, event: { type: "decision_boundary", reason: "ambiguous_arbitration" } },
    ] }, guarantee: "mock_only",
  },
  {
    id: "jev-failure", name: "JEV Failure", description: "An explicit JEV timeout exercises safe fallback.",
    demonstrationCondition: "The next arbitration during the first 60 s times out; the mock conflict trigger guarantees an attempted arbitration.", supportedModes: ["ai"],
    defaults: { ...normal, initialQueueByApproach: { north: 12, south: 12, east: 12, west: 12 }, scheduledEvents: [
      { id: "timeout-fault", atSimMs: 0, event: { type: "provider_fault", provider: "jev", fault: "timeout", durationMs: 60_000 } },
      { id: "failure-trigger", atSimMs: 8000, event: { type: "decision_boundary", reason: "simultaneous_proposals" } },
    ] }, guarantee: "mock_only",
  },
];
