# Traffic context, recovery actions, and comparison viewing

Both Mozaik agents already launch concurrently. They now receive the complete active vehicle list (positions, movement state, speed, waits, emergency flags and stop-line ETA), upstream backlog by approach, group demand, signal limits and committed service timing. This is structured simulation state, not camera image recognition and not knowledge of future arrivals.

JEV receives a fresh snapshot at arbitration time and available agent plans. Agent unavailability, invalid output, timeouts and rate limits now start bounded JEV recovery rather than immediately skipping to deterministic control. Late model answers cannot replace a recovery decision. JEV has a separate three-second recovery window; physics continues throughout.

The existing generic adapter supports variable candidate lists, so its API does not need a vendor fork. The coordinator supplies:

- Schedule North/South service after required clearance.
- Schedule East/West service after required clearance.
- Keep the existing schedule without issuing a signal command.
- Extend the existing green by at most five seconds, only when its timing limits permit this action.

The FSM still validates every service request, including minimum/maximum green, clearance, occupancy, stale observations, session generation and duplicate commands. A failed, abstaining, stale or unsuitable JEV response still has a deterministic backup. A lower-confidence choice can execute only when the independent numerical reference agrees on phase and approximately on duration; confidence alone is not evidence that a valid action is inappropriate.

`controllerActions` and `recoveryReason` are additive arbitration fields. The old two proposal slots remain for wire compatibility. If an agent has no proposal, that slot explicitly identifies a synthetic controller recovery candidate, never an agent-generated statement. These compatibility slots are not the choices sent to JEV. The UI reads the actual action list and selected candidate ID.

## Viewing comparisons

Use **Compare** in the main navigation or the simulation rail. Backend comparisons continue on the server after navigating elsewhere. The browser remembers the most recent comparison in session storage. **Open live comparison in a new tab** opens a dedicated read-only page with both live intersections, backed by independent snapshot requests; it does not start another simulation or replace the main scene's websocket.

Results lead with total observed waiting, including unfinished trips, alongside completed trips. A lower completed-trip average alone is not treated as a win. Offline comparisons remain in the originating browser and are identified separately. Server restart/session eviction can make an old comparison unavailable.

## Verification and live testing

Unit/contract tests cover concurrent inference, stale responses, clearance, recovery from failed agents, full vehicle context and retaining a schedule exactly. Browser tests cover navigation away and back, a separate comparison view and phone overflow.

`apps/server/scripts/benchmark-live.ts` requires `RUN_LIVE_BENCHMARK=1`, configured Gemini models and provider keys. It sends synthetic traffic using the server's Gemini and TypeSafe credentials. It runs fixed and adaptive controllers on identical seeded demand for 120 wall-paced seconds. `BENCHMARK_SCENARIO=normal-traffic` or `rush-hour` isolates a scenario. It stops before 100 Gemini attempts per invocation; separate invocations must share the user's overall budget manually. Reports are written under `/tmp/intersection-live-benchmark-*.json`.

The initial sandbox attempt failed to reach providers and is not live-model evidence. Network-enabled testing reached TypeSafe, but Gemini repeatedly returned rate limits, including in an isolated scenario. Therefore these measurements characterize JEV recovery and deterministic backup, not healthy two-agent superiority. No universal advantage over fixed timing is claimed. The offline five-scenario/five-seed numerical backup benchmark reduced total waiting in 20 of 25 cases.

### Measured runs (120 seconds each)

| Stage | Scenario / seed | Fixed total wait (vehicle-seconds) | Adaptive total wait | Fixed / adaptive completed trips |
| --- | --- | ---: | ---: | ---: |
| Before confidence refinement | Normal / 2026 | 226.0 | 224.8 | 12 / 16 |
| Before confidence refinement | Rush / 2027 | 312.9 | 276.1 | 26 / 28 |
| Isolated, before confidence refinement | Rush / 2026 | 575.4 | 256.2 | 29 / 34 |
| After confidence refinement | Normal / 2026 | 226.0 | 222.0 | 12 / 16 |

The final normal run accepted five JEV actions and used backup once. Gemini quota errors still prevented a healthy two-agent trial. Different seeds must not be compared as a before/after experiment. These are small samples, and the improved total waiting does not mean every individual wait metric improved.

Conservative request accounting, including blocked sandbox attempts: **62 Gemini inference attempts / 200 authorized; 31 JEV arbitration attempts / 100 authorized**. Network-enabled attempts were 42 and 21 respectively. No further live requests are running. Structured metrics and decision evidence are in [the benchmark report](benchmarks/traffic-control-2026-10-31.json).
