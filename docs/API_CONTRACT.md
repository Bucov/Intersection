# Intersection API contract v1 — Milestone 0

Status: **specified and schema-tested; endpoints and runtime are not implemented by this milestone**.
The existing starter server still serves `/health`, `/api/simulation` and the legacy socket message.
Do not mistake those routes for this contract. Implementation starts only after this checkpoint is integrated.

`packages/shared/src/index.ts` is the public entry point. Zod schemas are authoritative for field shapes,
units and validation; TypeScript types are inferred from those schemas. `REST_CONTRACT` binds each REST
operation to its method, path, request, success status and response schema. This document specifies behavior
that cannot be verified by validating a single JSON object.

## Compatibility and transport conventions

- All bodies are UTF-8 JSON. POST requires `Content-Type: application/json`. Success responses have
  `protocolVersion: 1`; there is no generic `data` wrapper. Session responses have `snapshot`.
- IDs are opaque case-sensitive strings, 1–128 characters, matching `[A-Za-z0-9][A-Za-z0-9_.:-]*`.
  Never infer ordering from IDs. Seeds are unsigned 32-bit integers, including zero.
- All timestamps ending in `SimMs` and `simulationTimeMs` are integer simulation milliseconds.
  Wall timestamps are UTC ISO 8601 strings. Durations ending in `Ms` are milliseconds; names ending in
  `Seconds`, `Mps`, `Mps2`, `M`, `Radians` and `VehPerHour` explicitly identify other units.
- Numbers must be finite. Counters are nonnegative safe integers. No `undefined`, `NaN` or `Infinity`
  appears on the wire. Unavailable observations and averages use explicit `null`, never invented zeroes.
- Requests reject unknown properties. Responses strip unknown properties during Zod parsing so additive
  fields are compatible. New enum members/event variants require a documented migration; do not silently
  widen the discriminants used by exhaustive frontend switches.
- Each POST has a required `requestId`. Idempotency scope is operation + resource + request ID, for
  the resource lifetime (creation IDs are retained for the server process lifetime). The identical
  parsed request returns its original status/body without replaying effects. A different request body
  with that ID returns 409 `IDEMPOTENCY_CONFLICT`. Check this cache before generation validation so
  retrying an accepted reset is safe. A new generation should use fresh request IDs.
- Requests are acknowledged after state mutation or durable in-memory scheduling, not after a model
  finishes. There is no persistence across server restarts in v1; old session IDs then return 404.
- `demoMode` is selected by server `DEMO_MODE`, never trusted from client input. Missing live credentials
  result in explicit unavailable provider status and deterministic control, not a relabeled mock model.
- Target local deployment: frontend proxies `/api` and `/ws` to the backend, normally port 3001.
  This is a local hackathon API, with no authentication contract. Do not expose it publicly without a
  separate authentication, origin and rate-limit policy. No credentials belong in responses.

## REST operations

| Method | Path | Request schema | Success schema | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | none | `HealthResponseSchema` | 200 |
| GET | `/api/config` | none | `RuntimeConfigResponseSchema` | 200 |
| GET | `/api/scenarios` | none | `ScenariosResponseSchema` | 200 |
| POST | `/api/sessions` | `CreateSessionRequestSchema` | `SessionResponseSchema` | 201 |
| GET | `/api/sessions/:id` | `SessionPathSchema` | `SessionResponseSchema` | 200 |
| POST | `/api/sessions/:id/control` | `SessionControlRequestSchema` | `SessionResponseSchema` | 200 |
| POST | `/api/sessions/:id/inject` | `InjectEventRequestSchema` | `InjectEventResponseSchema` | 202 |
| GET | `/api/sessions/:id/events` | `EventsQuerySchema` | `EventsResponseSchema` | 200 |
| GET | `/api/sessions/:id/metrics` | `MetricsQuerySchema` | `MetricsResponseSchema` | 200 |
| POST | `/api/comparisons` | `CreateComparisonRequestSchema` | `ComparisonResponseSchema` | 202 |
| GET | `/api/comparisons/:id` | `SessionPathSchema` | `ComparisonResponseSchema` | 200 |

