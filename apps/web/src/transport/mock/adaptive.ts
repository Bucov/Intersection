/**
 * Offline-demo stand-in for the AI coordination layer.
 *
 * Two rule-based mock agents (A: North/South, B: East/West) observe only their
 * own approaches and "infer" concurrently with simulated latency. Conflicting
 * proposals go to a deterministic mock arbiter that returns an explicit choice
 * distribution and a separate confidence, then the safety gate validates and
 * commits a schedule. Nothing here calls Gemini or JEV: every output carries
 * `provenance: "mock"` and the UI labels it as simulated.
 */
import type {
  AgentId,
  AgentStatus,
  ArbitrationChoice,
  ArbitrationRecord,
  ArbitrationResult,
  DecisionOutcome,
  FallbackReason,
  GreenPhase,
  InferenceInterval,
  JevStatus,
  MovementGroup,
  SignalPhase,
  TrafficProposal,
} from "@intersection/shared";
import { MOCK_GEMINI_MODEL, MOCK_JEV_MODEL, formatClock, phaseLabel, type FaultKind, type MockSimulation, type PhaseChangeReason } from "./engine";

const GREEN: Record<MovementGroup, GreenPhase> = { NS: "NS_GREEN", EW: "EW_GREEN" };
const OTHER: Record<GreenPhase, GreenPhase> = { NS_GREEN: "EW_GREEN", EW_GREEN: "NS_GREEN" };
const GROUP_NAME: Record<MovementGroup, string> = { NS: "North/South", EW: "East/West" };
const AGENTS: readonly { id: AgentId; letter: "a" | "b"; group: MovementGroup; label: string }[] = [
  { id: "agent-a", letter: "a", group: "NS", label: "Agent A" },
  { id: "agent-b", letter: "b", group: "EW", label: "Agent B" },
];

const CYCLE_INTERVAL_MS = 5000;
const PROPOSAL_TTL_MS = 8000;
const AGENT_DEADLINE_MS = 4000;
const JEV_DEADLINE_MS = 3000;
const STEP_MS = 100;
export const FALLBACK_POLICY = "emergency-fairness-v1" as const;

type Observation = ReturnType<MockSimulation["observe"]>;

interface AgentRun {
  agentId: AgentId;
  correlationId: string;
  letter: "a" | "b";
  group: MovementGroup;
  inferenceId: string;
  startedAtSim: number;
  startedAtWall: number;
  completesAtWall: number;
  fault: FaultKind | null;
  observedVersion: number;
  observation: Observation;
  phaseAtStart: SignalPhase;
  done: boolean;
  proposal: TrafficProposal | null;
}

interface ArbitrationRun {
  record: ArbitrationRecord;
  requestedAtWall: number;
  completesAtWall: number;
  fault: FaultKind | null;
}

interface Cycle {
  index: number;
  correlationId: string;
  runs: AgentRun[];
  arbitration: ArbitrationRun | null;
}

interface AgentState {
  status: AgentStatus["status"];
  lastInference: InferenceInterval | null;
  latestProposalId: string | null;
  requestCount: number;
  message: string | null;
}

export class MockAdaptiveController {
  private readonly sim: MockSimulation;
  private cycle: Cycle | null = null;
  private cycleCount = 0;
  private commandCount = 0;
  private lastCycleEndedAt = Number.NEGATIVE_INFINITY;
  private pendingTrigger: "decision_boundary" | "emergency" | null = null;
  private agents: Record<AgentId, AgentState>;
  private jev: { status: JevStatus["status"]; pendingArbitrationId: string | null; lastArbitration: ArbitrationRecord | null };

  constructor(sim: MockSimulation) {
    this.sim = sim;
    const initial = (): AgentState => ({ status: "idle", lastInference: null, latestProposalId: null, requestCount: 0, message: null });
    this.agents = { "agent-a": initial(), "agent-b": initial() };
    this.jev = { status: "idle", pendingArbitrationId: null, lastArbitration: null };
  }

  agentStatuses(): [AgentStatus, AgentStatus] {
    const build = (id: AgentId): AgentStatus => ({
      agentId: id,
      group: id === "agent-a" ? "NS" : "EW",
      provenance: "mock",
      model: MOCK_GEMINI_MODEL,
      ...this.agents[id],
    });
    return [build("agent-a"), build("agent-b")];
  }

  jevStatus(): JevStatus {
    return { ...this.jev };
  }

  requestCycle(trigger: "decision_boundary" | "emergency") {
    if (this.pendingTrigger !== "decision_boundary") this.pendingTrigger = trigger;
  }

