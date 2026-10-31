import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import { SquareWipe } from "@/components/common/SquareWipe";
import { useSquareWipe } from "@/hooks/useSquareWipe";
import { IntroOverlay } from "@/components/intro/IntroOverlay";
import { Header } from "@/components/navigation/Header";
import { AboutPage } from "@/routes/AboutPage";
import { HomePage } from "@/routes/HomePage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { SettingsPage } from "@/routes/SettingsPage";
import { ComparisonPage } from "@/routes/ComparisonPage";
import { SimulationPage } from "@/routes/SimulationPage";
import { useStore } from "@/state/store";
import { useServices } from "./services";

// Three.js streams in while the intro plays; the intro itself needs only React and Motion.
const IntersectionCanvas = lazy(() => import("@/components/scene/IntersectionCanvas").then(m => ({ default: m.IntersectionCanvas })));

/** Route sections, so changing mode or scenario inside the simulation keeps the page mounted. */
function sectionOf(pathname: string): string {
  if (pathname.startsWith("/simulate")) return "simulate";
  return pathname;
}

/**
 * One persistent 3D canvas behind every route; pages are layers over it. The
 * intro runs once on entry (or on replay), never on ordinary navigation.
 */
export function AppShell() {
  const location = useLocation();
  const services = useServices();
  const intro = useStore(services.intro, s => s.phase);
  const wipe = useSquareWipe();
  // The page on screen lags the URL while the squares cover the swap.
  const [shown, setShown] = useState(location);
  const target = useRef(location);

  useEffect(() => {
    target.current = location;
    if (sectionOf(location.pathname) === sectionOf(shown.pathname)) {
      setShown(location);
      return;
    }
    // The opening sequence is its own entrance; everything after it moves through the squares.
    if (intro !== "done") setShown(location);
    else wipe.run(() => setShown(target.current));
    // Only a new URL starts a transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  useEffect(() => {
    // Resolve the data source in the background; nothing waits for it.
    void services.dataSource.refresh();
  }, [services.dataSource]);

  return (
    <>
      <Suspense fallback={null}>
        <IntersectionCanvas />
      </Suspense>
      <Header />
      <Routes location={shown} key={sectionOf(shown.pathname)}>
        <Route path="/" element={<HomePage />} />
        <Route path="/simulate/:mode" element={<SimulationPage />} />
        <Route path="/comparison" element={<ComparisonPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <IntroOverlay />
      <SquareWipe stage={wipe.stage} fixed />
    </>
  );
}
