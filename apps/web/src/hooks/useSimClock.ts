import { useEffect, useState } from "react";
import { useServices } from "@/app/services";

/**
 * The session's render clock (simulation ms) at a modest UI refresh rate.
 * Countdowns use it so they move with the interpolated scene, not in jumps.
 */
export function useSimClock(hz = 10): number {
  const { sessionFeed } = useServices();
  const [time, setTime] = useState(() => sessionFeed.currentTime);
  useEffect(() => {
    const id = window.setInterval(() => setTime(sessionFeed.currentTime), 1000 / hz);
    return () => window.clearInterval(id);
  }, [hz, sessionFeed]);
  return time;
}
