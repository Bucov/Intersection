# Backend implementation record

## Gate 0 (2026-10-30)

Inspected clean `feature/backend` at `94f6d79`, all three worktrees, remotes and history.
`main` at `65be71f` is a descendant, so synchronization is a fast-forward. No AGENTS.md
applies. Implementation is staged in an isolated temporary clone because the backend
worktree is outside the session's writable roots; final transfer must be a fast-forward.

Existing backend: only Fastify starter routes in apps/server/src/index.ts. Shared v1
schemas, defaults and examples exist under packages/shared and docs/examples; their
tests cover serialization, not operational safety. Main contains the complete frontend
and its browser mock engine and live REST/WS transport. No prior backend plan was found.

Read API_CONTRACT.md, FRONTEND_HANDOFF.md, FRONTEND_INTEGRATION.md, README, manifests,
root lockfile, schemas, shared tests, mock engine/tests, live transport and reducer flows.
Root uses npm workspaces, lockfile v3. Environment: Node 26.12.1, npm 12.2.1.

Adapter remote branch verified through GitHub and a fresh checkout at
3f4cf7bb4b36768206832d9b500d3630c43dbfbf. Package is mozaik-jev-adapter 0.1.0,
requires Node >=22 and exact core peer 4.1.0. Read provider, bridge, schemas, concurrent
example, tests, README and handoff. Local teammate checkout predates this implementation.

Contract mismatches: physics stateVersion cannot be bridge decision revision; existing
Gemini-only provider fields cannot describe independent Claude configuration; nullable
confidence and separate abstention mass need preserving; mock yellow dilemma-zone entry
is weaker than backend safety requirements. Existing design and browser offline transport
are preserved. Server physics is adapted from the existing engine with attribution in source.

Order: deterministic engine/FSM; sessions/REST/WS; packaged adapter/mock bridge; concurrent
Mozaik runners; live JEV/freshness; paired comparison, browser acceptance and runbook.

## Simulation decisions

100 ms logical step. Demand, traits and hazards use independent named sfc32 streams;
controller execution and blocked spawn do not consume their random draws. Identical seed
and resolved scenario reproduce requests and traits. One straight lane per approach,
shared meter coordinates; no lane changing, pedestrians or turns. IDM acceleration is
simplified; discrete nonpenetration and stop-line clamps are authoritative and can require
instantaneous braking. Acceleration telemetry is clamped to the contract range. Yellow
and red prohibit new stop-line entry; vehicles already beyond the line clear normally.
All-red remains held for vehicle footprint occupancy. Minimum bumper gap is 2 m.

Only requestGreen can commit an AI signal plan; it rejects invalid durations, duplicate
commands, clearance-phase requests and conflicting pending plans. The FSM applies min/max
green, yellow, all-red and occupancy. Without a plan AI uses fixed duration fallback.
Physics never waits on inference. Controller hooks only mark work for the outer scheduler.
