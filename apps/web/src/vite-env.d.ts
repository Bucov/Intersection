/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "auto" (default), "mock" or "backend": the initial data-source preference. */
  readonly VITE_DATA_SOURCE?: string;
  /** Backend origin; empty means same origin through the Vite proxy. */
  readonly VITE_BACKEND_URL?: string;
}
