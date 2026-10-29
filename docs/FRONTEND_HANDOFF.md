# Frontend handoff — Milestone 0

The v1 contract is ready for frontend development against fixtures. **The simulator, new REST handlers,
WebSocket streaming, Gemini, Mozaik and JEV are not implemented yet.** The starter server still uses its
original protocol. This handoff defines what the later backend must deliver; it does not announce live APIs.

## Integration checkpoint

Integrate the Milestone 0 commit from `feature/backend` into shared `main`, then bring that revision into the
frontend worktree before importing the new contracts. This branch is based on initialized `main` revision
`23c3498`; its contract commit can be cherry-picked onto that revision. This milestone does not merge or push
main automatically. No files under `apps/web` or existing server handlers were changed.

The only dependency addition is `zod: ^4.6.7` as a direct runtime dependency of `@intersection/shared`.
That exact version was already present transitively in the root lockfile; declaring it prevents accidental
reliance on hoisting. The root manifest and TypeScript configuration are unchanged. The lockfile change only
adds the shared package dependency edge. Tests use the existing root Vitest installation.

From the monorepo root after integration:

```sh
npm ci
npm run build -w @intersection/shared
npm run typecheck -w @intersection/shared
npm run test -w @intersection/shared
```

The package exports compiled `dist` ESM and declarations. Build it before starting the web application,
and rebuild it when shared source changes. Root `npm run build` already does this in the correct order.
New public schemas/types are re-exported from the existing package root; no deep imports are needed.

```ts
import {
  SessionResponseSchema,
  SocketMessageSchema,
  signalLights,
  type SimulationSnapshot,
  type ServerEvent,
  type CreateSessionRequest,
} from "@intersection/shared";

const created = SessionResponseSchema.parse(await response.json());
const snapshot: SimulationSnapshot = created.snapshot;
const lights = signalLights(snapshot.signal.phase);
const decoded = SocketMessageSchema.safeParse(JSON.parse(socketEvent.data));
// Handle JSON syntax errors and !decoded.success; show a compatibility error and resync.
```

`CreateSessionRequest` describes caller input, so defaulted speed/autoStart can be omitted.
`ParsedCreateSessionRequest` describes the result of parsing, with those defaults present.
The exported `REST_CONTRACT` is also usable as a route/schema registry. It has no network side effects.

## Fixtures to build against

| File | Use |
| --- | --- |
| [simulation-snapshot.json](examples/simulation-snapshot.json) | complete world state, visible ambulance and crossing car |
| [server-events.json](examples/server-events.json) | all 13 domain event variants and overlapping mock inference intervals |
| [requests.json](examples/requests.json) | session creation, pause, injection, comparison and socket resync |
| [responses.json](examples/responses.json) | all eleven REST success shapes, including catalog/config |
| [error.json](examples/error.json) | stale-generation error UI |

These are illustrative JSON examples, not a recorded physics run. Do not use their metrics as AI performance
claims or their timestamped mock intervals as evidence of real model concurrency. JSON fixtures remain in docs
so the frontend can copy/import them in its own mock transport without introducing runtime simulator code.

## Rendering requirements

- Apply snapshots as complete vehicle replacements keyed by `(sessionId, generation, vehicle.id)`. An absent
  vehicle was removed. Keep render interpolation separate from authoritative state. Do not simulate arrivals,
  signal transitions or vehicle movement locally beyond bounded interpolation between snapshots.