Health describes process readiness and both providers; provider degradation still returns 200 with
`status: "degraded"` if the simulator can operate. Config exposes effective timings, geometry, five demand
presets, confidence policy, emission intervals, retention count, capacity and fault-injection availability.
`GET /api/scenarios` returns all nine definitions, defaults and supported modes.

### Session creation and lifecycle

```json
{"requestId":"create-1","mode":"ai","scenarioId":"ambulance-priority","seed":42,"speedMultiplier":1,"autoStart":false}
```

`speedMultiplier` defaults to 1, `autoStart` to false. `signalTiming`, if supplied, is a **complete** timing
object; otherwise use `/api/config` defaults. `scenarioParameters`, if supplied, is a **complete** replacement
of the selected scenario's defaults. Fetch the catalog, clone the chosen defaults, then edit them. The selected
`scenarioId` remains the template identity; non-default parameters mean the advertised demo guarantee may no
longer hold. `demandPreset` is the source label; explicit `arrivalRatesVehPerHour` are the effective values,
including after user edits. No hidden merge or extra multiplication by preset rates occurs.

Create resolves and returns full `SessionConfig`. A mode absent from a scenario's `supportedModes` returns
422 `VALIDATION_ERROR`. A mock-only scenario is selectable in live mode, but its description's guarantee is
explicitly limited to mock output; forcing a low-confidence model response in live mode is rejected.

The session begins `ready`, time 0, generation 0, version 0, sequence 0. Initial queue placement is part of
that initial state. Time-zero scheduled events are applied, in catalog order, on start before the first step.
`autoStart: true` performs the start action before returning; the response may already show a later state.

| Action | Valid source status | Effect |
| --- | --- | --- |
| `start` | ready | running; applies time-zero events once |
| `pause` | running | paused; clock and vehicle state stop |
| `resume` | paused | running; new inference may use a fresh snapshot |
| `reset` | any | ready at time 0; generation increments; same resolved config, seed and initial queue |
| `set_speed` | ready, running, paused | updates multiplier, no time jump |

Invalid transitions return 409 `INVALID_STATE`. The only implicit transition is running → completed at
configured duration. Reset clears vehicles, metrics, pending commands, injections and inference work from
the old generation, and reinstalls original scenario events. Last configured speed is retained. There is no
in-place mode, seed or scenario mutation; selecting a different one creates a new session. Outstanding model
results during pause are discarded; they cannot authorize later actions upon resume.

Controls require `generation` from the latest snapshot, e.g.
`{"requestId":"pause-1","generation":0,"action":"pause"}`. A stale generation returns 409
`STALE_GENERATION`. They do not require matching a physics tick's version. Reset increments `stateVersion`;
it does **not** reset version or event sequence. Sequence and stateVersion are monotonic for the session
lifetime, independent counters. `stateVersion` advances on authoritative mutations, including each physics
step, controls and accepted scheduling changes; observability-only events advance sequence only.

### Event injection

Supported event discriminants (`InjectedEventSchema`):

| Type | Additional fields | Meaning |
| --- | --- | --- |
| `emergency` | approach, vehicleType (`ambulance`/`police`), responding | enqueue one emergency-capable vehicle; priority only when responding |
| `demand_surge` | approach, multiplier (1–10), durationMs | temporarily multiply that approach's arrival rate |
| `temporary_congestion` | approach, speedFactor (0.1–1), durationMs | reduce approach desired speed without changing vehicle positions |
| `provider_fault` | provider, fault, durationMs | explicit adapter fault injection |
| `decision_boundary` | reason | trigger both agents without changing traffic physics |

The body includes `requestId`, `generation`, optional `atSimMs`, and `event`. Without `atSimMs`, ready
sessions schedule at zero; running/paused sessions schedule at the next 100 ms step. Explicit times must
align to 100 ms, be at least the next step for running/paused, and precede scenario end. Past or off-step
requests return 422. Completed sessions return 409. Paused sessions can accept future schedules without
advancing time. The 202 result contains the authoritative schedule ID and scheduled time; it is not a
promise that a vehicle has already physically spawned. A blocked entrance retains upstream demand.

