// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNAL_TIMING, SCENARIO_CATALOG, type ServerEvent, type SimulationSnapshot } from "@intersection/shared";
import { MockSimulation } from "@/transport/mock/engine";
import { agentVerdict, applySnapshot, createSessionState, latestCycle, reduceEvent, type SessionState } from "./session";

function engine(scenarioId: "simultaneous-proposals" | "normal-traffic" = "simultaneous-proposals") {
  let wall = Date.parse("2026-10-29T18:00:00Z");
  const scenario = SCENARIO_CATALOG.find(s => s.id === scenarioId)!;
  const sim = new MockSimulation({ sessionId: "s1", mode: "ai", scenarioId, parameters: scenario.defaults, signalTiming: DEFAULT_SIGNAL_TIMING, seed: 5, wallClock: () => wall });
  return {
    sim,
    run(seconds: number, snapshots = true): ServerEvent[] {
      const events: ServerEvent[] = [];
      for (let i = 0; i < seconds * 10; i++) {
        wall += 100;
        sim.advance(1);
        if (snapshots && i % 2 === 1) sim.broadcastSnapshot();
        events.push(...sim.drain());
      }
      return events;
    },
  };
}

function baseline(snapshot: SimulationSnapshot): SessionState {
  return applySnapshot(createSessionState("mock", snapshot.sessionId), snapshot, 0);
}

function feed(state: SessionState, events: ServerEvent[]) {
  let resyncs = 0;
  for (const event of events) {
    const result = reduceEvent(state, event, 0);
    state = result.state;
    if (result.resync) resyncs++;
  }
  return { state, resyncs };
}

