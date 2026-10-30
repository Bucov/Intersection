# Intersection backend — continuation prompt

You are taking over an interrupted implementation. Continue the work below, preserving all existing changes. This file is a handoff prompt, not a claim that acceptance is complete. Read the original detailed backend task if available, and inspect the actual source before editing.

## CRITICAL: where the implementation actually lives

- User workspace/root: `/home/luka/Projects/Intersection/Intersection`, branch `main`, originally clean at `65be71f`. This handoff is written here for discoverability. **Do not implement on or push to main.**
- Requested backend worktree: `/home/luka/Projects/Intersection/Intersection-backend`, branch `feature/backend`, still clean at `94f6d79`. It has NOT received the new implementation yet.
- **Actual working implementation:** `/tmp/intersection-backend-implementation`, an isolated clone on `feature/backend`, currently HEAD `d1d5c26`, with substantial uncommitted work. Work here first. Do NOT discard this directory or its dirty files.
- Adapter source checkout: `/tmp/intersection-jev-verified`, branch `feature/jev-adapter`, commit `3f4cf7bb4b36768206832d9b500d3630c43dbfbf`.
- Isolated toolchain: `/tmp/intersection-node22/node_modules/.bin` (Node 22.23.4, npm 10.9.9). Default machine has Node 26.12.1/npm 12.2.1.
- Dependency cache: `/tmp/intersection-npm-cache`.

The temporary clone was necessary because the backend worktree is outside this session's writable filesystem roots. Final delivery requires a permission-approved fetch/fast-forward of the original backend worktree from the temporary clone. Do not reset, force-push, switch over dirty work, or merge into main. Preserve this temporary directory until delivery succeeds. Its origin points to the local backend checkout, not GitHub.

## Original objective

Finish the existing TypeScript npm-workspace traffic demo, preserving its frontend design and browser offline transport. Traditional control must work without keys. Server AI runs two genuine concurrent Mozaik 4.1.0 loops; each independently selects Gemini or Claude and a manually configured supported model ID. Conflicting proposals go through the separate completed `mozaik-jev-adapter` package. Only a deterministic signal FSM may change signals. Provide real adapter mock integration, optional live JEV, REST/WS integration, truthful metrics and paired comparisons, tests, fish-compatible docs, and meaningful commits on feature/backend. Never invent live proof or AI superiority.

## Completed investigation

Gate 0 inspected branches/worktrees/status/remotes/history, manifests, lockfile, all shared contracts, server starter, frontend transports/mock engine/tests, and API/handoff/integration docs. No applicable AGENTS.md was found. Backend only had starter routes; main had the complete newer frontend. Main was a descendant, so the temporary clone was fast-forwarded to main before implementation. Inventory is in `docs/BACKEND_IMPLEMENTATION.md` in the temporary clone.

## Committed milestones in the temporary clone

1. `0ff0cd0` — deterministic traffic engine and signal safety gate.
   - Server physics adapted from existing frontend mock engine, without its invented mock arbitration.
   - Fixed 100 ms steps, named seeded sfc32 streams, four straight lanes, trajectories, queues/backlog, emergency vehicles, actual metrics.
   - Strict yellow/red stop-line entry prohibition, 2 m minimum bumper gap, min/max green, yellow/all-red and occupancy holds.
   - Validated synchronous `requestGreen` authority; separate decision revision, physics version and snapshot/event sequence fields.
2. `a5ea62f` — v1 session REST and WebSocket transport.
   - Health/config/scenarios, create/read/control/inject/events/metrics, schema errors, idempotency receipts, capacity bounds, checkpoint-first WS/ping/reset/reconnect and send-buffer limits.
3. `b107f83` — verified adapter package + Mozaik coordinator.
   - `vendor/mozaik-jev-adapter-0.1.0-3f4cf7b.tgz`, repo-relative dependency and lockfile, exact core 4.1.0.
   - Actual `createJevBridge`, joined participant, separate observer, actual MockJevAdapter fixtures, optional TypeSafeJevAdapter (no direct SDK client).
   - Frozen observations, stable A/B ordering, agreement bypass, current-cycle checks, action-time freshness, fallback, deadline and cleanup.
   - Raw adapter result retained alongside optional legacy presentation projection.
4. `d1d5c26` — independent provider configuration, concurrency tests, .env example, model-list command and opt-in live smoke script.