Fault injections require `faultInjectionEnabled`; otherwise return 409. `low_confidence` is allowed only for
mock JEV. Other faults (`timeout`, `provider_error`, `rate_limit`, `invalid_response`) are explicit simulated
failures even in live mode: events must identify the injected cause, and must not fabricate provider output.
Durations are 100–600,000 ms and must align to 100 ms (as checked by schemas). Decision triggers are ignored
by the traditional controller. Same-time events execute in scheduled array order, then manual acceptance
order. Surges multiply and clamp effective demand at 7,200 veh/h per approach; congestion uses the minimum
active speed factor. Events expire at start + duration; expiration is processed before arrivals at that time.

### History and metrics

`GET .../events?afterSequence=40&limit=100` returns ascending events with sequence strictly greater than 40.
Default limit 100, max 500. Without a cursor, start at the oldest retained event. `nextAfterSequence` is the
last returned sequence (or the supplied cursor when empty, otherwise latestSequence), with `hasMore` for
pagination. `oldestAvailableSequence` and `latestSequence` describe retention. If no events exist both are
zero. If `afterSequence < oldestAvailableSequence - 1`, return 410 `EVENT_HISTORY_EXPIRED`; if the cursor
is ahead of the current latest sequence return 422. Never silently return a partial history. Old-generation
events can be retained after reset, and carry their original generation. Initial/reconnect socket checkpoint
snapshots are not stored in this history.

`GET .../metrics?generation=0&fromSimMs=0&limit=1000` returns current totals plus retained samples ordered by
simulation time. Defaults: current generation, from 0, limit 300; maximum 1000. `fromSimMs` is inclusive.
`nextFromSimMs` is the first unreturned sample time, or null. `truncatedBeforeSimMs` is the earliest retained
sample time if older samples have been discarded, otherwise null. Reset clears the metrics history; requesting
an old generation returns 409. Samples start at zero, then at `sampleIntervalMs`, and include the final state.
Event and metric reads are consistent checkpoints, not mutable views into an advancing simulation.

## Snapshot and physical conventions

`SimulationSnapshot` contains the complete vehicle set and effective configuration; it is not a delta.
`signal` is the only physical signal authority. `controller.requestedMode` preserves the user's choice;
`activeController` may be `fixed_time`, `adaptive`, or `deterministic_fallback`. Agent tuple order is A/NS,
B/EW. Provider tuple order is Gemini, JEV. Provider status includes mode, readiness and nullable model name.
The frontend must display fallback or missing credentials rather than infer activity from `mode: "ai"`.

### Coordinates and routes

Three.js-compatible right-handed coordinates: center `(0,0,0)`, east `+X`, west `−X`, north `−Z`, south `+Z`,
up `+Y`. Units are meters. Vehicle positions describe **geometric centers at ground-plane Y=0**, not front
bumpers or mesh roof centers. The asset's local forward direction is `+Z`; rotate around +Y by
`headingRadians`. Add mesh vertical offsets within the vehicle group.

| Approach (comes from) | Travel / exit | Lane ID | Spawn center (x,z) | Heading | Stop-line coordinate |
| --- | --- | --- | --- | --- | --- |
| north | south | north-inbound | (−1.75, −120) | 0 | z = −10 |
| south | north | south-inbound | (+1.75, +120) | π | z = +10 |
| east | west | east-inbound | (+120, −1.75) | −π/2 | x = +10 |
| west | east | west-inbound | (−120, +1.75) | +π/2 | x = −10 |

There is one lane per approach; its ID stays with the vehicle through departure. Lanes are 3.5 m wide with
centers 1.75 m from the road centerline. Vehicles drive on the right. `intendedExit` and `travelDirection`
must equal the opposite of `approach` in v1. Future turning support needs a separate route/movement extension.

