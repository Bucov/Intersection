import type { Provenance, ServerEvent, SimulationSnapshot } from "@intersection/shared";
import {
  approachName,
  choiceName,
  formatLatency,
  formatPercent,
  formatSeconds,
  formatTimestamp,
  humanize,
  phaseName,
  vehicleTypeName,
} from "@/lib/format";

export type Participant = "simulation" | "agent-a" | "agent-b" | "jev" | "controller" | "safety";

export type TranscriptKind =
  | "session"
  | "observation"
  | "inference"
  | "proposal"
  | "conflict"
  | "arbitration"
  | "confidence"
  | "fallback"
  | "decision"
  | "signal"
  | "scenario"
  | "emergency"
  | "error";

export type Tone = "neutral" | "positive" | "warning" | "negative";

export interface TranscriptDetail {
  label: string;
  value: string;
}

export interface TranscriptEntry {
  key: string;
  sequence: number;
  generation: number;
  simulationTimeMs: number;
  participant: Participant;
  provenance: Provenance;
  kind: TranscriptKind;
  title: string;
  /** Summary written by the event source (backend or mock engine). */
  summary: string;
  tone: Tone;
  details: TranscriptDetail[];
  /** Late telemetry from a previous generation; displayed but never applied. */
  previousGeneration: boolean;
}

export const PARTICIPANT_LABEL: Record<Participant, string> = {
  simulation: "Simulation",
  "agent-a": "Agent A",
  "agent-b": "Agent B",
  jev: "JEV",
  controller: "Controller",
  safety: "Safety",
};

function participantOf(source: ServerEvent["source"]): Participant {
  return source === "api" ? "simulation" : source;
}

