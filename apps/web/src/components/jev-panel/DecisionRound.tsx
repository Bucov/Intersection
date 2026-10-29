import type { AgentStatus, SignalTiming } from "@intersection/shared";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { choiceName, formatPercent, formatTimestamp, humanize, phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DecisionCycle } from "@/state/session";
import { choicePhase } from "./jevState";

type StepState = "done" | "active" | "waiting" | "skipped" | "problem";

interface Step {
  who: string;
  dot: string;
  state: StepState;
  text: string;
}

const STATE_DOT: Record<StepState, string> = {
  done: "",
  active: "animate-pulse motion-reduce:animate-none",
  waiting: "opacity-35",
  skipped: "opacity-35",
  problem: "",
};

function agentStep(who: string, dot: string, status: AgentStatus | null, cycle: DecisionCycle, id: "agent-a" | "agent-b"): Step {
  const proposal = cycle.proposals[id];
  if (proposal) return { who, dot, state: "done", text: `${phaseName(proposal.requestedPhase)} for ${proposal.requestedGreenSeconds} s ⋅ ${proposal.urgency} urgency` };
  const interval = status?.lastInference;
  if (interval?.correlationId === cycle.correlationId) {
    if (interval.outcome === "pending") return { who, dot, state: "active", text: "Observing and thinking…" };
    if (interval.outcome === "failed") return { who, dot, state: "problem", text: status?.message ?? "Inference failed" };
    if (interval.outcome === "cancelled" || interval.outcome === "stale") return { who, dot, state: "skipped", text: "Discarded" };
  }
  return { who, dot, state: "waiting", text: "No proposal" };
}

/** Plain-language account of the latest round, built only from events received for it. */
export function DecisionRound({ cycle, agents, timing }: { cycle: DecisionCycle | null; agents: [AgentStatus, AgentStatus] | null; timing: SignalTiming | null }) {
  if (!cycle) {
    return (
      <section aria-label="Latest decision round" className="rounded-lg border border-dashed p-3.5 text-[0.8125rem] leading-snug text-muted-foreground">
        The first round starts once the current green reaches its minimum time. Both agents then observe their approaches at the same moment.
      </section>
    );
  }
  const steps: Step[] = [
    agentStep("Agent A", "bg-group-ns", agents?.[0] ?? null, cycle, "agent-a"),
    agentStep("Agent B", "bg-group-ew", agents?.[1] ?? null, cycle, "agent-b"),
  ];
  const arbitration = cycle.arbitration;
  const result = arbitration?.result ?? null;
  const decision = cycle.decisions[cycle.decisions.length - 1] ?? null;
  const a = cycle.proposals["agent-a"];
  const b = cycle.proposals["agent-b"];
  const agreed = a && b && a.requestedPhase === b.requestedPhase;

  if (arbitration?.status === "pending") steps.push({ who: "JEV", dot: "bg-jev", state: "active", text: "Weighing the two requests…" });
  else if (result) steps.push({ who: "JEV", dot: "bg-jev", state: "done", text: `${choiceName(result.choice)}${choicePhase(result.choice, cycle) ? ` (${phaseName(choicePhase(result.choice, cycle)!)})` : ""} ⋅ ${formatPercent(result.confidence)} confidence, ${result.confidenceBand}` });
  else if (arbitration) steps.push({ who: "JEV", dot: "bg-jev", state: "problem", text: `No result: ${humanize(arbitration.fallbackReason ?? arbitration.status).toLowerCase()}` });
  else if (agreed) steps.push({ who: "JEV", dot: "bg-jev", state: "skipped", text: "Not needed: the agents agree" });
  else steps.push({ who: "JEV", dot: "bg-jev", state: "waiting", text: cycle.conflict ? "Conflict detected" : "Called only on conflict" });

  if (cycle.fallback) {
    steps.push({ who: "Fallback", dot: "bg-warning", state: "done", text: `${humanize(cycle.fallback.reason)} → ${phaseName(cycle.fallback.selectedPhase)} (${cycle.fallback.policy})` });
  }

  if (decision) {
    steps.push({
      who: "Safety",
      dot: "bg-safety",
      state: decision.status === "rejected" ? "problem" : "done",
      text: decision.status === "accepted"
        ? decision.requestedPhase === cycle.phaseAtDecision
          ? `Accepted ⋅ keep ${phaseName(decision.requestedPhase)}${decision.scheduledAfterSimMs !== null ? ` until ${formatTimestamp(decision.scheduledAfterSimMs)}` : ""}`
          : `Accepted ⋅ ${phaseName(decision.requestedPhase)} after clearance${decision.scheduledAfterSimMs !== null ? `, from ${formatTimestamp(decision.scheduledAfterSimMs)}` : ""}`
        : `${humanize(decision.status)} ⋅ ${humanize(decision.reason).toLowerCase()}`,
    });
  } else {
    steps.push({ who: "Safety", dot: "bg-safety", state: cycle.fallback?.selectedPhase === "HOLD" || result?.choice === "DEFER" ? "skipped" : "waiting", text: cycle.fallback?.selectedPhase === "HOLD" || result?.choice === "DEFER" ? "Nothing to validate: the current phase holds" : "Waiting for a request" });
  }

  const summary = summarize(cycle, timing);

  return (
    <section aria-labelledby="round-title" className="flex flex-col gap-3 rounded-lg border bg-card p-3.5" data-testid="decision-round">
      <header className="flex items-center justify-between gap-2">
        <h3 id="round-title" className="text-[0.9375rem] font-semibold">Latest decision round</h3>
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-xs tabular text-subtle-foreground">{formatTimestamp(cycle.startedAtSimMs)}</span>
          {a ? <ProvenanceBadge provenance={a.provenance} /> : null}
        </span>
      </header>
      <ol className="flex flex-col gap-2">
        {steps.map(step => (
          <li key={step.who} className="grid grid-cols-[4.75rem_1fr] items-baseline gap-2 text-[0.8125rem]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 translate-y-[-1px] rounded-full", step.dot, STATE_DOT[step.state])} aria-hidden="true" />
              {step.who}
            </span>
            <span className={cn("leading-snug", step.state === "problem" ? "text-destructive" : step.state === "waiting" || step.state === "skipped" ? "text-subtle-foreground" : "text-foreground")}>{step.text}</span>
          </li>
        ))}
      </ol>
      {summary ? (
        <figure className="flex flex-col gap-1 rounded-md bg-muted/60 px-3 py-2.5">
          <p className="text-[0.8125rem] leading-relaxed" data-testid="round-summary">{summary}</p>
          <figcaption className="text-[0.6875rem] text-subtle-foreground">Summary written by this app from the events above, not by JEV.</figcaption>
        </figure>
      ) : null}
    </section>
  );
}

