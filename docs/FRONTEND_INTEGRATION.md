# Frontend integration

Status: the frontend (`apps/web`) runs completely offline and already implements the v1 backend contract
(`packages/shared`, [API_CONTRACT.md](API_CONTRACT.md)). When a contract-speaking backend is reachable it is used
automatically; until then the app falls back to the offline demo. No backend file and no shared contract file was
changed by the frontend work.

## Running

```sh
npm ci                      # from the repository root
npm run dev:web             # builds @intersection/shared, then starts Vite on http://localhost:5173
npm run dev:server          # optional: the backend on port 3001
```

The Vite dev server proxies `/api` and `/ws` to `http://127.0.0.1:3001` as the contract specifies. Override with
`INTERSECTION_BACKEND_URL=http://host:port npm run dev:web`. While the backend is down the proxy answers `/api/health`
with 502 and logs one line; the browser console shows that single failed request in "Automatic" mode.

| Variable | Where | Meaning |
| --- | --- | --- |
| `VITE_DATA_SOURCE` | web build | Initial data-source preference: `auto` (default), `mock`, `backend` |
| `VITE_BACKEND_URL` | web build | Talk to a backend origin directly instead of through the proxy (needs CORS on the server) |
| `INTERSECTION_BACKEND_URL` | Vite dev/preview | Proxy target for `/api` and `/ws` |

Visitors can change the data source in **Settings**: Automatic, Offline demo, or Backend only. Append `?skipIntro`
to any URL to skip the opening sequence (used by tests).

## Architecture in one screen

```
transport/IntersectionTransport.ts      one interface for every data source
transport/MockIntersectionTransport.ts  offline demo: deterministic engine in the browser, contract-shaped output
transport/WebSocketIntersectionTransport.ts  REST + /ws, schema-validated, reconnecting
transport/mock/                          engine.ts (traffic, signals, metrics), adaptive.ts (mock agents, JEV, safety gate)
state/session.ts                         reducer implementing the contract's sequence algorithm
state/SessionController.ts               opens sessions, applies events, sends commands, backfills history
components/scene/                        one persistent React Three Fiber canvas for Home and the simulation
```

The UI never branches on the transport. Panels read the normalized `SessionState`; the 3D scene reads an
interpolator fed from the same store and is updated in the render loop, not through React renders. Switching to
the backend is a data-source change, not a code change.

## What the frontend sends and expects

| Step | Call | Notes |
| --- | --- | --- |
| Detect | `GET /api/health` | 2.5 s timeout. Must parse as `HealthResponseSchema`; anything else means "not a v1 backend" and Automatic falls back to the offline demo. |
| Catalog | `GET /api/config`, `GET /api/scenarios` | Fetched once per detection. Scenario names, descriptions, supported modes, timings and `faultInjectionEnabled` drive the UI. |
| Create | `POST /api/sessions` | `{ requestId, mode, scenarioId, seed, speedMultiplier: 1, autoStart: false }`. Seed defaults to 42 (URL `?seed=`). Mode or scenario changes always create a new session. |
| Stream | `WS /ws?sessionId=…&protocolVersion=1` | The first message must be a checkpoint snapshot; the status only becomes "connected" then. |
| Start | `POST …/control` `start` | Sent about 1.1 s after creation, when the camera has flown into the operating view. |
| Controls | `pause`, `resume`, `reset`, `set_speed` | Speeds offered: 0.5×, 1×, 2×, 4×, 8×. Every intent has a fresh `requestId` and the current `generation`. |
| Inject | `POST …/inject` | See the table below. Without `atSimMs`, so running sessions schedule at the next step. |
| Resync | socket `simulation.request_snapshot` | On a sequence gap, an incompatible message, or an unknown event type. |
| History | `GET …/events?afterSequence=…&limit=500` | After a gap is resolved, to restore the transcript only. 410 shows an explicit "History unavailable" entry. |
| Compare | `POST /api/comparisons`, `GET /api/comparisons/:id` | `accelerated_mock` at 20× when the server is in mock mode, otherwise `realtime` at 1×. Durations 60/120/300 s, filtered so every scheduled scenario event fits. Polled every 250 ms (1 s for realtime). |
| Compare data | `GET …/metrics?fromSimMs=…&limit=1000` | For both child sessions, paginated with `nextFromSimMs`, to draw the queue chart. |
| Heartbeat | socket `ping` every 15 s | No `pong` within 8 s closes the socket and reconnects. |

Injections offered in the Events menu (each disabled with a stated reason when the mode, server or state does not allow it):

| Button | Body `event` |
| --- | --- |
| Ambulance / Police, per approach | `{ type: "emergency", approach, vehicleType, responding: true }` |
| Traffic surge, per approach | `{ type: "demand_surge", approach, multiplier: 4, durationMs: 60000 }` |
| Trigger a decision now (AI only) | `{ type: "decision_boundary", reason: "simultaneous_proposals" }` |
| Low JEV confidence (AI, mock JEV only) | `provider_fault` jev `low_confidence` 30 s, then `decision_boundary` `ambiguous_arbitration` |
| JEV timeout (AI, fault injection enabled) | `provider_fault` jev `timeout` 30 s, then `decision_boundary` |
| Gemini error (AI, fault injection enabled) | `provider_fault` gemini `provider_error` 30 s, then `decision_boundary` |