/** Map a domain event to a transcript entry, or null for high-frequency telemetry. */
export function describeEvent(event: ServerEvent, previousGeneration = false): TranscriptEntry | null {
  const base = {
    key: event.eventId,
    sequence: event.sequence,
    generation: event.generation,
    simulationTimeMs: event.simulationTimeMs,
    participant: participantOf(event.source),
    provenance: event.provenance,
    summary: event.summary,
    previousGeneration,
  };
  switch (event.type) {
    case "simulation.snapshot":
    case "simulation.metrics":
      return null;

    case "simulation.status": {
      const p = event.payload;
      return {
        ...base, kind: "session", title: "Session", tone: p.controller.activeController === "deterministic_fallback" ? "warning" : "neutral",
        details: [
          { label: "Status", value: humanize(p.status) },
          { label: "Speed", value: `${p.speedMultiplier}×` },
          { label: "Active controller", value: humanize(p.controller.activeController) },
          ...(p.controller.reason ? [{ label: "Reason", value: p.controller.reason }] : []),
        ],
      };
    }

    case "simulation.vehicle_event": {
      const p = event.payload;
      if (p.kind === "requested" && p.emergency) {
        return { ...base, kind: "emergency", title: "Emergency request", tone: "warning", details: [{ label: "Approach", value: approachName(p.approach) }, { label: "Demand", value: p.demandId }] };
      }
      if (p.kind === "spawned" && p.vehicle.emergency) {
        return { ...base, kind: "emergency", title: "Emergency vehicle entered", tone: "warning", details: [
          { label: "Vehicle", value: `${vehicleTypeName(p.vehicle.type)} ⋅ ${p.vehicle.id}` },
          { label: "Approach", value: approachName(p.vehicle.approach) },
        ] };
      }
      if (p.kind === "emergency_detected") {
        return { ...base, kind: "emergency", title: "Emergency detected", tone: "warning", details: [
          { label: "Approach", value: approachName(p.approach) },
          { label: "Stop-line ETA", value: p.stopLineEtaSeconds === null ? "No finite estimate" : `${p.stopLineEtaSeconds.toFixed(1)} s` },
        ] };
      }
      if (p.kind === "completed" && p.emergency) {
        return { ...base, kind: "emergency", title: "Emergency vehicle cleared", tone: "positive", details: [
          { label: "Travel time", value: formatSeconds(p.travelTimeMs) },
          { label: "Signal delay", value: formatSeconds(p.signalDelayMs) },
        ] };
      }
      return null;
    }

    case "simulation.scenario_event": {
      const p = event.payload;
      return { ...base, kind: "scenario", title: `Scenario event ${p.status}`, tone: "neutral", details: [
        { label: "Event", value: humanize(p.event.type) },
        { label: "Schedule", value: p.scheduleId },
      ] };
    }

    case "signal.phase_changed": {
      const p = event.payload;
      return { ...base, kind: "signal", title: "Signal transition", tone: "neutral", details: [
        { label: "From", value: phaseName(p.previousPhase) },
        { label: "To", value: phaseName(p.signal.phase) },
        { label: "Reason", value: humanize(p.reason) },
        { label: "Earliest next change", value: formatTimestamp(p.signal.earliestEndAtSimMs) },
        ...(p.signal.activeCommandId ? [{ label: "Command", value: p.signal.activeCommandId }] : []),
      ] };
    }

    case "agent.status": {
      const p = event.payload;
      const interval = p.lastInference;
      if (p.status === "inference" && interval?.outcome === "pending") {
        return { ...base, kind: "observation", title: "Observation ⋅ inference started", tone: "neutral", details: [
          { label: "Inference", value: interval.inferenceId },
          { label: "Requests so far", value: String(p.requestCount) },
          ...(p.model ? [{ label: "Model", value: p.model }] : []),
        ] };
      }
      if (interval && interval.outcome !== "pending" && interval.outcome !== "completed") {
        return { ...base, kind: "inference", title: `Inference ${interval.outcome}`, tone: interval.outcome === "failed" ? "negative" : "warning", details: [
          { label: "Inference", value: interval.inferenceId },
          { label: "Elapsed", value: formatLatency(interval.latencyMs) },
          ...(p.message ? [{ label: "Message", value: p.message }] : []),
        ] };
      }
      if (p.status === "error" || p.status === "disabled") {
        return { ...base, kind: "inference", title: `Agent ${p.status}`, tone: p.status === "error" ? "negative" : "neutral", details: p.message ? [{ label: "Message", value: p.message }] : [] };
      }
      return null;
    }

    case "agent.proposal": {
      const p = event.payload;
      return { ...base, kind: "proposal", title: "Proposal", tone: "neutral", details: [
        { label: "Requests", value: `${phaseName(p.requestedPhase)} for ${p.requestedGreenSeconds} s` },
        { label: "Urgency", value: humanize(p.urgency) },
        { label: "Observed queue", value: `${p.observations.queueLength} vehicles` },
        { label: "Longest wait", value: `${p.observations.maxWaitSeconds.toFixed(1)} s` },
        { label: "Emergency vehicles", value: String(p.observations.emergencyCount) },
        { label: "Arrival estimate", value: `${Math.round(p.observations.estimatedArrivalRateVehPerHour)} veh/h` },
        { label: p.provenance === "live" ? "Model rationale" : "Mock rationale (rule-based)", value: p.rationale },
        { label: "Expires", value: formatTimestamp(p.expiresAtSimMs) },
      ] };
    }

    case "arbitration.conflict":
      return { ...base, kind: "conflict", title: "Conflict identified", tone: "warning", details: [
        { label: "Proposals", value: event.payload.proposalIds.join(" vs ") },
        { label: "Reason", value: "Mutually exclusive phases" },
      ] };

    case "jev.arbitration": {
      const p = event.payload;
      if (p.status === "pending") {
        return { ...base, kind: "arbitration", title: "JEV arbitration started", tone: "neutral", details: [
          { label: "Agent A asks", value: `${phaseName(p.proposalA.requestedPhase)} ⋅ ${p.proposalA.requestedGreenSeconds} s` },
          { label: "Agent B asks", value: `${phaseName(p.proposalB.requestedPhase)} ⋅ ${p.proposalB.requestedGreenSeconds} s` },
          { label: "Eligible choices", value: p.eligibleChoices.map(choiceName).join(", ") },
        ] };
      }
      if (p.status === "completed" && p.result) {
        const r = p.result;
        return { ...base, kind: "confidence", title: "JEV decision ⋅ confidence evaluated", tone: r.confidenceBand === "low" ? "warning" : "neutral", details: [
          { label: "Choice", value: choiceName(r.choice) },
          { label: "Confidence", value: `${formatPercent(r.confidence)} (${r.confidenceBand})` },
          { label: "Distribution", value: r.probabilities.map(pr => `${choiceName(pr.choice)} ${formatPercent(pr.probability)}`).join(" ⋅ ") },
          { label: "Policy", value: `high ≥ ${formatPercent(r.confidencePolicy.highThreshold)}, medium ≥ ${formatPercent(r.confidencePolicy.mediumThreshold)}` },
          { label: "Latency", value: formatLatency(r.latencyMs) },
          { label: "Model", value: r.model ?? "Not reported" },
        ] };
      }
      return { ...base, kind: "arbitration", title: p.status === "stale" ? "JEV result discarded" : "JEV arbitration failed", tone: p.status === "stale" ? "warning" : "negative", details: [
        { label: "Status", value: humanize(p.status) },
        { label: "Reason", value: p.fallbackReason ? humanize(p.fallbackReason) : "Not reported" },
      ] };
    }

    case "arbitration.fallback": {
      const p = event.payload;
      return { ...base, kind: "fallback", title: "Fallback activated", tone: "warning", details: [
        { label: "Reason", value: humanize(p.reason) },
        { label: "Selected", value: phaseName(p.selectedPhase) },
        { label: "Policy", value: p.policy },
      ] };
    }

    case "decision.outcome": {
      const p = event.payload;
      const title = p.status === "accepted" ? "Action accepted" : p.status === "rejected" ? "Action rejected" : "No action needed";
      return { ...base, kind: "decision", title, tone: p.status === "accepted" ? "positive" : p.status === "rejected" ? "negative" : "neutral", details: [
        { label: "Requested", value: phaseName(p.requestedPhase) },
        { label: "Reason", value: humanize(p.reason) },
        ...(p.scheduledAfterSimMs !== null ? [{ label: "Scheduled after", value: formatTimestamp(p.scheduledAfterSimMs) }] : []),
        { label: "Command", value: p.commandId },
      ] };
    }

    case "simulation.error":
      return { ...base, kind: "error", title: "Error", tone: "negative", details: [
        { label: "Code", value: event.payload.code },
        { label: "Message", value: event.payload.message },
      ] };
  }
}

