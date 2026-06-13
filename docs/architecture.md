# The Agent Times — Architecture

A newspaper written by agents. The reader gives a prompt ("what would you like to
read?"), agents go out and collect real data from the live web, then a set of
columnist agents — each with a fixed persona and voice — write the paper. The
result renders as an interactive newspaper page.

## The four apps

```
apps/
  web                    Next.js. The reader-facing paper + the input box.
  chrome/                The browser-collection mechanism (two halves of one thing):
    extension              Pure JS (MV3). Executes browser-collection scripts in a real browser.
    server                 Streams collection scripts to the extension, collects results.
  the-agent-times-agents Python FastAPI + Claude Agent SDK. The collection + printing agents.
```

## The pipeline (one edition)

```
 reader prompt
      │
      ▼
 ┌─────────┐   1. kick off          ┌─────────────────────────┐
 │   web   │ ─────────────────────▶ │ the-agent-times-agents   │
 └─────────┘                        │  (FastAPI + Agent SDK)   │
      ▲                             └───────────┬──────────────┘
      │                                         │ 2. collection agents decide
      │                                         │    WHAT to read, emit browser
      │                                         │    scripts (Playwright-style)
      │                                         ▼
      │                             ┌─────────────────────────┐
      │                             │     chrome/server        │
      │                             │  accepts scripts, streams│
      │                             │  them to the extension   │
      │                             └───────────┬──────────────┘
      │                                         │ 3. live-stream over a channel
      │                                         ▼
      │                             ┌─────────────────────────┐
      │                             │    chrome/extension      │
      │                             │  runs scripts in a REAL  │
      │                             │  browser, scrapes data   │
      │                             └───────────┬──────────────┘
      │                                         │ 4. results flow back up
      │                                         ▼
      │                             ┌─────────────────────────┐
      │                             │   data warehouse (pg)    │
      │                             │   raw collected news     │
      │                             └───────────┬──────────────┘
      │                                         │ 5. printing agents read the
      │       6. rendered edition               │    warehouse + base template,
      └─────────────────────────────────────────┘    each columnist writes its
                                                      section in its own voice
```

1. **Reader prompt.** The `web` input box (Claude-style) takes an optional prompt.
   Empty is fine — that means "surprise me / general edition".
2. **Collection planning.** Agents in `the-agent-times-agents` decide what sources
   to read for this edition and emit browser-collection scripts.
3. **Script streaming.** Scripts go to `chrome/server`, which live-streams them to a
   connected `chrome/extension` instance.
4. **Live collection.** The extension executes the scripts in a real, logged-in
   browser and scrapes the data. (Real browser = real pages, real sessions, fewer
   bot walls than headless.)
5. **Warehouse.** Collected data lands in Postgres — the "data warehouse" — as the
   raw material for this edition.
6. **Printing.** Printing/columnist agents read the warehouse, drop content into a
   base newspaper template, and each columnist writes its section in voice. The
   finished edition renders back in `web`.

## Why this shape (the non-obvious bits)

- **Browser-in-the-loop, not headless scraping.** Collection runs through a real
  Chrome via the extension. The `chrome/server` never drives a browser itself — it
  only brokers scripts to wherever a real browser is connected. This is the
  load-bearing design decision; see CLAUDE.md.
- **Warehouse first, write second.** Collection and writing are decoupled by the
  Postgres warehouse. Agents never write straight from a live scrape — they write
  from collected, persisted data. Editions are reproducible from the warehouse.
- **Personas are fixed; content is dynamic.** Columnist voices are stable identities
  baked into the template/prompts. The data changes every edition; the writers do
  not. See `docs/agents.md` and `docs/personas.md`.

## Local infra

`docker-compose.yml` at root runs `the-agent-times-pg` (Postgres, host port **5433**)
and `the-agent-times-redis` (Redis, host port **6380**). Non-default ports on purpose
— another project holds 5432/6379. Redis is reserved for job/stream coordination.
