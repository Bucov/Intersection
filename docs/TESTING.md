# Milestone 0 validation

Run from the monorepo root:

```sh
npm run build -w @intersection/shared
npm run typecheck -w @intersection/shared
npm run test -w @intersection/shared
npm run typecheck -w @intersection/server
```

`npm test` also discovers the shared contract suite. Shared typechecking includes source and tests, including
compile-time assertions that exported request and response types match the schemas. The server check verifies
that preserving the starter exports keeps the existing server compilable.

The suite validates every published JSON fixture, all REST success schemas, all domain event discriminants,
all nine scenario defaults, request defaults, bounds and rejection of unknown request fields. Negative cases
cover invalid routes/vehicle states, conflicting signal representation, invalid timing, impossible demand
counts, empty-sample metric semantics, inconsistent snapshot metadata, proposal expiration shape, arbitration
choice distributions, confidence boundaries, provider failures, comparison isolation metadata and reconnect
history ordering. Event examples include overlapping mock intervals to exercise the timeline data shape.

This milestone does **not** test physical collision avoidance, Poisson sampling, runtime determinism, Fastify
routes, actual socket reconnection, model concurrency, Mozaik delivery, TypeSafe parsing or safety-gate behavior.
Those implementations do not exist yet. Schema validation cannot replace their future unit/integration tests.

No credentials, downloads or external API calls are required for the contract tests once dependencies are
installed. Compiled output is ignored by Git. The only new dependency is the shared package's explicit Zod
runtime dependency; Vitest and Node types use the existing workspace tooling.

Milestone verification: 62 tests pass through both the workspace test script and root `npm test`; shared
build/typechecks, server typecheck, and targeted Oxlint checks pass. The existing root `npm run typecheck`
cannot finish because `@intersection/web` has no `typecheck` script. This predates the contract change;
frontend scripts were left untouched under file ownership rules. Use the scoped checks above for this milestone.
