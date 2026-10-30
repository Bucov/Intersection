import type {
  ComparisonResponse,
  CreateComparisonRequest,
  CreateSessionRequest,
  ErrorCode,
  ErrorDetail,
  EventsQuery,
  EventsResponse,
  HealthResponse,
  InjectEventRequest,
  InjectEventResponse,
  MetricsQuery,
  MetricsResponse,
  RuntimeConfigResponse,
  ScenarioDefinition,
  ServerEvent,
  SessionControlRequest,
  SimulationSnapshot,
} from "@intersection/shared";

/**
 * The boundary between the UI and a data source.
 *
 * Both adapters speak the shared v1 contract: the UI, the scene and every panel
 * consume the same `SimulationSnapshot` / `ServerEvent` stream whichever one is
 * active. Nothing outside `src/transport` knows how the data is produced.
 */
export interface IntersectionTransport {
  readonly source: DataSourceKind;

  getConnectionStatus(): ConnectionStatus;
  onConnectionStatus(listener: (status: ConnectionStatus) => void): () => void;

  /** Runtime config and the scenario catalog (`GET /api/config`, `GET /api/scenarios`). */
  loadCatalog(): Promise<Catalog>;

  /** `POST /api/sessions`; resolves with the authoritative initial snapshot. */
  createSession(request: CreateSessionRequest): Promise<SimulationSnapshot>;

  /** Start streaming a session's events. The first delivered event is a checkpoint snapshot. */
  connect(sessionId: string): Promise<void>;
  disconnect(): Promise<void>;

  subscribe(listener: (event: ServerEvent) => void): () => void;

  /** Controls and injections go over REST with a fresh request ID and the current generation. */
  sendCommand(command: SimulationCommand): Promise<CommandResult>;

  /** Ask for a fresh checkpoint after a sequence gap or an incompatible event. */
  requestSnapshot(): void;

  getEvents(sessionId: string, query?: EventsQuery): Promise<EventsResponse>;
  getMetrics(sessionId: string, query?: MetricsQuery): Promise<MetricsResponse>;

  createComparison(request: CreateComparisonRequest): Promise<ComparisonResponse>;
  getComparison(comparisonId: string): Promise<ComparisonResponse>;

  dispose(): void;
}

export type DataSourceKind = "mock" | "backend";

export type ConnectionState =
  /** Local mock transport; no backend involved. */
  | "offline-demo"
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectionStatus {
  source: DataSourceKind;
  state: ConnectionState;
  /** Human-readable detail for the status popover. */
  message: string | null;
  reconnectAttempt: number;
}

export interface Catalog {
  config: RuntimeConfigResponse;
  scenarios: ScenarioDefinition[];
  health: HealthResponse | null;
}

export type SimulationCommand =
  | { kind: "control"; sessionId: string; body: SessionControlRequest }
  | { kind: "inject"; sessionId: string; body: InjectEventRequest };

export type CommandResult =
  | { kind: "control"; snapshot: SimulationSnapshot }
  | { kind: "inject"; response: InjectEventResponse };

export type TransportErrorCode = ErrorCode | "NETWORK" | "TIMEOUT" | "PROTOCOL";

export class TransportError extends Error {
  readonly code: TransportErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly detail: ErrorDetail | null;

  constructor(code: TransportErrorCode, message: string, options: { status?: number | null; retryable?: boolean; detail?: ErrorDetail | null } = {}) {
    super(message);
    this.name = "TransportError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
    this.detail = options.detail ?? null;
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError;
}
