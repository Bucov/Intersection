import { SemanticEvent } from "@mozaik-ai/core";
import {
  events,
  type Correlation,
  type eventPayloadSchema,
} from "mozaik-jev-adapter";
import { z } from "zod";
import {
  TrafficProposalSchema,
  type AgentStatus,
  type ArbitrationRecord,
  type ArbitrationResult,
  type FallbackReason,
  type GreenPhase,
  type JevStatus,
  type TrafficProposal,
} from "@intersection/shared";
import { Simulation, type Coordination } from "../simulation/engine.js";
import {
  freezeObservation,
  ProposalSchema,
  type Observation,
} from "./schemas.js";
import { type AIService, type RunnerTask } from "./service.js";
interface Cycle {
  id: string;
  generation: number;
  revision: number;
  version: number;
  observation: Observation;
  deadline: number;
  proposals: Map<string, TrafficProposal>;
  record: ArbitrationRecord | null;
  timer: ReturnType<typeof setTimeout>;
  executed: boolean;
}
export class Coordinator implements Coordination {
  cycle: Cycle | null = null;
  private idleWaiters: (() => void)[] = [];
  whenIdle(): Promise<void> {
    return this.cycle
      ? new Promise((resolve) => this.idleWaiters.push(resolve))
      : Promise.resolve();
  }
  private counter = 0;
  private due = true;
  private nextAt = 0;
  private closed = false;
  private statuses!: [AgentStatus, AgentStatus];
  private jev!: JevStatus;
  readonly decisionTrace: {
    cycleId: string;
    simulationTimeMs: number;
    phase: GreenPhase;
    accepted: boolean;
    reason: string;
  }[] = [];
  constructor(
    readonly sim: Simulation,
    readonly service: AIService,
  ) {
    this.reset();
  }
  reset() {
    this.cycle = null;
    this.due = true;
    this.nextAt = 0;
    this.statuses = [this.initial("agent-a"), this.initial("agent-b")];
    this.jev = {
      status: "idle",
      pendingArbitrationId: null,
      lastArbitration: null,
    };
    this.decisionTrace.length = 0;
  }
  private initial(agentId: "agent-a" | "agent-b"): AgentStatus {
    const cfg = this.service.config,
      agent = cfg.agents[agentId === "agent-a" ? 0 : 1];
    return {
      agentId,
      group: agentId === "agent-a" ? "NS" : "EW",
      status: "idle",
      provenance: cfg.mode,
      latencyMeasurement: "wall",
      provider: cfg.mode === "mock" ? "mock" : agent.provider,
      model:
        cfg.mode === "mock" ? "offline-rule-proposal" : agent.model || null,
      lastInference: null,
      latestProposalId: null,
      requestCount: 0,
      message: agent.reason,
    };
  }
  update() {
    if (this.sim.now() >= this.nextAt) this.due = true;
  }
  requestCycle(_reason: string) {
    this.due = true;
  }
  onGreenStarted() {
    this.due = true;
  }
  agentStatuses() {
    return structuredClone(this.statuses);
  }
  providerStatuses() {
    return this.service.providers();
  }
  jevStatus() {
    return structuredClone(this.jev);
  }
  owns(task: RunnerTask) {
    return (
      !this.closed &&
      this.cycle?.id === task.cycleId &&
      this.cycle.generation === task.generation &&
      this.sim.generation === task.generation
    );
  }
  isCurrent(r: Correlation) {
    const c = this.cycle;
    return (
      !!c &&
      !this.closed &&
      this.sim.mode === "ai" &&
      this.sim.status === "running" &&
      r.sessionId === this.sim.sessionId &&
      r.generation === this.sim.generation &&
      r.generation === c.generation &&
      r.cycleId === c.id &&
      r.stateVersion === c.revision &&
      r.stateVersion === this.sim.decisionStateVersion &&
      Date.now() <= c.deadline &&
      !c.executed
    );
  }
  poll() {
    if (
      this.closed ||
      this.sim.status !== "running" ||
      this.cycle ||
      !this.due ||
      !this.sim.signalView().phase.endsWith("_GREEN")
    )
      return;
    this.due = false;
    this.nextAt = this.sim.now() + 8000;
    const unavailable = this.service.config.agents.some((a) => a.reason);
    if (unavailable) {
      this.fallback("missing_credentials", null);
      return;
    }
    this.sim.invalidateDecisions();
    const id = `g${this.sim.generation}-cycle-${++this.counter}`;
    const snapshot = this.sim.snapshot();
    const observation = freezeObservation({
      simulationTimeMs: this.sim.now(),
      signal: snapshot.signal,
      timing: this.sim.timing,
      ns: this.sim.observe("NS"),
      ew: this.sim.observe("EW"),
      occupiedVehicleCount: snapshot.occupiedVehicleIds.length,
    });
    const timer = setTimeout(() => {
      if (this.cycle?.id === id) {
        this.sim.deadlineMisses++;
        this.fail("timeout");
      }
    }, this.service.config.deadlineMs);
    timer.unref();
    this.cycle = {
      id,
      generation: this.sim.generation,
      revision: this.sim.decisionStateVersion,
      version: this.sim.stateVersion,
      observation,
      deadline: Date.now() + this.service.config.deadlineMs,
      proposals: new Map(),
      record: null,
      timer,
      executed: false,
    };
    if (!this.service.launch(this, id, observation))
      this.fail("provider_error");
  }
  inferenceStarted(task: RunnerTask) {
    if (!this.owns(task)) return;
    const s = this.statuses[task.agentId === "agent-a" ? 0 : 1];
    s.status = "inference";
    s.requestCount++;
    this.sim.geminiRequests++;
    s.message =
      this.service.config.mode === "mock"
        ? "Offline runner through Mozaik."
        : "Provider inference through Mozaik.";
    s.lastInference = {
      inferenceId: `${task.cycleId}-${task.agentId}`,
      correlationId: task.cycleId,
      startedAtWallTime: new Date(task.startedAt!).toISOString(),
      completedAtWallTime: null,
      startedAtSimMs: this.sim.now(),
      completedAtSimMs: null,
      latencyMs: null,
      outcome: "pending",
    };
    this.emitStatus(s);
  }
  inferenceEnded(task: RunnerTask) {
    if (!this.owns(task)) return;
    const s = this.statuses[task.agentId === "agent-a" ? 0 : 1];
    if (!s.lastInference) return;
    const latency = Math.max(0, task.endedAt! - task.startedAt!);
    s.lastInference = {
      ...s.lastInference,
      completedAtWallTime: new Date(task.endedAt!).toISOString(),
      completedAtSimMs: this.sim.now(),
      latencyMs: latency,
      outcome: task.error ? "failed" : "completed",
    };
    s.status = task.error ? "error" : "proposal_pending";
    s.message = task.error ? `Inference failed: ${task.error}.` : null;
    this.sim.geminiLatency.count++;
    this.sim.geminiLatency.sum += latency;
    this.sim.geminiLatency.max = Math.max(this.sim.geminiLatency.max, latency);
    this.emitStatus(s);
  }
  private emitStatus(s: AgentStatus) {
    this.sim.emit("agent.status", structuredClone(s), {
      source: s.agentId,
      provenance: s.provenance,
      summary: s.message ?? `${s.agentId}: ${s.status}`,
      correlationId: s.lastInference?.correlationId,
    });
  }
  answer(task: RunnerTask, payload: unknown) {
    const c = this.cycle;
    if (!c || !this.owns(task)) return;
    if (task.error) {
      this.fail(
        task.error === "rate_limit"
          ? "rate_limit"
          : task.error === "timeout"
            ? "timeout"
            : "provider_error",
      );
      return;
    }
    let action: z.infer<typeof ProposalSchema>;
    try {
      const text = (payload as { answer: { content: { text: string } } }).answer
        .content.text;
      if (text.length > 8000) throw Error();
      action = ProposalSchema.parse(JSON.parse(text));
    } catch {
      this.fail("invalid_response");
      return;
    }
    const duration = action.requestedGreenSeconds * 1000;
    if (
      duration < this.sim.timing.minimumGreenMs ||
      duration > this.sim.timing.maximumGreenMs
    ) {
      this.fail("invalid_response");
      return;
    }
    const obs =
      task.agentId === "agent-a" ? c.observation.ns : c.observation.ew;
    const proposal = TrafficProposalSchema.parse({
      proposalId: `${c.id}-${task.agentId}`,
      correlationId: c.id,
      agentId: task.agentId,
      sessionId: this.sim.sessionId,
      generation: c.generation,
      stateVersion: c.version,
      createdAtSimMs: c.observation.simulationTimeMs,
      expiresAtSimMs: c.observation.simulationTimeMs + 12000,
      createdAtWallTime: new Date(task.startedAt!).toISOString(),
      deadlineWallTime: new Date(c.deadline).toISOString(),
      requestedPhase: action.requestedPhase,
      requestedGreenSeconds: action.requestedGreenSeconds,
      urgency: obs.emergencyCount ? "emergency" : "normal",
      observations: {
        queueLength: obs.queueLength,
        maxWaitSeconds: obs.maxWaitSeconds,
        emergencyCount: obs.emergencyCount,
        estimatedArrivalRateVehPerHour: this.sim.observe(
          task.agentId === "agent-a" ? "NS" : "EW",
        ).estimatedArrivalRateVehPerHour,
      },
      rationale: action.summary,
      provenance: this.service.config.mode,
    });
    c.proposals.set(task.agentId, proposal);
    this.statuses[task.agentId === "agent-a" ? 0 : 1].latestProposalId =
      proposal.proposalId;
    this.sim.emit("agent.proposal", proposal, {
      source: task.agentId,
      provenance: proposal.provenance,
      summary: proposal.rationale,
      correlationId: c.id,
    });
    if (c.proposals.size === 2) this.decide(c);
  }
  private decide(c: Cycle) {
    const a = c.proposals.get("agent-a")!,
      b = c.proposals.get("agent-b")!;
    if (!this.fresh(c)) {
      this.apply(a, c);
      this.finish();
      return;
    }
    // Equal phase and duration produce the same effective request. Different durations
    // are competing plans too, even if both recommend the currently green group.
    if (
      a.requestedPhase === b.requestedPhase &&
      a.requestedGreenSeconds === b.requestedGreenSeconds
    ) {
      this.apply(a, c);
      this.finish();
      return;
    }
    this.sim.emit(
      "arbitration.conflict",
      {
        proposalIds: [a.proposalId, b.proposalId],
        reason:
          a.requestedPhase === b.requestedPhase
            ? "different_service_plans"
            : "mutually_exclusive_phases",
      },
      {
        source: "controller",
        provenance: "deterministic",
        summary:
          "Agents proposed different service plans; requesting adapter arbitration.",
        correlationId: c.id,
      },
    );
    const now = new Date().toISOString();
    c.record = {
      arbitrationId: `${c.id}-jev`,
      correlationId: c.id,
      sessionId: this.sim.sessionId,
      generation: c.generation,
      stateVersion: this.sim.stateVersion,
      decisionStateVersion: c.revision,
      proposalA: a,
      proposalB: b,
      eligibleChoices: ["GRANT_A", "GRANT_B", "DEFER"],
      context: {
        currentPhase: c.observation.signal.phase,
        ns: c.observation.ns,
        ew: c.observation.ew,
        minimumGreenRemainingMs: Math.max(
          0,
          c.observation.signal.earliestEndAtSimMs -
            c.observation.simulationTimeMs,
        ),
        maximumGreenRemainingMs: Math.max(
          0,
          (c.observation.signal.latestEndAtSimMs ??
            c.observation.simulationTimeMs) - c.observation.simulationTimeMs,
        ),
      },
      requestedAtSimMs: this.sim.now(),
      requestedAtWallTime: now,
      deadlineWallTime: new Date(c.deadline).toISOString(),
      completedAtWallTime: null,
      status: "pending",
      result: null,
      fallbackReason: null,
    };
    this.jev = {
      status: "arbitrating",
      pendingArbitrationId: c.record.arbitrationId,
      lastArbitration: c.record,
    };
    this.publishRecord(c.record);
    this.service.runtime.sendEvent(
      SemanticEvent.create(events.requested, this.service.participant.getId(), {
        requestId: c.record.arbitrationId,
        sessionId: this.sim.sessionId,
        cycleId: c.id,
        generation: c.generation,
        stateVersion: c.revision,
        state: c.observation,
        candidates: [a, b].map((p) => ({
          id: p.proposalId,
          producerId: p.agentId,
          label: `${p.requestedPhase === "NS_GREEN" ? "North/South" : "East/West"} service for ${p.requestedGreenSeconds} seconds: ${p.rationale}`,
          proposal: {
            requestedPhase: p.requestedPhase,
            requestedGreenSeconds: p.requestedGreenSeconds,
            summary: p.rationale,
          },
        })),
      }),
      this.service.participant.getId(),
    );
  }
  terminal(payload: z.infer<typeof eventPayloadSchema>) {
    const c = this.cycle;
    if (
      !c ||
      payload.cycleId !== c.id ||
      payload.generation !== c.generation ||
      !c.record
    )
      return;
    const record = c.record;
    record.bridgePhase = payload.phase;
    if (payload.reason) record.bridgeReason = payload.reason;
    if (payload.phase === "started") {
      this.publishRecord(record);
      return;
    }
    if (payload.result) record.adapterResult = payload.result;
    record.completedAtWallTime = new Date().toISOString();
    record.status =
      payload.phase === "discarded"
        ? "stale"
        : payload.result &&
            (payload.result.status === "selected" ||
              payload.result.status === "abstained")
          ? "completed"
          : "failed";
    let reason: FallbackReason | null = null;
    if (payload.phase === "discarded") reason = "stale_result";
    else if (payload.phase === "timed_out") reason = "timeout";
    else if (payload.phase === "failed")
      reason =
        payload.result?.status === "error" &&
        payload.result.errorCode === "rate_limit"
          ? "rate_limit"
          : "provider_error";
    const r = payload.result;
    if (r) {
      this.sim.jevLatency.count++;
      this.sim.jevLatency.sum += r.latencyMs;
      this.sim.jevLatency.max = Math.max(this.sim.jevLatency.max, r.latencyMs);
    }
    if (r && (r.status === "selected" || r.status === "abstained")) {
      const confidence = r.confidence,
        band =
          confidence === null
            ? null
            : confidence >= this.sim.confidencePolicy.highThreshold
              ? "high"
              : confidence >= this.sim.confidencePolicy.mediumThreshold
                ? "medium"
                : "low";
      if (band) this.sim.jevConfidence[band]++;
      else this.sim.jevUnmeasured++;
      // Optional v1 presentation projection. The lossless adapterResult is always kept;
      // absent measurements or rounded mass are never replaced with invented numbers.
      if (
        r.probabilities &&
        r.abstainProbability !== null &&
        confidence !== null &&
        band
      ) {
        const probabilities = [
          {
            choice: "GRANT_A" as const,
            probability: r.probabilities[record.proposalA.proposalId],
          },
          {
            choice: "GRANT_B" as const,
            probability: r.probabilities[record.proposalB.proposalId],
          },
          { choice: "DEFER" as const, probability: r.abstainProbability },
        ];
        if (
          probabilities.every((p) => Number.isFinite(p.probability)) &&
          Math.abs(probabilities.reduce((n, p) => n + p.probability, 0) - 1) <
            1e-6
        )
          record.result = {
            choice:
              r.selectedCandidateId === record.proposalA.proposalId
                ? "GRANT_A"
                : r.selectedCandidateId === record.proposalB.proposalId
                  ? "GRANT_B"
                  : "DEFER",
            probabilities,
            confidence,
            confidenceBand: band,
            confidencePolicy: this.sim.confidencePolicy,
            model: this.service.providers()[1].model,
            modelVersion: null,
            latencyMs: r.latencyMs,
            provenance: r.source === "mock" ? "mock" : "live",
          } satisfies ArbitrationResult;
      }
      if (r.status === "abstained") reason = "no_valid_proposal";
      else if (
        confidence === null ||
        confidence < this.sim.confidencePolicy.mediumThreshold
      )
        reason = "low_confidence";
      else if (confidence < this.sim.confidencePolicy.highThreshold)
        reason = "medium_confidence_deferred";
    }
    record.fallbackReason = reason;
    this.jev = {
      status: reason ? "degraded" : "idle",
      pendingArbitrationId: null,
      lastArbitration: record,
    };
    this.publishRecord(record);
    if (reason) {
      this.fallback(reason, c);
      this.finish();
      return;
    }
    const proposal = [...c.proposals.values()].find(
      (p) => p.proposalId === r?.selectedCandidateId,
    );
    if (!proposal) this.fallback("no_valid_proposal", c);
    else this.apply(proposal, c);
    this.finish();
  }
  private publishRecord(record: ArbitrationRecord) {
    this.sim.emit("jev.arbitration", structuredClone(record), {
      source: "jev",
      provenance: this.service.config.jevMode,
      summary: `Adapter arbitration: ${record.bridgePhase ?? record.status}${record.bridgeReason ? ` (${record.bridgeReason})` : ""}.`,
      correlationId: record.correlationId,
    });
  }
  private fresh(c: Cycle) {
    if (
      !this.isCurrent({
        requestId: "check",
        sessionId: this.sim.sessionId,
        cycleId: c.id,
        generation: c.generation,
        stateVersion: c.revision,
      }) ||
      this.sim.now() - c.observation.simulationTimeMs > 12000
    )
      return false;
    for (const [group, observed] of [
      ["NS", c.observation.ns],
      ["EW", c.observation.ew],
    ] as const) {
      const current = this.sim.observe(group);
      if (
        Math.abs(current.queueLength - observed.queueLength) > 12 ||
        current.emergencyCount !== observed.emergencyCount
      )
        return false;
    }
    return true;
  }
  private apply(proposal: TrafficProposal, c: Cycle) {
    const fresh = this.fresh(c),
      valid =
        TrafficProposalSchema.safeParse(proposal).success &&
        c.proposals.get(proposal.agentId)?.proposalId === proposal.proposalId;
    const at =
      fresh && valid
        ? this.sim.requestGreen(
            proposal.requestedPhase,
            proposal.requestedGreenSeconds * 1000,
            c.id,
          )
        : null;
    c.executed = at !== null;
    if (at !== null) this.sim.setActiveController("adaptive", null);
    else this.sim.safetyRejections++;
    this.sim.emit(
      "decision.outcome",
      {
        commandId: c.id,
        correlationId: c.id,
        proposalIds: [...c.proposals.values()].map((p) => p.proposalId),
        arbitrationId: c.record?.arbitrationId ?? null,
        status: at !== null ? "accepted" : "rejected",
        requestedPhase: proposal.requestedPhase,
        reason:
          at !== null
            ? "authorized"
            : fresh
              ? "unsafe_transition"
              : "stale_version",
        committedStateVersion: at !== null ? this.sim.stateVersion : null,
        scheduledAfterSimMs: at,
        summary:
          at !== null
            ? "Signal request accepted; FSM will enforce clearance."
            : "Signal request rejected by freshness or safety validation.",
      },
      {
        source: "safety",
        provenance: "deterministic",
        summary:
          at !== null
            ? "Service plan accepted by signal FSM."
            : "Service plan rejected.",
        correlationId: c.id,
      },
    );
    this.trace(
      c.id,
      proposal.requestedPhase,
      at !== null,
      at !== null ? "authorized" : "rejected",
    );
    if (at === null)
      this.fallback(fresh ? "no_valid_proposal" : "stale_result", c);
  }
  private trace(
    cycleId: string,
    phase: GreenPhase,
    accepted: boolean,
    reason: string,
  ) {
    this.decisionTrace.push({
      cycleId,
      simulationTimeMs: this.sim.now(),
      phase,
      accepted,
      reason,
    });
    if (this.decisionTrace.length > 2000) this.decisionTrace.shift();
  }
  private fallback(reason: FallbackReason, c: Cycle | null) {
    this.sim.setActiveController("deterministic_fallback", reason);
    const ns = this.sim.observe("NS"),
      ew = this.sim.observe("EW");
    let phase: GreenPhase;
    if (ns.emergencyCount !== ew.emergencyCount)
      phase = ns.emergencyCount > ew.emergencyCount ? "NS_GREEN" : "EW_GREEN";
    else
      phase =
        ns.maxWaitSeconds === ew.maxWaitSeconds
          ? this.sim.signalView().nextGreen
          : ns.maxWaitSeconds > ew.maxWaitSeconds
            ? "NS_GREEN"
            : "EW_GREEN";
    const id = `${c?.id ?? `fallback-${++this.counter}`}-fallback`;
    const at = this.sim.requestGreen(
      phase,
      this.sim.timing.minimumGreenMs,
      id,
      true,
    );
    this.sim.emit(
      "arbitration.fallback",
      {
        arbitrationId: c?.record?.arbitrationId ?? null,
        reason,
        selectedPhase: at === null ? "HOLD" : phase,
        policy: "emergency-fairness-v1",
      },
      {
        source: "controller",
        provenance: "deterministic",
        summary: `Deterministic fallback: ${reason}; ${at === null ? "retain safe signal plan" : phase}.`,
        correlationId: c?.id ?? id,
      },
    );
    this.trace(id, phase, at !== null, reason);
  }
  private fail(reason: FallbackReason) {
    const c = this.cycle;
    if (!c) return;
    if (c.record) {
      c.record.status = reason === "stale_result" ? "stale" : "failed";
      c.record.completedAtWallTime = new Date().toISOString();
      c.record.fallbackReason = reason;
      this.publishRecord(c.record);
      this.jev = {
        status: "degraded",
        pendingArbitrationId: null,
        lastArbitration: c.record,
      };
    }
    this.fallback(reason, c);
    this.finish();
  }
  private finish() {
    const c = this.cycle;
    if (!c) return;
    clearTimeout(c.timer);
    this.service.release(this, c.id);
    this.cycle = null;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
    for (const s of this.statuses) {
      if (s.lastInference?.outcome === "pending") {
        s.lastInference = {
          ...s.lastInference,
          completedAtWallTime: new Date().toISOString(),
          completedAtSimMs: this.sim.now(),
          latencyMs: Math.max(
            0,
            Date.now() - Date.parse(s.lastInference.startedAtWallTime),
          ),
          outcome: "cancelled",
        };
      }
      if (s.status !== "error") s.status = "idle";
      this.emitStatus(s);
    }
  }
  discardOutstanding(_reason: string) {
    const c = this.cycle;
    if (c) {
      if (c.record) {
        c.record.status = "stale";
        c.record.completedAtWallTime = new Date().toISOString();
        c.record.fallbackReason = "stale_result";
        this.publishRecord(c.record);
        this.jev = {
          status: "idle",
          pendingArbitrationId: null,
          lastArbitration: c.record,
        };
      }
      this.finish();
    }
    this.due = true;
  }
  dispose() {
    this.closed = true;
    this.discardOutstanding("disposed");
  }
}
