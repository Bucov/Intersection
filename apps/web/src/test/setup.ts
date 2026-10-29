import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Engine and transport suites run in the node environment; only DOM suites need the shims.
if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });

  // jsdom has no ResizeObserver or matchMedia; components only need inert versions.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // jsdom does not implement scrollTo on elements.
  Element.prototype.scrollTo ??= function scrollTo() {};

  // jsdom has no canvas backend: report "no context" like a browser without WebGL.
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}