  onGreenStarted() {
    // A new green resets nothing but the trigger window; cycles resume at minimum green.
  }

  /** Called once per physics step while running. */
  update() {
    const T = this.sim.now();
    const wall = this.sim.wallNow();
    if (this.cycle) this.progress(T, wall);
    if (!this.cycle && this.shouldStart(T)) this.start(T, wall);
  }

  /** Pause or completion discards outstanding model work; it can never authorize later actions. */
  discardOutstanding(reason: "paused" | "completed") {
    const cycle = this.cycle;
    if (!cycle) return;
    const T = this.sim.now();
    const wall = this.sim.wallNow();
    const note = reason === "paused" ? "Discarded because the session was paused." : "Discarded because the session completed.";
    for (const run of cycle.runs) {
      if (run.done) continue;
      run.done = true;
      const agent = this.agents[run.agentId];
      agent.status = "idle";
      agent.message = note;
      agent.lastInference = this.interval(run, T, wall, "cancelled");
      this.sim.emit("agent.status", this.agentStatuses()[run.letter === "a" ? 0 : 1], {
        source: run.agentId, provenance: "mock", correlationId: cycle.correlationId,
        summary: `${label(run.agentId)} inference cancelled: ${note.toLowerCase()}`,
      });
    }
    if (cycle.arbitration && cycle.arbitration.record.status === "pending") {
      const record: ArbitrationRecord = {
        ...cycle.arbitration.record,
        status: "stale",
        completedAtWallTime: iso(Math.max(wall, cycle.arbitration.requestedAtWall)),
        fallbackReason: "stale_result",
      };
      this.jev = { status: "idle", pendingArbitrationId: null, lastArbitration: record };
      this.sim.emit("jev.arbitration", record, {
        source: "jev", provenance: "mock", correlationId: cycle.correlationId,
        summary: `JEV arbitration discarded as stale: ${note.toLowerCase()}`,
      });
    }
    for (const run of cycle.runs) {
      if (this.agents[run.agentId].status === "proposal_pending") this.agents[run.agentId].status = "idle";
    }
    this.cycle = null;
    this.lastCycleEndedAt = T;
  }

  // ---------------------------------------------------------------------------

  private shouldStart(T: number): boolean {
    const view = this.sim.signalView();
    if (view.phase !== "NS_GREEN" && view.phase !== "EW_GREEN") return false;
    if (view.pendingSwitch) return false;
    if (this.pendingTrigger) return true;
    if (T < view.earliestEnd) return false;
    return T - this.lastCycleEndedAt >= CYCLE_INTERVAL_MS;
  }

  private start(T: number, wall: number) {
    const index = ++this.cycleCount;
    const gen = this.sim.generation;
    const correlationId = `g${gen}-decision-${index}`;
    const fault = this.sim.activeFault("gemini");
    const phase = this.sim.signalView().phase;
    const runs: AgentRun[] = [];
    for (const agent of AGENTS) {
      const latency = fault === "timeout"
        ? AGENT_DEADLINE_MS + 100
        : fault === "provider_error" || fault === "rate_limit"
          ? this.sim.latencyRng.range(150, 450)
          : agent.letter === "a" ? this.sim.latencyRng.range(650, 1500) : this.sim.latencyRng.range(550, 1400);
      const observation = this.sim.observe(agent.group);
      const run: AgentRun = {
        agentId: agent.id,
        correlationId,
        letter: agent.letter,
        group: agent.group,
        inferenceId: `g${gen}-inference-${agent.letter}-${index}`,
        startedAtSim: T,
        startedAtWall: wall,
        completesAtWall: wall + latency,
        fault,
        observedVersion: this.sim.stateVersion,
        observation,
        phaseAtStart: phase,
        done: false,
        proposal: null,
      };
      runs.push(run);
      const state = this.agents[agent.id];
      state.status = "inference";
      state.requestCount += 1;
      state.message = null;
      state.lastInference = this.interval(run, null, null, "pending");
      this.sim.geminiRequests += 1;
      this.sim.emit("agent.status", this.agentStatuses()[agent.letter === "a" ? 0 : 1], {
        source: agent.id, provenance: "mock", correlationId,
        summary: `${agent.label} observed ${GROUP_NAME[agent.group]} (${describeObservation(observation)}) and started inference`,
      });
    }
    this.cycle = { index, correlationId, runs, arbitration: null };
    this.pendingTrigger = null;
  }