Error handling: `STALE_GENERATION` and `INVALID_STATE` trigger a checkpoint request, never an automatic retry of the
user's action; the message is shown. `NETWORK`/`TIMEOUT` suggest checking the server or switching to the offline demo.

## Reconnect behaviour

Exponential backoff from 0.5 s, doubling to an 8 s cap with ±25% jitter, at most 8 attempts. From the second failed
attempt the client calls `GET /api/sessions/:id`; a 404 ends reconnection with "This session no longer exists on the
server". While not connected the header and a banner say the data is not live, the scene freezes on the last
authoritative snapshot (no extrapolation), and the viewer can reconnect now or switch to a fresh offline demo.

## How events are shown

| Event | Where it appears |
| --- | --- |
| `simulation.snapshot` | Replaces vehicles, signal, metrics, agents, providers, JEV state. Generation change clears proposals, arbitration, timeline and charts (transcript kept). |
| `signal.phase_changed` | Signal HUD, timing chart rows, scene lights; transcript "Signal transition". |
| `agent.status` | Agent cards; timeline bars from `lastInference` (sim start/end, latency); transcript "Observation ⋅ inference started" and failures. Completed-inference statuses are not repeated in the transcript. |
| `agent.proposal` | Agent cards (observations, request, rationale labeled model or mock), decision round. |
| `arbitration.conflict` | Decision round, JEV panel "why called". |
| `jev.arbitration` | JEV panel: distribution, reported confidence and band, latency, model; timeline bar from `requestedAtSimMs` to the event's `simulationTimeMs`. |
| `arbitration.fallback` | Decision round "Fallback" row; banner when `activeController` is `deterministic_fallback`. |
| `decision.outcome` | Safety row, agent verdicts, timeline safety bar until `scheduledAfterSimMs`. Keep vs change is inferred from the current phase when the outcome arrives. |
| `simulation.metrics` | Metric list and charts (one point per event). |
| `simulation.status`, `scenario_event`, `error`, emergency `vehicle_event`s | Transcript. Ordinary vehicle request/spawn/complete events are counted, not listed. |

Honesty rules the UI enforces: every model-derived value carries a provenance badge (Mock / Live / Rule-based);
`null` averages render as "No completed trips" or "None yet", never 0; confidence is shown only from
`ArbitrationResult.confidence` (a timeout shows none); the plain-language round summary is labeled "written by this
app"; mock latencies are labeled simulated; comparisons show the server's `limitations` and no hardcoded winner.

## Offline demo vs backend

The mock engine is a stand-in for demonstrations, not a second source of truth:

- Deterministic seeded streams (sfc32) for demand, vehicle mix and latency, so a traditional and an AI session with
  the same seed get identical arrivals. Not bitwise compatible with the backend's RNG (the contract makes no such claim).
- Intelligent Driver Model car-following; vehicles that cannot stop below 4.5 m/s² proceed on yellow (dilemma zone).
  The backend's physics is authoritative when connected; the renderer draws whatever positions it receives.
- Mock agents are rule-based (queue, wait, emergencies); the mock JEV scores pressure, returns a softmax distribution
  over the eligible choices and a separate confidence. Low confidence appears only when injected.
- Snapshots at 10 Hz, metrics every simulated second, `faultInjectionEnabled: true`, model names `mock-gemini-v1` and
  `mock-jev-v1`, every model output `provenance: "mock"`.
- Tests validate every mock event and snapshot against the shared Zod schemas for all nine scenarios.

## Coordination notes for the backend

These are observations, not contract changes:

1. `RuntimeConfigResponse.snapshotIntervalMs` is typed as simulation time but described as a wall-clock cadence. The
   frontend does not depend on it (interpolation uses snapshot arrival times), but the meaning should be confirmed.
2. The UI derives "observation" moments from `agent.status` with a pending `lastInference`. A distinct observation
   event would need a contract change; none is requested.
3. Extension ("keep this green longer") outcomes are recognised by `requestedPhase` equal to the current phase. If the
   backend expresses extensions differently, `DecisionRound` needs a small update.
4. Summaries are rendered verbatim and should stay short (the transcript wraps them in a narrow rail).
5. Event history retention should cover at least a few hundred events so short disconnects can be backfilled.

## Files outside `apps/web`

- `vitest.config.ts` (new, root): Vitest projects so root `npm test` runs the shared and web suites with their own
  settings. Add a project entry here if `apps/server` gains tests with its own config.
- `package-lock.json`: frontend dependencies (Three.js, React Three Fiber, drei, React Router, Overpass, testing tools);
  PixiJS and Inter were removed from the web package because one React Three Fiber renderer replaces them.
- `docs/FRONTEND_INTEGRATION.md`: this file.

## Verification

```sh
npm test                                  # shared contract + web unit/component tests
npm run typecheck -w @intersection/web
npm run test:e2e -w @intersection/web     # Playwright against the dev server, no backend
```

The end-to-end suite uses headless Chromium with SwiftShader WebGL, which is far slower than a laptop GPU; timeouts
are set accordingly. Known noise: React Three Fiber 9.8 logs a `THREE.Clock` deprecation warning from its internals.

## Not done yet

- Side-by-side 3D comparison. The comparison view shows paired metrics and a queue chart instead.
- The WebSocket transport is verified against the contract with a scripted socket, not against a running backend.
- The visual language is a placeholder to be replaced by the team's direction through the tokens in
  `apps/web/src/index.css` (the 3D scene reads the same tokens).
