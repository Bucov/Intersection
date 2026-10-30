# Intersection web app

The user-facing side of Intersection: a cinematic intro, a live 3D intersection preview, and a simulation view that
compares a fixed-time signal with two concurrent AI agents and JEV arbitration. It runs fully offline; with a v1
backend available it switches to live data automatically.

```sh
npm run dev -w @intersection/web         # http://localhost:5173 (builds @intersection/shared first)
npm run typecheck -w @intersection/web
npm run test -w @intersection/web        # Vitest: engine, reducer, transports, components
npm run test:e2e -w @intersection/web    # Playwright, no backend needed
```

- Integration with the backend: [docs/FRONTEND_INTEGRATION.md](../../docs/FRONTEND_INTEGRATION.md)
- Product context: [PRODUCT.md](PRODUCT.md)
- Restyling: colours, faces and the 3D materials are tokens in [src/index.css](src/index.css).

Code map: `src/routes` (pages), `src/components` (scene, panels, controls), `src/state` (stores and the session
reducer), `src/transport` (offline demo and backend adapters), `e2e` (Playwright).