  private progress(T: number, wall: number) {
    const cycle = this.cycle!;
    for (const run of cycle.runs) {
      if (!run.done && wall >= run.completesAtWall) this.finishRun(cycle, run, T, wall);
    }
    if (!cycle.arbitration && cycle.runs.every(r => r.done)) {
      this.resolveProposals(cycle, T, wall);
      return;
    }
    if (cycle.arbitration && cycle.arbitration.record.status === "pending" && wall >= cycle.arbitration.completesAtWall) {
      this.finishArbitration(cycle, T, wall);
    }
  }

  private finishRun(cycle: Cycle, run: AgentRun, T: number, wall: number) {
    run.done = true;
    const state = this.agents[run.agentId];
    const latency = Math.max(0, Math.round(wall - run.startedAtWall));
    this.recordLatency(this.sim.geminiLatency, latency);
    if (run.fault) {
      state.status = "error";
      state.message = faultMessage("Gemini", run.fault, AGENT_DEADLINE_MS);
      state.lastInference = this.interval(run, T, wall, "failed");
      if (run.fault === "timeout") this.sim.deadlineMisses += 1;
      this.sim.emit("agent.status", this.agentStatuses()[run.letter === "a" ? 0 : 1], {
        source: run.agentId, provenance: "mock", correlationId: cycle.correlationId,
        summary: `${label(run.agentId)} inference failed: ${state.message}`,
      });
      return;
    }
    const proposal = this.buildProposal(cycle, run);
    run.proposal = proposal;
    state.status = "proposal_pending";
    state.latestProposalId = proposal.proposalId;
    state.lastInference = this.interval(run, T, wall, "completed");
    this.sim.emit("agent.status", this.agentStatuses()[run.letter === "a" ? 0 : 1], {
      source: run.agentId, provenance: "mock", correlationId: cycle.correlationId,
      summary: `${label(run.agentId)} finished inference in ${latency} ms (simulated)`,
    });
    this.sim.emit("agent.proposal", proposal, {
      source: run.agentId, provenance: "mock", correlationId: cycle.correlationId,
      summary: `${label(run.agentId)} proposes ${phaseLabel(proposal.requestedPhase)} for ${proposal.requestedGreenSeconds} s (${proposal.urgency} urgency)`,
    });
  }

  private buildProposal(cycle: Cycle, run: AgentRun): TrafficProposal {
    const obs = run.observation;
    const own = GREEN[run.group];
    const other = OTHER[own];
    const name = GROUP_NAME[run.group];
    const otherName = GROUP_NAME[run.group === "NS" ? "EW" : "NS"];
    let requestedPhase: GreenPhase;
    let seconds: number;
    let urgency: TrafficProposal["urgency"];
    let rationale: string;
    if (obs.emergencyCount > 0) {
      requestedPhase = own;
      seconds = clampInt(10 + 1.5 * obs.queueLength, 10, 30);
      urgency = "emergency";
      const eta = obs.nearestEmergencyEtaSeconds;
      rationale = `Responding emergency vehicle on ${name}${eta !== null ? `, about ${Math.round(eta)} s from the stop line` : ""}. Requesting ${name} green for ${seconds} s.`;
    } else if (obs.queueLength + obs.approaching === 0) {
      requestedPhase = other;
      seconds = 10;
      urgency = "low";
      rationale = `No vehicles waiting or approaching on ${name}. Yielding the green to ${otherName}.`;
    } else if (run.phaseAtStart === own) {
      requestedPhase = own;
      seconds = clampInt(4 + 2 * obs.queueLength + 1.2 * obs.approaching, 6, 30);
      urgency = obs.queueLength >= 8 ? "high" : "normal";
      rationale = `${name} is green with ${plural(obs.queueLength, "vehicle")} queued and ${obs.approaching} approaching. Requesting ${seconds} s more.`;
    } else {
      requestedPhase = own;
      seconds = clampInt(8 + 2 * obs.queueLength, 10, 40);
      urgency = obs.queueLength >= 8 || obs.maxWaitSeconds >= 40 ? "high" : obs.queueLength > 0 ? "normal" : "low";
      rationale = `${plural(obs.queueLength, "vehicle")} queued on ${name}, longest wait ${Math.round(obs.maxWaitSeconds)} s. Requesting ${name} green for ${seconds} s.`;
    }
    return {
      proposalId: `g${this.sim.generation}-proposal-${run.letter}-${cycle.index}`,
      correlationId: cycle.correlationId,
      agentId: run.agentId,
      sessionId: this.sim.sessionId,
      generation: this.sim.generation,
      stateVersion: run.observedVersion,
      createdAtSimMs: run.startedAtSim,
      expiresAtSimMs: run.startedAtSim + PROPOSAL_TTL_MS,
      createdAtWallTime: iso(run.startedAtWall),
      deadlineWallTime: iso(run.startedAtWall + AGENT_DEADLINE_MS),
      requestedPhase,
      requestedGreenSeconds: seconds,
      urgency,
      observations: {
        queueLength: obs.queueLength,
        maxWaitSeconds: obs.maxWaitSeconds,
        emergencyCount: obs.emergencyCount,
        estimatedArrivalRateVehPerHour: obs.estimatedArrivalRateVehPerHour,
      },
      rationale,
      provenance: "mock",
    };
  }

