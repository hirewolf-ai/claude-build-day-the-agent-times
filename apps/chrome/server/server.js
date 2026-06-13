// The Agent Times — chrome command-queue server (broker).
// Agents/CLI POST commands here; the extension polls and runs them in real Chrome.
// Run:   node apps/chrome/server/server.js
// Default port 3011 (override with PORT env var).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { annotateScreenshot } = require("./annotate.js");

// Mirror stdout/stderr to a log file.
const LOG_DIR = path.join(__dirname, "..", "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, "queue.log");
const logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
logStream.write(`\n=== queue start ${new Date().toISOString()} ===\n`);
for (const level of ["log", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const line = args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ");
    logStream.write(`[${new Date().toISOString()}] ${line}\n`);
  };
}

const PORT = Number(process.env.PORT || 3011);

// In-memory store. Resets on restart.
const pending = []; // FIFO queue of unclaimed commands
const inFlight = new Map(); // id -> command (handed to extension, awaiting result)
const completed = new Map(); // id -> { command, result, error, finishedAt }
const log = []; // chronological event log
const sessionTabs = new Map(); // tabId -> { tabId, url, title, commandId, openedAt, closedAt? }

function event(kind, payload) {
  const entry = { ts: new Date().toISOString(), kind, ...payload };
  log.push(entry);
  if (log.length > 500) log.shift();
  console.log(`[${entry.ts}] ${kind}`, payload);
}

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const routes = [
  // CORS preflight
  {
    method: "OPTIONS",
    match: () => true,
    handler: (_req, res) => send(res, 204, {}),
  },

  // Enqueue a command
  // POST /commands  { command: "openTab", args: { url: "..." } }
  {
    method: "POST",
    match: (p) => p === "/commands",
    handler: async (req, res) => {
      const body = await readJson(req);
      if (!body.command) return send(res, 400, { error: "command required" });
      const entry = {
        id: randomUUID(),
        command: body.command,
        args: body.args || {},
        enqueuedAt: new Date().toISOString(),
      };
      pending.push(entry);
      event("enqueued", { id: entry.id, command: entry.command, args: entry.args });
      send(res, 201, entry);
    },
  },

  // Extension polls here
  // GET /commands/next  -> 200 with command, or 204 if queue empty
  {
    method: "GET",
    match: (p) => p === "/commands/next",
    handler: (_req, res) => {
      const next = pending.shift();
      if (!next) return send(res, 204, {});
      inFlight.set(next.id, next);
      event("dispatched", { id: next.id, command: next.command });
      send(res, 200, next);
    },
  },

  // Extension reports result
  // POST /commands/:id/result  { ok: true, result: {...} } | { ok: false, error: "..." }
  {
    method: "POST",
    match: (p) => /^\/commands\/[0-9a-f-]+\/result$/i.test(p),
    handler: async (req, res, url) => {
      const id = url.pathname.split("/")[2];
      const cmd = inFlight.get(id);
      if (!cmd) return send(res, 404, { error: "unknown or already-completed id" });
      const body = await readJson(req);
      completed.set(id, {
        command: cmd,
        ok: !!body.ok,
        result: body.result ?? null,
        error: body.error ?? null,
        finishedAt: new Date().toISOString(),
      });
      inFlight.delete(id);
      event("completed", { id, ok: !!body.ok, error: body.error ?? null });
      send(res, 200, { ok: true });
    },
  },

  // Look up a single command's status / result
  // GET /commands/:id
  {
    method: "GET",
    match: (p) => /^\/commands\/[0-9a-f-]+$/i.test(p),
    handler: (_req, res, url) => {
      const id = url.pathname.split("/")[2];
      if (completed.has(id)) return send(res, 200, { status: "completed", ...completed.get(id) });
      if (inFlight.has(id)) return send(res, 200, { status: "in_flight", command: inFlight.get(id) });
      const queued = pending.find((c) => c.id === id);
      if (queued) return send(res, 200, { status: "pending", command: queued });
      send(res, 404, { error: "unknown id" });
    },
  },

  // Extension reports an opened tab
  // POST /sessions/tab  { tabId, url, title?, commandId? }
  {
    method: "POST",
    match: (p) => p === "/sessions/tab",
    handler: async (req, res) => {
      const body = await readJson(req);
      if (body.tabId == null) return send(res, 400, { error: "tabId required" });
      const entry = {
        tabId: body.tabId,
        url: body.url ?? null,
        title: body.title ?? null,
        commandId: body.commandId ?? null,
        openedAt: new Date().toISOString(),
        closedAt: null,
      };
      sessionTabs.set(body.tabId, entry);
      event("session.opened", { tabId: body.tabId, url: body.url });
      send(res, 201, entry);
    },
  },

  // Extension reports a closed tab
  // POST /sessions/tab/:tabId/closed
  {
    method: "POST",
    match: (p) => /^\/sessions\/tab\/\d+\/closed$/.test(p),
    handler: (_req, res, url) => {
      const tabId = Number(url.pathname.split("/")[3]);
      const entry = sessionTabs.get(tabId);
      if (!entry) return send(res, 404, { error: "unknown tabId" });
      entry.closedAt = new Date().toISOString();
      event("session.closed", { tabId });
      send(res, 200, entry);
    },
  },

  // List current session
  // GET /sessions?include=open|closed|all  (default: open)
  {
    method: "GET",
    match: (p) => p === "/sessions",
    handler: (_req, res, url) => {
      const include = url.searchParams.get("include") || "open";
      let tabs = Array.from(sessionTabs.values());
      if (include === "open") tabs = tabs.filter((t) => !t.closedAt);
      else if (include === "closed") tabs = tabs.filter((t) => t.closedAt);
      send(res, 200, { count: tabs.length, tabs });
    },
  },

  // Wipe session memory (does NOT close tabs — CLI does that)
  // DELETE /sessions
  {
    method: "DELETE",
    match: (p) => p === "/sessions",
    handler: (_req, res) => {
      const cleared = sessionTabs.size;
      sessionTabs.clear();
      event("session.cleared", { cleared });
      send(res, 200, { cleared });
    },
  },

  // Annotate a screenshot with SoM-style numbered boxes.
  // POST /annotate  { screenshot_b64, nodes: [{id, tag, attrs?, name?, bbox}], dpr?, filterShortLabels? }
  {
    method: "POST",
    match: (p) => p === "/annotate",
    handler: async (req, res) => {
      const body = await readJson(req);
      if (!body.screenshot_b64) return send(res, 400, { error: "screenshot_b64 required" });
      if (!Array.isArray(body.nodes)) return send(res, 400, { error: "nodes[] required" });
      try {
        const out = await annotateScreenshot(
          body.screenshot_b64,
          body.nodes,
          Number(body.dpr || 1),
          body.filterShortLabels !== false,
        );
        send(res, 200, { ok: true, annotated_b64: out, count: body.nodes.length });
      } catch (err) {
        event("annotate.failed", { error: err.message });
        send(res, 500, { ok: false, error: String(err?.message || err) });
      }
    },
  },

  // Debug: see everything
  // GET /events
  {
    method: "GET",
    match: (p) => p === "/events",
    handler: (_req, res) =>
      send(res, 200, {
        pending,
        inFlight: Array.from(inFlight.values()),
        completed: Array.from(completed.entries()).map(([id, v]) => ({ id, ...v })),
        log: log.slice(-50),
      }),
  },

  // Health
  {
    method: "GET",
    match: (p) => p === "/" || p === "/health",
    handler: (_req, res) => send(res, 200, { ok: true, pending: pending.length, inFlight: inFlight.size }),
  },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes.find((r) => r.method === req.method && r.match(url.pathname));
  if (!route) return send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
  try {
    await route.handler(req, res, url);
  } catch (err) {
    send(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`the-agent-times chrome server listening on http://localhost:${PORT}`);
  console.log(`  POST   /commands              { command, args }`);
  console.log(`  GET    /commands/next         (extension polls)`);
  console.log(`  POST   /commands/:id/result   { ok, result | error }`);
  console.log(`  GET    /commands/:id          status + result`);
  console.log(`  GET    /events                debug log`);
});