## Current uncommitted work — PRESERVE

Run git status in the temporary clone for the authoritative list. Currently modified:

- `apps/server/src/ai/service.ts`: explicitly empties MOZAIK_API_KEY to disable core's optional cloud exporter (including cached credentials); this was just added and needs final verification.
- `apps/server/src/app.ts`: comparison endpoints plus formatting.
- `apps/server/src/simulation/engine.ts`: occupancy flag refresh after motion; additional 8 MiB serialized history bound. The history-byte bound was just added and needs final verification.
- `apps/server/src/simulation/rng.ts`, `apps/server/test/api.test.ts`: formatting.
- Frontend AgentCard, JevPanel/tests/jevState, MetricsPanel, ConnectionStatus, ConcurrencyTimeline: actual provider labels, raw nullable JEV results, synthetic probability labels, measured wall-time labels, new trajectory metrics; no redesign.
- root package.json/package-lock.json: Node >=22 and backend browser test script; lock refreshed using npm 10 offline.

Untracked implementation files:

- `apps/server/src/comparisons.ts`
- `apps/server/test/comparison.test.ts`
- `apps/server/test/final-safety.test.ts`
- `apps/web/playwright.backend.config.ts`
- `apps/web/e2e-backend/backend.spec.ts`

Comparison driver creates isolated sessions with identical input/seed/horizon. Accelerated mock waits BETWEEN physics steps for mock decisions, preserving reproducibility; physics itself never awaits. Live comparisons are wall-paced and labeled non-repeatable. Hash identifies schema-ordered seed/scenario/engine-version inputs, not sampled output. Child sessions are read-only. UI already consumes existing comparison contracts.

## Verification achieved (do not overclaim)

- Adapter: `npm ci --workspaces=false`, `npm run check` (45 tests), `npm run verify:package`, `npm pack --workspaces=false` succeeded using Node 22/npm 10 and a shared populated npm cache. Built exports/declarations inspected.
- Archive SHA256: `b00561e8c3c9f48a96529b6ba15d99233aec3d94576a89150ab9104f68b848ea`. See `vendor/README.md`.
- `npm ls @mozaik-ai/core mozaik-jev-adapter` showed one deduplicated core 4.1.0 and valid adapter 0.1.0 after repairing interrupted install.
- Full suite passed **168 tests** before the latest final-safety/history changes. Full build and typecheck passed at that point.
- Latest server-only suite passed **35 tests** after fixing an occupancy flag that stayed true for one tick after a vehicle cleared the box. This includes null measurements, forged selected IDs, queue drift, all-red occupancy, comparison reproducibility, concurrency and failure cases.
- Four deferred-runner tests demonstrate actual overlapping Mozaik loop intervals for Gemini/Gemini, Claude/Claude, Gemini/Claude and Claude/Gemini configurations. They use injected OFFLINE runners; they are not live provider proof.
- `npm run test:live -w @intersection/server` accurately skipped. The original backend has no `.env`; exact model IDs and live credentials are absent. No live Gemini, Claude or JEV call has been proven.
- Lint passes with existing warnings from frontend and bundled skill code. Final lint on all latest edits remains required.

## IMMEDIATE BLOCKER: production browser bundle crashes

The new backend browser suite ran against production builds and **all five tests failed** before session UI appeared. Do NOT call browser acceptance complete.

Command:

```fish
npm exec -- playwright test -c apps/web/playwright.backend.config.ts
```

Trace artifacts: `apps/web/test-results/*/trace.zip` and error-context.md in temporary clone.

Investigation found the real runtime error:

```
TypeError: r is not a function
  at /assets/services-DjWLHmmn.js:55:29639
```

The compiled services chunk imports React's CommonJS require wrapper from `react-B2abuHbR.js`, while the React chunk imports from both services and the main index. This creates a circular chunk initialization failure. Existing `apps/web/vite.config.ts` manually groups react/motion/base-ui, three and charts with `includeDependenciesRecursively:false`. Likely fix: remove or revise the manual React group (possibly let the bundler choose chunks altogether) and rebuild. This is a build/integration correction, not a UI redesign. Verify the diagnosis; do not merely increase timeouts or switch tests to dev mode to hide it.

A second test-only error occurs because the Playwright init script accesses localStorage on an opaque initial document. Guard with a try/catch or document-origin check in the test init script. Do not suppress real app errors.