  private resolveProposals(cycle: Cycle, T: number, wall: number) {
    const proposals = cycle.runs.map(r => r.proposal).filter((p): p is TrafficProposal => p !== null);
    const valid: TrafficProposal[] = [];
    for (const proposal of proposals) {
      if (T >= proposal.expiresAtSimMs) {
        this.decide(cycle, {
          status: "rejected", reason: "expired", requestedPhase: proposal.requestedPhase,
          proposalIds: [proposal.proposalId], arbitrationId: null,
          summary: `Safety gate rejected ${label(proposal.agentId)}'s proposal: it expired before it could be validated (high simulation speed).`,
        });
      } else valid.push(proposal);
    }

    if (valid.length === 2) {
      const [a, b] = valid[0].agentId === "agent-a" ? [valid[0], valid[1]] : [valid[1], valid[0]];
      if (a.requestedPhase === b.requestedPhase) {
        const owner = a.requestedPhase === GREEN.NS ? a : b;
        this.sim.setActiveController("adaptive", null);
        this.commit(cycle, owner.requestedPhase, owner.requestedGreenSeconds, [a.proposalId, b.proposalId], null, "adaptive_command",
          `Agents agree on ${phaseLabel(owner.requestedPhase)}; no arbitration needed.`);
        this.endCycle(T);
        return;
      }
      this.sim.emit("arbitration.conflict", { proposalIds: [a.proposalId, b.proposalId], reason: "mutually_exclusive_phases" }, {
        source: "controller", provenance: "deterministic", correlationId: cycle.correlationId,
        summary: `Conflict: Agent A requests ${phaseLabel(a.requestedPhase)}, Agent B requests ${phaseLabel(b.requestedPhase)}. Both cannot be green.`,
      });
      this.startArbitration(cycle, a, b, T, wall);
      return;
    }

    if (valid.length === 1) {
      const only = valid[0];
      this.sim.setActiveController("adaptive", null);
      this.commit(cycle, only.requestedPhase, only.requestedGreenSeconds, [only.proposalId], null, "adaptive_command",
        `Only ${label(only.agentId)} produced a valid proposal; it goes straight to the safety gate.`);
      this.endCycle(T);
      return;
    }

    const failed = cycle.runs.find(r => r.fault)?.fault ?? null;
    const reason: FallbackReason = failed && failed !== "low_confidence" ? failed : proposals.length ? "deadline_missed" : "no_valid_proposal";
    this.fallback(cycle, null, reason, [], T);
    this.endCycle(T);
  }

  private startArbitration(cycle: Cycle, a: TrafficProposal, b: TrafficProposal, T: number, wall: number) {
    const fault = this.sim.activeFault("jev");
    const view = this.sim.signalView();
    const atMax = view.latestEnd !== null && T >= view.latestEnd - 1000;
    const eligibleChoices: ArbitrationChoice[] = [];
    if (!(atMax && a.requestedPhase === view.phase)) eligibleChoices.push("GRANT_A");
    if (!(atMax && b.requestedPhase === view.phase)) eligibleChoices.push("GRANT_B");
    if (!atMax) eligibleChoices.push("DEFER");
    const record: ArbitrationRecord = {
      arbitrationId: `g${this.sim.generation}-arbitration-${cycle.index}`,
      correlationId: cycle.correlationId,
      sessionId: this.sim.sessionId,
      generation: this.sim.generation,
      stateVersion: this.sim.stateVersion,
      proposalA: a,
      proposalB: b,
      eligibleChoices,
      context: this.context(T),
      requestedAtSimMs: T,
      requestedAtWallTime: iso(wall),
      deadlineWallTime: iso(wall + JEV_DEADLINE_MS),
      completedAtWallTime: null,
      status: "pending",
      result: null,
      fallbackReason: null,
    };
    const latency = fault === "timeout"
      ? JEV_DEADLINE_MS + 100
      : fault === "provider_error" || fault === "rate_limit"
        ? this.sim.latencyRng.range(120, 300)
        : this.sim.latencyRng.range(260, 720);
    cycle.arbitration = { record, requestedAtWall: wall, completesAtWall: wall + latency, fault };
    this.jev = { status: "arbitrating", pendingArbitrationId: record.arbitrationId, lastArbitration: record };
    this.sim.emit("jev.arbitration", record, {
      source: "jev", provenance: "mock", correlationId: cycle.correlationId,
      summary: "JEV arbitration started (mock arbiter, no model call)",
    });
  }

