import { useState } from "react";
import { AlertTriangle, CircleDot, LoaderCircle, Pause, Send } from "lucide-react";
import type { AgentId, AgentStatus, TrafficProposal } from "@intersection/shared";
import { ProvenanceBadge } from "@/components/common/ProvenanceBadge";
import { Square } from "@/components/common/Square";
import { formatLatency, humanize, phaseName } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgentVerdict } from "@/state/session";

const IDENTITY: Record<AgentId, { name: string; group: string; text: string }> = {
  "agent-a": { name: "Agent A", group: "North/South", text: "text-group-ns" },
  "agent-b": { name: "Agent B", group: "East/West", text: "text-group-ew" },
};

function statusLine(agent: AgentStatus | null): { icon: React.ReactNode; text: string } {
  if (!agent) return { icon: <CircleDot />, text: "Waiting for the session" };
  switch (agent.status) {
    case "inference": return { icon: <LoaderCircle className="animate-spin motion-reduce:animate-none" />, text: "Observing and thinking…" };
    case "proposal_pending": return { icon: <Send />, text: "Proposal sent, awaiting decision" };
    case "cooldown": return { icon: <Pause />, text: "Waiting for the next decision window" };
    case "error": return { icon: <AlertTriangle />, text: agent.message ?? "Inference failed" };
    case "disabled": return { icon: <CircleDot />, text: agent.message ?? "Disabled" };
    case "idle": return { icon: <CircleDot />, text: agent.message ?? "Idle until the next decision window" };
  }
}

function verdictText(verdict: AgentVerdict): { text: string; tone: "positive" | "negative" | "neutral" | "warning" } | null {
  switch (verdict.kind) {
    case "none": return null;
    case "waiting": return { text: "Awaiting the decision", tone: "neutral" };
    case "accepted":
      return {
        text: verdict.via === "agreement" ? "Accepted: both agents agreed" : verdict.via === "arbitration" ? "Granted by JEV" : verdict.via === "fallback" ? "Chosen by the fallback rules" : "Accepted by the safety gate",
        tone: "positive",
      };
    case "not-selected": return { text: verdict.by === "jev" ? "Not selected by JEV" : "Overruled by the fallback rules", tone: "neutral" };
    case "deferred": return { text: "JEV deferred both requests", tone: "neutral" };
    case "rejected": return { text: `Rejected by the safety gate: ${humanize(verdict.decision.reason).toLowerCase()}`, tone: "negative" };
  }
}

const TONE = { positive: "text-positive", negative: "text-destructive", neutral: "text-muted-foreground", warning: "text-warning" } as const;

export function AgentCard({ agentId, agent, proposal, verdict }: { agentId: AgentId; agent: AgentStatus | null; proposal: TrafficProposal | null; verdict: AgentVerdict }) {
  const identity = IDENTITY[agentId];
  const [expanded, setExpanded] = useState(false);
  const status = statusLine(agent);
  const outcome = verdictText(verdict);
  const interval = agent?.lastInference ?? null;

  return (
    <article aria-label={`${identity.name}, ${identity.group}`} className="flex min-w-0 flex-col gap-3 border-t pt-3" data-testid={`agent-card-${agentId}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold leading-tight">
            <Square className={cn("size-2", identity.text)} />
            {identity.name}
          </h3>
          <p className={cn("text-xs", identity.text)}>{identity.group}</p>
        </div>
        {agent ? <ProvenanceBadge provenance={agent.provenance} /> : null}
      </header>

      <p className={cn("flex items-start gap-1.5 text-[0.8125rem] leading-snug [&_svg]:mt-0.5 [&_svg]:size-3.5 [&_svg]:shrink-0", agent?.status === "error" ? "text-destructive" : "text-muted-foreground")} data-testid={`agent-status-${agentId}`}>
        {status.icon}
        <span className="min-w-0">{status.text}</span>
      </p>

      {proposal ? (
        <div className="flex flex-col gap-2.5 text-[0.8125rem]">
          <div>
            <p className="text-xs text-subtle-foreground">Observed</p>
            <p className="tabular leading-snug">
              {proposal.observations.queueLength} queued ⋅ longest wait {Math.round(proposal.observations.maxWaitSeconds)} s
              {proposal.observations.emergencyCount > 0 ? <span className="text-emergency"> ⋅ {proposal.observations.emergencyCount} emergency</span> : null}
            </p>
          </div>
          <div>
            <p className="text-xs text-subtle-foreground">Asks for</p>
            <p className="font-medium leading-snug" data-testid={`agent-proposal-${agentId}`}>
              {phaseName(proposal.requestedPhase)} ⋅ {proposal.requestedGreenSeconds} s
            </p>
            <p className={cn("text-xs", proposal.urgency === "emergency" ? "text-emergency" : proposal.urgency === "high" ? "text-warning" : "text-subtle-foreground")}>{humanize(proposal.urgency)} urgency</p>
          </div>
          <figure className="flex flex-col gap-1">
            <blockquote className={cn("leading-snug text-muted-foreground", !expanded && "line-clamp-4")}>{proposal.rationale}</blockquote>
            <figcaption className="flex items-center justify-between gap-2 text-[0.6875rem] text-subtle-foreground">
              <span>{proposal.provenance === "live" ? "Model rationale" : "Mock rationale (rule-based)"}</span>
              {proposal.rationale.length > 110 ? (
                <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" onClick={() => setExpanded(v => !v)}>
                  {expanded ? "Less" : "More"}
                </button>
              ) : null}
            </figcaption>
          </figure>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-subtle-foreground">{agent?.status === "disabled" ? "Not used by this controller." : "No proposal yet in this generation."}</p>
      )}

      <footer className="mt-auto flex flex-col gap-1 border-t pt-2.5 text-xs">
        {outcome ? <p className={cn("font-medium leading-snug", TONE[outcome.tone])} data-testid={`agent-verdict-${agentId}`}>{outcome.text}</p> : null}
        <p className="tabular text-subtle-foreground">
          {interval ? (interval.outcome === "pending" ? "Inference running" : `Inference ${formatLatency(interval.latencyMs)}${agent?.latencyMeasurement === "wall" ? " (wall time)" : agent?.provenance === "mock" ? " (simulated)" : ""}`) : "No inference yet"}
          {agent && agent.requestCount > 0 ? ` ⋅ ${agent.requestCount} request${agent.requestCount === 1 ? "" : "s"}` : ""}
        </p>
        {agent?.provider ? <p className="text-subtle-foreground">{agent.provider === "claude" ? "Claude / Anthropic" : agent.provider === "gemini" ? "Gemini" : "Offline runner"}</p> : null}
        {agent?.model ? <p className="truncate text-subtle-foreground" title={agent.model}>{agent.model}</p> : null}
      </footer>
    </article>
  );
}
