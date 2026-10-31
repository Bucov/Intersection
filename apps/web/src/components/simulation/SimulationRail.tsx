import { DecisionStatsPanel } from "@/components/decision-stats/DecisionStatsPanel";
import { Suspense, lazy, useState } from "react";
import type { ControllerMode, ScenarioDefinition, ScenarioId } from "@intersection/shared";
import { useServices } from "@/app/services";
import { AgentCard } from "@/components/agent-panels/AgentCard";
import { DecisionRound } from "@/components/jev-panel/DecisionRound";
import { JevPanel } from "@/components/jev-panel/JevPanel";
import { Transcript } from "@/components/transcript/Transcript";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { agentVerdict, latestCycle, type SessionState } from "@/state/session";
import { useStore } from "@/state/store";
import { FixedTimePanel } from "./FixedTimePanel";

// Charts load on first use of their tabs.
const MetricsPanel = lazy(() => import("@/components/metrics/MetricsPanel").then(m => ({ default: m.MetricsPanel })));
const ComparisonPanel = lazy(() => import("@/components/comparison/ComparisonPanel").then(m => ({ default: m.ComparisonPanel })));

function TabLoading() {
  return <p className="text-sm text-subtle-foreground">Loading…</p>;
}

function findProposal(state: SessionState, agentId: "agent-a" | "agent-b") {
  for (let i = state.cycles.length - 1; i >= 0; i--) {
    const p = state.cycles[i].proposals[agentId];
    if (p) return { proposal: p, cycle: state.cycles[i] };
  }
  return null;
}

function DecisionsTab() {
  const { session } = useServices();
  const view = useStore(session.store, s => {
    const a = findProposal(s, "agent-a");
    const b = findProposal(s, "agent-b");
    return {
      cycle: latestCycle(s),
      agents: s.agents,
      timing: s.snapshot?.config.signalTiming ?? null,
      jevModel: s.providers?.[1].model ?? null,
      controller: s.controller,
      a,
      b,
    };
  }, (x, y) =>
    x.cycle === y.cycle && x.agents === y.agents && x.timing === y.timing && x.jevModel === y.jevModel && x.controller === y.controller &&
    x.a?.proposal === y.a?.proposal && x.a?.cycle === y.a?.cycle && x.b?.proposal === y.b?.proposal && x.b?.cycle === y.b?.cycle);

  return (
    <div className="flex flex-col gap-3">
      {view.controller?.activeController === "deterministic_fallback" ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[0.8125rem] leading-snug text-warning" role="status">
          Deterministic fallback in control{view.controller.reason ? `: ${view.controller.reason}` : ""}. Rules, not models, are choosing phases.
        </p>
      ) : null}
      <DecisionRound cycle={view.cycle} agents={view.agents} timing={view.timing} />
      <div className="grid grid-cols-2 gap-3" aria-label="The two agents, working independently">
        <AgentCard agentId="agent-a" agent={view.agents?.[0] ?? null} proposal={view.a?.proposal ?? null} verdict={agentVerdict(view.a?.cycle ?? null, "agent-a")} />
        <AgentCard agentId="agent-b" agent={view.agents?.[1] ?? null} proposal={view.b?.proposal ?? null} verdict={agentVerdict(view.b?.cycle ?? null, "agent-b")} />
      </div>
      <JevPanel cycle={view.cycle} jevModel={view.jevModel} />
    </div>
  );
}

interface RailProps {
  mode: ControllerMode;
  scenarioId: ScenarioId;
  seed: number;
  scenarios: readonly ScenarioDefinition[];
}

export function SimulationRail({ mode, scenarioId, seed, scenarios }: RailProps) {
  const [tab, setTab] = useState<string>(mode === "ai" ? "decisions" : "controller");
  const primary = mode === "ai" ? "decisions" : "controller";
  const active = tab === "decisions" || tab === "controller" ? primary : tab;

  return (
    <Tabs value={active} onValueChange={value => setTab(String(value))} className="flex h-full min-h-0 flex-col gap-0">
      <TabsList variant="line" className="h-11 w-full overflow-x-auto shrink-0 justify-start gap-1 rounded-none border-b px-3">
        <TabsTrigger value={primary} className="flex-none px-2.5">{mode === "ai" ? "Decisions" : "Controller"}</TabsTrigger>
        <TabsTrigger value="transcript" className="flex-none px-2.5">{mode === "ai" ? "Transcript" : "Events"}</TabsTrigger>
        <TabsTrigger value="stats" className="flex-none px-2.5">Decision Stats</TabsTrigger>
        <TabsTrigger value="metrics" className="flex-none px-2.5">Metrics</TabsTrigger>
        <TabsTrigger value="compare" className="flex-none px-2.5">Compare</TabsTrigger>
      </TabsList>
      <TabsContent value={primary} className="min-h-0 flex-1 overflow-y-auto p-4">
        {mode === "ai" ? <DecisionsTab /> : <FixedTimePanel />}
      </TabsContent>
      <TabsContent value="transcript" className="flex min-h-0 flex-1 flex-col pt-3">
        <Transcript />
      </TabsContent>
      <TabsContent value="stats" className="min-h-0 flex-1 overflow-y-auto p-4"><DecisionStatsPanel /></TabsContent>
      <TabsContent value="metrics" className="min-h-0 flex-1 overflow-y-auto p-4">
        <Suspense fallback={<TabLoading />}>
          <MetricsPanel mode={mode} />
        </Suspense>
      </TabsContent>
      <TabsContent value="compare" className="min-h-0 flex-1 overflow-y-auto p-4">
        <Suspense fallback={<TabLoading />}>
          <ComparisonPanel scenarioId={scenarioId} seed={seed} scenarios={scenarios} />
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
