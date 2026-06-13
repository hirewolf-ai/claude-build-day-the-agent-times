# CLAUDE.md

The Agent Times — a newspaper written by agents. Full architecture in `docs/`.
Only the things that are easy to get wrong live here.

## Don't get these wrong

- **Collection is a REAL browser via the Chrome extension — never headless.**
  `apps/chrome/server` is a broker that streams Playwright-style scripts to
  `apps/chrome/extension`, which runs them in real Chrome. The server never drives
  a browser itself. Don't "just use headless Playwright on the server" — it defeats
  the design.
- **Warehouse-first.** Collection agents fill Postgres; printing agents write only
  from persisted data, never a live scrape. Editions are reproducible.
- **Personas are fixed, data is dynamic.** The columnists are stable characters —
  that's the product hook. Don't regenerate voices per edition.
- **The agents run IN Next.js, not a separate service.** We use the **Claude Agent
  SDK** (`@anthropic-ai/claude-agent-sdk`) — it runs the agent loop in-process. The
  collection agent is a `query()` call in `apps/web/src/agents/` driven from
  `/api/collect`. (The old Python FastAPI plan is dropped — don't re-add it.)
- **The collection agent may ONLY run `chrome-cli`.** `canUseTool` denies every
  Bash command that isn't chrome-cli. It runs with `cwd: apps/chrome` so
  `./cli/chrome-cli` and bare `chrome-cli` both resolve. `Agent` tool = the per-beat
  subagent swarm.
- **All our ports live in the 3010+ range** (other apps on this machine hold lower
  ports — never use them): web **3010**, chrome/server **3011**. Infra is non-default
  too: pg **5433**, redis **6380** (another project holds 5432/6379/3000/3001).
  Don't reset any of these to defaults.
- `apps/chrome/extension` is **pure vanilla JS, MV3** — no build framework.

## How we work

Hack day — speed over polish. Build one app at a time, wire end-to-end before
deepening. Don't over-scaffold; don't over-document.
