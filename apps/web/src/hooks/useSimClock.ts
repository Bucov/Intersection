import { useEffect, useState } from "react";
import { useServices } from "@/app/services";

/**
 * The session's render clock (simulation ms) at a modest UI refresh rate.
 * Countdowns use it so they move with the interpolated scene, not in jumps.
 * While the visitor replays a paused session it reports the replayed moment.
 */
export function useSimClock(hz = 10): number {
  const { sessionFeed, replay } = useServices();
  const read = () => replay.getState().time ?? sessionFeed.currentTime;
  const [time, setTime] = useState(read);
  useEffect(() => {
    const update = () => setTime(replay.getState().time ?? sessionFeed.currentTime);
    const id = window.setInterval(update, 1000 / hz);
    const unsubscribe = replay.subscribe(update);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [hz, sessionFeed, replay]);
  return time;
}