- X/Z is the ground plane; north is **negative Z**. Y is elevation. Positions are vehicle centers at ground
  level in meters. Model local forward is +Z; apply `rotation.y = headingRadians`. See the route/spawn/stop-line
  table in [API_CONTRACT.md](API_CONTRACT.md#coordinates-and-routes). This differs from the old 2D `x/y` shape.
- Ambulance/police styling comes from `type`; emergency strobes/priority come from `emergency`. A police car
  with `emergency: false` has no priority. `stopLineEtaSeconds: null` means no finite estimate, not arrival now.
- Derive colors with `signalLights(phase)`. There is one phase enum, never independently writable NS/EW lights.
  An accepted proposal is a schedule, not an immediate green. Render actual `signal.phase_changed` or snapshots.
- Animate clearance normally. `clearanceBlockedByVehicles` explains an extended all-red interval. Countdown
  maximums are null for yellow/all-red; use `earliestEndAtSimMs` as the earliest permissible change, not a
  guaranteed change time. Simulation and wall clocks must not be mixed.

## Session controls and connection

1. Fetch config/scenarios. Create with mode, scenario ID, seed and request ID. Selecting a different mode or
   scenario creates a new session; there is no `set_mode` control. Full scenario/timing overrides are optional.
2. Save the returned snapshot, then connect `/ws?sessionId=<id>&protocolVersion=1`. The first socket snapshot
   is authoritative and closes the race with REST creation. The server may have advanced before connection.
3. Use REST for start/pause/resume/reset/set_speed and injections; always include a fresh request ID and the
   current generation. Retrying the same operation uses the same ID/body. A new user intent uses a new ID.
4. Apply domain sequences in order; ignore duplicates. A gap requires a snapshot request or reconnect. A
   reconnect snapshot is a checkpoint and may reuse the latest sequence; accept it as the new baseline.
   `pong` is outside the domain sequence. See the full reconnect algorithm in API_CONTRACT.md.
5. Reset increments generation and clears local interpolation, vehicles, proposals, timeline selection and
   metric series. State versions and event sequences do not restart. Keep historical trace display separate
   from active generation state. REST 409 on an old generation should prompt a snapshot refresh, not an
   automatic retry of a potentially different user action.
6. Load trace history separately if needed; handle 410 as an explicit unavailable-history boundary. The
   snapshot restores present state, not all past explanations.

Default planned stream cadence is 5 snapshots per wall second, with immediate domain events. Do not expect
every 100 ms physics tick. Paused state is static even while wall time advances. Interpolate using simulation
timestamps and the configured speed; stop extrapolating during pauses/disconnection.

## Agent and JEV panels

`agents[0]` is A/NS, `agents[1]` B/EW. Each has its own `lastInference` with wall start/end times so both
can occupy overlapping spans on a timeline. Pair events by inference ID; group decisions by correlation ID.
Proposals have short explicit rationales. Display them as model output, not hidden chain-of-thought.

Show `config.demoMode`, provider readiness, agent/result provenance and `controller.activeController`.
AI-selected sessions may be in deterministic fallback with missing live credentials. Pending JEV arbitration
has a null result. Timeout is not a 0%-confidence response. Low-confidence mock injections must stay labeled
mock. Do not invent model/version data when the field is null.

The confidence band uses the result's policy and actual `confidence`; do not calculate it from the selected
option's probability. Eligible-choice distributions may omit ineligible options. DEFER and safe fallback are
valid outcomes. `decision.outcome` explains acceptance/rejection; a subsequent phase event shows execution.

## Metrics and comparisons

Show upstream backlog next to the on-road queue. Requested, spawned and completed are different counts.
Label completed waiting/travel averages as such and render null as “No completed trips”. Surface active and
upstream waiting alongside them so uncompleted traffic is visible. Queue-series samples come from the metrics
endpoint; truncate/paginate explicitly using its cursors. See the exact metric definitions in API_CONTRACT.md.

Comparison responses expose isolated traditional/AI session IDs, paired schedule identity and each side's
metrics. Child sessions are read-only. `realtime` means 1×; `accelerated_mock` demonstrates control logic only.
Show provenance, execution mode and limitations next to any result. The AI is allowed to perform worse.

## Compatibility and future changes

The starter `Vehicle`, `IntersectionState`, `TrafficLightState`, `ServerMessage`, and `ClientMessage` exports
remain deprecated for compilation compatibility. They are **not aliases** for v1. Migrate to `VehicleState`,
`SimulationSnapshot`, `ServerEvent`, and `ClientEvent`; migrate `simulation:state` to `simulation.snapshot` and
`/api/simulation` to the session API only when the new transport milestone is implemented.

After this checkpoint, contract changes require a separate commit, migration note and explicit handoff to the
frontend. Additive optional response fields are preferred; new required request fields, enum members, removed
fields, changed units or reconnect semantics require coordination. The current contract is version 1.
