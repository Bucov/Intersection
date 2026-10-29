export type TrafficLightState =
  | "red"
  | "yellow"
  | "green";

export interface Vehicle {
  id: string;
  x: number;
  y: number;
  speed: number;
  direction: "north" | "south" | "east" | "west";
}

export interface IntersectionState {
  tick: number;
  vehicles: Vehicle[];
  lights: Record<string, TrafficLightState>;
}

export type ServerMessage =
  | {
      type: "simulation:state";
      payload: IntersectionState;
    }
  | {
      type: "simulation:error";
      payload: { message: string };
    };

export type ClientMessage =
  | { type: "simulation:start" }
  | { type: "simulation:pause" }
  | { type: "simulation:reset" };