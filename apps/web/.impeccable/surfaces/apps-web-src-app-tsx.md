---
version: 1
slug: "apps-web-src-app-tsx"
primary_target: "apps/web/src/App.tsx"
related_targets: ["apps/web/src/routes/HomePage.tsx","apps/web/src/routes/SimulationPage.tsx"]
---

# Surface brief: Intersection app shell (Home → Simulation)

Scope: the persistent app shell, the intro, Home (visitor mode: Persuade, the visitor picks a controller) and the Simulation view entered from it (visitor mode: Operate, the visitor runs and reads the simulation). Settings (Operate) and About (Read) inherit this world with minimal content.

Audience and job: hackathon judges, presenter-driven, on a projected screen or a laptop. Job: understand both controllers, start one, watch decisions happen, compare honestly.
Constraints: offline demo always works; provenance always visible; null shown as unavailable; scene stays dominant; all styling via tokens (visual language to be supplied by the team later).
Memorable moment: the title lands in the header and the camera flies from the miniature into the operating intersection without a cut.

## Direction contract

THESIS: One intersection, two controllers. The same live 3D intersection is the landing page, the centerpiece of the choice, and the simulation itself; the visitor never leaves it. Refuses the category default: hero headline over feature cards, then a separate dashboard of KPI tiles.

OWN-WORLD: A scale model under a lamp in a dark room. The lit diorama floats in the intro's black; chrome is near-black neutral panels with hairline borders, 8px radii, no glow, no gradients. Colour only ever means something: signal red/amber/green for phases, cyan for Agent A (NS), violet for Agent B (EW), warm white for JEV, steel for safety. Overpass (highway-sign lineage, built for distance) sets everything; Overpass Mono sets clocks, IDs and readouts.

STORY: See a living intersection, learn there are two ways to run it, pick one, fly in. In AI mode watch both agents reason at once, JEV choose, the safety gate approve, then the light change. Leave believing the AI is observable, not magic.

FIRST VIEWPORT: Header: nav left, "Intersection" top-middle, data-source status right. Centre: the diorama, cars stopping and going. Traditional panel left, AI panel right, each one line, three facts, a primary Run button. Simulation: scene full-bleed, decision rail right, signal HUD top-left, playback and signal-timing timeline docked bottom.

FORM: Brief- and user-pinned ("something simple that is easy to make, easy to understand and presents everything it needs to present"). concept-seed was rolled for the record; its assignment is not adopted because a user-pinned direction beats the roll. Signature move: the concurrency timeline drawn as a traffic-engineering signal-timing chart, agent, JEV and safety bars on the signal phases' time axis. seed:232c8ca45e1eb370

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Final palette, typography and 3D style (team will supply; swap tokens in src/theme and src/index.css).
- Viewing setup is inferred (projector plus laptop), not confirmed.
