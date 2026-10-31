import { lazy, Suspense } from "react";
import { SCENARIO_CATALOG } from "@intersection/shared";
import { SquareLoader } from "@/components/common/SquareLoader";
import { useSceneStage } from "@/hooks/useSceneStage";

const ComparisonPanel = lazy(() => import("@/components/comparison/ComparisonPanel").then(m => ({ default: m.ComparisonPanel })));

/** Both controllers on the same traffic, as two 3D intersections side by side. The main scene rests meanwhile. */
export function ComparisonPage() {
  const stage = useSceneStage("hidden");
  return (
    <main className="fixed inset-x-0 bottom-0 top-(--header-height) z-10 overflow-y-auto">
      <div ref={stage} className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-5 sm:px-8 sm:py-6">
        <h1 className="text-[clamp(1.75rem,2.6vw,2.5rem)] font-[620] leading-none tracking-[-0.045em]">compare</h1>
        <Suspense fallback={<SquareLoader label="Loading the comparison" />}>
          <ComparisonPanel scenarioId="normal-traffic" seed={42} scenarios={SCENARIO_CATALOG} variant="page" />
        </Suspense>
      </div>
    </main>
  );
}
