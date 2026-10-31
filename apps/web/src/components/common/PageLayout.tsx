import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useServices } from "@/app/services";
import { useSceneStage } from "@/hooks/useSceneStage";
import { useStore } from "@/state/store";

/** Quiet document layout for Settings, About and Not found; the 3D scene is hidden behind it. */
export function PageLayout({ title, lead, children, compact = false }: { title: ReactNode; lead?: ReactNode; children: ReactNode; compact?: boolean }) {
  const reduced = useReducedMotion() ?? false;
  const stage = useSceneStage("hidden");
  const { intro } = useServices();
  const phase = useStore(intro, s => s.phase);
  const revealed = phase === "handoff" || phase === "done";
  return (
    <motion.main
      className="fixed inset-x-0 bottom-0 top-(--header-height) z-10 overflow-y-auto"
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={revealed ? { opacity: 1, y: 0, transition: { duration: 0.45, delay: phase === "handoff" ? 0.6 : 0.1, ease: [0.16, 1, 0.3, 1] } } : { opacity: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <div ref={stage} className={compact ? "mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-6" : "mx-auto flex w-full max-w-2xl flex-col gap-10 px-5 py-12 sm:py-16"}>
        <header className="flex flex-col gap-3">
          <h1 className={compact ? "text-2xl font-semibold" : "text-[2rem] font-semibold leading-tight tracking-[-0.02em]"}>{title}</h1>
          {lead ? <p className="text-[1.0625rem] leading-relaxed text-muted-foreground">{lead}</p> : null}
        </header>
        {children}
      </div>
    </motion.main>
  );
}

export function PageSection({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t pt-8">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