  private finishArbitration(cycle: Cycle, T: number, wall: number) {
    const run = cycle.arbitration!;
    const pending = run.record;
    const latency = Math.max(0, Math.round(wall - run.requestedAtWall));
    this.recordLatency(this.sim.jevLatency, latency);

    if (run.fault && run.fault !== "low_confidence") {
      const record: ArbitrationRecord = { ...pending, status: "failed", completedAtWallTime: iso(wall), fallbackReason: run.fault };
      if (run.fault === "timeout") this.sim.deadlineMisses += 1;
      this.jev = { status: "idle", pendingArbitrationId: null, lastArbitration: record };
      this.sim.emit("jev.arbitration", record, {
        source: "jev", provenance: "mock", correlationId: cycle.correlationId,
        summary: `JEV arbitration failed: ${faultMessage("JEV", run.fault, JEV_DEADLINE_MS)}`,
      });
      this.fallback(cycle, record.arbitrationId, run.fault, [pending.proposalA.proposalId, pending.proposalB.proposalId], T);
      this.endCycle(T);
      return;
    }

    const result = this.score(pending, T, latency, run.fault === "low_confidence");
    const record: ArbitrationRecord = { ...pending, status: "completed", completedAtWallTime: iso(wall), result };
    this.sim.jevConfidence[result.confidenceBand] += 1;
    this.jev = { status: "idle", pendingArbitrationId: null, lastArbitration: record };
    this.sim.emit("jev.arbitration", record, {
      source: "jev", provenance: "mock", correlationId: cycle.correlationId,
      summary: `JEV ${choiceLabel(result.choice)} with ${Math.round(result.confidence * 100)}% confidence (${result.confidenceBand}, mock output)`,
    });

    const ids = [pending.proposalA.proposalId, pending.proposalB.proposalId];
    const chosen = result.choice === "GRANT_A" ? pending.proposalA : result.choice === "GRANT_B" ? pending.proposalB : null;
    if (result.confidenceBand === "low") {
      this.fallback(cycle, record.arbitrationId, "low_confidence", ids, T);
    } else if (result.confidenceBand === "medium" && !this.policyAgrees(chosen)) {
      // Medium confidence adds a deterministic check; when it disagrees the controller defers.
      this.sim.emit("arbitration.fallback", { arbitrationId: record.arbitrationId, reason: "medium_confidence_deferred", selectedPhase: "HOLD", policy: FALLBACK_POLICY }, {
        source: "controller", provenance: "deterministic", correlationId: cycle.correlationId,
        summary: "Medium confidence and the deterministic check disagrees: holding the current phase.",
      });
      this.sim.setActiveController("adaptive", null);
    } else if (chosen) {
      this.sim.setActiveController("adaptive", null);
      this.commit(cycle, chosen.requestedPhase, chosen.requestedGreenSeconds, ids, record.arbitrationId, "adaptive_command",
        `JEV granted ${label(chosen.agentId)}.`);
    } else {
      this.sim.setActiveController("adaptive", null);
    }
    this.endCycle(T);
  }