/** App-written entries for snapshot milestones (session start, reset, resync). */
export function describeSnapshot(snapshot: SimulationSnapshot, kind: "ready" | "reset" | "resync"): TranscriptEntry {
  const title = kind === "ready" ? "Session ready" : kind === "reset" ? `Reset to generation ${snapshot.generation}` : "Resynchronized";
  const summary = kind === "resync"
    ? "Applied a fresh checkpoint after missed or incompatible events. Earlier transcript entries may be incomplete."
    : `${humanize(snapshot.config.scenarioId)} ⋅ ${snapshot.config.mode === "ai" ? "AI controller" : "fixed-time controller"} ⋅ seed ${snapshot.config.seed}`;
  return {
    key: `snapshot-${snapshot.sessionId}-${snapshot.generation}-${snapshot.sequence}-${kind}`,
    sequence: snapshot.sequence,
    generation: snapshot.generation,
    simulationTimeMs: snapshot.simulationTimeMs,
    participant: "simulation",
    provenance: "simulation",
    kind: "session",
    title,
    summary,
    tone: kind === "resync" ? "warning" : "neutral",
    details: [
      { label: "Session", value: snapshot.sessionId },
      { label: "Data", value: snapshot.config.demoMode === "mock" ? "Mock adapters" : "Live adapters" },
    ],
    previousGeneration: false,
  };
}
