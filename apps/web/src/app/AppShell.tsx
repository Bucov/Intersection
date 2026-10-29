import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router";
import { AnimatePresence } from "motion/react";
import { IntroOverlay } from "@/components/intro/IntroOverlay";
import { Header } from "@/components/navigation/Header";
import { IntersectionCanvas } from "@/components/scene/IntersectionCanvas";
import { AboutPage } from "@/routes/AboutPage";
import { HomePage } from "@/routes/HomePage";
import { NotFoundPage } from "@/routes/NotFoundPage";
import { SettingsPage } from "@/routes/SettingsPage";
import { SimulationPage } from "@/routes/SimulationPage";
import { useServices } from "./services";

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

  useEffect(() => {
    // Resolve the data source in the background; nothing waits for it.
    void services.dataSource.refresh();
  }, [services.dataSource]);

  return (
    <>
      <IntersectionCanvas />
      <Header />
      <AnimatePresence mode="sync" initial={false}>
        <Routes location={location} key={sectionOf(location.pathname)}>
          <Route path="/" element={<HomePage />} />
          <Route path="/simulate/:mode" element={<SimulationPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AnimatePresence>
      <IntroOverlay />
    </>
  );
}