  /** Deterministic mock arbiter: pressure-based utilities, softmax distribution, separate confidence. */
  private score(record: ArbitrationRecord, T: number, latencyMs: number, lowConfidence: boolean): ArbitrationResult {
    const { ns, ew, currentPhase } = record.context;
    const currentGreen: GreenPhase | null = currentPhase === "NS_GREEN" || currentPhase === "EW_GREEN" ? currentPhase : null;
    const urgencyBonus = { emergency: 8, high: 2, normal: 0.5, low: -1 } as const;
    const pressure = (phase: GreenPhase) => {
      const g = phase === "NS_GREEN" ? ns : ew;
      const sinceServed = g.lastServedAtSimMs === null ? 30 : (T - g.lastServedAtSimMs) / 1000;
      let u = g.queueLength + g.maxWaitSeconds / 8 + g.emergencyCount * 30 + Math.min(sinceServed, 60) / 12;
      if (currentGreen && phase !== currentGreen) u -= 2.5;
      return u;
    };
    const utility: Record<ArbitrationChoice, number> = {
      GRANT_A: pressure(record.proposalA.requestedPhase) + urgencyBonus[record.proposalA.urgency],
      GRANT_B: pressure(record.proposalB.requestedPhase) + urgencyBonus[record.proposalB.urgency],
      DEFER: 1.2,
    };
    const choices = record.eligibleChoices;
    const tau = 2.2;
    const max = Math.max(...choices.map(c => utility[c]));
    let raw = choices.map(c => Math.exp((utility[c] - max) / tau));
    const sum = raw.reduce((a, b) => a + b, 0);
    raw = raw.map(p => p / sum);
    let confidence: number;
    if (lowConfidence) {
      // Injected low-confidence fault: flatten toward uniform and report low confidence.
      raw = raw.map(p => 0.2 * p + 0.8 / choices.length);
      confidence = 0.36 + 0.08 * this.sim.latencyRng.next();
    } else {
      const sorted = choices.map(c => utility[c]).sort((a, b) => b - a);
      const margin = sorted.length > 1 ? sorted[0] - sorted[1] : 6;
      // Close calls land in the medium band; low confidence only appears when injected.
      confidence = 0.6 + 0.38 * Math.tanh(margin / 2.5);
    }
    const probabilities = normalise(choices.map((choice, i) => ({ choice, probability: raw[i] })));
    const choice = probabilities.reduce((best, p) => (p.probability > best.probability ? p : best)).choice;
    confidence = Math.round(confidence * 1000) / 1000;
    const policy = this.sim.confidencePolicy;
    const confidenceBand = confidence >= policy.highThreshold ? "high" : confidence >= policy.mediumThreshold ? "medium" : "low";
    return {
      choice,
      probabilities,
      confidence,
      confidenceBand,
      confidencePolicy: { ...policy },
      model: MOCK_JEV_MODEL,
      modelVersion: null,
      latencyMs,
      provenance: "mock",
    };
  }

  private policyAgrees(chosen: TrafficProposal | null): boolean {
    const policy = this.policy();
    if (!chosen) return policy === "HOLD";
    const phase = this.sim.signalView().phase;
    return policy === chosen.requestedPhase || (policy === "HOLD" && chosen.requestedPhase === phase);
  }

  /** emergency-fairness-v1: emergencies first, then starvation, then clear queue imbalance. */
  private policy(): GreenPhase | "HOLD" {
    const ns = this.sim.observe("NS");
    const ew = this.sim.observe("EW");
    if (ns.emergencyCount > 0 && ew.emergencyCount === 0) return "NS_GREEN";
    if (ew.emergencyCount > 0 && ns.emergencyCount === 0) return "EW_GREEN";
    const view = this.sim.signalView();
    const current: GreenPhase = view.phase === "NS_GREEN" || view.phase === "EW_GREEN" ? view.phase : view.nextGreen;
    const cur = current === "NS_GREEN" ? ns : ew;
    const oth = current === "NS_GREEN" ? ew : ns;
    if (oth.queueLength === 0) return "HOLD";
    if (oth.maxWaitSeconds >= 45 || oth.queueLength > cur.queueLength * 1.5 + 2 || cur.queueLength + cur.approaching === 0) return OTHER[current];
    return "HOLD";
  }

  private fallback(cycle: Cycle, arbitrationId: string | null, reason: FallbackReason, proposalIds: string[], T: number) {
    const selected = this.policy();
    this.sim.emit("arbitration.fallback", { arbitrationId, reason, selectedPhase: selected, policy: FALLBACK_POLICY }, {
      source: "controller", provenance: "deterministic", correlationId: cycle.correlationId,
      summary: `Fallback (${reason.replaceAll("_", " ")}): ${FALLBACK_POLICY} selects ${selected === "HOLD" ? "hold the current phase" : phaseLabel(selected)}.`,
    });
    this.sim.setActiveController("deterministic_fallback", `${reason.replaceAll("_", " ")} at ${formatClock(T)}`);
    if (selected !== "HOLD") {
      this.commit(cycle, selected, 15, proposalIds.slice(0, 2), arbitrationId, "fallback", "Deterministic fallback command.");
    }
  }

