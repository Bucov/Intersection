# Running Intersection with real AI

> Short version: [`QUICKSTART.md`](QUICKSTART.md). This page is the detailed reference.

This guide describes the code currently in this repository. It explains what was implemented, how to connect the browser to the server, and how to replace both mock agents and mock arbitration with real services.

## What the project does

Intersection has three parts:

- `apps/web`: the React interface and Three.js traffic view. It can run its own offline simulation or connect to the backend.
- `apps/server`: the authoritative traffic simulation, HTTP API, WebSocket stream, two Mozaik agent loops, and JEV arbitration integration.
- `packages/shared`: the schemas and types that both sides use to agree on requests and events.

With a backend session, the server moves the cars and calculates metrics. The browser sends controls over HTTP and receives simulation updates over WebSockets. Vite forwards `/api` and `/ws` to the server, so you do not need to wire up URLs in individual components.

For AI control, two agents inspect traffic and independently propose a signal plan. Each agent can use Gemini or Claude. Conflicting proposals go through the separate `mozaik-jev-adapter` package. Agreement can bypass arbitration, so a healthy live session does not necessarily make a JEV request every cycle.

Only the deterministic signal state machine changes lights. AI cannot bypass minimum green, yellow, all-red or intersection occupancy rules. Failed, late or unusable AI responses leave deterministic fallback available. Cars moving on screen therefore do **not**, by themselves, prove that AI is working.

## What was implemented and verified

The existing backend implementation includes deterministic traffic physics, signal safety checks, session APIs, WebSocket updates, independent provider configuration, concurrent Mozaik loops, actual adapter mock integration, optional live JEV, and paired comparisons. The frontend preserves its existing design and offline option while displaying backend results.

During this continuation I removed forced vendor chunk groups from Vite to fix the production React initialization crash, guarded the browser test's localStorage setup on opaque documents, and replaced the placeholder README with setup instructions.

Verification on this machine: production build and typecheck passed, 174 unit/integration tests passed, all five existing production backend browser tests passed, and lint passed with warnings. The dependency tree has one deduplicated Mozaik core 4.1.0 and adapter 0.1.0. The adapter archive is checked into `vendor`; its source commit and checksum are in `vendor/README.md`.

Update (2026-10-30): the live smoke test now passes with Gemini agents and live TypeSafe JEV (conflict, measured JEV response, selected proposal, overlapping inference). It previously failed because Gemini wrapped its JSON in markdown fences; agents now request structured JSON output. Live Claude was not verified because the configured Anthropic key was rejected. Expanded browser coverage, the final resource audit and clean-clone verification remain outstanding.

## 1. Install the project

Open a terminal at the repository root—the directory containing this guide's parent `docs` directory and the root `package.json`.

```sh
npm ci
npm run build
npm run models -w @intersection/server
```

Use Node 22 or newer. The original work used Node 22/npm 10; this continuation built and tested with Node 24/npm 11. You do not need the old `/tmp` implementation directories or a separate adapter checkout.

The model-list command prints the exact model IDs supported by the installed Mozaik version. Copy IDs from that output. Do not guess a model name or assume a newly released provider model is supported by Mozaik 4.1.0. Registry support also does not guarantee access through your particular API account.

## 2. Prepare the API credentials

For the example below, obtain:

- A Gemini API key from your Google AI Studio account, with API access to your selected Gemini model.
- An Anthropic API key from your Anthropic developer account, with access to your selected Claude model.
- A TypeSafe API key for live JEV arbitration.

These are API credentials, not browser chat subscriptions. Use accounts with the required API access and available quota. Live sessions send synthetic traffic observations to the configured services and can incur usage charges.

Both agents may use Gemini, both may use Claude, or they may use different providers. You only need keys for providers actually selected. You still need the TypeSafe key if you want arbitration to be live too.

No Mozaik cloud API key is required. Streaming agent loops to the Mozaik cloud dashboard (app.jigjoy.ai) is optional: pair once with `npx @mozaik-ai/cloud-sdk pair` and set `MOZAIK_CLOUD=on`. See step 5 of `QUICKSTART.md`. The startup log's last line reports whether it is on.

## 3. Create the server environment file

From the repository root, copy the example **if you do not already have a server .env**:

```sh
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env` in your editor:

```dotenv
HOST=127.0.0.1
PORT=3001

DEMO_MODE=live
JEV_MODE=live

AGENT_A_PROVIDER=gemini
AGENT_A_MODEL=REPLACE_WITH_EXACT_GEMINI_ID_FROM_MODEL_LIST
AGENT_B_PROVIDER=claude
AGENT_B_MODEL=REPLACE_WITH_EXACT_CLAUDE_ID_FROM_MODEL_LIST

GEMINI_API_KEY=REPLACE_WITH_YOUR_GOOGLE_API_KEY
ANTHROPIC_API_KEY=REPLACE_WITH_YOUR_ANTHROPIC_API_KEY
TYPESAFE_API_KEY=REPLACE_WITH_YOUR_TYPESAFE_API_KEY

TYPESAFE_DEFAULT_MODEL=
```

Replace every `REPLACE_...` value. `TYPESAFE_DEFAULT_MODEL` is an optional TypeSafe model override; leave it empty to use the client's default unless your TypeSafe setup requires a particular supported ID. It is separate from the Gemini/Claude model IDs. `JEV_MOCK_FIXTURE` is not needed for live arbitration.

