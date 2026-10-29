import { useState } from "react";
import { useNavigate } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { DEFAULT_SIGNAL_TIMING, type ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { DecisionPipelineDiagram, FixedCycleDiagram } from "@/components/home/ModeDiagrams";
import { ModeCard } from "@/components/home/ModeCard";
import { useSceneStage } from "@/hooks/useSceneStage";
import { useStore } from "@/state/store";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_IN = [0.55, 0, 1, 0.45] as const;

export function HomePage() {
  const services = useServices();
  const navigate = useNavigate();
  const reduced = useReducedMotion() ?? false;
  const stage = useSceneStage("preview");
  const phase = useStore(services.intro, s => s.phase);
  const source = useStore(services.dataSource.store, s => s);
  const [selected, setSelected] = useState<ControllerMode | null>(null);
  const revealed = phase === "handoff" || phase === "done";
  const delay = phase === "handoff" ? 0.55 : 0.05;
  const timing = source.catalog?.config.signalTiming ?? DEFAULT_SIGNAL_TIMING;
  const s = (ms: number) => `${Math.round(ms / 1000)} s`;

  const providers = source.health?.providers;
  const aiNote = source.kind === "mock"
    ? "Offline demo: the agents and JEV are simulated in your browser. No models are called."
    : providers?.some(p => p.mode === "live")
      ? providers.every(p => p.status === "ready")
        ? "Live backend: proposals and arbitration come from the real models."
        : "Live backend, but a model provider is not ready. The controller will fall back to deterministic rules."
      : "Backend in mock mode: model outputs are simulated by the server.";

  const run = (mode: ControllerMode) => {
    if (selected) return;
    setSelected(mode);
    window.setTimeout(() => navigate(`/simulate/${mode}`), reduced ? 0 : 200);
  };

  const side = (from: -1 | 1) => ({
    initial: { opacity: 0, x: reduced ? 0 : from * 28 },
    animate: revealed ? { opacity: 1, x: 0, transition: { duration: 0.7, delay: delay + 0.08, ease: EASE_OUT } } : { opacity: 0, x: reduced ? 0 : from * 28 },
    exit: { opacity: 0, x: reduced ? 0 : from * 56, transition: { duration: 0.42, ease: EASE_IN } },
  });
  const fade = {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: revealed ? { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: EASE_OUT } } : { opacity: 0, y: reduced ? 0 : 6 },
    exit: { opacity: 0, y: reduced ? 0 : -6, transition: { duration: 0.3, ease: EASE_IN } },
  };

  return (
    <motion.main className="fixed inset-0 z-10 overflow-y-auto pt-(--header-height) lg:overflow-hidden" exit={{ opacity: 1 }} transition={{ duration: 0.45 }}>
      <div className="grid min-h-full gap-x-8 gap-y-5 px-4 pb-6 sm:px-6 lg:h-full lg:grid-cols-[minmax(18.5rem,23rem)_1fr_minmax(18.5rem,23rem)] lg:px-8 lg:pb-8">
        <div className="flex flex-col lg:col-start-2 lg:row-start-1 lg:min-h-0">
          <motion.h1 {...fade} className="pt-5 text-center text-[clamp(1.375rem,2.2vw,1.875rem)] font-semibold tracking-[-0.015em] text-balance sm:pt-7">
            Choose how this intersection is controlled
          </motion.h1>
          <div ref={stage} className="h-[52vh] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1" aria-hidden="true" />
          <motion.p {...fade} className="text-center text-sm text-subtle-foreground">
            Live preview: the fixed-time controller on demo traffic, simulated in your browser.
          </motion.p>
        </div>

        <motion.div {...side(-1)} className="flex lg:col-start-1 lg:row-start-1 lg:items-center">
          <ModeCard
            id="traditional"
            title="Traditional intersection"
            summary="A fixed timer. Each direction gets the same green time every cycle, however many cars are waiting."
            diagram={<FixedCycleDiagram timing={timing} />}
            facts={[
              `${s(timing.fixedGreenMs)} green for North/South, then ${s(timing.fixedGreenMs)} for East/West`,
              `${s(timing.yellowMs)} yellow and ${s(timing.allRedMs)} all-red between phases`,
              "No AI is called: nothing is observed or predicted",
            ]}
            action="Run traditional"
            selected={selected === "traditional"}
            disabled={selected !== null && selected !== "traditional"}
            onRun={() => run("traditional")}
            className="w-full"
          />
        </motion.div>

        <motion.div {...side(1)} className="flex lg:col-start-3 lg:row-start-1 lg:items-center">
          <ModeCard
            id="ai"
            title="AI intersection"
            summary="Two Gemini agents watch the roads at the same time and propose green times. When they disagree, JEV decides. A safety gate checks every change before the light switches."
            diagram={<DecisionPipelineDiagram />}
            facts={[
              "Agent A watches North/South, Agent B East/West, in parallel (Mozaik)",
              "JEV picks between conflicting proposals and reports its confidence",
              `The safety gate enforces ${s(timing.minimumGreenMs)}–${s(timing.maximumGreenMs)} green, yellow and all-red`,
            ]}
            note={aiNote}
            action="Run AI"
            selected={selected === "ai"}
            disabled={selected !== null && selected !== "ai"}
            onRun={() => run("ai")}
            className="w-full"
          />
        </motion.div>
      </div>
    </motion.main>
  );
}