A front bumper is center + half length along forward direction. On red or yellow, a vehicle whose front
has not already passed the stop line must stop before it. Vehicles already beyond the line continue clearing;
they do not teleport or stop in the crossing. Clearance occupancy covers the square `|x| <= 8, |z| <= 8`;
`occupiedVehicleIds` includes any vehicle footprint intersecting this square, not just its center. Physics
uses a nominal 1.8 m width for all MVP vehicles. Despawn after the **rear** passes 140 m along the outbound
axis. Spawn capacity must account for full length and a 2 m minimum bumper gap; blocked requests wait upstream.

`initialQueueByApproach` is 0–12 ordinary 4.5 m passenger cars per lane, zero speed, positioned behind the
stop line with front bumper at 10.5 m from the center and subsequent 2 m gaps. They are deterministic demand
requests already spawned at time zero, counted in all request/spawn metrics and shared in comparisons. These
fixtures ensure congestion demonstrations do not depend on rare arrivals. They use IDs before generated demand.

`waitingTimeMs` is time since spawn with speed below 0.5 m/s. `signalDelayMs` counts stopped time while the
vehicle is before the stop line and its group is red/yellow, including time stopped behind a queue. It is an
operational measure, not a counterfactual causal estimate. ETA is distance of front bumper to stop line divided
by current speed; null when upstream, stopped, or already past the line. Do not turn null ETA into zero.

### Signal safety representation

Phases: `NS_GREEN → NS_YELLOW → ALL_RED → EW_GREEN → EW_YELLOW → ALL_RED → NS_GREEN`.
`signalLights(phase)` provides four presentation colors, without duplicating mutable light state.
Defaults: minimum green 8 s, maximum 45 s, fixed green 30 s, yellow 3 s, all-red 2 s. Timings are step-aligned.
`earliestEndAtSimMs` is the safety minimum; `latestEndAtSimMs` is the maximum for green and null for clearance.
`nextGreen` names the target following yellow/all-red, never an immediately actionable request to skip clearance.
All-red holds beyond nominal clearance if occupied, exposing `clearanceBlockedByVehicles`. Maximum green
applies regardless of model availability. A proposal can alter service duration only within configured limits.

Schemas validate the state representation, not safe trajectories or legal transitions across successive
states. Those invariants belong to later simulation and safety-gate tests.

## Demand and scenarios

Rates in `DEMAND_PRESETS` are provisional demo values, not empirical measurements:

| Preset | North | South | East | West (veh/h) |
| --- | ---: | ---: | ---: | ---: |
| light | 100 | 100 | 80 | 80 |
| normal | 240 | 240 | 180 | 180 |
| rush-hour | 520 | 520 | 170 | 170 |
| reverse-rush | 170 | 170 | 520 | 520 |
| heavy-all-round | 420 | 420 | 420 | 420 |

Demand counts use a seeded non-homogeneous Poisson process, with `lambda = effectiveVehPerHour / 3600`.
More than one request per step is supported. Demand generation must not consume RNG based on controller
decisions or spawn success. The same resolved config and seed produce the same request schedule; failed
spawns do not erase demand. Simulation RNG algorithm and schedule hashing are to be frozen with the engine
implementation; Milestone 0 makes no cross-implementation bitwise replay claim.

Mix: car .845, van .10, bus/truck .05, ambulance .003, police .002; the schema requires a total of 1.
Random ambulances are responding. Random police response probability defaults to .20 and is separately
configurable; a police vehicle alone does not imply priority. Manual/scheduled events explicitly set `responding`.

Random hazards default off. When enabled, at each positive integer multiple of `intervalMs` (default 600,000),
draw independent surge (.15) and congestion (.10) Bernoulli events, once per interval. No hazard at time zero
and no per-tick reinterpretation. Choose one of four approaches uniformly per triggered event; default random
surge is ×3 for 120 s, random congestion factor .5 for 120 s. Random emergency arrivals come only from the mix.

| Scenario ID | Default guaranteed input / demo |
| --- | --- |
| normal-traffic | normal rates, 300 s duration |
| rush-hour | heavy NS rates |
| reverse-rush | heavy EW rates |
| sudden-surge | north ×4 at 60 s for 120 s |
| ambulance-priority | EW initially green; north ambulance requested at zero |
| competing-priorities | 12 initially queued cars on each EW approach; north ambulance at zero |
| simultaneous-proposals | 12 queued per approach; both mock agents request their groups at 8 s |
| jev-uncertainty | queued conflict; explicit mock low-confidence fault and 8 s trigger |
| jev-failure | queued conflict; explicit timeout fault and 8 s trigger |

