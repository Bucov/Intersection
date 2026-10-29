# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** judges of the Jigjoy October 2026 hackathon, evaluating the project during a live demonstration. Many are not traffic engineers or AI specialists.
- **Secondary:** team MAGI (freshmen at the University of Novi Sad, Faculty of Technical Sciences), who present the demo and keep developing it.
- **Viewing setup (inferred, not confirmed):** a team member drives the demo on a shared or projected screen; judges may also click through it on a laptop. The interface must read at a distance and still work at laptop density.

## Product Purpose

Intersection is a real-time traffic-simulation website. It runs the same four-way intersection under two controllers and lets visitors compare them:

- **Traditional:** a fixed-time signal schedule that never adapts to queues.
- **AI:** two concurrent Gemini agents (Agent A watches North/South, Agent B watches East/West) each propose a signal plan; JEV, a TypeSafe decision model, arbitrates when they conflict; a deterministic safety gate validates every transition before the signal changes.

Success: within a minute a judge can see cars obeying the signals, understand what each controller is doing, follow what the agents observed and proposed and how JEV decided, and compare the controllers' outcomes honestly.

## Positioning

Parallel AI reasoning for signal control. Two independent agents reason at the same time (Mozaik concurrency), JEV arbitrates with calibrated probabilities, and a deterministic safety layer has the final word. The interface makes that concurrency and arbitration observable instead of asserting it.

## Operating Context

- Live, presenter-driven hackathon demo. Must run completely offline: no backend, no credentials, clearly labeled as an offline demo.
- Later connects to the team's Fastify REST + WebSocket backend. The v1 contract lives in `packages/shared` and `docs/API_CONTRACT.md`. The backend is built in parallel by another agent.
- Scenarios: Normal Traffic, Rush Hour, Reverse Rush, Sudden Surge, Ambulance Priority, Competing Priorities, Simultaneous Proposals, JEV Uncertainty, JEV Failure.

## Capabilities and Constraints

- Routes: Home (default: intro, live 3D preview, controller choice), the simulation view entered from Home, Settings (placeholder), About (placeholder).
- The 3D scene renders the backend's world coordinates as given: X east, north is −Z, Y up, meters; vehicle heading rotates around +Y.
- The frontend never modifies the authoritative simulation, the backend, or the shared contract.
- Stack (existing): React 19, TypeScript 7, Vite 8, Tailwind CSS 4, shadcn/ui on Base UI, Motion, Recharts, Lucide. Three.js through React Three Fiber renders the scene.
- Undecided: the final visual language (palette, typography, 3D style, references) will be supplied by the team later. Everything is styled through tokens so it can be restyled.

## Brand Commitments

- Name **Intersection**; attribution **by MAGI**.
- Opening sequence: black screen, "Intersection" reveal, "by MAGI" beneath, then the title travels to the top-middle header as the site appears.
- Direction for now, in the user's words: "something simple that is easy to make, easy to understand and presents everything it needs to present."

## Evidence on Hand

- Contract fixtures in `docs/examples/` are hand-authored illustrations, not simulator output or benchmarks.
- No team member names, logos, sponsors, measured results, or AI-versus-traditional improvements exist yet. None may be invented.
- Offline-demo agent, JEV and latency values are produced by deterministic mock adapters and must always be labeled as such.

## Product Principles

1. **Honesty over spectacle.** Provenance (mock, live, deterministic) is always visible. Null stays "unavailable", never zero. No result is claimed that was not measured.
2. **The intersection is the interface.** The 3D scene is the focal point; every panel explains something happening in it.
3. **Understandable in one look.** A nontechnical judge follows observe → propose → arbitrate → validate → signal without a walkthrough.
4. **Always demo-able.** The offline demo works with no network, no backend and no keys.
5. **Simple to build, simple to restyle.** Familiar components, tokens for every visual decision.

## Accessibility & Inclusion

Keyboard-accessible controls with visible focus, readable contrast at projector distance, reduced-motion support, and graceful behavior when WebGL is unavailable.
