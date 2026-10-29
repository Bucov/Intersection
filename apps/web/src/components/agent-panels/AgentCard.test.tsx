import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AgentStatus } from "@intersection/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { agentVerdict } from "@/state/session";
import { sessionStateAfter } from "@/test/fixtures";
import { AgentCard } from "./AgentCard";

function renderCard(props: Parameters<typeof AgentCard>[0]) {
  return render(<TooltipProvider><AgentCard {...props} /></TooltipProvider>);
}

describe("AgentCard", () => {
  it("renders an agent's observation, proposal, rationale and outcome from normalized state", () => {
    const state = sessionStateAfter("simultaneous-proposals", 20);
    const cycle = state.cycles.find(c => c.arbitration?.result && c.proposals["agent-a"])!;
    const proposal = cycle.proposals["agent-a"]!;
    renderCard({ agentId: "agent-a", agent: state.agents![0], proposal, verdict: agentVerdict(cycle, "agent-a") });
    expect(screen.getByRole("article", { name: "Agent A, North/South" })).toBeInTheDocument();
    expect(screen.getByTestId("agent-proposal-agent-a")).toHaveTextContent(`${proposal.requestedGreenSeconds} s`);
    expect(screen.getByText(proposal.rationale)).toBeInTheDocument();
    expect(screen.getByText("Mock rationale (rule-based)")).toBeInTheDocument();
    expect(screen.getByText("Mock")).toBeInTheDocument();
    expect(screen.getByTestId("agent-verdict-agent-a").textContent).toMatch(/Granted by JEV|Not selected by JEV|Overruled|deferred|Chosen by the fallback/);
  });

  it("labels live model output as model rationale", () => {
    const state = sessionStateAfter("simultaneous-proposals", 20);
    const cycle = state.cycles.find(c => c.proposals["agent-b"])!;
    const proposal = { ...cycle.proposals["agent-b"]!, provenance: "live" as const };
    const agent: AgentStatus = { ...state.agents![1], provenance: "live", model: "gemini-model-from-backend" };
    renderCard({ agentId: "agent-b", agent, proposal, verdict: { kind: "waiting" } });
    expect(screen.getByText("Model rationale")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("gemini-model-from-backend")).toBeInTheDocument();
    expect(screen.queryByText(/simulated/)).not.toBeInTheDocument();
  });

  it("shows a disabled agent in fixed-time mode without inventing activity", () => {
    const state = sessionStateAfter("normal-traffic", 5, "traditional");
    renderCard({ agentId: "agent-a", agent: state.agents![0], proposal: null, verdict: { kind: "none" } });
    expect(screen.getByText("Fixed-time mode: agents are not called.")).toBeInTheDocument();
    expect(screen.getByText("Not used by this controller.")).toBeInTheDocument();
    expect(screen.getByText("No inference yet")).toBeInTheDocument();
  });

  it("handles a missing agent status", () => {
    renderCard({ agentId: "agent-b", agent: null, proposal: null, verdict: { kind: "none" } });
    expect(screen.getByText("Waiting for the session")).toBeInTheDocument();
  });
});
