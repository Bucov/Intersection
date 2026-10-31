# Intersection web app

For installation, running the project and a tour of its features, start with the [main README](../../README.md).

The frontend uses React, TypeScript, Vite and Three.js through React Three Fiber. It supports an independent browser-only demo and a REST/WebSocket connection to the simulation backend.

- `src/routes`: pages.
- `src/components`: the scene, panels, controls and charts.
- `src/state`: application stores, settings, session state and replay history.
- `src/transport`: browser demo and backend adapters.
- `e2e`: browser tests.

Run these commands from the repository root:

```sh
npm run dev:web
npm run typecheck -w @intersection/web
npm run test -w @intersection/web
npm run test:e2e -w @intersection/web
```

See the [API contract](../../docs/API_CONTRACT.md) and [testing guide](../../docs/TESTING.md) for technical details. Interface colours, typography and scene materials use the tokens in `src/index.css`.
