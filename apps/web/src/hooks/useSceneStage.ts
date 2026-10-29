import { useLayoutEffect, useRef } from "react";
import { useServices } from "@/app/services";
import { sameInsets, type SceneView } from "@/state/scene";

/**
 * Each page renders an empty "stage" element where the intersection should
 * appear. Its viewport rect becomes the scene insets, so the camera frames the
 * junction inside whatever space the page's UI leaves free.
 */
export function useSceneStage<T extends HTMLElement = HTMLDivElement>(view: SceneView) {
  const ref = useRef<T>(null);
  const { scene } = useServices();

  useLayoutEffect(() => {
    scene.setState(s => (s.view === view ? s : { ...s, view }));
  }, [scene, view]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const insets = {
        top: Math.round(Math.max(0, rect.top)),
        left: Math.round(Math.max(0, rect.left)),
        right: Math.round(Math.max(0, window.innerWidth - rect.right)),
        bottom: Math.round(Math.max(0, window.innerHeight - rect.bottom)),
      };
      scene.setState(s => (sameInsets(s.insets, insets) ? s : { ...s, insets }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [scene]);

  return ref;
}
