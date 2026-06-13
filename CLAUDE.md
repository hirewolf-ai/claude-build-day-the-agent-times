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
- **All our ports live in the 3010+ range** (other apps on this machine hold lower
  ports — never use them): web **3010**, chrome/server **3011**, agents **3012**.
  Infra is non-default too: pg **5433**, redis **6380** (another project holds
  5432/6379/3000/3001). Don't reset any of these to defaults.
- `apps/chrome/extension` is **pure vanilla JS, MV3** — no build framework.
- `apps/the-agent-times-agents` is **Python (uv + FastAPI + Agent SDK)** in an
  otherwise-JS monorepo. Deliberate.

## How we work

Hack day — speed over polish. Build one app at a time, wire end-to-end before
deepening. Don't over-scaffold; don't over-document.