The last three are AI-only scenarios. `guarantee: "scheduled_input"` means the advertised input is deliberate,
not that a stochastic queue length or model response is guaranteed. `mock_only` means the complete output
demonstration is guaranteed only with deterministic mock adapters. Live model outputs must remain authentic.

## WebSocket protocol

Connect to `/ws?sessionId=<id>&protocolVersion=1`. Validate query before upgrading; HTTP failures use
`ErrorEnvelope`. A successful connection receives a `simulation.snapshot` checkpoint first, then live events.
There is no socket mutation API: creation, controls, mode selection and injection use REST.

All domain events have: `protocolVersion`, `eventId`, `correlationId`, `sessionId`, `generation`, `stateVersion`,
`sequence`, `simulationTimeMs`, `wallTime`, `source`, `provenance`, `summary`, `type`, `payload`.
Source is simulation/controller/agent-a/agent-b/jev/safety/api. Provenance is simulation/deterministic/mock/live.
Correlation IDs connect inference, proposals, arbitration and decisions. Summaries are deliberate short
explanations, never a promise of private chain-of-thought.

| Type | Payload |
| --- | --- |
| simulation.snapshot | `SimulationSnapshot` (full replacement) |
| simulation.status | status, speedMultiplier, controller |
| simulation.vehicle_event | requested / spawned / completed / emergency_detected discriminated payload |
| simulation.scenario_event | scheduleId, event, scheduled/applied/expired status |
| signal.phase_changed | previousPhase, full signal state, reason |
| agent.status | `AgentStatus`, including inference interval and outcome |
| agent.proposal | `TrafficProposal` |
| arbitration.conflict | two proposalIds and mutually_exclusive_phases reason |
| jev.arbitration | `ArbitrationRecord`, pending/completed/failed/stale |
| arbitration.fallback | arbitrationId (nullable), reason, selectedPhase/HOLD, policy |
| decision.outcome | command/proposal IDs, accepted/rejected/duplicate/unnecessary, reason and commit metadata |
| simulation.metrics | `TrafficMetrics` |
| simulation.error | `ErrorDetail` |

Agent inference start/end/failure is represented by `agent.status` plus `lastInference`: wall and simulation
start/end times, request/correlation IDs, latency and outcome. Pending intervals have null completion fields.
Both agents can have pending intervals simultaneously. The mock examples illustrate this shape; they are
not proof of real provider concurrency. Only later implementation traces can demonstrate actual overlap.

### Sequence and reconnect algorithm

1. A session's event sequence increments by one for every broadcast domain event, across resets. Broadcast
   snapshots also get a new sequence. `stateVersion` may be unchanged for telemetry-only events.
2. The connection's initial/recovery snapshot is a **checkpoint**, using the latest already-issued sequence;
   it does not allocate a new sequence or appear in history. Snapshot payload/envelope metadata must agree.
   Atomically subscribe/buffer broadcasts while capturing this checkpoint, then release events with larger
   sequences. This requirement prevents a snapshot-to-subscription race.
3. Replace local state from the initial snapshot and set the cursor to its sequence. Apply subsequent domain
   events in sequence order. Ignore duplicate/older events. Never apply events for a different session.
4. After a reset, the server broadcasts a full snapshot of the new generation as the first new-generation
   event. Drop old vehicle/interpolation/proposal/arbitration state. Late old-generation inference results may
   produce rejection telemetry, but may not repopulate current-generation state.
5. On any sequence gap or incompatible generation, stop applying incremental state and request a fresh
   checkpoint: `{"protocolVersion":1,"type":"simulation.request_snapshot","requestId":"resync-1","sessionId":"session-demo"}`.
   Accept a requested checkpoint even when its sequence equals your previous cursor. Discard buffered events
   through its sequence, then resume. Reconnecting always starts with a checkpoint; replay is not required.
