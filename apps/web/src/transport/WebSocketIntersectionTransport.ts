import {
  ComparisonResponseSchema,
  EventsResponseSchema,
  HealthResponseSchema,
  InjectEventResponseSchema,
  MetricsResponseSchema,
  PROTOCOL_VERSION,
  RuntimeConfigResponseSchema,
  ScenariosResponseSchema,
  SessionResponseSchema,
  SocketMessageSchema,
  type ClientEvent,
  type ComparisonResponse,
  type CreateComparisonRequest,
  type CreateSessionRequest,
  type EventsQuery,
  type EventsResponse,
  type MetricsQuery,
  type MetricsResponse,
  type ServerEvent,
  type SimulationSnapshot,
} from "@intersection/shared";
import { createRequestId } from "@/lib/ids";
import {
  isTransportError,
  type Catalog,
  type CommandResult,
  type ConnectionStatus,
  type IntersectionTransport,
  type SimulationCommand,
} from "./IntersectionTransport";
import { requestJson, type FetchLike } from "./rest";

export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  maxAttempts: number;
}

export interface WebSocketTransportOptions {
  /** Backend origin. Empty string means same origin through the Vite proxy. */
  baseUrl?: string;
  fetch?: FetchLike;
  WebSocket?: typeof WebSocket;
  reconnect?: Partial<ReconnectPolicy>;
  heartbeatIntervalMs?: number;
  pongTimeoutMs?: number;
  random?: () => number;
}

const DEFAULT_RECONNECT: ReconnectPolicy = { initialDelayMs: 500, maxDelayMs: 8000, jitter: 0.25, maxAttempts: 8 };

/** Backoff delay for a 1-based attempt: exponential, capped, with symmetric jitter. */
export function reconnectDelay(attempt: number, policy: ReconnectPolicy, random: () => number = Math.random): number {
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** Math.max(0, attempt - 1));
  const spread = base * policy.jitter;
  return Math.round(base - spread + random() * 2 * spread);
}

/**
 * Backend transport: REST for creation, controls, injections and history;
 * `/ws?sessionId=…&protocolVersion=1` for checkpoints and live events.
 * Every inbound message is validated with the shared schemas.
 */
export class WebSocketIntersectionTransport implements IntersectionTransport {
  readonly source = "backend" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly policy: ReconnectPolicy;
  private readonly heartbeatIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly random: () => number;

  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private wantOpen = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPing: string | null = null;
  private listeners = new Set<(event: ServerEvent) => void>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private status: ConnectionStatus = { source: "backend", state: "idle", message: null, reconnectAttempt: 0 };

  constructor(options: WebSocketTransportOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.WebSocketImpl = options.WebSocket ?? WebSocket;
    this.policy = { ...DEFAULT_RECONNECT, ...options.reconnect };
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 8_000;
    this.random = options.random ?? Math.random;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  onConnectionStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ---------------------------------------------------------------------------
  // REST

  async loadCatalog(): Promise<Catalog> {
    const [config, scenarios, health] = await Promise.all([
      requestJson(this.fetchImpl, this.baseUrl, "/api/config", { schema: RuntimeConfigResponseSchema }),
      requestJson(this.fetchImpl, this.baseUrl, "/api/scenarios", { schema: ScenariosResponseSchema }),
      requestJson(this.fetchImpl, this.baseUrl, "/api/health", { schema: HealthResponseSchema }).catch(() => null),
    ]);
    return { config, scenarios: scenarios.scenarios, health };
  }

  async getSnapshot(sessionId: string): Promise<SimulationSnapshot> {
    const response = await requestJson(this.fetchImpl, this.baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}`, { schema: SessionResponseSchema });
    return response.snapshot;
  }

  async createSession(request: CreateSessionRequest): Promise<SimulationSnapshot> {
    const response = await requestJson(this.fetchImpl, this.baseUrl, "/api/sessions", { method: "POST", body: request, schema: SessionResponseSchema });
    return response.snapshot;
  }

  async sendCommand(command: SimulationCommand): Promise<CommandResult> {
    const path = `/api/sessions/${encodeURIComponent(command.sessionId)}/${command.kind === "control" ? "control" : "inject"}`;
    if (command.kind === "control") {
      const response = await requestJson(this.fetchImpl, this.baseUrl, path, { method: "POST", body: command.body, schema: SessionResponseSchema });
      return { kind: "control", snapshot: response.snapshot };
    }
    const response = await requestJson(this.fetchImpl, this.baseUrl, path, { method: "POST", body: command.body, schema: InjectEventResponseSchema });
    return { kind: "inject", response };
  }

  getEvents(sessionId: string, query: EventsQuery = {}): Promise<EventsResponse> {
    return requestJson(this.fetchImpl, this.baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/events`, { query: query as Record<string, string>, schema: EventsResponseSchema });
  }

  getMetrics(sessionId: string, query: MetricsQuery = {}): Promise<MetricsResponse> {
    return requestJson(this.fetchImpl, this.baseUrl, `/api/sessions/${encodeURIComponent(sessionId)}/metrics`, { query: query as Record<string, string>, schema: MetricsResponseSchema });
  }

  createComparison(request: CreateComparisonRequest): Promise<ComparisonResponse> {
    return requestJson(this.fetchImpl, this.baseUrl, "/api/comparisons", { method: "POST", body: request, schema: ComparisonResponseSchema });
  }

  getComparison(comparisonId: string): Promise<ComparisonResponse> {
    return requestJson(this.fetchImpl, this.baseUrl, `/api/comparisons/${encodeURIComponent(comparisonId)}`, { schema: ComparisonResponseSchema });
  }

