import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

let cached = { width: 0, height: 0 };
function snapshot() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width !== cached.width || height !== cached.height) cached = { width, height };
  return cached;
}

export function useViewport(): { width: number; height: number } {
  return useSyncExternalStore(subscribe, snapshot, () => ({ width: 1280, height: 800 }));
}
