# Traffic randomness and controller tuning

New simulation visits choose a browser-generated random 32-bit seed unless a fixed seed is saved in Settings or supplied through `?seed=42`. A scenario change uses the saved seed, or generates a fresh one when no seed is saved. Reset and a completed run's Run again replay the existing run with its seed and configuration. Comparisons also use the saved seed when present; otherwise they draw a fresh one. Both comparison sides receive the same demand and vehicle traits. Scheduled demonstration inputs (initial queues, ambulance placement, surges) still follow the selected scenario.

## Repeat a run from Settings

In **Settings → Simulation & debugging**, enter the seed shown in the simulation controls, select the original scenario, and keep its parameters and data source the same. **Use last run** loads the last simulation's seed, scenario, traffic inputs and signal timing together. Choose **Save settings** to use these defaults on future visits, or **Save & run AI / fixed-time** to start immediately. Seed `0` is valid; a blank seed generates new traffic. **Use random seeds** returns to that behavior.

The expandable groups expose arrival rates, initial queues, initial green, signal timings, vehicle mix, police responding probability, and random surge/congestion settings. Traffic changes are stored per scenario; signal timings apply to all new runs. Scenario-scheduled events are retained, and a duration that excludes them cannot be saved. Configuration is validated against the shared schemas and stored in `intersection.run-settings.v1` in browser local storage. The existing presentation preferences remain separate.

New simulations and paired comparisons send the saved overrides through the existing session/comparison APIs. The Compare page starts from the configured scenario and custom duration; its duration selector can shorten the horizon while keeping all scheduled events. Existing runs retain their original configuration. Agent models, request timing and JEV thresholds remain server-owned; Settings displays the reported confidence policy without offering unsupported controls.

Seeds reproduce generated inputs on the same engine/data source and version, not live inference results. Model decisions, wall-clock latency and manually injected events can differ. For an exact view of a past live run, use its recorded timeline instead of expecting a seed to replay the models.

Vehicle arrivals use separate seeded streams for demand and traits, independent of controller decisions.

## Backend control policy

- Approaching-vehicle counts and arrival rates reach the proposal agents and JEV, along with committed green end time and a numerical reference service plan.
- Agents share a total-delay objective. Their assigned direction is a focus for observation, not an instruction to always request that direction. Instructions explain clearance losses, future arrivals, service-duration semantics, and how to justify a departure from the reference plan.
- `apps/server/src/ai/trafficPolicy.ts` contains the numerical reference and prompt. The reference divides an approximately 60-second cycle, minus yellow/all-red losses, by current demand rates. It uses observed vehicles to avoid serving an empty approach, prioritises responding emergencies, and considers opposing waits of at least 45 seconds.
- Backup policy is identified as `demand-batches-v2`. It uses that plan instead of repeatedly requesting minimum green based only on the oldest wait.
- The coordinator usually waits until six seconds before a committed green ends before planning again. Pending switches are not overwritten. New ordinary requests respect the committed service end. Responding emergencies can request an earlier transition, still subject to minimum green, yellow/all-red and occupancy checks. Same-direction requests cannot shorten an already committed green.
- JEV confidence at or above the existing high threshold (0.85 by default) follows the existing path. Medium confidence, from 0.6, is eligible only if the selected direction matches the current numerical reference and duration is within five seconds. Otherwise it is deferred. Low/missing confidence, abstention, failures and stale results still fall back. This lowers the effective confidence requirement for corroborated plans without treating every ambiguous selection as usable.

The browser-only synthetic AI controller retains its existing decision policy; fresh traffic seeds apply to both data sources. Backend mock-agent fixtures remain fixtures for testing arbitration rather than being silently replaced with an optimised controller.

## Measurements

Run from the repository root:

```sh
npm run build -w @intersection/shared
npm run benchmark:control -w @intersection/server
npm run benchmark:control -w @intersection/server -- --holdout
```

This benchmark runs the actual backend's missing-provider fallback against fixed-time for five simulation minutes. It calls no model and uses no provider credentials. It measures the revised backup policy and engine scheduling; it does **not** establish live-agent performance or a live fallback frequency. Live comparisons require separate model calls and remain variable.

Initial seeds: 1, 17, 42, 103, 991. Additional seeds checked after implementation: 7, 29, 257, 2026, 8191. Each scenario uses its existing demand and safety defaults. Fixed-time timings and traffic inputs were not changed. Full per-seed measurements, including unfinished waiting and emergency delay, are in [benchmarks/traffic-control.csv](benchmarks/traffic-control.csv).

Means over the five additional seeds:

| Scenario | Fixed completed trips | Revised backup completed trips | Fixed completed-trip wait | Revised backup completed-trip wait |
| --- | ---: | ---: | ---: | ---: |
| Normal | 60.8 | 61.4 | 10.01 s | 8.46 s |
| Rush hour | 93.8 | 102.6 | 12.76 s | 6.54 s |
| Reverse rush | 102.2 | 105.2 | 12.35 s | 6.67 s |
| Sudden surge | 78.6 | 85.2 | 18.48 s | 11.15 s |
| Ambulance priority | 61.6 | 59.6 | 9.06 s | 7.80 s |

The ambulance scenario has fewer completed trips in this finite horizon; responding-emergency signal delay falls from 22.5 s to 0.5 s. The controller does not dominate every metric on every run. Queue, unfinished-wait and throughput measurements should be considered together. Lower fallback frequency is not itself evidence of better traffic flow.