function summarize(cycle: DecisionCycle, timing: SignalTiming | null): string | null {
  const a = cycle.proposals["agent-a"];
  const b = cycle.proposals["agent-b"];
  const decision = cycle.decisions[cycle.decisions.length - 1];
  const result = cycle.arbitration?.result;
  if (!decision && !cycle.fallback && !result) return null;
  const parts: string[] = [];
  if (a && b) {
    parts.push(a.requestedPhase === b.requestedPhase
      ? `Both agents asked for ${phaseName(a.requestedPhase)}, so no arbitration was needed.`
      : `Agent A asked for ${phaseName(a.requestedPhase)} and Agent B asked for ${phaseName(b.requestedPhase)}.`);
  } else if (a || b) {
    parts.push(`Only ${a ? "Agent A" : "Agent B"} produced a proposal.`);
  } else {
    parts.push("Neither agent produced a usable proposal.");
  }
  if (result) parts.push(`JEV chose to ${choiceName(result.choice).toLowerCase()} with ${formatPercent(result.confidence)} confidence (${result.confidenceBand}).`);
  else if (cycle.arbitration?.status === "failed") parts.push("JEV did not answer in time, so it reported no confidence.");
  if (cycle.fallback) parts.push(`The deterministic fallback (${cycle.fallback.reason.replaceAll("_", " ")}) chose to ${cycle.fallback.selectedPhase === "HOLD" ? "hold the current phase" : `serve ${phaseName(cycle.fallback.selectedPhase)}`}.`);
  if (decision) {
    if (decision.status === "accepted") {
      const clearance = timing ? ` after ${timing.yellowMs / 1000} s of yellow and ${timing.allRedMs / 1000} s of all red` : "";
      parts.push(decision.requestedPhase === cycle.phaseAtDecision
        ? `The safety gate approved keeping ${phaseName(decision.requestedPhase)} a little longer.`
        : `The safety gate approved the change; ${phaseName(decision.requestedPhase)} follows${clearance}.`);
    } else if (decision.status === "rejected") {
      parts.push(`The safety gate rejected it (${decision.reason.replaceAll("_", " ")}).`);
    }
  }
  return parts.join(" ");
}
