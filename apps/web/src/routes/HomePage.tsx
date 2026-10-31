import { useState } from "react";
import { useNavigate } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { DEFAULT_SIGNAL_TIMING, type ControllerMode } from "@intersection/shared";
import { useServices } from "@/app/services";
import { ModeCard, type LegendRow } from "@/components/home/ModeCard";
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

  // The fixed cycle, phase by phase, then the same squares again, fading: it repeats whatever the queues.
  const cycle: LegendRow[] = [
    { tone: "text-signal-green", label: `${s(timing.fixedGreenMs)} green, north/south` },
    { tone: "text-signal-amber", label: `${s(timing.yellowMs)} yellow` },
    { tone: "text-signal-red", label: `${s(timing.allRedMs)} all red` },
    { tone: "text-signal-green", label: `${s(timing.fixedGreenMs)} green, east/west` },
    { tone: "text-signal-amber", label: `${s(timing.yellowMs)} yellow` },
    { tone: "text-signal-red", label: `${s(timing.allRedMs)} all red` },
    { tone: "text-signal-green", faint: true },
    { tone: "text-signal-amber", faint: true },
    { tone: "text-signal-red", faint: true },
  ];
  const pipeline: LegendRow[] = [
    { tone: "text-group-ns", label: "Agent A watches north/south" },
    { tone: "text-group-ew", label: "Agent B watches east/west, at the same time" },
    { tone: "text-jev", label: "JEV picks a plan when they disagree" },
    { tone: "text-safety", label: `The safety gate keeps green within ${s(timing.minimumGreenMs)}–${s(timing.maximumGreenMs)}` },
    { tone: "text-signal-green", label: "Then the light changes" },
  ];

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
    animate: revealed ? { opacity: 1, x: 0, transition: { duration: 0.8, delay: delay + 0.12, ease: EASE_OUT } } : { opacity: 0, x: reduced ? 0 : from * 28 },
    exit: { opacity: 0, x: reduced ? 0 : from * 56, transition: { duration: 0.42, ease: EASE_IN } },
  });
  const fade = {
    initial: { opacity: 0, y: reduced ? 0 : 6 },
    animate: revealed ? { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: EASE_OUT } } : { opacity: 0, y: reduced ? 0 : 6 },
    exit: { opacity: 0, y: reduced ? 0 : -6, transition: { duration: 0.3, ease: EASE_IN } },
  };

  return (
    <motion.main className="fixed inset-x-0 bottom-0 top-(--header-height) z-10 overflow-y-auto xl:overflow-hidden" exit={{ opacity: 1 }} transition={{ duration: 0.45 }}>
      {/* The model floats in the dark room: its roads fall away before they reach the text on either side. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 max-xl:hidden"
        style={{ background: "radial-gradient(ellipse 36% 48% at 50% 53%, transparent 30%, var(--background) 80%)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: revealed ? 1 : 0, transition: { duration: 1.1, delay: phase === "handoff" ? 0.35 : 0, ease: EASE_OUT } }}
        exit={{ opacity: 0, transition: { duration: 0.4, ease: EASE_IN } }}
      />
      <div className="grid min-h-full gap-x-12 gap-y-10 px-5 pb-10 sm:px-8 md:grid-cols-2 xl:h-full xl:grid-cols-[minmax(17rem,23rem)_1fr_minmax(17rem,23rem)] xl:gap-x-8 xl:px-12 xl:pb-8">
        <div className="flex flex-col md:col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:min-h-0">
          <motion.h1 {...fade} className="pt-3 text-center text-[clamp(1.0625rem,1.3vw,1.25rem)] font-[450] tracking-[-0.015em] text-balance text-foreground/85 sm:pt-5">
            Choose how this intersection is controlled
          </motion.h1>
          <div ref={stage} className="h-[52vh] shrink-0 md:h-[clamp(14rem,calc(100dvh_-_26rem),52vh)] xl:h-auto xl:min-h-0 xl:flex-1" aria-hidden="true" />
          <motion.p {...fade} className="relative z-[1] text-center text-[0.8125rem] text-subtle-foreground">
            Live preview: the fixed-time controller on demo traffic, simulated in your browser.
          </motion.p>
        </div>

        {/* Below xl the blocks sit under the model; the room covers the scene behind them, fading in from the caption. */}
        <div
          aria-hidden="true"
          className="pointer-events-none relative col-span-full row-[2/3] -mx-5 -mb-10 -mt-20 bg-[linear-gradient(to_bottom,transparent,var(--background)_4rem)] max-md:row-[2/4] sm:-mx-8 xl:hidden"
        />

        {/* The two controllers stand on either side of the intersection, their squares facing it. Below xl
            they sit side by side under the preview, still mirrored around the page's centre line. */}
        <div className="contents xl:pointer-events-none xl:col-span-3 xl:col-start-1 xl:row-start-1 xl:grid xl:grid-cols-subgrid xl:items-start xl:self-center">
          <motion.div {...side(-1)} className="relative z-[1] flex max-xl:col-start-1 max-xl:row-start-2 md:justify-end xl:pointer-events-auto xl:col-start-1">
            <ModeCard
              id="traditional"
              side="left"
              title="traditional"
              summary="A fixed timer, blind to traffic."
              legend={cycle}
              fact="Then the same cycle again. No AI is called: nothing is observed or predicted."
              note="The baseline the AI controller is compared against."
              action="Run traditional"
              selected={selected === "traditional"}
              disabled={selected !== null && selected !== "traditional"}
              onRun={() => run("traditional")}
            />
          </motion.div>

          <motion.div {...side(1)} className="relative z-[1] flex max-md:col-start-1 max-md:row-start-3 md:max-xl:col-start-2 md:max-xl:row-start-2 xl:pointer-events-auto xl:col-start-3">
            <ModeCard
              id="ai"
              side="right"
              title="AI"
              summary="Two AI agents propose, JEV decides."
              legend={pipeline}
              fact="Gemini agents, run in parallel through Mozaik. JEV reports its confidence with every choice."
              note={aiNote}
              action="Run AI"
              selected={selected === "ai"}
              disabled={selected !== null && selected !== "ai"}
              onRun={() => run("ai")}
            />
          </motion.div>
        </div>
      </div>
    </motion.main>
  );
}