The dev-mode UI screenshot did render the existing design; first capture showed backend unavailable during tsx restarts triggered by repeated shared builds. Subsequent curl checks proved both backend and Vite proxy healthy. Production-browser tests intentionally use stable builds to avoid these restarts.

## Other failures already understood

- Sandbox blocks DNS, local server sockets, tsx IPC and Chromium IPC. Use the platform's explicit escalation mechanism when needed; do not bypass it.
- npm 12 changed `npm pack --json` from an array to an object; upstream adapter verify script expects npm 10. Do not modify the adapter; use isolated Node 22/npm 10.
- Adapter verifier uses an offline temporary consumer install. It must share the cache populated by adapter npm ci.
- Interrupted dependency install left manifest changes but incomplete lockfile/invalid adapter. Repaired using npm 10 offline install; do not redo unless inspection shows a new problem.
- `npm run dev:web -- --host ...` failed because nested npm 12 forwarding treated --host as npm configuration. Plain `npm run dev:web` works. Backend browser config uses workspace-local preview.

## Next actions, in order

1. Inspect git status and current processes. Preserve all dirty work. Read source and tests listed above.
2. Fix production circular chunk issue and test-only localStorage init error. Rebuild and rerun backend browser suite. Inspect desktop and mobile screenshots, fix actual issues.
3. Complete browser coverage for reconnect and real adapter abstention/stale outcomes (server tests already cover these; current browser suite covers traditional, selection, low confidence, timeout and comparison).
4. Audit final safety/resource limits. Verify the just-added history-byte cap and disabled cloud exporter. Consider replacing per-socket server close listeners with a bounded shared socket set to avoid EventEmitter warnings at >10 sockets. Check disposal, late results, no unhandled rejections, accurate statuses and counts.
5. Finish documentation: substantial root README and `docs/PROJECT_OVERVIEW.md`, update existing API/frontend docs' stale 'not implemented' statements and migration notes. Include real paths, fish startup, Node22/npm10, artifact provenance, config matrix, manually selected models, live untested status, FSM/freshness, metric denominators, comparison tradeoffs, reconnect/reset/demo instructions and limitations.
6. Run full build/typecheck/lint/test, shared package type-level checks, existing offline frontend Playwright suite and backend browser suite. Run adapter checks on Node22 if needed, preserving package boundary. Live smoke remains opt-in and accurately skipped without keys/IDs.
7. Commit remaining meaningful milestones (final safety/UI, comparison/browser fix, docs). Do not accidentally omit untracked files.
8. Test clean-clone setup using the committed relative archive and npm ci, ideally Node22/npm10, including build/test. No absolute /tmp dependency may remain in package manifests/lockfile.
9. Recheck original backend worktree still clean and branch still feature/backend. Request required filesystem permission to fetch temporary feature/backend and fast-forward original backend to it. Do not overwrite newly added teammate work; if branch advanced, reconcile safely in isolation.
10. Final report: original backend branch/status, changed files, exact test results, adapter commit/install method, mock/live capability matrix, offline overlap evidence, browser results, unresolved limitations and clean-checkout run instructions. No push/merge to main requested.

## Useful commands and locations

Run implementation commands from `/tmp/intersection-backend-implementation`:

```fish
npm run build
npm run typecheck
npm run lint
npm test
npm test -- --project server
npm run models -w @intersection/server
npm run test:live -w @intersection/server
npm run test:e2e:backend
npm run test:e2e -w @intersection/web
npm ls @mozaik-ai/core mozaik-jev-adapter
```

For isolated toolchain in fish:

```fish
set -lx PATH /tmp/intersection-node22/node_modules/.bin $PATH
set -lx npm_config_cache /tmp/intersection-npm-cache
```

Servers from earlier work may still run: dev backend port 3001 and Vite localhost:5173. Backend Playwright uses ports 3011 and 4175. Inspect before stopping processes; do not kill unrelated services.

Existing design uses Overpass, dark semantic colors and Three.js. Preserve it. TypeSafe skill and Impeccable skill were read; user explicitly authorized continued implementation without redesign. Impeccable reported stale design sidecar/orphaned old App.tsx brief; do not expand this task into repairing skill metadata.

No requested original backend acceptance is complete until production browser tests pass and the actual feature/backend worktree receives the implementation.
