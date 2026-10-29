import type { ArbitrationChoice, DecisionOutcome, GreenPhase } from "@intersection/shared";
import type { DecisionCycle } from "@/state/session";

export type JevStateKind =
  | "idle"
  | "not-needed"
  | "pending"
  | "received"
  | "accepted"
  | "deferred"
  | "low-confidence"
  | "medium-deferred"
  | "timeout"
  | "invalid"
  | "provider-error"
  | "stale"
  | "safety-rejected"
  | "fallback";

export interface JevState {
  kind: JevStateKind;
  label: string;
  tone: "neutral" | "positive" | "warning" | "negative";
}

/** Classify the latest round for the JEV panel, using only received events. */
export function jevState(cycle: DecisionCycle | null): JevState {
  if (!cycle) return { kind: "idle", label: "Waiting for the first round", tone: "neutral" };
  const arbitration = cycle.arbitration;
  const decision = cycle.decisions[cycle.decisions.length - 1] as DecisionOutcome | undefined;
  if (!arbitration) {
    if (cycle.fallback) return { kind: "fallback", label: "Fallback rules decided", tone: "warning" };
    const a = cycle.proposals["agent-a"];
    const b = cycle.proposals["agent-b"];
    if (a && b && a.requestedPhase === b.requestedPhase) return { kind: "not-needed", label: "No arbitration needed", tone: "neutral" };
    if (decision) return { kind: "not-needed", label: "No arbitration needed", tone: "neutral" };
    return { kind: "idle", label: cycle.conflict ? "Conflict detected" : "Agents are working", tone: "neutral" };
  }
  switch (arbitration.status) {
    case "pending":
      return { kind: "pending", label: "Arbitrating…", tone: "neutral" };
    case "stale":
      return { kind: "stale", label: "Result discarded (stale)", tone: "warning" };
    case "failed":
      if (arbitration.fallbackReason === "timeout") return { kind: "timeout", label: "Timed out ⋅ fallback used", tone: "warning" };
      if (arbitration.fallbackReason === "invalid_response") return { kind: "invalid", label: "Invalid response ⋅ fallback used", tone: "warning" };
      return { kind: "provider-error", label: "Provider error ⋅ fallback used", tone: "warning" };
    case "completed": {
      const result = arbitration.result!;
      if (decision?.status === "rejected") return { kind: "safety-rejected", label: "Rejected by the safety gate", tone: "negative" };
      if (result.confidenceBand === "low") return { kind: "low-confidence", label: "Low confidence ⋅ fallback used", tone: "warning" };
      if (cycle.fallback?.reason === "medium_confidence_deferred") return { kind: "medium-deferred", label: "Medium confidence ⋅ deferred", tone: "warning" };
      if (result.choice === "DEFER") return { kind: "deferred", label: "Deferred", tone: "neutral" };
      if (decision?.status === "accepted") return { kind: "accepted", label: "Decision accepted", tone: "positive" };
      return { kind: "received", label: "Decision received", tone: "neutral" };
    }
  }
}

export function choicePhase(choice: ArbitrationChoice, cycle: DecisionCycle): GreenPhase | null {
  if (choice === "GRANT_A") return cycle.proposals["agent-a"]?.requestedPhase ?? cycle.arbitration?.proposalA.requestedPhase ?? null;
  if (choice === "GRANT_B") return cycle.proposals["agent-b"]?.requestedPhase ?? cycle.arbitration?.proposalB.requestedPhase ?? null;
  return null;
}
