import { useEffect } from "react";
import { useReducedMotion } from "motion/react";
import type { ControllerMode, ScenarioId } from "@intersection/shared";
import { useServices } from "@/app/services";
import { createRequestId } from "@/lib/ids";

/** Time for the camera to settle into the operating view before traffic starts. */
const ARRIVAL_MS = 1100;

/**
 * Opens a session for the selected controller and scenario. Selecting a
 * different mode or scenario creates a new session (the contract has no
 * in-place mode change); the session starts once the camera has arrived.
 */
export function useSessionLifecycle(mode: ControllerMode | null, scenarioId: ScenarioId, seed: number) {
  const services = useServices();
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    if (!mode) return;
    let cancelled = false;
    const opened = performance.now();
    void (async () => {
      const source = services.dataSource.store.getState();
      const state = source.catalog ? source : await services.dataSource.refresh();
      if (cancelled) return;
      if (state.blocked) {
        services.session.meta.setState(m => ({ ...m, error: state.backendNote ?? "The backend is unavailable. Switch to the offline demo in Settings." }));
        return;
      }
      const ok = await services.session.open(services.dataSource.transport(), {
        requestId: createRequestId("create"),
        mode,
        scenarioId,
        seed,
        speedMultiplier: 1,
        autoStart: false,
      });
      if (!ok || cancelled) return;
      const wait = reduced ? 0 : Math.max(0, ARRIVAL_MS - (performance.now() - opened));
      await new Promise(resolve => setTimeout(resolve, wait));
      if (cancelled) return;
      if (services.session.store.getState().status === "ready") await services.session.control("start");
    })();
    return () => {
      cancelled = true;
      services.session.closeSoon(450);
    };
  }, [mode, scenarioId, seed, services, reduced]);
}
