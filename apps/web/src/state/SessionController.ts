import type { CreateSessionRequest, InjectedEvent, InjectEventResponse, ServerEvent } from "@intersection/shared";
import { createRequestId } from "@/lib/ids";
import { isTransportError, type ConnectionStatus, type IntersectionTransport } from "@/transport/IntersectionTransport";
import { applySnapshot, createSessionState, reduceEvent, type SessionState } from "./session";
import { createStore, type Store } from "./store";

export type ControlAction = "start" | "pause" | "resume" | "reset";

export interface ControllerMeta {
  /** Session creation in flight. */
  opening: boolean;
  /** A control or injection in flight. */
  busy: boolean;
  /** Last command or creation error, phrased for the UI. */
  error: string | null;
  connection: ConnectionStatus | null;
}

/**
 * Owns the active session: creates it through a transport, applies its event
 * stream to the normalized store, and sends commands with fresh request IDs and
 * the current generation. Panels and the scene only read the store.
 */
export class SessionController {
  readonly store: Store<SessionState> = createStore(createSessionState());
  readonly meta: Store<ControllerMeta> = createStore<ControllerMeta>({ opening: false, busy: false, error: null, connection: null });
  private transport: IntersectionTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private openToken = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  get activeTransport(): IntersectionTransport | null {
    return this.transport;
  }

  async open(transport: IntersectionTransport, request: CreateSessionRequest): Promise<boolean> {
    this.cancelPendingClose();
    await this.close();
    const token = ++this.openToken;
    this.transport = transport;
    this.store.setState(createSessionState(transport.source));
    this.meta.setState(m => ({ ...m, opening: true, error: null, connection: transport.getConnectionStatus() }));
    this.unsubscribeStatus = transport.onConnectionStatus(status => this.meta.setState(m => ({ ...m, connection: status })));
    try {
      const snapshot = await transport.createSession(request);
      if (token !== this.openToken) return false;
      this.store.setState(applySnapshot(createSessionState(transport.source, snapshot.sessionId), snapshot));
      this.unsubscribe = transport.subscribe(event => this.handle(event));
      await transport.connect(snapshot.sessionId);
      if (token !== this.openToken) return false;
      this.meta.setState(m => ({ ...m, opening: false, connection: transport.getConnectionStatus() }));
      return true;
    } catch (error) {
      if (token === this.openToken) this.meta.setState(m => ({ ...m, opening: false, error: describeError(error, "Could not start the session.") }));
      return false;
    }
  }

  /** Close after `delayMs` (lets the scene fade the fleet out) unless a new session opens first. */
  closeSoon(delayMs: number) {
    this.cancelPendingClose();
    const token = this.openToken;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (token === this.openToken) void this.close();
    }, delayMs);
  }

  private cancelPendingClose() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  async close(): Promise<void> {
    this.cancelPendingClose();
    this.openToken++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    const transport = this.transport;
    this.transport = null;
    this.store.setState(createSessionState());
    this.meta.setState({ opening: false, busy: false, error: null, connection: null });
    await transport?.disconnect();
  }

  control(action: ControlAction): Promise<boolean> {
    return this.send(action, generation => ({ requestId: createRequestId(action), generation, action }));
  }

  setSpeed(speedMultiplier: number): Promise<boolean> {
    return this.send("set_speed", generation => ({ requestId: createRequestId("speed"), generation, action: "set_speed", speedMultiplier }));
  }

  async inject(event: InjectedEvent): Promise<InjectEventResponse | null> {
    const transport = this.transport;
    const state = this.store.getState();
    if (!transport || !state.sessionId) return null;
    this.meta.setState(m => ({ ...m, busy: true, error: null }));
    try {
      const result = await transport.sendCommand({ kind: "inject", sessionId: state.sessionId, body: { requestId: createRequestId("inject"), generation: state.generation, event } });
      this.meta.setState(m => ({ ...m, busy: false }));
      return result.kind === "inject" ? result.response : null;
    } catch (error) {
      this.recover(error);
      this.meta.setState(m => ({ ...m, busy: false, error: describeError(error, "The event could not be scheduled.") }));
      return null;
    }
  }

  clearError() {
    this.meta.setState(m => ({ ...m, error: null }));
  }

  private async send(label: string, body: (generation: number) => Parameters<IntersectionTransport["sendCommand"]>[0]["body"]): Promise<boolean> {
    const transport = this.transport;
    const state = this.store.getState();
    if (!transport || !state.sessionId) return false;
    this.meta.setState(m => ({ ...m, busy: true, error: null }));
    try {
      const result = await transport.sendCommand({ kind: "control", sessionId: state.sessionId, body: body(state.generation) as never });
      if (result.kind === "control") this.store.setState(s => applySnapshot(s, result.snapshot));
      this.meta.setState(m => ({ ...m, busy: false }));
      return true;
    } catch (error) {
      this.recover(error);
      this.meta.setState(m => ({ ...m, busy: false, error: describeError(error, `Could not ${label.replace("_", " ")} the session.`) }));
      return false;
    }
  }

  /** A stale generation means our view is behind: refresh instead of retrying the user's action. */
  private recover(error: unknown) {
    if (isTransportError(error) && (error.code === "STALE_GENERATION" || error.code === "INVALID_STATE")) this.transport?.requestSnapshot();
  }

  private handle(event: ServerEvent) {
    const result = reduceEvent(this.store.getState(), event);
    this.store.setState(result.state);
    if (result.resync) this.transport?.requestSnapshot();
  }
}

function describeError(error: unknown, fallback: string): string {
  if (isTransportError(error)) {
    switch (error.code) {
      case "STALE_GENERATION": return "The session was reset elsewhere. The view has been refreshed; try again.";
      case "INVALID_STATE": return error.message || "That action is not available in the current state.";
      case "NETWORK": return "The backend is not reachable. Check the server, or switch to the offline demo in Settings.";
      case "TIMEOUT": return "The backend did not answer in time.";
      case "RATE_LIMITED":
      case "CAPACITY_EXCEEDED": return "The backend is busy. Try again in a moment.";
      default: return error.message || fallback;
    }
  }
  return fallback;
}
