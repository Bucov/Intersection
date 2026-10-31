import { DecisionStatsPanel } from "@/components/decision-stats/DecisionStatsPanel";
import { Suspense, lazy, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { StatsBoard } from "@/components/decision-stats/StatsBoard";
import { useViewport } from "@/hooks/useViewport";
import { cn } from "@/lib/utils";
import type { ControllerMode, ScenarioDefinition, ScenarioId } from "@intersection/shared";
import { useServices } from "@/app/services";
import { AgentCard } from "@/components/agent-panels/AgentCard";
import { DecisionRound } from "@/components/jev-panel/DecisionRound";
import { JevPanel } from "@/components/jev-panel/JevPanel";
import { Transcript } from "@/components/transcript/Transcript";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatClock } from "@/lib/format";
import { agentVerdict, type DecisionCycle } from "@/state/session";
import { useStore } from "@/state/store";
import { FixedTimePanel } from "./FixedTimePanel";

// Charts load on first use of their tabs.
const MetricsPanel = lazy(() => import("@/components/metrics/MetricsPanel").then(m => ({ default: m.MetricsPanel })));
const ComparisonPanel = lazy(() => import("@/components/comparison/ComparisonPanel").then(m => ({ default: m.ComparisonPanel })));

function TabLoading() {
  return <p className="text-sm text-subtle-foreground">Loading…</p>;
}

function findProposal(cycles: DecisionCycle[], agentId: "agent-a" | "agent-b") {
  for (let i = cycles.length - 1; i >= 0; i--) {
    const p = cycles[i].proposals[agentId];
    if (p) return { proposal: p, cycle: cycles[i] };
  }
  return null;
}

function DecisionsTab() {
  const { session, replay } = useServices();
  const replaying = useStore(replay, r => r.time);
  const view = useStore(session.store, s => {
    // While replaying, the rail explains the moment on screen: the rounds started by then.
    const cycles = replaying === null ? s.cycles : s.cycles.filter(c => c.startedAtSimMs <= replaying);
    const a = findProposal(cycles, "agent-a");
    const b = findProposal(cycles, "agent-b");
    return {
      cycle: cycles[cycles.length - 1] ?? null,
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
        <p className="border border-warning/40 bg-warning/10 px-3 py-2 text-[0.8125rem] leading-snug text-warning" role="status">
          Deterministic fallback in control{view.controller.reason ? `: ${view.controller.reason}` : ""}. Rules, not models, are choosing phases.
        </p>
      ) : null}
      {replaying !== null ? (
        <p className="text-sm leading-relaxed text-muted-foreground" role="status">Replaying {formatClock(replaying)}. Below is the latest round that had started by then; agent status lines still describe the paused session.</p>
      ) : (
        <p className="text-sm leading-relaxed">Two agents inspect the same traffic at the same time. They plan service for North/South and East/West. JEV resolves disagreements or failed requests; the safety controller enforces green limits and clearance before lights change.</p>
      )}
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

/** The rail's width at rest (matches --rail-width) and when Statistics opens over the scene. */
function widths(viewport: number) {
  const rest = Math.min(480, Math.max(352, viewport * 0.3));
  return { rest, open: Math.max(rest, Math.min(viewport - 300, 1280)) };
}

export function SimulationRail({ mode, scenarioId, seed, scenarios }: RailProps) {
  const { session } = useServices();
  const reduced = useReducedMotion() ?? false;
  const viewport = useViewport();
  const [tab, setTab] = useState<string>(new URLSearchParams(window.location.search).has("comparison") ? "compare" : mode === "ai" ? "decisions" : "controller");
  const primary = mode === "ai" ? "decisions" : "controller";
  const active = tab === "decisions" || tab === "controller" ? primary : tab;
  const open = active === "stats";
  const wide = viewport.width >= 1024;
  const { rest, open: openWidth } = widths(viewport.width);
  const scenarioName = scenarios.find(s => s.id === scenarioId)?.name ?? scenarioId;

  const select = (value: string) => {
    setTab(value);
    // Statistics are for reading the run: hold it still while they are open.
    if (value === "stats" && session.store.getState().status === "running") void session.control("pause");
  };

  return (
    <motion.div
      className={cn("flex h-full min-h-0 flex-col transition-colors duration-500 lg:absolute lg:inset-y-0 lg:right-0 lg:z-30 lg:border-l", open ? "bg-background" : "bg-panel")}
      initial={false}
      animate={wide ? { width: open ? openWidth : rest } : { width: "100%" }}
      transition={{ duration: reduced ? 0 : 0.7, ease: [0.16, 1, 0.3, 1] }}
      data-expanded={open || undefined}
    >
      <Tabs value={active} onValueChange={value => select(String(value))} className="flex h-full min-h-0 flex-col gap-0">
        <div className="flex shrink-0 items-center border-b">
          <TabsList variant="line" className="h-11 min-w-0 flex-1 overflow-x-auto justify-start gap-0.5 rounded-none px-2">
            <TabsTrigger value={primary} className="flex-none px-2">{mode === "ai" ? "Decisions" : "Controller"}</TabsTrigger>
            <TabsTrigger value="transcript" className="flex-none px-2">{mode === "ai" ? "Transcript" : "Events"}</TabsTrigger>
            <TabsTrigger value="stats" className="flex-none px-2">Statistics</TabsTrigger>
            <TabsTrigger value="metrics" className="flex-none px-2">Metrics</TabsTrigger>
            <TabsTrigger value="compare" className="flex-none px-2">Compare</TabsTrigger>
          </TabsList>
          {open ? (
            <button type="button" onClick={() => setTab(primary)} className="mr-2 inline-flex h-8 shrink-0 items-center gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground" aria-label="Close statistics">
              <X className="size-4" aria-hidden="true" />
              <span className="max-sm:hidden">Close</span>
            </button>
          ) : null}
        </div>
        <TabsContent value={primary} className="min-h-0 flex-1 overflow-y-auto p-4">
          {mode === "ai" ? <DecisionsTab /> : <FixedTimePanel />}
        </TabsContent>
        <TabsContent value="transcript" className="flex min-h-0 flex-1 flex-col pt-3">
          <Transcript />
        </TabsContent>
        <TabsContent value="stats" className="min-h-0 flex-1 overflow-y-auto px-5 py-6 lg:px-10 lg:py-8">
          {open ? (
            <motion.div
              className="mx-auto flex max-w-6xl flex-col gap-12"
              initial={{ opacity: 0, y: reduced ? 0 : 10 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.5, delay: reduced ? 0 : 0.25, ease: [0.16, 1, 0.3, 1] } }}
            >
              <StatsBoard mode={mode} scenarioName={scenarioName} />
              <details className="group border-t pt-5">
                <summary className="w-fit cursor-pointer text-sm text-muted-foreground hover:text-foreground">Full breakdown</summary>
                <div className="mt-5 max-w-3xl"><DecisionStatsPanel /></div>
              </details>
            </motion.div>
          ) : null}
        </TabsContent>
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
    </motion.div>
  );
}
