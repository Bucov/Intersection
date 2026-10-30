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
    ? "Offline demo: agents and JEV are simulated here, no models are called."
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
    <motion.main className="fixed inset-0 z-10 overflow-y-auto pt-(--header-height) xl:overflow-hidden" exit={{ opacity: 1 }} transition={{ duration: 0.45 }}>
      <div className="grid min-h-full gap-x-8 gap-y-5 px-4 pb-6 sm:px-6 md:grid-cols-2 xl:h-full xl:grid-cols-[minmax(18.5rem,23rem)_1fr_minmax(18.5rem,23rem)] xl:px-8 xl:pb-8">
        <div className="flex flex-col md:col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:min-h-0">
          <motion.h1 {...fade} className="pt-5 text-center text-[clamp(1.375rem,2.2vw,1.875rem)] font-semibold tracking-[-0.015em] text-balance sm:pt-7">
            Choose how this intersection is controlled
          </motion.h1>
          <div ref={stage} className="h-[52vh] shrink-0 md:h-[clamp(14rem,calc(100dvh_-_21rem),52vh)] xl:h-auto xl:min-h-0 xl:flex-1" aria-hidden="true" />
          <motion.p {...fade} className="text-center text-sm text-subtle-foreground">
            Live preview: the fixed-time controller on demo traffic, simulated in your browser.
          </motion.p>
        </div>

        {/* Side by side below the preview from tablet width. On wide screens the two choices flank the
            preview and share one row of the page grid, so they get one height and one top line. */}
        <div className="contents xl:pointer-events-none xl:col-span-3 xl:col-start-1 xl:row-start-1 xl:grid xl:grid-cols-subgrid xl:self-center">
          <motion.div {...side(-1)} className="flex xl:pointer-events-auto xl:col-start-1">
            <ModeCard
              id="traditional"
              title="Traditional intersection"
              summary="A fixed timer, blind to traffic."
              diagram={<FixedCycleDiagram timing={timing} />}
              facts={[
                `${s(timing.fixedGreenMs)} green for North/South, then ${s(timing.fixedGreenMs)} for East/West`,
                `${s(timing.yellowMs)} yellow and ${s(timing.allRedMs)} all-red between phases`,
                "No AI is called: nothing is observed or predicted",
              ]}
              note="The baseline the AI controller is compared against."
              action="Run traditional"
              selected={selected === "traditional"}
              disabled={selected !== null && selected !== "traditional"}
              onRun={() => run("traditional")}
              className="w-full"
            />
          </motion.div>

          <motion.div {...side(1)} className="flex xl:pointer-events-auto xl:col-start-3">
            <ModeCard
              id="ai"
              title="AI intersection"
              summary="Two AI agents propose, JEV decides."
              diagram={<DecisionPipelineDiagram />}
              facts={[
                "Gemini agents A (North/South) and B (East/West) reason in parallel through Mozaik",
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
      </div>
    </motion.main>
  );
}
