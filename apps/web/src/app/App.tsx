import { BrowserRouter } from "react-router";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "./AppShell";
import { ServicesProvider, type AppServices } from "./services";

export function App({ services }: { services?: AppServices }) {
  return (
    <ServicesProvider services={services}>
      {/* Motion follows the visitor's reduced-motion setting everywhere. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider delay={250}>
          <BrowserRouter>
            <AppShell />
          </BrowserRouter>
        </TooltipProvider>
      </MotionConfig>
    </ServicesProvider>
  );
}
