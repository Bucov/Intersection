import { HealthResponseSchema, type HealthResponse } from "@intersection/shared";
import { isTransportError, type Catalog, type DataSourceKind, type IntersectionTransport } from "@/transport/IntersectionTransport";
import { MockIntersectionTransport } from "@/transport/MockIntersectionTransport";
import { WebSocketIntersectionTransport } from "@/transport/WebSocketIntersectionTransport";
import { requestJson, type FetchLike } from "@/transport/rest";
import type { DataSourcePreference } from "./preferences";
import { createStore, type Store } from "./store";

export interface DataSourceState {
  preference: DataSourcePreference;
  /** A backend probe is in flight. */
  probing: boolean;
  /** The source new sessions will use. */
  kind: DataSourceKind;
  /** The backend was requested but cannot be used; sessions cannot start. */
  blocked: boolean;
  health: HealthResponse | null;
  /** Why the backend is not in use (shown in the status popover). */
  backendNote: string | null;
  catalog: Catalog | null;
}

export interface DataSourceOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  probeTimeoutMs?: number;
}

/**
 * Decides where sessions come from. "auto" probes `GET /api/health` without
 * blocking anything and falls back to the offline demo; "mock" never touches
 * the network; "backend" requires it and reports when it is unavailable.
 */
export class DataSourceManager {
  readonly store: Store<DataSourceState>;
  readonly mock = new MockIntersectionTransport();
  private backend: WebSocketIntersectionTransport | null = null;
  private readonly options: DataSourceOptions;
  private probeToken = 0;
  private inflight: { preference: DataSourcePreference; promise: Promise<DataSourceState> } | null = null;

  constructor(preference: DataSourcePreference, options: DataSourceOptions = {}) {
    this.options = options;
    this.store = createStore<DataSourceState>({
      preference,
      probing: false,
      kind: preference === "backend" ? "backend" : "mock",
      blocked: false,
      health: null,
      backendNote: preference === "mock" ? "Offline demo selected in Settings." : null,
      catalog: null,
    });
  }

  transport(): IntersectionTransport {
    const { kind } = this.store.getState();
    if (kind === "mock") return this.mock;
    this.backend ??= new WebSocketIntersectionTransport({ baseUrl: this.options.baseUrl, fetch: this.options.fetch });
    return this.backend;
  }

  refresh(preference = this.store.getState().preference): Promise<DataSourceState> {
    // Concurrent requests for the same preference share one probe.
    if (this.inflight?.preference === preference) return this.inflight.promise;
    const promise = this.resolve(preference).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { preference, promise };
    return promise;
  }

  private async resolve(preference: DataSourcePreference): Promise<DataSourceState> {
    const token = ++this.probeToken;
    this.store.setState(s => ({ ...s, preference, probing: preference !== "mock" }));

    if (preference === "mock") {
      const catalog = await this.mock.loadCatalog();
      this.commit(token, { kind: "mock", blocked: false, health: null, backendNote: "Offline demo selected in Settings.", catalog });
      return this.store.getState();
    }

    const fetchImpl = this.options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
    let note: string | null = null;
    try {
      const health = await requestJson(fetchImpl, this.options.baseUrl ?? "", "/api/health", { schema: HealthResponseSchema, timeoutMs: this.options.probeTimeoutMs ?? 2500 });
      this.backend ??= new WebSocketIntersectionTransport({ baseUrl: this.options.baseUrl, fetch: this.options.fetch });
      const catalog = await this.backend.loadCatalog();
      this.commit(token, { kind: "backend", blocked: false, health, backendNote: null, catalog });
      return this.store.getState();
    } catch (error) {
      note = isTransportError(error)
        ? error.code === "PROTOCOL"
          ? `The backend answered but does not speak the v1 contract yet. ${error.message}`
          : error.message
        : "The backend could not be reached.";
    }

    if (preference === "auto") {
      const catalog = await this.mock.loadCatalog();
      this.commit(token, { kind: "mock", blocked: false, health: null, backendNote: note, catalog });
    } else {
      this.commit(token, { kind: "backend", blocked: true, health: null, backendNote: note, catalog: null });
    }
    return this.store.getState();
  }

  private commit(token: number, patch: Partial<DataSourceState>) {
    if (token !== this.probeToken) return;
    this.store.setState(s => ({ ...s, ...patch, probing: false }));
  }
}