Keep all keys on the server. Never put them in `apps/web`, a `VITE_` variable, screenshots or commits. The repository ignores `.env` files.

The server imports `dotenv/config`, which reads `.env` relative to its working directory. The workspace npm commands below run from `apps/server`, so they load **apps/server/.env**. Running `node apps/server/dist/index.js` directly from the root would instead look for a root `.env`. Existing exported shell variables can override values in the file; check for old exports if changes appear ineffective. Restart the server after editing configuration.

## 4. Start the backend and frontend

Terminal one, from the repository root:

```sh
npm run start -w @intersection/server
```

This uses the production server built earlier. For server development, use `npm run dev:server` instead. Do not run both on port 3001.

Terminal two, also from the root:

```sh
npm run dev:web
```

Open the address printed by Vite, usually `http://localhost:5173`.

The default proxy already connects the frontend to `http://127.0.0.1:3001`. If you deliberately change the backend port, start Vite with the matching URL (works in fish and bash):

```sh
env INTERSECTION_BACKEND_URL=http://127.0.0.1:3002 npm run dev:web
```

Keep the frontend and backend on this machine for this walkthrough. Remote hosting needs its own reverse-proxy and deployment setup.

## 5. Explicitly require the backend in the UI

Open **Settings → Data source → Backend only**. Then start a new AI simulation, for example the simultaneous-proposals scenario.

This choice matters: **Automatic** may fall back to the browser's offline demo when the server cannot be reached. **Offline demo** never contacts the backend. The home-page preview always runs locally, even when Backend only is selected; use the simulation page to demonstrate the backend.

Three independent choices determine what is real:

| Setting | Required for a fully live AI demo |
| --- | --- |
| Browser data source | Backend only |
| Server `DEMO_MODE` | `live` — real agent inference |
| Server `JEV_MODE` | `live` — real arbitration when proposals conflict |

Backend only with `DEMO_MODE=mock` is still server-side mock AI. `DEMO_MODE=live` with `JEV_MODE=mock` uses real agents but synthetic arbitration. Traditional mode never calls AI, regardless of these settings.

## 6. Check that live services are actually working

From another terminal:

```sh
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3001/api/config
```

Read startup warnings for missing keys, unsupported model IDs, or unavailable JEV. A ready/configured provider is not proof of a successful external request: inspect the AI agent cards, completed inference information, transcript and JEV results during a session. “Offline runner,” “Mock,” and “Synthetic confidence” are not evidence of live inference.

For stronger verification, run the opt-in smoke test:

```sh
env RUN_LIVE_SMOKE=1 npm run test:live -w @intersection/server
```

This loads the server environment file and makes real calls. It creates its own session; it does not need the HTTP server to be running. It attempts up to three cycles over roughly 35 seconds and reports `conflict`, `liveJev`, `selected`, `overlap`, and inference intervals.

Success requires an observed conflict, a measured live JEV response, and completed overlapping agent intervals. `selected` can be false even with a measured response. A skipped test is not a pass. A failure to observe conflict or overlap does not automatically mean the credentials are invalid; the test reports what evidence was actually observed.

## 7. A useful demonstration sequence

1. Show a traditional backend session to establish the baseline.
2. Start a new AI session at normal speed with Backend only selected.
3. Show both agents' provider/model labels and completed reasoning intervals.
4. Inspect a real conflict and the resulting JEV status, if one occurs.
5. Show metrics and explain that lights remain subject to the safety state machine.
6. Pause or stop sessions when finished, and stop the server with Ctrl+C.

Use normal speed first: inference has real network latency, while faster simulation makes observations age more quickly. The current agent cycle deadline is 8 seconds and arbitration timeout is 3 seconds. Timeouts and stale results can legitimately prevent a proposal from taking effect.

Comparisons use isolated sessions with matching seed, scenario and horizon. Live comparisons are wall-paced and non-repeatable. Do not present a single comparison as proof that AI is universally better.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser still shows offline agents | Select Backend only, set both modes to live, restart backend, create a new AI session. |
| Backend unreachable | Check server terminal, port 3001, and Vite proxy target. Restart Vite after changing its environment. |
| Agent unavailable | Check exact supported model ID, matching provider and required key; read startup warning. |
| Correct configuration but requests fail | Check provider account access, quota and network connectivity. Configuration validation cannot prove remote access. |
| JEV never appears | Agents may agree; arbitration is only needed for conflicts. Inspect transcript and smoke output. |
| JEV unavailable or times out | Check TypeSafe credentials/configuration and network; the timeout is 3 seconds. |
| Signals continue despite AI failure | Deterministic fallback is intentional; inspect inference outcomes rather than car movement. |
| Environment edits do nothing | Confirm apps/server/.env, restart server, and check exported shell variables. |
| Session capacity reached | Restart the local server; sessions are in memory and are lost on restart. |

For code-level details, start with `apps/server/src/ai/config.ts`, `apps/server/src/ai/service.ts`, `apps/server/src/app.ts`, `apps/server/src/simulation/engine.ts`, and `apps/web/src/transport/WebSocketIntersectionTransport.ts`. API schemas are documented in `docs/API_CONTRACT.md`.
