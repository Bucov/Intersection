import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { motion, useReducedMotion, type TargetAndTransition } from "motion/react";
import { SCENARIO_CATALOG, type ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { ConnectionBanner } from "@/components/simulation/ConnectionBanner";
import { SignalHud, SignalStrip } from "@/components/simulation/SignalHud";
import { SimulationRail } from "@/components/simulation/SimulationRail";
import { ViewControls } from "@/components/simulation/ViewControls";
import { ControlBar } from "@/components/simulation-controls/ControlBar";
import { ConcurrencyTimeline } from "@/components/timeline/ConcurrencyTimeline";
import { useSceneStage } from "@/hooks/useSceneStage";
import { useSessionLifecycle } from "@/hooks/useSessionLifecycle";
import { useStore } from "@/state/store";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.55, 0, 1, 0.45] as const;

function parseSeed(value: string | null): number {
  const seed = Number(value);
  return value !== null && Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff ? seed : 42;
}

export function SimulationPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const services = useServices();
  const reduced = useReducedMotion() ?? false;
  const mode: ControllerMode | null = params.mode === "ai" || params.mode === "traditional" ? params.mode : null;
  const scenarios = useStore(services.dataSource.store, s => s.catalog?.scenarios ?? SCENARIO_CATALOG);
  const requested = search.get("scenario");
  const scenario = scenarios.find(s => s.id === requested && mode !== null && s.supportedModes.includes(mode)) ?? scenarios.find(s => s.id === "normal-traffic") ?? scenarios[0];
  const seed = parseSeed(search.get("seed"));
  const stage = useSceneStage("simulation");
  const intro = useStore(services.intro, s => s.phase);
  const revealed = intro === "handoff" || intro === "done";
  // Coming from Home, the camera starts moving first; panels follow it in.
  const delay = intro === "handoff" ? 0.7 : 0.35;

  useSessionLifecycle(mode, scenario.id, seed);

  useEffect(() => {
    if (!mode) navigate("/", { replace: true });
  }, [mode, navigate]);

  if (!mode) return null;

  const enter = (axis: "x" | "y", distance: number, extra = 0): { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition } => {
    const away = reduced ? 0 : distance;
    const at = (value: number) => (axis === "x" ? { x: value } : { y: value });
    return {
      initial: { opacity: 0, ...at(away) },
      animate: revealed ? { opacity: 1, ...at(0), transition: { duration: 0.65, delay: delay + extra, ease: EASE_OUT } } : { opacity: 0, ...at(away) },
      exit: { opacity: 0, ...at(away), transition: { duration: 0.35, ease: EASE_IN } },
    };
  };

  return (
    <motion.main className="pointer-events-none fixed inset-0 z-10 flex flex-col pt-(--header-height) max-lg:overflow-y-auto lg:flex-row" exit={{ opacity: 1 }} transition={{ duration: 0.4 }} data-testid="simulation">
      <h1 className="sr-only">{mode === "ai" ? "AI intersection" : "Traditional intersection"} simulation</h1>
      <section aria-label="Intersection" className="relative flex min-h-0 flex-col max-lg:shrink-0 lg:min-w-0 lg:flex-1">
        <div ref={stage} className="relative min-h-0 max-lg:h-[58vh] lg:flex-1" aria-hidden="true" />

        <motion.div {...enter("x", -24)} className="pointer-events-none absolute left-4 top-4 z-10 max-lg:hidden">
          <SignalHud mode={mode} scenarioName={scenario.name} compact />
        </motion.div>
        <motion.div {...enter("y", -12, 0.05)} className="absolute right-4 top-4 z-10 flex flex-col items-end gap-3">
          <ViewControls />
        </motion.div>
        <div className="pointer-events-none absolute inset-x-4 top-20 z-20 flex justify-center lg:top-4">
          <ConnectionBanner />
        </div>

        <motion.div {...enter("y", 24, 0.1)} className="pointer-events-auto z-10 px-4 pb-4">
          <div className="flex flex-col gap-3 rounded-xl border bg-panel p-3 shadow-[0_18px_40px_-24px_rgb(0_0_0/0.9)]" data-testid="dock">
            <div className="lg:hidden">
              <SignalStrip />
            </div>
            <ControlBar mode={mode} scenarioId={scenario.id} seed={seed} scenarios={scenarios} />
            <ConcurrencyTimeline mode={mode} />
          </div>
        </motion.div>

        <div className="pointer-events-auto px-4 pb-4 lg:hidden">
          <SignalHud mode={mode} scenarioName={scenario.name} />
        </div>
      </section>

      <motion.aside
        {...enter("x", 40, 0.05)}
        aria-label={mode === "ai" ? "AI coordination" : "Fixed-time controller"}
        className="pointer-events-auto flex min-h-[32rem] flex-col border-t bg-panel lg:min-h-0 lg:w-(--rail-width) lg:shrink-0 lg:border-l lg:border-t-0"
      >
        <SimulationRail mode={mode} scenarioId={scenario.id} seed={seed} scenarios={scenarios} />
      </motion.aside>
    </motion.main>
  );
}
