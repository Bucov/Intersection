// Starter protocol kept for source compatibility. New consumers use the v1 exports.
export * from "./schemas/domain.js";
export * from "./schemas/coordination.js";
export * from "./schemas/session.js";
export * from "./schemas/events.js";
export * from "./schemas/api.js";
export * from "./contracts/defaults.js";
export * from "./contracts/routes.js";

/** @deprecated Starter protocol; use SignalState and signalLights instead. */
export type TrafficLightState =
  | "red"
  | "yellow"
  | "green";

/** @deprecated Starter 2D shape; use VehicleState (meters, X/Z ground plane). */
export interface Vehicle {
  id: string;
  x: number;
  y: number;
  speed: number;
  direction: "north" | "south" | "east" | "west";
}

/** @deprecated Use SimulationSnapshot. */
export interface IntersectionState {
  tick: number;
  vehicles: Vehicle[];
  lights: Record<string, TrafficLightState>;
}

/** @deprecated Use ServerEvent and ServerEventSchema. */
export type ServerMessage =
  | {
      type: "simulation:state";
      payload: IntersectionState;
    }
  | {
      type: "simulation:error";
      payload: { message: string };
    };

/** @deprecated Use ClientEvent and ClientEventSchema. */
export type ClientMessage =
  | { type: "simulation:start" }
  | { type: "simulation:pause" }
  | { type: "simulation:reset" };

export * from './decisionStats.js';
