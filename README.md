# The Agent Times

**A newspaper written entirely by AI agents.**

You type what you want to read. A swarm of Claude (Opus 4.8) agents **drive a real,
logged-in Chrome browser** to gather the day's news from live sources, file it into a
markdown "warehouse," then a Design Desk agent and columnist agents lay out a *New York
Times*–style front page in HTML — rendered live, section by section, with cinematic
motion. Each columnist is its own agent with a fixed personality and voice. When the
edition is done, the paper stamps the **total agent cost** like an old newspaper price.

> Built in one day for **Claude Build Day** with **Claude Code on Opus 4.8**.

---

## 📺 For judges — start here

- **Demo video:** *(link in the submission form)*
- **Full Claude Code session log:** [`session-log.md`](./session-log.md) — the entire
  build conversation, including the moments where Claude **debugged and verified its own
  work** (see "How we directed Claude" below).
- **How we directed Claude (orchestration write-up):** [`SUBMISSION-orchestration.txt`](./SUBMISSION-orchestration.txt)
- **Video script + shot list:** [`SUBMISSION-video-script.txt`](./SUBMISSION-video-script.txt)
- **The brief / rubric we gave the model:** [`CLAUDE.md`](./CLAUDE.md) +
  [`docs/architecture.md`](./docs/architecture.md), [`docs/agents.md`](./docs/agents.md),
  [`docs/personas.md`](./docs/personas.md)

A finished sample edition cost **$9.94** in Opus 4.8 across both agent phases (7 news
beats collected → 12 sections printed).

---

## How it works

```
reader prompt
   │
   ▼
LEAD RESEARCH AGENT  (Claude Agent SDK, in-process in Next.js)
   │  fans out the `Agent` tool → one SUBAGENT PER BEAT (markets, world, tech, culture…)
   │  each subagent drives REAL Chrome via chrome-cli and writes collected/<beat>.md
   ▼
WAREHOUSE  (.runs/read-<datetime>/collected/*.md — markdown, reproducible)
   │  auto-handoff (collecting → printing), one SSE stream
   ▼
PRINTING / DESIGN DESK AGENT
   │  reads the warehouse, writes sections/*.html
   │  spawns COLUMNIST SUBAGENTS for the opinion columns (distinct voices)
   ▼
LIVE NEWSPAPER  (rendered section-by-section in the browser, PRICE stamp at the end)
```

**Real browser, not a scraper.** Collection runs through a Chrome extension + a local
broker (`chrome-cli` → server on `:3011` → MV3 extension → real Chrome via CDP). That's
the whole hook: the agents browse *your* logged-in web (including your X feed for
personalization). It is **not** headless and is **not** cloud-deployable by design.

### Where Claude + Opus 4.8 live in the code
- Agents: [`apps/web/src/agents/`](./apps/web/src/agents/) — `runCollection.ts`,
  `runPrinting.ts`, `editionRuns.ts` (the `collect → print` chain), and the prompts
  `collectionPrompt.ts` / `printingPrompt.ts`. Every agent runs on `claude-opus-4-8` via
  `@anthropic-ai/claude-agent-sdk`.
- Tool lock: the collection agent may **only** run `chrome-cli` — enforced by the SDK's
  `canUseTool` callback in `runCollection.ts` (denies every non-chrome-cli Bash command
  and all web-fetch tools).
- Live UI: [`apps/web/src/components/PaperCanvas.tsx`](./apps/web/src/components/PaperCanvas.tsx)
  + SSE event stream in [`apps/web/src/app/api/editions/`](./apps/web/src/app/api/editions/).

---

## How we directed Claude (and how it verified itself)

The full story is in [`SUBMISSION-orchestration.txt`](./SUBMISSION-orchestration.txt) and
the [session log](./session-log.md). The short version:

- **Scaffolding:** a tight [`CLAUDE.md`](./CLAUDE.md) encoding only the things easy to get
  wrong (real browser never headless, port ranges, warehouse-first, chrome-cli-only), plus
  `docs/` for depth.
- **Multi-agent pipeline:** lead research agent → per-beat subagent swarm → warehouse →
  printing agent → columnist subagents → live paper, in one auto-handed-off SSE stream.
- **Claude verifying its own work:** subagents initially gathered news but silently never
  wrote their files. Claude read its own `[lead]`/`[sub:xxxxxx]` debug trace, root-caused a
  missing absolute file path, **wrote a test to confirm the fix**, patched the lead prompt,
  and added a "VERIFY each file exists" step. It also caught a deeper failure — `chrome-cli`
  "fetch failed" because the dev server had been spawned inside Claude Code's own OS sandbox
  (which blocks localhost) — diagnosed it, fixed it operationally, and saved it to memory so
  it never recurred.

---

## Run it locally

> The app drives **real Chrome on your machine** — it is intentionally local-first and
> not deployable to the cloud. Run everything below in a **normal terminal**, not inside
> Claude Code (its sandbox blocks localhost networking, which the broker needs).

**Prerequisites:** Node 20+, pnpm, Docker, Google Chrome, an `ANTHROPIC_API_KEY`.

1. **Infra (Postgres + Redis):**
   ```bash
   docker compose up -d   # the-agent-times-pg :5433, the-agent-times-redis :6380
   ```
2. **Web app env:** create `apps/web/.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   DATABASE_URL=postgresql://agenttimes:agenttimes@localhost:5433/agenttimes
   ```
3. **DB schema:**
   ```bash
   cd apps/web && pnpm install && pnpm db:push
   ```
4. **Web app** (port 3010):
   ```bash
   pnpm dev    # in apps/web
   ```
5. **Chrome broker server** (port 3011), in a second terminal:
   ```bash
   cd apps/chrome/server && npm install && npm run dev
   ```
6. **Chrome extension:** load `apps/chrome/extension/` as an unpacked MV3 extension
   (`chrome://extensions` → Developer mode → Load unpacked). It connects to the broker and
   joins "The Agent Times" tab group. Make sure you're logged into X in that Chrome.
7. Open **http://localhost:3010**, set your reader profile, type a prompt (or click
   *Surprise me* for the fast path), and watch the agents work.

**Ports** (all in the 3010+ range on purpose — lower ports are taken on the build machine):
web `3010`, chrome broker `3011`, Postgres `5433`, Redis `6380`.

---

## Repo layout

```
apps/
  web/      Next.js app — UI, /api routes, and the agents (Claude Agent SDK)
  chrome/   the real-browser pipeline:
              server/     broker (queues commands for the extension)  :3011
              extension/  MV3 Chrome extension (drives real Chrome)
              cli/        chrome-cli (what the agents actually call)
docs/       architecture, agents, personas
CLAUDE.md   the brief we gave Claude
```

Built with Claude Code · Opus 4.8 · Claude Agent SDK.