  /** Safety gate: validate against the current signal state and commit a schedule exactly once. */
  private commit(cycle: Cycle, target: GreenPhase, seconds: number, proposalIds: string[], arbitrationId: string | null, reason: PhaseChangeReason, context: string) {
    const T = this.sim.now();
    const view = this.sim.signalView();
    const green = view.phase === "NS_GREEN" || view.phase === "EW_GREEN";
    let decision: Omit<DecisionOutcome, "commandId" | "correlationId" | "committedStateVersion" | "scheduledAfterSimMs"> & { scheduledAfterSimMs?: number };
    if (green && target === view.phase) {
      const latest = view.latestEnd!;
      if (view.pendingSwitch) {
        decision = { status: "rejected", reason: "already_scheduled", requestedPhase: target, proposalIds, arbitrationId,
          summary: `${context} Rejected: a change to ${phaseLabel(view.pendingSwitch.target)} is already committed.` };
      } else if (T >= latest - STEP_MS) {
        decision = { status: "rejected", reason: "maximum_green", requestedPhase: target, proposalIds, arbitrationId,
          summary: `${context} Rejected: ${phaseLabel(target)} has reached its maximum green time.` };
      } else {
        const until = Math.min(stepAlign(T + seconds * 1000), latest);
        decision = { status: "accepted", reason: "authorized", requestedPhase: target, proposalIds, arbitrationId, scheduledAfterSimMs: until,
          summary: `${context} Accepted: keep ${phaseLabel(target)} until ${formatClock(until)}${until === latest ? " (maximum green)" : ""}.` };
      }
    } else if (green) {
      if (view.pendingSwitch && view.pendingSwitch.target === target) {
        decision = { status: "unnecessary", reason: "already_scheduled", requestedPhase: target, proposalIds, arbitrationId,
          summary: `${context} ${phaseLabel(target)} is already scheduled.` };
      } else {
        const at = Math.max(T, view.earliestEnd);
        decision = { status: "accepted", reason: "authorized", requestedPhase: target, proposalIds, arbitrationId, scheduledAfterSimMs: at,
          summary: `${context} Accepted: ${phaseLabel(target)} after yellow and all-red clearance${at > T ? `, once minimum green ends at ${formatClock(at)}` : ""}.` };
      }
    } else if (target === view.nextGreen) {
      decision = { status: "unnecessary", reason: "already_scheduled", requestedPhase: target, proposalIds, arbitrationId,
        summary: `${context} ${phaseLabel(target)} is already next after the clearance interval.` };
    } else {
      decision = { status: "rejected", reason: "unsafe_transition", requestedPhase: target, proposalIds, arbitrationId,
        summary: `${context} Rejected: the signal is already clearing toward ${phaseLabel(view.nextGreen)}.` };
    }

    const commandId = `g${this.sim.generation}-command-${++this.commandCount}`;
    let committedStateVersion: number | null = null;
    let scheduledAfterSimMs: number | null = null;
    if (decision.status === "accepted") {
      scheduledAfterSimMs = decision.scheduledAfterSimMs!;
      if (target === view.phase) this.sim.extendGreen(scheduledAfterSimMs, commandId, reason);
      else this.sim.scheduleSwitch(target, scheduledAfterSimMs, commandId, reason);
      committedStateVersion = this.sim.bumpVersion();
    } else if (decision.status === "rejected") {
      this.sim.safetyRejections += 1;
    }
    const payload: DecisionOutcome = {
      commandId,
      correlationId: cycle.correlationId,
      proposalIds: decision.proposalIds,
      arbitrationId: decision.arbitrationId,
      status: decision.status,
      requestedPhase: decision.requestedPhase,
      reason: decision.reason,
      committedStateVersion,
      scheduledAfterSimMs,
      summary: decision.summary.slice(0, 500),
    };
    this.sim.emit("decision.outcome", payload, {
      source: "safety", provenance: "deterministic", correlationId: cycle.correlationId, summary: payload.summary,
    });
  }

  /** Safety-gate rejection that schedules nothing (e.g. an expired proposal). */
  private decide(cycle: Cycle, d: Pick<DecisionOutcome, "reason" | "requestedPhase" | "proposalIds" | "arbitrationId" | "summary"> & { status: "rejected" }) {
    this.sim.safetyRejections += 1;
    const payload: DecisionOutcome = {
      commandId: `g${this.sim.generation}-command-${++this.commandCount}`,
      correlationId: cycle.correlationId,
      proposalIds: d.proposalIds,
      arbitrationId: d.arbitrationId,
      status: d.status,
      requestedPhase: d.requestedPhase,
      reason: d.reason,
      committedStateVersion: null,
      scheduledAfterSimMs: null,
      summary: d.summary.slice(0, 500),
    };
    this.sim.emit("decision.outcome", payload, {
      source: "safety", provenance: "deterministic", correlationId: cycle.correlationId, summary: payload.summary,
    });
  }

