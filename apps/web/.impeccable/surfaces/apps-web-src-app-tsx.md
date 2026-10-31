---
version: 1
slug: "apps-web-src-app-tsx"
primary_target: "apps/web/src/App.tsx"
related_targets: ["apps/web/src/routes/HomePage.tsx","apps/web/src/routes/SimulationPage.tsx"]
---

# Surface brief: Intersection app shell (Home → Simulation)

Scope: the persistent app shell, the intro, Home (visitor mode: Persuade, the visitor picks a controller) and the Simulation view entered from it (visitor mode: Operate, the visitor runs, pauses, rewinds and reads the simulation). Settings (Operate) and About (Read) inherit this world with minimal content.

Audience and job: hackathon judges, presenter-driven, on a projected screen or a laptop. Job: understand both controllers, start one, watch decisions happen, rewind to any moment, compare honestly.
Constraints: offline demo always works; provenance always visible; null shown as unavailable; scene stays dominant; all styling via tokens; rewind is a replay of recorded snapshots and never claims to rewind the authoritative simulation.
Memorable moment: one car drives up out of the black, through "by MAGI", chasing the wordmark into the header; as it clears the junction the mask wears off and the whole intersection comes alive around it.

## Direction contract

THESIS: One intersection, two sides. The live 3D junction is the page; the two controllers stand on either side of it like the two camps of a data essay, each drawn as a column of coloured squares that encodes its real mechanism. Refuses hero-over-feature-cards and the KPI-tile dashboard.

OWN-WORLD: Warm charcoal room (hue ~75, near-zero chroma), warm off-white type, no containers: text sits on the ground. One wide, tight grotesk (Onest) for everything, lowercase in navigation and the wordmark, tabular figures for readouts. Colour lives only in small crisp squares (no radius, 2px gaps) that each mean one thing: signal state, Agent A cyan, Agent B violet, JEV warm white, safety steel, emergency rose. Pills, dots and rounded boxes are gone; corners are square.

STORY: See a single car arrive and the junction appear around it; meet the two sides; run one; watch agents, JEV and the safety gate as squares on a signal-timing grid; pause and drag back to replay any moment.

FIRST VIEWPORT: Header: four lowercase links spread across the top, "intersection" small at the exact centre as the home button. Centre: the diorama. Left: "traditional" text right-aligned against its column of cycle squares; right: "ai" text left-aligned beside its pipeline squares; each block is the run button. Simulation: scene full-bleed, rail right, square-grid timeline and session strip docked bottom.

FORM: user-pinned (header reference: dark grotesk portfolio; squares reference: the7eye "Both Sides"); roll not run because the user pinned the direction. Signature move: the concurrency timeline as a unit grid of squares with a scrubbable session strip. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Viewing setup is inferred (projector plus laptop), not confirmed.
