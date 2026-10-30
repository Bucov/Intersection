import { useEffect, useRef } from "react";
import { signalLights, type VehicleType } from "@intersection/shared";
import { useServices } from "@/app/services";
import { sameInsets } from "@/state/scene";
import { useStore } from "@/state/store";
import { cn } from "@/lib/utils";
import type { RenderVehicle } from "./interpolation";

const WIDTH: Record<VehicleType, number> = { car: 1.8, van: 1.95, bus_truck: 2.5, ambulance: 2.1, police: 1.85 };
const SVG_NS = "http://www.w3.org/2000/svg";

const REASON: Record<"unsupported" | "error" | "lost", string> = {
  unsupported: "This browser cannot create a WebGL context.",
  error: "The 3D renderer failed to start.",
  lost: "The graphics context was lost. It will come back if the browser restores it.",
};

/**
 * Top-down schematic of the same feed the 3D scene draws, used when WebGL is
 * unavailable or lost. Updated imperatively per animation frame.
 */
export function SceneFallback({ reason, overlay = false }: { reason: "unsupported" | "error" | "lost"; overlay?: boolean }) {
  const services = useServices();
  const view = useStore(services.scene, s => s.view);
  const insets = useStore(services.scene, s => s.insets, sameInsets);
  const vehiclesRef = useRef<SVGGElement>(null);
  const stripRefs = useRef<Record<"NS" | "EW", SVGRectElement[]>>({ NS: [], EW: [] });

  useEffect(() => {
    if (overlay) return;
    // Without the canvas, the preview feed must be driven from here.
    if (view === "preview") services.preview.start();
    return () => {
      if (view === "preview") services.preview.stop();
    };
  }, [view, overlay, services.preview]);

  useEffect(() => {
    const group = vehiclesRef.current;
    if (!group || view === "hidden") return;
    const buffer: RenderVehicle[] = [];
    const pool: SVGRectElement[] = [];
    let raf = 0;
    const tick = () => {
      const feed = view === "simulation" ? services.sessionFeed : services.preview;
      const sample = feed.sample(performance.now(), buffer);
      for (let i = 0; i < sample.count; i++) {
        const v = buffer[i];
        let rect = pool[i];
        if (!rect) {
          rect = document.createElementNS(SVG_NS, "rect");
          rect.setAttribute("rx", "0.4");
          group.appendChild(rect);
          pool[i] = rect;
        }
        const w = WIDTH[v.type];
        rect.setAttribute("width", String(w));
        rect.setAttribute("height", String(v.lengthM));
        rect.setAttribute("x", String(-w / 2));
        rect.setAttribute("y", String(-v.lengthM / 2));
        rect.setAttribute("transform", `translate(${v.x} ${v.z}) rotate(${(-v.heading * 180) / Math.PI})`);
        rect.setAttribute("fill", v.emergency ? "var(--emergency)" : v.type === "bus_truck" ? "var(--muted-foreground)" : "var(--foreground)");
        rect.style.display = "";
      }
      for (let i = sample.count; i < pool.length; i++) pool[i].style.display = "none";
      const lights = sample.phase ? signalLights(sample.phase) : null;
      const color = (state: "red" | "yellow" | "green" | undefined) => state === "green" ? "var(--signal-green)" : state === "yellow" ? "var(--signal-amber)" : "var(--signal-red)";
      for (const rect of stripRefs.current.NS) rect.setAttribute("fill", color(lights?.north));
      for (const rect of stripRefs.current.EW) rect.setAttribute("fill", color(lights?.east));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const rect of pool) rect.remove();
    };
  }, [view, services]);

  const strip = (group: "NS" | "EW", index: number) => (el: SVGRectElement | null) => {
    if (el) stripRefs.current[group][index] = el;
  };

  return (
    <div
      className={overlay ? "absolute inset-0 bg-background" : "absolute inset-0"}
      data-testid="scene-fallback"
    >
      {/* The notice never sits on the schematic. On Home it follows the headline; in the simulation the
          HUD and view controls own the top corners, so it goes underneath, above the dock. */}
      <div className={cn("absolute flex items-center gap-3 py-4 sm:py-6", view === "simulation" ? "flex-col-reverse" : "flex-col")} style={{ top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left }}>
        <p className="max-w-[min(34rem,calc(100%-1rem))] shrink-0 rounded-md border bg-card px-3 py-2 text-center text-sm text-muted-foreground">
          3D view unavailable. {REASON[reason]} Showing a 2D schematic of the same simulation.
        </p>
        <svg viewBox="-80 -80 160 160" overflow="hidden" className="aspect-square min-h-0 max-w-full flex-1" role="img" aria-label="Top-down schematic of the intersection">
          <rect x={-80} y={-80} width={160} height={160} fill="var(--scene-base)" />
          <rect x={-3.5} y={-80} width={7} height={160} fill="var(--scene-asphalt)" />
          <rect x={-80} y={-3.5} width={160} height={7} fill="var(--scene-asphalt)" />
          <line x1={0} y1={-80} x2={0} y2={-10.5} stroke="var(--scene-marking)" strokeWidth={0.15} />
          <line x1={0} y1={10.5} x2={0} y2={80} stroke="var(--scene-marking)" strokeWidth={0.15} />
          <line x1={-80} y1={0} x2={-10.5} y2={0} stroke="var(--scene-marking)" strokeWidth={0.15} />
          <line x1={10.5} y1={0} x2={80} y2={0} stroke="var(--scene-marking)" strokeWidth={0.15} />
          {/* Stop-line strips coloured by signal state (north, south, east, west). */}
          <rect ref={strip("NS", 0)} x={-3.4} y={-11.2} width={3.3} height={0.9} />
          <rect ref={strip("NS", 1)} x={0.1} y={10.3} width={3.3} height={0.9} />
          <rect ref={strip("EW", 0)} x={10.3} y={-3.4} width={0.9} height={3.3} />
          <rect ref={strip("EW", 1)} x={-11.2} y={0.1} width={0.9} height={3.3} />
          <g ref={vehiclesRef} />
        </svg>
      </div>
    </div>
  );
}
