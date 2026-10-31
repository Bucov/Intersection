import { trafficPlan } from "./trafficPolicy.js";
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
  actions?: Map<string, TrafficProposal>;
  recoveryReason?: FallbackReason;
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
    const view = this.sim.signalView();
    const opposite = this.sim.observe(view.phase === "NS_GREEN" ? "EW" : "NS");
    // Let committed batches discharge traffic; prepare the next plan near their end.
    if (view.pendingSwitch || (view.plannedEnd !== null && this.sim.now() < view.plannedEnd - 6000 && opposite.emergencyCount === 0)) return;
    this.due = false;
    this.nextAt = this.sim.now() + 8000;
    const unavailable = this.service.config.agents.some((a) => a.reason);

    this.sim.invalidateDecisions();
    const id = `g${this.sim.generation}-cycle-${++this.counter}`;
    const snapshot = this.sim.snapshot();
    const observation = freezeObservation({
      simulationTimeMs: this.sim.now(),
      signal: snapshot.signal,
      timing: this.sim.timing,
      ns: this.sim.observe("NS"),
      ew: this.sim.observe("EW"),
      vehicles: snapshot.vehicles,
      upstreamBacklog: snapshot.metrics.upstreamBacklogByApproach,
      occupiedVehicleCount: snapshot.occupiedVehicleIds.length,
      referencePlan: this.referencePlan(),
      committedGreenUntilSimMs: view.plannedEnd,
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
    if (unavailable) { this.fail("missing_credentials"); return; }
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
    if (!c || !this.owns(task) || c.record) return;
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
      // Tolerate a markdown code fence around the JSON object.
      const json = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      action = ProposalSchema.parse(JSON.parse(json));
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
  private decide(c: Cycle, recovery = false) {
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
      !recovery && a.requestedPhase === b.requestedPhase &&
      a.requestedGreenSeconds === b.requestedGreenSeconds
    ) {
      this.apply(a, c);
      this.finish();
      return;
    }
    if (!recovery) this.sim.emit(
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
    const view = this.sim.signalView();
    const latest = this.sim.snapshot();
    c.observation = freezeObservation({ ...c.observation, simulationTimeMs: this.sim.now(),
      signal: latest.signal, vehicles: latest.vehicles, upstreamBacklog: latest.metrics.upstreamBacklogByApproach,
      occupiedVehicleCount: latest.occupiedVehicleIds.length, committedGreenUntilSimMs: view.plannedEnd,
      ns: this.sim.observe("NS"), ew: this.sim.observe("EW"), referencePlan: this.referencePlan(),
      agentPlans: [a, b].filter(p => !p.proposalId.endsWith("-recovery")).map(p => ({ requestedPhase: p.requestedPhase, requestedGreenSeconds: p.requestedGreenSeconds, summary: p.rationale })),
    });
    const current = view.phase === "EW_GREEN" ? "EW_GREEN" : "NS_GREEN";
    const seconds = this.referencePlan().requestedGreenSeconds;
    const make = (id: string, phase: GreenPhase, duration: number, label: string) => ({ ...a, proposalId: `${c.id}-${id}`, requestedPhase: phase, requestedGreenSeconds: duration, rationale: label });
    const actions = [
      make("schedule-ns", "NS_GREEN", seconds, "Schedule North/South service after required clearance"),
      make("schedule-ew", "EW_GREEN", seconds, "Schedule East/West service after required clearance"),
      make("keep-plan", current, Math.max(1, Math.ceil(((view.plannedEnd ?? view.startedAt + this.sim.timing.fixedGreenMs) - this.sim.now()) / 1000)), "Keep the existing schedule plan"),
    ];
    const remaining = ((view.latestEnd ?? this.sim.now()) - this.sim.now()) / 1000;
    const extension = Math.min(remaining, ((view.plannedEnd ?? view.earliestEnd) - this.sim.now()) / 1000 + 5);
    if (extension >= this.sim.timing.minimumGreenMs / 1000 && Math.floor(extension) > ((view.plannedEnd ?? view.earliestEnd) - this.sim.now()) / 1000) actions.push(make("extend-green", current, Math.floor(extension), "Extend the current green briefly, within its limits"));
    c.actions = new Map(actions.map(p => [p.proposalId, p]));
    const now = new Date().toISOString();
    c.record = {
      recoveryReason: c.recoveryReason,
      controllerActions: actions.map(p => ({ id: p.proposalId, label: p.rationale, requestedPhase: p.requestedPhase, requestedGreenSeconds: p.requestedGreenSeconds })),
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
        candidates: actions.map((p) => ({
          id: p.proposalId,
          producerId: p.agentId,
          label: p.rationale + (p.proposalId.endsWith("keep-plan") ? ". Do not change the committed timing." : ` (${p.requestedGreenSeconds} seconds of service).`),
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
      else if (confidence === null) reason = "low_confidence";
      else if (confidence < this.sim.confidencePolicy.highThreshold) {
        const selected = [...(c.actions ?? c.proposals).values()].find(p => p.proposalId === r.selectedCandidateId);
        const reference = this.referencePlan();
        // Probability is distributed over several safe actions. Numeric evidence,
        // not confidence concentration alone, validates a lower-confidence choice.
        if (!selected || selected.requestedPhase !== reference.requestedPhase || Math.abs(selected.requestedGreenSeconds - reference.requestedGreenSeconds) > 5)
          reason = confidence < this.sim.confidencePolicy.mediumThreshold ? "low_confidence" : "medium_confidence_deferred";
      }
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
    const proposal = [...(c.actions ?? c.proposals).values()].find(
      (p) => p.proposalId === r?.selectedCandidateId,
    );
    if (!proposal) this.fallback("no_valid_proposal", c);
    else if (proposal.proposalId.endsWith("keep-plan") && this.fresh(c)) {
      c.executed = true;
      this.sim.setActiveController("adaptive", null);
      this.sim.emit("decision.outcome", {
        realizedExtension: false, decisionSource: "jev", requestedGreenSeconds: proposal.requestedGreenSeconds,
        commandId: c.id, correlationId: c.id, proposalIds: [], arbitrationId: record.arbitrationId,
        status: "accepted", requestedPhase: proposal.requestedPhase, reason: "authorized",
        committedStateVersion: this.sim.stateVersion, scheduledAfterSimMs: this.sim.now(),
        summary: "JEV retained the existing schedule without changing signal timing.",
      }, { source: "safety", provenance: "deterministic", correlationId: c.id, summary: "Existing schedule retained." });
      this.trace(c.id, proposal.requestedPhase, true, "keep_existing_plan");
    }
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
    const before = this.sim.signalView();
    const fresh = this.fresh(c),
      valid =
        TrafficProposalSchema.safeParse(proposal).success &&
        (c.actions?.has(proposal.proposalId) || c.proposals.get(proposal.agentId)?.proposalId === proposal.proposalId);
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
        realizedExtension: at !== null && before.phase === proposal.requestedPhase && at > (before.plannedEnd ?? before.earliestEnd),
        decisionSource: c.record ? "jev" : "agreement",
        requestedGreenSeconds: proposal.requestedGreenSeconds,
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
  private referencePlan() {
    const view = this.sim.signalView();
    return trafficPlan({ simulationTimeMs: this.sim.now(), phase: view.phase, phaseStartedAtSimMs: view.startedAt,
      timing: this.sim.timing, ns: this.sim.observe("NS"), ew: this.sim.observe("EW") });
  }
  private fallback(reason: FallbackReason, c: Cycle | null) {
    this.sim.setActiveController("deterministic_fallback", reason);
    const plan = this.referencePlan();
    const phase = plan.requestedPhase;
    const id = `${c?.id ?? `fallback-${++this.counter}`}-fallback`;
    const before = this.sim.signalView();
    const at = this.sim.requestGreen(
      phase,
      plan.requestedGreenSeconds * 1000,
      id,
      true,
    );
    this.sim.emit(
      "arbitration.fallback",
      {
        arbitrationId: c?.record?.arbitrationId ?? null,
        reason,
        selectedPhase: phase,
        policy: "demand-batches-v2",
      },
      {
        source: "controller",
        provenance: "deterministic",
        summary: `Deterministic fallback: ${reason}; ${at === null ? "retain safe signal plan" : phase}.`,
        correlationId: c?.id ?? id,
      },
    );
    this.sim.emit("decision.outcome", {
      realizedExtension: at !== null && before.phase === phase && at > (before.plannedEnd ?? before.earliestEnd),
      decisionSource: "fallback", requestedGreenSeconds: plan.requestedGreenSeconds,
      commandId: id, correlationId: c?.id ?? id, proposalIds: [], arbitrationId: null,
      status: at === null ? "rejected" : "accepted", requestedPhase: phase,
      reason: at === null ? "unsafe_transition" : "authorized",
      committedStateVersion: at === null ? null : this.sim.stateVersion,
      scheduledAfterSimMs: at, summary: "Fallback service request outcome.",
    }, { source: "safety", provenance: "deterministic", correlationId: c?.id ?? id, summary: "Fallback service request outcome." });
    this.trace(id, phase, at !== null, reason);
  }
  private fail(reason: FallbackReason) {
    const c = this.cycle;
    if (!c) return;
    if (!c.record && this.sim.signalView().phase.endsWith("_GREEN") && !this.service.jevUnavailable) {
      c.recoveryReason = reason;
      clearTimeout(c.timer);
      this.service.release(this, c.id);
      c.deadline = Date.now() + this.service.config.arbitrationTimeoutMs + 100;
      c.revision = this.sim.decisionStateVersion;
      const snapshot = this.sim.snapshot();
      c.observation = freezeObservation({ ...c.observation, simulationTimeMs: this.sim.now(), signal: snapshot.signal, vehicles: snapshot.vehicles, upstreamBacklog: snapshot.metrics.upstreamBacklogByApproach, ns: this.sim.observe("NS"), ew: this.sim.observe("EW"), referencePlan: this.referencePlan() });
      for (const agentId of ["agent-a", "agent-b"] as const) {
        if (!c.proposals.has(agentId)) c.proposals.set(agentId, {
          proposalId: `${c.id}-${agentId}-recovery`, correlationId: c.id, agentId, sessionId: this.sim.sessionId,
          generation: c.generation, stateVersion: this.sim.stateVersion, createdAtSimMs: this.sim.now(), expiresAtSimMs: this.sim.now() + 12000,
          createdAtWallTime: new Date().toISOString(), deadlineWallTime: new Date(c.deadline).toISOString(),
          requestedPhase: agentId === "agent-a" ? "NS_GREEN" : "EW_GREEN", requestedGreenSeconds: this.sim.timing.minimumGreenMs / 1000,
          urgency: "normal", observations: { ...this.sim.observe(agentId === "agent-a" ? "NS" : "EW") },
          rationale: `Controller recovery candidate: ${reason}; no agent proposal available.`, provenance: "mock",
        });
      }
      c.timer = setTimeout(() => this.cycle === c && this.fail("timeout"), this.service.config.arbitrationTimeoutMs + 100);
      c.timer.unref();
      this.decide(c, true);
      return;
    }
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