6. Use REST event history separately to restore the visible transcript. Merge by sequence/event ID; handle
   410 by showing the history boundary. A checkpoint replaces vehicle state but cannot recreate lost transcripts.

`ping` takes protocolVersion and requestId; the reply is `pong` with those fields and `wallTime`. Pong has no
session sequence and is not a domain event. `SocketMessageSchema` validates the domain-event/pong union.
Unknown event discriminants or protocol versions require resynchronization and a compatibility error, not
blind application. Invalid client frames generate `simulation.error`; close 1008 for repeated malformed frames,
1009 for oversized frames, 1001 on shutdown, and 1013 for a slow consumer. A lost session requires REST recreation.
No selective event filtering in v1: all domain event sequences are shared across subscribers.

Default target cadence is a full snapshot every 200 wall-clock ms while running, metrics every 1,000 simulated
ms, plus immediate control/signal/agent events. Effective intervals come from config. Paused sessions emit only
changes and checkpoint replies. Physics remains fixed at 100 ms; snapshot emission is independent of rendering.

## Proposals, arbitration and safety metadata

Proposals contain session/generation, observed stateVersion, created/expiry simulation times and a wall-clock
deadline, correlation and proposal IDs, requested green phase/duration, urgency, compact observations and rationale.
Agents may agree on a phase; identity does not restrict requestedPhase. Proposal syntax validity is not authorization.
The runtime must reject obsolete generations, future versions, expired proposals and requests outside current
safety eligibility. The observed proposal version is not expected to equal every subsequent physics tick; the
executor must re-evaluate the proposal against the current snapshot and use an atomic expected-current-version
commit. The exact allowable proposal-age policy is an implementation setting to expose before live integration.

`ArbitrationRecord` retains both proposals, eligible choices, queues, waits, emergency ETA, fairness history,
current phase, minimum/maximum remaining green and deadlines. Options are only `GRANT_A`, `GRANT_B`, `DEFER`;
the eligible subset determines the complete returned probability distribution. No unsafe option is offered.
Completed `ArbitrationResult` is a normalized application **Choice** result, not a claimed raw SDK response.
It requires actual probability distribution and confidence, nullable model/version metadata, latency and provenance.
We do not derive confidence by taking the highest probability. Score and Noul are not used by this wire contract;
a future adapter must not pretend a Noul probability is a Choice confidence. The real SDK mapping is deferred
until its official API is inspected in the integration milestone.

The returned policy records the actual thresholds: high ≥ .85; medium ≥ .60 and < .85; low < .60 by default.
These are provisional settings, not calibration guarantees. High still requires safety validation; medium adds
deterministic checks or defers before the deadline; low invokes safe fallback. A timeout/failure may have no
provider result. A stale returned result may be retained for observability with `status: "stale"`, never applied.
Fallback reason remains independent of model provenance; a deterministic decision is labeled deterministic.

Accepted `decision.outcome` means an authorized transition **schedule** was committed once. It does not mean
the requested group is already green. `scheduledAfterSimMs` is an earliest bound; actual phase changes arrive
via `signal.phase_changed`. Duplicate command IDs are idempotent. Before acceptance, validate generation,
freshness, current version, current phase, minimum/maximum green, clearance and eligibility. Keep independent
inference running while arbitration is pending; serialize physical command commitment only.

While waiting on a model, maintain the current authorized phase, respect maximum green, and use deterministic
fallback when a wall deadline expires. Simulation speed never changes wall-clock model latency. Single live
sessions allow 0.1–20×, but 1× is recommended; accelerated live behavior may miss decisions and is not evidence
of real-time model feasibility.

## Metrics and paired comparisons

- Requested = physically spawned + upstream backlog; spawned = completed + active. Counts include initial
  queues and injected vehicles. No demand is silently dropped.
- `waitingVehicleCount` is the on-road queue (speed < .5 m/s before the stop line), excluding upstream demand.
  `queueByApproach` sums to it. `maximumQueueLength` is the historical maximum of that total in this generation.
