import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DecisionCycle } from "@/state/session";
import { sessionStateAfter } from "@/test/fixtures";
import { DecisionRound } from "./DecisionRound";
import { JevPanel } from "./JevPanel";
import { jevState } from "./jevState";

const wrap = (node: React.ReactNode) => render(<TooltipProvider>{node}</TooltipProvider>);

function arbitrated(scenario: "simultaneous-proposals" | "jev-failure" | "jev-uncertainty", seconds = 25): DecisionCycle {
  const state = sessionStateAfter(scenario, seconds);
  const cycle = state.cycles.find(c => c.arbitration && c.arbitration.status !== "pending");
  if (!cycle) throw new Error(`no arbitration in ${scenario}`);
  return cycle;
}

describe("JEV panel", () => {
  it("shows a completed mock arbitration with its distribution and confidence", () => {
    const cycle = arbitrated("simultaneous-proposals");
    wrap(<JevPanel cycle={cycle} jevModel="mock-jev-v1" />);
    const result = cycle.arbitration!.result!;
    expect(screen.getByTestId("jev-panel")).toHaveTextContent(/Called because Agent A asked for/);
    expect(screen.getByRole("list", { name: "Choice distribution" }).querySelectorAll("li")).toHaveLength(result.probabilities.length);
    expect(screen.getByRole("meter", { name: "JEV confidence" })).toHaveAttribute("aria-valuenow", String(Math.round(result.confidence * 100)));
    expect(screen.getByText(/Reported by the mock arbiter, not derived from the top probability/)).toBeInTheDocument();
    expect(screen.getAllByText("Mock").length).toBeGreaterThan(0);
  });

  it("distinguishes live output from mock output", () => {
    const mock = arbitrated("simultaneous-proposals");
    const live: DecisionCycle = {
      ...mock,
      proposals: Object.fromEntries(Object.entries(mock.proposals).map(([k, p]) => [k, { ...p, provenance: "live" }])),
      arbitration: { ...mock.arbitration!, result: { ...mock.arbitration!.result!, provenance: "live", model: "jev-from-backend" } },
    };
    wrap(<JevPanel cycle={live} jevModel={null} />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByText("Mock")).not.toBeInTheDocument();
    expect(screen.getByText(/Reported by JEV/)).toBeInTheDocument();
    expect(screen.getByText("jev-from-backend")).toBeInTheDocument();
  });

  it("reports a timeout without inventing a confidence", () => {
    const cycle = arbitrated("jev-failure");
    expect(jevState(cycle).kind).toBe("timeout");
    wrap(<JevPanel cycle={cycle} jevModel="mock-jev-v1" />);
    expect(screen.getByTestId("jev-state")).toHaveTextContent("Timed out ⋅ fallback used");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByText(/A timeout is not a 0% answer/)).toBeInTheDocument();
  });

  it("flags injected low confidence and the fallback it triggers", () => {
    const cycle = arbitrated("jev-uncertainty");
    expect(jevState(cycle).kind).toBe("low-confidence");
    wrap(<JevPanel cycle={cycle} jevModel="mock-jev-v1" />);
    expect(screen.getByTestId("jev-state")).toHaveTextContent("Low confidence ⋅ fallback used");
    expect(screen.getByText(/Low hands the decision to the fallback rules/)).toBeInTheDocument();
  });

  it("says when no arbitration was needed", () => {
    const state = sessionStateAfter("normal-traffic", 40);
    const agreed = state.cycles.find(c => !c.arbitration && c.decisions.length && c.proposals["agent-a"] && c.proposals["agent-b"]);
    expect(agreed).toBeDefined();
    wrap(<JevPanel cycle={agreed!} jevModel={null} />);
    expect(screen.getByTestId("jev-state")).toHaveTextContent("No arbitration needed");
  });

  it("handles an empty session", () => {
    wrap(<JevPanel cycle={null} jevModel={null} />);
    expect(screen.getByTestId("jev-state")).toHaveTextContent("Waiting for the first round");
  });
});

describe("Decision round", () => {
  it("explains the round in plain language and labels the summary as app-written", () => {
    const state = sessionStateAfter("simultaneous-proposals", 25);
    const cycle = state.cycles.find(c => c.arbitration?.result && c.decisions.length)!;
    wrap(<DecisionRound cycle={cycle} agents={state.agents} timing={state.snapshot!.config.signalTiming} />);
    expect(screen.getByTestId("round-summary").textContent).toMatch(/Agent A asked for .* and Agent B asked for/);
    expect(screen.getByText("Summary written by this app from the events above, not by JEV.")).toBeInTheDocument();
  });
});
