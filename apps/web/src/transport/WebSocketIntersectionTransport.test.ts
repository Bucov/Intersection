// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@intersection/shared";
import responses from "../../../../docs/examples/responses.json";
import events from "../../../../docs/examples/server-events.json";
import errorFixture from "../../../../docs/examples/error.json";
import { TransportError, type ConnectionStatus } from "./IntersectionTransport";
import { WebSocketIntersectionTransport, reconnectDelay } from "./WebSocketIntersectionTransport";

/** Minimal scriptable WebSocket: tests open, message and close it explicitly. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = 1;
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get frames() {
    return this.sent.map(s => JSON.parse(s) as { type: string; sessionId?: string; requestId: string });
  }
}

const SNAPSHOT_EVENT = (events as ServerEvent[]).find(e => e.type === "simulation.snapshot")!;
const SESSION = SNAPSHOT_EVENT.sessionId;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const statuses: ConnectionStatus[] = [];
  const received: ServerEvent[] = [];
  const transport = new WebSocketIntersectionTransport({
    baseUrl: "http://backend.test",
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    fetch: fetchImpl ?? (async () => jsonResponse(404, { protocolVersion: 1, requestId: "x", error: { code: "NOT_FOUND", message: "no", retryable: false, issues: [] } })),
    reconnect: { initialDelayMs: 100, maxDelayMs: 800, jitter: 0, maxAttempts: 3 },
    heartbeatIntervalMs: 1000,
    pongTimeoutMs: 500,
  });
  transport.onConnectionStatus(s => statuses.push(s));
  transport.subscribe(e => received.push(e));
  return { transport, statuses, received };
}

describe("WebSocketIntersectionTransport", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the contract URL and becomes live on the first checkpoint", async () => {
    const { transport, statuses, received } = setup();
    await transport.connect(SESSION);
    const socket = FakeSocket.instances[0];
    expect(socket.url).toBe(`ws://backend.test/ws?sessionId=${SESSION}&protocolVersion=1`);
    expect(transport.getConnectionStatus().state).toBe("connecting");
    socket.open();
    socket.receive(SNAPSHOT_EVENT);
    expect(transport.getConnectionStatus().state).toBe("connected");
    expect(received).toHaveLength(1);
    expect(statuses.map(s => s.state)).toEqual(["connecting", "connected"]);
  });

  it("validates every message and requests a checkpoint on bad input", async () => {
    const { transport, received } = setup();
    await transport.connect(SESSION);
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive(SNAPSHOT_EVENT);
    socket.receive("{not json");
    socket.receive({ ...SNAPSHOT_EVENT, type: "simulation.teleport" });
    expect(received).toHaveLength(1);
    const resyncs = socket.frames.filter(f => f.type === "simulation.request_snapshot");
    expect(resyncs).toHaveLength(2);
    expect(resyncs[0].sessionId).toBe(SESSION);
    expect(transport.getConnectionStatus().message).toMatch(/incompatible/);
  });

  it("ignores events for another session", async () => {
    const { transport, received } = setup();
    await transport.connect(SESSION);
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ ...SNAPSHOT_EVENT, sessionId: "someone-else", payload: { ...(SNAPSHOT_EVENT.payload as object), sessionId: "someone-else" } });
    expect(received).toHaveLength(0);
  });

  it("reconnects with exponential backoff and accepts the new checkpoint", async () => {
    const { transport, statuses, received } = setup();
    await transport.connect(SESSION);
    FakeSocket.instances[0].open();
    FakeSocket.instances[0].receive(SNAPSHOT_EVENT);
    FakeSocket.instances[0].drop();
    expect(transport.getConnectionStatus()).toMatchObject({ state: "reconnecting", reconnectAttempt: 1 });
    expect(transport.getConnectionStatus().message).toMatch(/not live/);
    await vi.advanceTimersByTimeAsync(99);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].open();
    FakeSocket.instances[1].receive(SNAPSHOT_EVENT);
    expect(transport.getConnectionStatus()).toMatchObject({ state: "connected", reconnectAttempt: 0 });
    expect(received).toHaveLength(2);
    expect(statuses.map(s => s.state)).toEqual(["connecting", "connected", "reconnecting", "connected"]);
  });

  it("gives up after the attempt budget and reports an error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, {}));
    const { transport } = setup(fetchImpl);
    await transport.connect(SESSION);
    FakeSocket.instances[0].drop();
    for (const delay of [100, 200, 400]) {
      await vi.advanceTimersByTimeAsync(delay);
      FakeSocket.instances.at(-1)!.drop();
    }
    expect(transport.getConnectionStatus().state).toBe("error");
    expect(transport.getConnectionStatus().message).toMatch(/Gave up after 3 attempts/);
    const count = FakeSocket.instances.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeSocket.instances).toHaveLength(count);
  });

  it("stops reconnecting when the server no longer knows the session", async () => {
    const { transport } = setup(async () => jsonResponse(404, { protocolVersion: 1, requestId: "lookup-1", error: { code: "NOT_FOUND", message: "Unknown session", retryable: false, issues: [] } }));
    await transport.connect(SESSION);
    FakeSocket.instances[0].drop();
    await vi.advanceTimersByTimeAsync(100);
    FakeSocket.instances.at(-1)!.drop();
    await vi.advanceTimersByTimeAsync(200);
    expect(transport.getConnectionStatus().state).toBe("error");
    expect(transport.getConnectionStatus().message).toMatch(/no longer exists/);
  });

  it("treats a missing pong as a dead stream", async () => {
    const { transport } = setup();
    await transport.connect(SESSION);
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive(SNAPSHOT_EVENT);
    await vi.advanceTimersByTimeAsync(1000);
    const ping = socket.frames.find(f => f.type === "ping");
    expect(ping).toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(transport.getConnectionStatus().state).toBe("reconnecting");
  });

  it("keeps the stream when pongs answer", async () => {
    const { transport } = setup();
    await transport.connect(SESSION);
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive(SNAPSHOT_EVENT);
    await vi.advanceTimersByTimeAsync(1000);
    const ping = socket.frames.find(f => f.type === "ping")!;
    socket.receive({ protocolVersion: 1, type: "pong", requestId: ping.requestId, wallTime: new Date().toISOString() });
    await vi.advanceTimersByTimeAsync(600);
    expect(transport.getConnectionStatus().state).toBe("connected");
  });

  it("disconnect closes the socket without reconnecting", async () => {
    const { transport } = setup();
    await transport.connect(SESSION);
    FakeSocket.instances[0].open();
    await transport.disconnect();
    expect(transport.getConnectionStatus().state).toBe("idle");
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("validates REST responses against the shared schemas", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const { transport } = setup(async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, responses.createSession);
    });
    const snapshot = await transport.createSession({ requestId: "create-1", mode: "ai", scenarioId: "ambulance-priority", seed: 42 });
    expect(snapshot.sessionId).toBe(responses.createSession.snapshot.sessionId);
    expect(calls[0].url).toBe("http://backend.test/api/sessions");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ requestId: "create-1", mode: "ai" });
  });

  it("maps contract error envelopes to typed errors", async () => {
    vi.useRealTimers();
    const { transport } = setup(async () => jsonResponse(409, errorFixture));
    const failure = transport.sendCommand({ kind: "control", sessionId: SESSION, body: { requestId: "pause-1", generation: 0, action: "pause" } });
    await expect(failure).rejects.toBeInstanceOf(TransportError);
    await expect(failure).rejects.toMatchObject({ code: "STALE_GENERATION", status: 409, retryable: false });
  });

  it("reports a response that breaks the contract as a protocol error", async () => {
    vi.useRealTimers();
    const { transport } = setup(async () => jsonResponse(200, { protocolVersion: 1, snapshot: { nope: true } }));
    await expect(transport.sendCommand({ kind: "control", sessionId: SESSION, body: { requestId: "start-1", generation: 0, action: "start" } }))
      .rejects.toMatchObject({ code: "PROTOCOL" });
  });

  it("reports an unreachable backend as a network error", async () => {
    vi.useRealTimers();
    const { transport } = setup(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(transport.loadCatalog()).rejects.toMatchObject({ code: "NETWORK", retryable: true });
  });
});

describe("reconnectDelay", () => {
  const policy = { initialDelayMs: 500, maxDelayMs: 8000, jitter: 0.25, maxAttempts: 8 };
  it("grows exponentially and caps", () => {
    expect([1, 2, 3, 4, 5, 6].map(n => reconnectDelay(n, policy, () => 0.5))).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });
  it("applies symmetric jitter", () => {
    expect(reconnectDelay(2, policy, () => 0)).toBe(750);
    expect(reconnectDelay(2, policy, () => 1)).toBe(1250);
  });
});