  // ---------------------------------------------------------------------------
  // Socket

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(sessionId: string): Promise<void> {
    this.clearReconnect();
    this.closeSocket(1000);
    this.sessionId = sessionId;
    this.wantOpen = true;
    this.attempt = 0;
    this.setStatus("connecting", "Opening the live event stream.");
    this.open();
  }

  async disconnect(): Promise<void> {
    this.wantOpen = false;
    this.clearReconnect();
    this.closeSocket(1000);
    this.sessionId = null;
    this.setStatus("idle", null);
  }

  /** Reconnect immediately after a manual retry (resets the attempt budget). */
  retry() {
    if (!this.sessionId) return;
    this.wantOpen = true;
    this.attempt = 0;
    this.clearReconnect();
    this.closeSocket(1000);
    this.setStatus("connecting", "Retrying the live event stream.");
    this.open();
  }

  requestSnapshot(): void {
    if (!this.sessionId) return;
    const frame: ClientEvent = { protocolVersion: PROTOCOL_VERSION, type: "simulation.request_snapshot", requestId: createRequestId("resync"), sessionId: this.sessionId };
    if (!this.sendFrame(frame)) {
      // Not open: the next (re)connection starts with a checkpoint anyway.
    }
  }

  dispose(): void {
    void this.disconnect();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  private open() {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl(this.socketUrl(sessionId));
    } catch {
      this.scheduleReconnect("Could not open the event stream.");
      return;
    }
    this.socket = socket;
    socket.onmessage = message => {
      if (this.socket === socket) this.handleMessage(message.data);
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      if (!this.wantOpen) return;
      const reason = event.code === 1013 ? "The server closed the stream because this client fell behind."
        : event.code === 1001 ? "The server is shutting down or restarting."
        : event.code === 1008 || event.code === 1009 ? "The server rejected a message from this client."
        : "The live event stream was interrupted.";
      this.scheduleReconnect(reason);
    };
    socket.onerror = () => {
      // A close event always follows; reconnection is handled there.
    };
  }

  private handleMessage(data: unknown) {
    let json: unknown;
    try {
      json = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      this.incompatible("Received a frame that is not valid JSON.");
      return;
    }
    const parsed = SocketMessageSchema.safeParse(json);
    if (!parsed.success) {
      const type = typeof json === "object" && json !== null && "type" in json ? String((json as { type: unknown }).type) : "unknown";
      this.incompatible(`Received an incompatible "${type}" message; requested a fresh checkpoint.`);
      return;
    }
    const message = parsed.data;
    if (message.type === "pong") {
      if (message.requestId === this.pendingPing) {
        this.pendingPing = null;
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
      return;
    }
    if (message.sessionId !== this.sessionId) return;
    if (message.type === "simulation.snapshot" && this.status.state !== "connected") {
      // The checkpoint closes the creation/reconnect race; the stream is live now.
      this.attempt = 0;
      this.setStatus("connected", null);
      this.startHeartbeat();
    }
    for (const listener of this.listeners) listener(message);
  }

  private incompatible(message: string) {
    this.setStatus(this.status.state, message);
    this.requestSnapshot();
  }

  private scheduleReconnect(reason: string) {
    this.clearReconnect();
    this.attempt += 1;
    if (this.attempt > this.policy.maxAttempts) {
      this.wantOpen = false;
      this.setStatus("error", `${reason} Gave up after ${this.policy.maxAttempts} attempts. Retry, or switch to the offline demo.`);
      return;
    }
    const delay = reconnectDelay(this.attempt, this.policy, this.random);
    this.setStatus("reconnecting", `${reason} Reconnecting in ${(delay / 1000).toFixed(1)} s. Data shown is not live.`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect() {
    if (!this.wantOpen || !this.sessionId) return;
    // After repeated failures, check whether the session still exists (a restart loses it).
    if (this.attempt >= 2) {
      try {
        await requestJson(this.fetchImpl, this.baseUrl, `/api/sessions/${encodeURIComponent(this.sessionId)}`, { schema: SessionResponseSchema, timeoutMs: 4000 });
      } catch (error) {
        if (isTransportError(error) && error.code === "NOT_FOUND") {
          this.wantOpen = false;
          this.setStatus("error", "This session no longer exists on the server (it may have restarted). Start a new session.");
          return;
        }
      }
      if (!this.wantOpen) return;
    }
    this.open();
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.pendingPing) return;
      const requestId = createRequestId("ping");
      if (!this.sendFrame({ protocolVersion: PROTOCOL_VERSION, type: "ping", requestId })) return;
      this.pendingPing = requestId;
      this.pongTimer = setTimeout(() => {
        // No pong: treat the stream as dead and reconnect.
        this.pendingPing = null;
        this.closeSocket(4000);
        if (this.wantOpen) this.scheduleReconnect("The server stopped answering heartbeats.");
      }, this.pongTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
    this.pendingPing = null;
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private closeSocket(code: number) {
    const socket = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    if (socket && (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING)) {
      try {
        socket.close(code);
      } catch {
        // Already closing.
      }
    }
  }

  private sendFrame(frame: ClientEvent): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  private socketUrl(sessionId: string): string {
    const origin = this.baseUrl || (typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const url = new URL(`/ws`, origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("protocolVersion", String(PROTOCOL_VERSION));
    return url.toString();
  }

  private setStatus(state: ConnectionStatus["state"], message: string | null) {
    this.status = { source: "backend", state, message, reconnectAttempt: this.attempt };
    for (const listener of this.statusListeners) listener(this.status);
  }
}
