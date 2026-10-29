import { DEFAULT_SIGNAL_TIMING, SCENARIO_CATALOG, type ControllerMode, type ScenarioId } from "@intersection/shared";
import { applySnapshot, createSessionState, reduceEvent, type SessionState } from "@/state/session";
import { MockSimulation } from "@/transport/mock/engine";

/** Run a scenario through the mock engine and the reducer: realistic normalized state for UI tests. */
export function sessionStateAfter(scenarioId: ScenarioId, seconds: number, mode: ControllerMode = "ai", seed = 5): SessionState {
  let wall = Date.parse("2026-10-29T18:00:00Z");
  const scenario = SCENARIO_CATALOG.find(s => s.id === scenarioId)!;
  const sim = new MockSimulation({ sessionId: `fixture-${scenarioId}`, mode, scenarioId, parameters: scenario.defaults, signalTiming: DEFAULT_SIGNAL_TIMING, seed, wallClock: () => wall });
  let state = applySnapshot(createSessionState("mock", sim.sessionId), sim.snapshot(), 0);
  if (seconds > 0) {
    sim.control("start", 0);
    for (const event of sim.drain()) state = reduceEvent(state, event, 0).state;
    for (let i = 0; i < seconds * 10; i++) {
      wall += 100;
      sim.advance(1);
      if (i % 2 === 1) sim.broadcastSnapshot();
      for (const event of sim.drain()) state = reduceEvent(state, event, 0).state;
    }
  }
  return state;
}