describe("session reducer", () => {
  it("applies an initial snapshot as the baseline", () => {
    const { sim } = engine();
    const state = baseline(sim.snapshot());
    expect(state.sync).toBe("live");
    expect(state.cursor).toBe(sim.latestSequence);
    expect(state.transcript[0].title).toBe("Session ready");
    expect(state.snapshot?.vehicles).toHaveLength(48);
  });

  it("follows a live stream into proposals, arbitration and decisions", () => {
    const e = engine();
    let state = baseline(e.sim.snapshot());
    e.sim.control("start", 0);
    const events = [...e.sim.drain(), ...e.run(25)];
    ({ state } = feed(state, events));
    expect(state.cursor).toBe(e.sim.latestSequence);
    expect(state.sync).toBe("live");
    const cycle = state.cycles.find(c => c.arbitration?.status === "completed");
    expect(cycle).toBeDefined();
    expect(cycle!.proposals["agent-a"]).toBeDefined();
    expect(cycle!.proposals["agent-b"]).toBeDefined();
    const verdicts = [agentVerdict(cycle!, "agent-a").kind, agentVerdict(cycle!, "agent-b").kind];
    expect(verdicts).toContain("accepted");
    expect(state.timeline.some(b => b.lane === "agent-a")).toBe(true);
    expect(state.timeline.some(b => b.lane === "jev")).toBe(true);
    expect(state.series.length).toBeGreaterThan(20);
    expect(state.transcript.some(t => t.kind === "proposal")).toBe(true);
    expect(latestCycle(state)).not.toBeNull();
  });

  it("ignores duplicates and other sessions", () => {
    const e = engine();
    let state = baseline(e.sim.snapshot());
    e.sim.control("start", 0);
    const events = [...e.sim.drain(), ...e.run(3)];
    ({ state } = feed(state, events));
    const before = state;
    const incremental = events.filter(ev => ev.type !== "simulation.snapshot");
    const { state: after, resyncs } = feed(state, [incremental[incremental.length - 1], incremental[incremental.length - 2]]);
    expect(resyncs).toBe(0);
    expect(after).toBe(before);
    const foreign = { ...events[events.length - 1], sessionId: "other", sequence: state.cursor + 1 } as ServerEvent;
    expect(reduceEvent(state, foreign).state).toBe(state);
  });

  it("stops on a sequence gap and resumes from a checkpoint with the same sequence", () => {
    const e = engine();
    let state = baseline(e.sim.snapshot());
    e.sim.control("start", 0);
    // No broadcast snapshots here: every sequence number belongs to an incremental event.
    const events = [...e.sim.drain(), ...e.run(6, false)];
    const half = Math.floor(events.length / 2);
    ({ state } = feed(state, events.slice(0, half)));
    const gapped = feed(state, events.slice(half + 1));
    expect(gapped.resyncs).toBe(1);
    expect(gapped.state.sync).toBe("resyncing");
    expect(gapped.state.historyGap).toBe(true);
    expect(gapped.state.cursor).toBe(state.cursor);
    // The requested checkpoint may reuse the latest issued sequence.
    const checkpoint = e.sim.checkpointEvent();
    const recovered = reduceEvent(gapped.state, checkpoint).state;
    expect(recovered.sync).toBe("live");
    expect(recovered.cursor).toBe(checkpoint.sequence);
    expect(recovered.transcript.at(-1)?.title).toBe("Resynchronized");
    expect(reduceEvent(recovered, checkpoint).state.cursor).toBe(checkpoint.sequence);
  });

  it("drops generation-scoped state on reset but keeps the transcript", () => {
    const e = engine();
    let state = baseline(e.sim.snapshot());
    e.sim.control("start", 0);
    ({ state } = feed(state, [...e.sim.drain(), ...e.run(20)]));
    const transcriptLength = state.transcript.length;
    expect(state.cycles.length).toBeGreaterThan(0);
    e.sim.control("reset", 0);
    ({ state } = feed(state, e.sim.drain()));
    expect(state.generation).toBe(1);
    expect(state.cycles).toHaveLength(0);
    expect(state.timeline).toHaveLength(0);
    expect(state.series).toHaveLength(1);
    expect(state.status).toBe("ready");
    expect(state.transcript.length).toBe(transcriptLength + 1);
    expect(state.transcript.at(-1)?.title).toBe("Reset to generation 1");
  });

  it("shows late old-generation telemetry without applying it", () => {
    const e = engine();
    let state = baseline(e.sim.snapshot());
    e.sim.control("start", 0);
    ({ state } = feed(state, [...e.sim.drain(), ...e.run(3)]));
    e.sim.control("reset", 0);
    ({ state } = feed(state, e.sim.drain()));
    const late: ServerEvent = {
      protocolVersion: 1, eventId: "late-1", correlationId: "g0-decision-9", sessionId: "s1", generation: 0,
      stateVersion: state.snapshot!.stateVersion, sequence: state.cursor + 1, simulationTimeMs: 0,
      wallTime: new Date().toISOString(), source: "jev", provenance: "mock", summary: "Late result",
      type: "simulation.error", payload: { code: "INTERNAL_ERROR", message: "late", retryable: false, issues: [] },
    };
    const next = reduceEvent(state, late).state;
    expect(next.lastError).toBeNull();
    expect(next.transcript.at(-1)?.previousGeneration).toBe(true);
    expect(next.cursor).toBe(late.sequence);
  });

  it("asks for a checkpoint when an event comes from a future generation", () => {
    const e = engine();
    const state = baseline(e.sim.snapshot());
    const future = { ...e.sim.checkpointEvent(), type: "simulation.metrics", payload: e.sim.currentMetrics(), generation: 3, sequence: state.cursor + 1 } as ServerEvent;
    const result = reduceEvent(state, future);
    expect(result.resync).toBe(true);
    expect(result.state.sync).toBe("resyncing");
  });

  it("rejects a stale snapshot older than the cursor", () => {
    const e = engine();
    const first = e.sim.snapshot();
    e.sim.control("start", 0);
    e.run(2);
    const later = e.sim.snapshot();
    const state = applySnapshot(baseline(first), later);
    expect(applySnapshot(state, first)).toBe(state);
  });
});
