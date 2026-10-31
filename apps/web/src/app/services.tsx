import { createContext, useContext, type ReactNode } from "react";
import { PreviewFeed } from "@/components/scene/previewFeed";
import { SnapshotInterpolator } from "@/components/scene/interpolation";
import { DataSourceManager } from "@/state/dataSource";
import { createIntroCarProbe, createIntroStore, type IntroCarProbe, type IntroState } from "@/state/intro";
import { createPreferencesStore, type Preferences } from "@/state/preferences";
import { createReplayStore, SessionHistory, type ReplayState } from "@/state/replay";
import { createSceneStore, type SceneState } from "@/state/scene";
import { SessionController } from "@/state/SessionController";
import type { Store } from "@/state/store";

export interface AppServices {
  preferences: Store<Preferences>;
  dataSource: DataSourceManager;
  session: SessionController;
  /** Interpolated view of the active session for the 3D scene. */
  sessionFeed: SnapshotInterpolator;
  /** Recorded snapshots of the current session, for rewinding while paused. */
  history: SessionHistory;
  /** The moment being replayed, or null for live. */
  replay: Store<ReplayState>;
  preview: PreviewFeed;
  scene: Store<SceneState>;
  intro: Store<IntroState>;
  /** Where the intro's opening car is on screen (written by the scene, read by the overlay). */
  introCar: IntroCarProbe;
}

export function createAppServices(): AppServices {
  const preferences = createPreferencesStore();
  const dataSource = new DataSourceManager(preferences.getState().dataSource, { baseUrl: import.meta.env.VITE_BACKEND_URL ?? "" });
  const session = new SessionController();
  const sessionFeed = new SnapshotInterpolator();
  const history = new SessionHistory();
  const replay = createReplayStore();

  // The scene reads snapshots from the store, never from React renders.
  let lastSnapshot: unknown = null;
  let lastKey: string | null = null;
  session.store.subscribe(() => {
    const state = session.store.getState();
    // Replay only exists while the session stands still; running, a reset or a new session returns to live.
    const key = state.snapshot ? `${state.snapshot.sessionId}:${state.snapshot.generation}` : null;
    if (replay.getState().time !== null && (state.status === "running" || key !== lastKey)) replay.setState({ time: null });
    lastKey = key;
    if (state.snapshot === lastSnapshot) return;
    lastSnapshot = state.snapshot;
    if (state.snapshot) {
      sessionFeed.push(state.snapshot, state.snapshotReceivedAt);
      history.push(state.snapshot);
    } else {
      sessionFeed.clear();
      history.clear();
    }
  });
  session.meta.subscribe(() => {
    const connection = session.meta.getState().connection;
    sessionFeed.setLive(!connection || connection.state === "offline-demo" || connection.state === "connected");
  });

  // Changing the data source preference re-resolves where new sessions come from.
  let lastPreference = preferences.getState().dataSource;
  preferences.subscribe(() => {
    const next = preferences.getState().dataSource;
    if (next === lastPreference) return;
    lastPreference = next;
    void dataSource.refresh(next);
  });

  return {
    preferences,
    dataSource,
    session,
    sessionFeed,
    history,
    replay,
    preview: new PreviewFeed(),
    scene: createSceneStore(),
    intro: createIntroStore(),
    introCar: createIntroCarProbe(),
  };
}

let singleton: AppServices | null = null;

/** Services live for the page; StrictMode double-mounts must not tear them down. */
function appServices(): AppServices {
  singleton ??= createAppServices();
  // Development only: lets visual checks inspect the stores from the console.
  if (import.meta.env.DEV) (window as unknown as { __intersection?: AppServices }).__intersection = singleton;
  return singleton;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services?: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services ?? appServices()}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("useServices must be used inside <ServicesProvider>.");
  return services;
}
