# Intersection

Intersection is a Jigjoy 2026 October hackathon traffic simulation by students at the University of Novi Sad, Faculty of Technical Sciences. A deterministic signal controller enforces clearance and occupancy rules while two concurrent AI agents can propose signal plans. The browser also supports an independent offline demo.

## Run locally

**New here? Follow [`docs/QUICKSTART.md`](docs/QUICKSTART.md)** — keys, live models, and the optional Mozaik cloud dashboard in one page.

Use Node 22 or newer. The original implementation was verified with Node 22/npm 10; this checkout also builds with Node 24/npm 11. From the repository root (these commands also work in fish):

```sh
npm ci
npm run build
npm run dev:server
```

In a second terminal run `npm run dev:web`. Open the URL printed by Vite and select the backend data source. The server defaults to port 3001. Traditional control and the default mock AI configuration need no credentials. Restart the server to clear retained sessions when capacity is reached.

## AI configuration

See `apps/server/.env.example` for configuration names. Select each agent's provider and supported model explicitly; run `npm run models -w @intersection/server` to list the installed registry. Gemini requires `GEMINI_API_KEY`; Claude requires `ANTHROPIC_API_KEY`. Live JEV requires `TYPESAFE_API_KEY`. Mock execution demonstrates orchestration and adapter behavior, not live model quality. Live Gemini and TypeSafe JEV calls are verified by `npm run test:live` (see the quickstart). Streaming agent loops to the Mozaik cloud dashboard is optional and opt-in via `MOZAIK_CLOUD=on`.

The server uses Mozaik core 4.1.0 and the separate packaged `mozaik-jev-adapter`. The repository-relative archive and its provenance are documented in `vendor/README.md`. No adapter checkout under `/tmp` is needed for installation.

Only the signal state machine changes signals. It enforces minimum/maximum green, yellow, all-red, and intersection occupancy holds. Inference does not block simulation steps. Proposals are checked for freshness before application. Missing, failed or rejected decisions leave deterministic fallback control available.

Paired comparisons use isolated sessions with the same configured seed, scenario and horizon. Mock comparisons wait between physics steps for reproducible decisions; live comparisons are wall-paced and non-repeatable. Results describe this simplified straight-lane simulation and do not establish AI superiority or real-world traffic safety.

## Verification

```sh
npm run build
npm run typecheck
npm run lint
npm test
npm exec -- playwright install chromium
npm run test:e2e:backend
npm run test:e2e -w @intersection/web
npm run test:live -w @intersection/server
```

Live smoke testing is opt-in and skips without the required configuration. See `docs/API_CONTRACT.md`, `docs/BACKEND_IMPLEMENTATION.md`, and `BACKEND_AGENT_HANDOFF.md` for contracts, implementation decisions and outstanding acceptance work. The handoff's `/home/luka` and `/tmp` locations describe the previous machine; this checkout preserves that implementation on `feature/backend`.
