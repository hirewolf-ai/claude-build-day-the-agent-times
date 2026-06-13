# chrome — The Agent Times' browser

The newsroom's browser-collection mechanism. Two halves of one thing:

- **`extension/`** — a pure-JS MV3 Chrome extension. It runs browser-collection
  commands (navigate, click, scrape) in a **real, logged-in Chrome** via the
  DevTools Protocol. No build step, no framework.
- **`server/`** — a small Node broker on **port 3011**. It holds a queue of
  commands and the results. It **never drives a browser itself** — the extension
  polls it for work and posts results back.

```
  chrome-cli ──enqueue──▶  server (:3011)  ◀──poll/result──  extension  ──CDP──▶  real Chrome
```

`chrome-cli` (in `cli/`) is how you — or a research agent — enqueue commands. See
`./cli/chrome-cli --help`.

> Collection is **always** a real browser, never headless. That's the load-bearing
> design decision; see the repo root `CLAUDE.md`.

---

## Install the extension in dev mode

### 1. Start the broker server

The extension is useless until the server it polls is running.

```bash
cd apps/chrome/server
npm install          # first time only (pulls in sharp, used for screenshots)
npm run dev          # node --watch server.js  →  http://localhost:3011
```

You should see:

```
the-agent-times chrome server listening on http://localhost:3011
```

Leave it running. (`npm start` runs it without file-watching.)
Port is **3011** by design — override with `PORT=… npm run dev` if you must, but the
extension and CLI both default to `http://localhost:3011`, so don't unless you
change both.

### 2. Load the unpacked extension

1. Open Chrome and go to `chrome://extensions`.
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select the **`apps/chrome/extension`** folder (the one with `manifest.json`).

The extension — **"The Agent Times Chrome Extension"** — now appears in the list.
Pin it from the puzzle-piece menu so its popup is one click away.

> It requests broad permissions (`debugger`, `tabs`, `<all_urls>`, …) because it
> attaches the DevTools debugger to tabs to scrape and drive them. That's expected.

### 3. Connect the extension to the server

1. Click the extension's toolbar icon to open the popup ("The Agent Times — The
   newsroom's browser").
2. Click **Connect**.

The status dot goes active and the button flips to **Disconnect**. Under the hood
the extension now polls `http://localhost:3011/commands/next` for work and posts
results back. Connected state is remembered in `chrome.storage.local`, so it
reconnects on browser restart (as long as the server is up).

### 4. Verify end-to-end

With the server running and the extension connected:

```bash
cd apps/chrome
./cli/chrome-cli status          # → { "ok": true, "pending": 0, "inFlight": 0 }
./cli/chrome-cli listAllTabs     # should return your real Chrome tabs as JSON
```

If `status` is `ok` but commands never complete (they stay pending / time out),
the extension isn't connected — re-open the popup and check the dot / click
**Connect**.

---

## Dev loop & reloading

- **Edit the extension** (`background.js`, `popup.*`, `dom/*`) → go to
  `chrome://extensions` and click the **reload ↻** on the extension card. MV3
  service workers don't hot-reload; you must reload manually. Re-click **Connect**
  if the popup shows inactive after a reload.
- **Edit the server** → `npm run dev` is already watching (`node --watch`), so it
  restarts on save. The extension will simply resume polling.
- **Inspect the extension's logs** → on `chrome://extensions`, click the
  extension's **service worker** link to open its DevTools console. Background
  logs are prefixed `[wolf]`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `chrome-cli` commands hang / time out | Extension not connected — open popup, click **Connect**. Confirm the dot is active. |
| `status` not `ok` / connection refused | Server isn't running. `cd server && npm run dev`. |
| Commands fail with debugger errors | Another DevTools/debugger is attached to that tab (e.g. you have its DevTools open). Close it, or `detachDebugger` then retry. |
| Extension greyed out after a code change | Reload it on `chrome://extensions`, then re-**Connect**. |
| Port conflict on 3011 | Something else holds 3011. Free it, or run with a different `PORT` **and** point the CLI at it via `--server` / `AGENT_TIMES_SERVER`. |

## Layout

```
apps/chrome/
  cli/        chrome-cli — enqueue commands, fetch results
  server/     the broker (port 3011): server.js, annotate.js
  extension/  the MV3 extension (load this in dev mode)
    manifest.json   MV3 manifest, version 0.0.1
    background.js   service worker — poll loop + CDP command execution
    popup.html/.js/.css   the Connect/Disconnect popup
    dom/            SoM snapshot + serializer used by get_visible_dom
    icons/
```
