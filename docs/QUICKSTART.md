# Quickstart: run Intersection live

This is the short version. For the full reference see `LIVE_DEMO_GUIDE.md`.

## How it fits together

```
browser (apps/web, Vite :5173)
   │  /api + /ws  (proxied by Vite)
   ▼
server (apps/server, Fastify :3001)  ── reads apps/server/.env
   ├─ traffic simulation + signal safety state machine (only thing that changes lights)
   ├─ Agent A ┐  two Mozaik agent loops, each calls Gemini or Claude
   ├─ Agent B ┘  and proposes "NS_GREEN / EW_GREEN for N seconds"
   ├─ JEV (TypeSafe) — picks a winner only when the two agents disagree
   └─ Mozaik cloud (optional) — dashboard that shows every agent loop live
```

Which keys do you need?

| Key | Needed for | Required? |
| --- | --- | --- |
| `GEMINI_API_KEY` | any agent with `AGENT_*_PROVIDER=gemini` | only if you use Gemini |
| `ANTHROPIC_API_KEY` | any agent with `AGENT_*_PROVIDER=claude` | only if you use Claude |
| `TYPESAFE_API_KEY` | `JEV_MODE=live` (real arbitration) | only for live JEV |
| Mozaik cloud key | watching agents on app.jigjoy.ai | **no** — optional, see step 5 |

The models themselves run through your Gemini/Claude keys. Mozaik is the agent framework inside the server; its cloud is only a viewer, so the app runs live without it.

## 1. Install and build (once)

```sh
npm ci
npm run build
npm run models -w @intersection/server   # lists the model IDs you may use
```

Node 22 or newer.

## 2. Configure `apps/server/.env`

```sh
cp apps/server/.env.example apps/server/.env   # only if you don't have one yet
```

A working live setup:

```dotenv
DEMO_MODE=live
JEV_MODE=live

AGENT_A_PROVIDER=gemini
AGENT_A_MODEL=gemini-3.5-flash-lite
AGENT_B_PROVIDER=claude
AGENT_B_MODEL=claude-haiku-4-5

GEMINI_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
TYPESAFE_API_KEY=...
TYPESAFE_DEFAULT_MODEL=

# optional, see step 5
MOZAIK_CLOUD=on
```

- Model IDs must be copied exactly from `npm run models`.
- Both agents can use the same provider (e.g. both Gemini), then you need only that key.
- `DEMO_MODE=mock` / `JEV_MODE=mock` run without any keys (fake answers), useful for UI work.
- On a free Gemini tier, two agents on one key can hit rate limits (`rate_limit` in the UI). Use a paid key or put one agent on Claude.

## 3. Check the keys really work

```sh
env RUN_LIVE_SMOKE=1 npm run test:live -w @intersection/server
```

This makes real calls (about 35 seconds) and prints a JSON summary. A healthy result has
`"conflict": true, "liveJev": true, "overlap": true` and both intervals `"outcome": "completed"`.
If it fails, check the server log lines above the summary: `401` = wrong key, `429` = rate limit/quota.

## 4. Run it

Terminal 1:

```sh
npm run dev:server
```

The startup log tells you what is active: `Agent X unavailable: ...` and `JEV unavailable: ...` mean a config problem; the last line reports Mozaik cloud status.

Terminal 2:

```sh
npm run dev:web
```

Open http://localhost:5173, go to **Settings → Data source → Backend only**, then start an **AI** simulation. (In *Automatic* the browser silently falls back to its own offline demo if the server is unreachable, so *Backend only* is the safe choice for a live demo.)

Quick check from a terminal: `curl http://127.0.0.1:3001/api/health` — both providers should say `"mode":"live","status":"ready"`.

## 5. Optional: watch the agents in Mozaik cloud

Mozaik core 4.x can stream every agent loop (inference start, model answer, …) to https://app.jigjoy.ai. It is off by default because it uploads the full prompts and answers.

1. Pair this machine once, from the repository root:

   ```sh
   npx @mozaik-ai/cloud-sdk pair
   ```

   It prints an approve link. Open it while signed in to app.jigjoy.ai and click **Approve device**. The key is saved to `~/.mozaik/credentials.json`; you don't paste it anywhere.

   *Alternative:* copy the project key from the dashboard into `apps/server/.env` as `MOZAIK_API_KEY=pk_...`.

2. Turn streaming on in `apps/server/.env`:

   ```dotenv
   MOZAIK_CLOUD=on
   ```

3. Restart the server. The log should say `Mozaik cloud: streaming agent loops to https://app.jigjoy.ai`. Start an AI session; each agent loop appears on the dashboard as its own session (two per decision cycle).

Optional: `MOZAIK_REDACTION=content` sends only event shapes and sizes, without prompt and answer text.

If the log says `MOZAIK_CLOUD=on but no key found`, pairing didn't complete. Run `pair` again or set `MOZAIK_API_KEY`.

## Troubleshooting

| You see | Meaning / fix |
| --- | --- |
| Agent card shows `invalid_response` | The model returned something that isn't a valid proposal. Fixed for Gemini's code-fenced JSON; if it persists, try another model. |
| `provider_error` on a Claude agent | Usually a wrong `ANTHROPIC_API_KEY` (smoke test shows `401 invalid x-api-key`). Anthropic keys start with `sk-ant-`. |
| `rate_limit` | Provider quota. Slow down (normal speed), use a paid key, or split providers. |
| `low_confidence` after a conflict | JEV saw the conflict but wasn't confident; the deterministic fallback decided. This is normal behaviour. |
| Lights change but agents look idle | The deterministic controller keeps running when AI fails. Check the agent cards, not the cars. |
| `.env` edits do nothing | Restart the server. The file must be `apps/server/.env`. Exported shell variables override it. |