- Completed waiting average includes upstream waiting plus on-road stopped time for completed trips.
  Completed travel average measures demand request → rear-boundary exit, including upstream time. Both are
  null until a trip completes. Averages must be labeled as completed-trip metrics on the frontend.
- `activeWaitingTimeMs` includes accrued upstream and on-road waiting for active trips; `upstreamWaitingTimeMs`
  is accrued waiting for requests not yet spawned. `totalObservedWaitingTimeMs` includes these plus all completed
  waits. Thus incomplete demand is visible even when completed averages look favorable.
- Throughput = completed × 3,600,000 / elapsed simulation ms, zero at time zero. Completion count is also
  provided so this early-run rate is not mistaken for a stable capacity estimate.
- Emergency delay uses the signal-delay definition above. `averageCompletedEmergencySignalDelayMs` is null
  without completed responding emergencies; active emergency delay is reported separately.
- `signalChangeCount` counts every physical phase transition, including yellow/all-red. Reset restarts it.
  Gemini requests count started inferences. JEV decisions count successfully parsed responses, including
  stale or low-confidence outputs; confidence bins sum to that count. Timeouts do not fabricate decisions.
  Latency aggregates count completed attempts with measured wall elapsed time, including failed attempts.
  Deadline misses and safety rejections are separate counters. `jev.arbitration` history provides distributions.

Comparisons create two isolated child sessions with identical seed, preloaded queue, full demand/special-event
schedule, physics, geometry, duration and safety timings. Creation starts both; POST returns 202. Scenario-specific
AI decision/fault triggers have no traffic effect on the traditional side. AI-only demo scenario IDs are allowed
as comparison templates; the baseline consumes their physical demand while ignoring AI coordination events.
The schedule ID and SHA-256 hash identify the shared immutable demand input; the hash serialization format must
be specified with the demand engine, not improvised by clients. Child sessions are read-only through control
and injection routes (409); changing their demand independently would invalidate the experiment.

`execution: "realtime"` requires 1×; either server demo mode may be used and is always reported.
`accelerated_mock` requires mock server mode and may run up to 20×. A live server rejects accelerated_mock
with 422. Duration overrides the catalog duration unless complete parameters were supplied, in which case
their duration must match. Reject scheduled events outside the resulting duration. Completion means both
sessions reached that duration; metrics still count outstanding vehicles/backlog. No winning controller or
improvement percentage is hardcoded. `limitations` communicates actual experiment caveats.

## Errors

Every REST failure uses `ErrorEnvelopeSchema`, including requestId, code, message, retryable and field issues.
For GET or unparsable bodies, the server generates a request ID; a valid supplied POST ID is echoed.

| HTTP | Codes |
| --- | --- |
| 400 | VALIDATION_ERROR (malformed JSON/query), UNSUPPORTED_PROTOCOL |
| 404 | NOT_FOUND |
| 409 | INVALID_STATE, STALE_GENERATION, IDEMPOTENCY_CONFLICT |
| 410 | EVENT_HISTORY_EXPIRED |
| 413 | PAYLOAD_TOO_LARGE |
| 422 | VALIDATION_ERROR (well-formed but invalid body/semantic constraints) |
| 429 | RATE_LIMITED, CAPACITY_EXCEEDED |
| 500 | INTERNAL_ERROR |
| 503 | PROVIDER_UNAVAILABLE (only when an operation cannot continue safely) |

Ordinary missing Gemini/JEV credentials do not prevent session creation: provider status, fallback and trace
events report the condition. Error messages must exclude secrets and internal stack traces.

## Validated examples

- [Complete snapshot](examples/simulation-snapshot.json)
- [Every domain event variant, including pending/completed inference and arbitration](examples/server-events.json)
- [REST and socket request examples](examples/requests.json)
- [Success responses for all eleven REST operations](examples/responses.json)
- [Error envelope](examples/error.json)

These are hand-authored contract fixtures, not captured simulator outputs or benchmark evidence. The comparison
hash is an explicitly labeled placeholder. Tests parse every example using the same schemas exported to clients.
