# Traffic randomness and controller tuning

New simulation visits now choose a browser-generated random 32-bit seed instead of always using 42. A scenario change and a completed run's Run again choose fresh seeds too. Every comparison run draws a fresh seed and displays it. Both sides of that comparison still receive exactly the same demand and vehicle traits: comparing different traffic would make the result unfair. Reset intentionally replays the existing run; an explicit `?seed=42` reproduces that simulation. Scheduled demonstration inputs (initial queues, ambulance placement, surges) still follow the selected scenario.

Vehicle arrivals were already stochastic, with separate seeded streams for demand and traits. The fault was repeatedly supplying the same seed, so the physics/random generator has not been replaced or biased in favour of AI.

## Backend changes

- The observation validator previously removed approaching-vehicle counts and arrival rates. Both now reach the proposal agents and JEV, along with committed green end time and a numerical reference service plan.
- Agents share a total-delay objective. Their assigned direction is a focus for observation, not an instruction to always request that direction. Instructions explain clearance losses, future arrivals, service-duration semantics, and how to justify a departure from the reference plan.
- `apps/server/src/ai/trafficPolicy.ts` contains the numerical reference and prompt. The reference divides an approximately 60-second cycle, minus yellow/all-red losses, by current demand rates. It uses observed vehicles to avoid serving an empty approach, prioritises responding emergencies, and considers opposing waits of at least 45 seconds.
- Backup policy is now identified as `demand-batches-v2`. It uses that plan instead of repeatedly requesting minimum green based only on the oldest wait.
- The coordinator usually waits until six seconds before a committed green ends before planning again. Pending switches are not overwritten. New ordinary requests respect the committed service end. Responding emergencies can request an earlier transition, still subject to minimum green, yellow/all-red and occupancy checks. Same-direction requests cannot shorten an already committed green.
- JEV confidence at or above the existing high threshold (0.85 by default) follows the existing path. Medium confidence, from 0.6, is now eligible only if the selected direction matches the current numerical reference and duration is within five seconds. Otherwise it is deferred. Low/missing confidence, abstention, failures and stale results still fall back. This lowers the effective confidence requirement for corroborated plans without treating every ambiguous selection as usable.

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

Live JEV documentation could not be fetched during this change; integration syntax was checked against the installed adapter and shared schemas. Live prompt/confidence tuning is pending explicit approval of the proposed experiment budget.
