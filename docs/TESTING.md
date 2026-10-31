# Testing Intersection

Install Node.js 22 or newer and run `npm ci` from the repository root first. All commands below run from that same folder.

## Standard checks

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

The test suites cover shared schemas and fixtures, deterministic traffic, signal safety, session APIs, AI coordination with mocks, transports, state reducers and interface components. Standard tests do not require provider keys or make live model calls.

## Browser tests

Install the test browser once:

```sh
npm exec -- playwright install chromium
```

Run the browser-only demo checks:

```sh
npm run test:e2e -w @intersection/web
```

Run the backend integration checks:

```sh
npm run test:e2e:backend
```

Playwright configurations start their required local servers. Linux environments may need browser system dependencies; Playwright reports missing libraries when launching Chromium.

## Optional live-provider check

Configure `apps/server/.env` as described in the [README](../README.md#optional-connect-real-ai-models). The smoke test exercises the selected live providers and JEV and consumes their API quotas. Without explicit opt-in it skips.

macOS/Linux terminal:

```sh
RUN_LIVE_SMOKE=1 npm run test:live -w @intersection/server
```

Windows Command Prompt:

```bat
set RUN_LIVE_SMOKE=1
npm run test:live -w @intersection/server
set RUN_LIVE_SMOKE=
```

The output reports whether a conflict, live arbitration and overlapping completed agent requests were observed. Passing mock tests does not establish provider availability or live-model quality.

## Reproducibility and benchmarks

Use Settings to save a seed and configuration, or restore the last run. The same seed requires the same scenario, parameters, engine/version and data source to reproduce generated traffic. Live decisions and wall-clock timing can vary.

The [traffic methodology](TRAFFIC_CONTROL_TUNING.md) explains the benchmark command, measured inputs and limitations. [Decision Stats](DECISION_STATS.md) defines the decision counters and their denominators.