  private endCycle(T: number) {
    const cycle = this.cycle;
    if (cycle) {
      for (const run of cycle.runs) {
        const state = this.agents[run.agentId];
        if (state.status === "proposal_pending") state.status = "idle";
      }
    }
    this.cycle = null;
    this.lastCycleEndedAt = T;
  }

  private context(T: number): ArbitrationRecord["context"] {
    const view = this.sim.signalView();
    const green = view.phase === "NS_GREEN" || view.phase === "EW_GREEN";
    const group = (g: MovementGroup) => {
      const o = this.sim.observe(g);
      return {
        queueLength: o.queueLength,
        maxWaitSeconds: o.maxWaitSeconds,
        emergencyCount: o.emergencyCount,
        nearestEmergencyEtaSeconds: o.nearestEmergencyEtaSeconds,
        lastServedAtSimMs: o.lastServedAtSimMs,
        totalGreenMs: o.totalGreenMs,
      };
    };
    return {
      currentPhase: view.phase,
      ns: group("NS"),
      ew: group("EW"),
      minimumGreenRemainingMs: green ? Math.max(0, view.earliestEnd - T) : 0,
      maximumGreenRemainingMs: green && view.latestEnd !== null ? Math.max(0, view.latestEnd - T) : 0,
    };
  }

  private interval(run: AgentRun, T: number | null, wall: number | null, outcome: InferenceInterval["outcome"]): InferenceInterval {
    const done = outcome !== "pending" && T !== null && wall !== null;
    return {
      inferenceId: run.inferenceId,
      correlationId: run.correlationId,
      startedAtWallTime: iso(run.startedAtWall),
      completedAtWallTime: done ? iso(Math.max(wall!, run.startedAtWall)) : null,
      startedAtSimMs: run.startedAtSim,
      completedAtSimMs: done ? Math.max(T!, run.startedAtSim) : null,
      latencyMs: done ? Math.max(0, Math.round(wall! - run.startedAtWall)) : null,
      outcome: done ? outcome : "pending",
    };
  }

  private recordLatency(stats: { count: number; sum: number; max: number }, ms: number) {
    stats.count += 1;
    stats.sum += ms;
    stats.max = Math.max(stats.max, ms);
  }
}

function normalise(items: { choice: ArbitrationChoice; probability: number }[]) {
  const rounded = items.map(i => ({ choice: i.choice, probability: Math.round(i.probability * 10000) / 10000 }));
  const drift = 1 - rounded.reduce((sum, i) => sum + i.probability, 0);
  const largest = rounded.reduce((best, i) => (i.probability > best.probability ? i : best));
  largest.probability = Math.round((largest.probability + drift) * 10000) / 10000;
  return rounded;
}

function describeObservation(o: Observation): string {
  const parts = [`${o.queueLength} queued`];
  if (o.approaching) parts.push(`${o.approaching} approaching`);
  if (o.maxWaitSeconds > 0) parts.push(`longest wait ${Math.round(o.maxWaitSeconds)} s`);
  if (o.emergencyCount) parts.push(`${plural(o.emergencyCount, "emergency vehicle")}`);
  return parts.join(", ");
}

function faultMessage(provider: "Gemini" | "JEV", fault: FaultKind, deadlineMs: number): string {
  switch (fault) {
    case "timeout": return `no response before the ${deadlineMs / 1000} s deadline (injected ${provider} timeout)`;
    case "provider_error": return `injected ${provider} provider error`;
    case "rate_limit": return `injected ${provider} rate limit`;
    case "invalid_response": return `injected invalid ${provider} response`;
    case "low_confidence": return "injected low confidence";
  }
}

function choiceLabel(choice: ArbitrationChoice): string {
  return choice === "GRANT_A" ? "granted Agent A" : choice === "GRANT_B" ? "granted Agent B" : "deferred";
}

function label(agentId: AgentId): string {
  return agentId === "agent-a" ? "Agent A" : "Agent B";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function stepAlign(ms: number): number {
  return Math.ceil(ms / STEP_MS) * STEP_MS;
}

function iso(ms: number): string {
  return new Date(Math.round(ms)).toISOString();
}
