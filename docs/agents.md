# The Agent System

Two families of agents, both run via the Claude Agent SDK inside
`apps/the-agent-times-agents`. They are separated by the warehouse: collection
agents fill it, printing agents read it.

## 1. Collection agents (fill the warehouse)

**Job:** given the reader's prompt (or "general edition" when empty), decide what
to read and produce browser-collection scripts.

- Plan sources for the edition (what topics/sites are worth reading right now).
- Emit Playwright-style scripts describing what to navigate/scrape.
- Hand scripts to `chrome/server`, which streams them to the live `chrome/extension`.
- Receive scraped results and persist them to the Postgres warehouse as raw items.

They do **not** write prose. Their output is data.

## 2. Printing agents (write the paper)

**Job:** turn the warehouse into a finished edition.

- An **editor** agent shapes the edition: picks the lead, assigns warehouse items
  to sections, sets the through-line for this edition.
- **Columnist** agents each own one section and write it in a fixed persona/voice
  (see `docs/personas.md`). Same writers every edition; only the data changes.
- Output drops into the **base newspaper template** — sections are baked in, the
  columnists fill them.

## Base template

The paper has a stable skeleton (masthead, lead story, columnist sections, etc.).
The editor + columnists fill the slots; the structure does not get regenerated from
scratch each time. This keeps editions consistent and the layout predictable for
`web` to render. Template lives with `web` (rendering) and is referenced by the
printing agents (what slots to fill).

## Status

This doc describes the intended system. We build it one app at a time — start
simple, wire the pipeline end to end, then deepen the personas and collection logic.
