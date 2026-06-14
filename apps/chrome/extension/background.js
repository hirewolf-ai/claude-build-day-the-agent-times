// Service worker — handles command execution requested by the popup
// and runs the poll loop against the local command server.

import { buildSnapshotLookup } from "./dom/enhanced_snapshot.js";
import { buildAxLookup, buildEnhancedTree } from "./dom/tree_builder.js";
import { serializeAccessibleElements } from "./dom/serializer.js";

const DEBUGGER_PROTOCOL_VERSION = "1.3";
// User-visible tab-group label (internal const name kept as-is per scope).
const WOLF_GROUP_TITLE = "The Agent Times";
const WOLF_GROUP_COLOR = "yellow";
// Broker URL. Defaults to local dev; override for a deployed broker by setting
// `serverUrl` in chrome.storage.local (e.g. the k8s LoadBalancer URL):
//   chrome.storage.local.set({ serverUrl: "http://<lb-host>:3011" })
// Loaded async on startup; falls back to localhost until then.
let SERVER_URL = "http://localhost:3011";
chrome.storage?.local?.get?.("serverUrl", (r) => {
  if (r && typeof r.serverUrl === "string" && r.serverUrl) SERVER_URL = r.serverUrl;
});
chrome.storage?.onChanged?.addListener?.((changes, area) => {
  if (area === "local" && changes.serverUrl?.newValue) {
    SERVER_URL = changes.serverUrl.newValue;
  }
});
const POLL_INTERVAL_MS = 2000;

// tabId -> true for tabs we've attached CDP to
const attached = new Set();

let pollTimer = null;

async function ensureDebuggerAttached(tabId) {
  if (attached.has(tabId)) return false;
  await chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL_VERSION);
  attached.add(tabId);
  // Enable domains we lean on. Idempotent — safe to call repeatedly elsewhere.
  try {
    await Promise.all([
      cdp(tabId, "Page.enable"),
      cdp(tabId, "Runtime.enable"),
      cdp(tabId, "DOM.enable"),
      cdp(tabId, "Accessibility.enable"),
    ]);
  } catch (err) {
    console.warn("[wolf] domain enable failed:", err.message);
  }
  return true;
}

function cdp(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(`${method}: ${err.message}`));
      resolve(result);
    });
  });
}

async function targetTab(tabId) {
  const id = tabId ?? (await activeTabId());
  if (id == null) throw new Error("no tab specified and no active tab");
  await ensureDebuggerAttached(id);
  return id;
}

async function activeOrGiven(tabId) {
  const id = tabId ?? (await activeTabId());
  if (id == null) throw new Error("no tab specified and no active tab");
  return id;
}

// Minimal key map for the keys agents actually press.
const KEY_CODES = {
  Enter: "Enter", Escape: "Escape", Tab: "Tab", Backspace: "Backspace",
  Delete: "Delete", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown", Space: "Space",
};
const VKEY = {
  Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32,
};

async function ensureWolfGroup(tabId) {
  const groupId = await chrome.tabs.group({ tabIds: [tabId] });
  await chrome.tabGroups.update(groupId, {
    title: WOLF_GROUP_TITLE,
    color: WOLF_GROUP_COLOR,
  });
  return groupId;
}

// Tracks tabIds we've opened so onRemoved can report just ours.
const sessionTabs = new Set();

async function reportSessionOpen(tab, commandId) {
  sessionTabs.add(tab.id);
  try {
    await fetch(`${SERVER_URL}/sessions/tab`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tabId: tab.id,
        url: tab.url || tab.pendingUrl || null,
        title: tab.title || null,
        commandId: commandId || null,
      }),
    });
  } catch (err) {
    console.warn("[wolf] sessions report failed:", err.message);
  }
}

async function reportSessionClose(tabId) {
  try {
    await fetch(`${SERVER_URL}/sessions/tab/${tabId}/closed`, { method: "POST" });
  } catch (err) {
    console.warn("[wolf] sessions close-report failed:", err.message);
  }
}

const COMMANDS = {
  async openTab({ url, _commandId, focus = false }) {
    const tab = await chrome.tabs.create({
      url: url || "about:blank",
      active: !!focus,
    });
    const groupId = await ensureWolfGroup(tab.id);
    await ensureDebuggerAttached(tab.id);
    await reportSessionOpen(tab, _commandId);
    return { tabId: tab.id, url: tab.url, groupId, debugger: "attached", focused: !!focus };
  },

  async navigate({ url, tabId }) {
    const targetTabId = tabId ?? (await activeTabId());
    if (targetTabId == null) throw new Error("No active tab to navigate");
    const tab = await chrome.tabs.update(targetTabId, { url });
    await ensureDebuggerAttached(targetTabId);
    return { tabId: tab.id, url: tab.url, debugger: "attached" };
  },

  async closeTab({ tabId }) {
    const targetTabId = tabId ?? (await activeTabId());
    if (targetTabId == null) throw new Error("No tab to close");
    await chrome.tabs.remove(targetTabId);
    return { closedTabId: targetTabId };
  },

  async listTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      url: t.url,
      title: t.title,
      active: t.active,
      groupId: t.groupId,
    }));
  },

  async focusTab({ tabId, windowId }) {
    if (tabId == null && windowId == null) {
      throw new Error("focusTab requires tabId and/or windowId");
    }
    let targetWindowId = windowId;
    if (tabId != null) {
      const tab = await chrome.tabs.get(tabId);
      targetWindowId = tab.windowId;
      await chrome.tabs.update(tabId, { active: true });
    }
    await chrome.windows.update(targetWindowId, { focused: true, drawAttention: true });
    return { tabId: tabId ?? null, windowId: targetWindowId };
  },

  async listAllTabs() {
    const windows = await chrome.windows.getAll({ populate: true });
    return windows.map((w) => ({
      windowId: w.id,
      focused: w.focused,
      state: w.state,
      tabs: w.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
        groupId: t.groupId,
      })),
    }));
  },

  async openDebugTab({ url }) {
    return COMMANDS.openTab({ url });
  },

  async detachDebugger({ tabId }) {
    const targetTabId = tabId ?? (await activeTabId());
    if (targetTabId == null) throw new Error("No tab to detach");
    await chrome.debugger.detach({ tabId: targetTabId });
    attached.delete(targetTabId);
    return { detachedTabId: targetTabId };
  },

  // ---- Playwright-like primitives via raw CDP ----

  // evaluate({ tabId?, expression, awaitPromise? }) -> any
  // Run JS in the page. Returns the resolved value (or throws on JS errors).
  async evaluate({ tabId, expression, awaitPromise = true }) {
    if (!expression) throw new Error("evaluate requires expression");
    const id = await targetTab(tabId);
    const { result, exceptionDetails } = await cdp(id, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (exceptionDetails) {
      const msg = exceptionDetails.exception?.description || exceptionDetails.text;
      throw new Error(`page threw: ${msg}`);
    }
    return { tabId: id, value: result.value ?? null, type: result.type };
  },

  // click({ tabId?, selector, nth? }) -> { x, y }
  // Resolves selector via DOM.querySelector, computes center, dispatches mouse press+release.
  async click({ tabId, selector, nth = 0 }) {
    if (!selector) throw new Error("click requires selector");
    const id = await targetTab(tabId);
    const expr = `(() => {
      const els = document.querySelectorAll(${JSON.stringify(selector)});
      const el = els[${Number(nth)}];
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`;
    const { result } = await cdp(id, "Runtime.evaluate", { expression: expr, returnByValue: true });
    if (!result.value) throw new Error(`selector matched no element: ${selector}`);
    const { x, y } = result.value;
    const base = { type: "mousePressed", x, y, button: "left", clickCount: 1 };
    await cdp(id, "Input.dispatchMouseEvent", base);
    await cdp(id, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
    return { tabId: id, x, y };
  },

  // screenshot({ tabId?, format?, quality?, fullPage? }) -> { dataUrl, path? }
  // Returns base64 PNG/JPEG. Writes to disk happens server-side, not here.
  async screenshot({ tabId, format = "png", quality, fullPage = false }) {
    const id = await targetTab(tabId);
    const params = { format };
    if (format === "jpeg" && quality != null) params.quality = Number(quality);
    if (fullPage) params.captureBeyondViewport = true;
    const { data } = await cdp(id, "Page.captureScreenshot", params);
    return {
      tabId: id,
      format,
      dataUrl: `data:image/${format};base64,${data}`,
      bytes: data.length, // base64 length, not decoded — rough size signal
    };
  },

  // ---- SoM-style DOM API ----
  //
  // get_visible_dom snapshots interactable elements currently in the
  // viewport, assigns each a stable numeric id for the lifetime of the page,
  // and stashes the node references on window.__wolfDom so click_id/type_id
  // can resolve them later. Snapshots are invalidated by navigation.

  // get_visible_dom({ tabId?, format?, viewportThreshold? })
  //   format: "text" (default) | "json"
  //   viewportThreshold: px of slack beyond viewport for "is_visible"
  //                      (default 1000 — matches browser-use)
  //   Runs the ported browser-use DOM pipeline (DOMSnapshot + AX tree +
  //   paint-order overlay filter + simplified tree + indented serialization).
  //   Returns elements keyed by stable CDP backendNodeId.
  async get_visible_dom({ tabId, format = "text", viewportThreshold = 1000 } = {}) {
    const id = await targetTab(tabId);
    const vt = viewportThreshold === null || viewportThreshold === "null"
      ? null
      : Number(viewportThreshold);
    return await snapshotV2(id, { format, viewportThreshold: vt });
  },

  // click_at({ tabId?, x, y, button?, clickCount? })
  //   Vision-only click: dispatch mouse press/release at the given viewport
  //   coordinates. No DOM resolution, no scrollIntoView — the caller is
  //   responsible for ensuring (x, y) is visible.
  // move_at({ tabId?, x, y })
  //   Dispatch a single trusted mouseMoved event at the given viewport coords.
  //   isTrusted: true on the page side (LinkedIn's bot detection passes).
  async move_at({ tabId, x, y }) {
    if (x == null || y == null) throw new Error("move_at requires x and y");
    const id = await targetTab(tabId);
    await cdp(id, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Number(x),
      y: Number(y),
      button: "none",
    });
    return { tabId: id, x: Number(x), y: Number(y) };
  },

  // move_curve_to({ tabId?, fromX, fromY, toX, toY, steps?, jitterPx?, dwellMs? })
  //   Draws a quadratic-Bezier curve of trusted mouseMoved events from
  //   (fromX,fromY) to (toX,toY) and ends with a short dwell at the target.
  async move_curve_to({ tabId, fromX, fromY, toX, toY, steps = 7, jitterPx = 40, dwellMs = 250 }) {
    if (toX == null || toY == null) throw new Error("move_curve_to requires toX/toY");
    if (fromX == null || fromY == null) {
      // No origin given — use a sane default near the right side of the viewport
      fromX = 800; fromY = 200;
    }
    const id = await targetTab(tabId);
    const cx = (Number(fromX) + Number(toX)) / 2 + (Math.random() * 2 - 1) * jitterPx;
    const cy = (Number(fromY) + Number(toY)) / 2 + (Math.random() * 2 - 1) * jitterPx;
    const points = [];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * Number(fromX) + 2 * (1 - t) * t * cx + t * t * Number(toX);
      const y = (1 - t) * (1 - t) * Number(fromY) + 2 * (1 - t) * t * cy + t * t * Number(toY);
      points.push({ x: Math.round(x), y: Math.round(y) });
    }
    for (const p of points) {
      await cdp(id, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: p.x, y: p.y, button: "none",
      });
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 40));
    }
    if (dwellMs > 0) await new Promise((r) => setTimeout(r, Number(dwellMs)));
    return { tabId: id, points: points.length, end: points[points.length - 1] };
  },

  // wheel_at({ tabId?, x, y, deltaY, deltaX? })
  //   Dispatch a real trusted mouseWheel event at (x,y). Pages that have
  //   `wheel`/`scroll` listeners on the document will see this as a real
  //   user scroll — needed for LinkedIn's lazy-load triggers and scroll
  //   telemetry. deltaY positive = scroll down.
  async wheel_at({ tabId, x, y, deltaY, deltaX = 0 }) {
    if (x == null || y == null) throw new Error("wheel_at requires x and y");
    if (deltaY == null) throw new Error("wheel_at requires deltaY");
    const id = await targetTab(tabId);
    await cdp(id, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Number(x),
      y: Number(y),
      deltaX: Number(deltaX),
      deltaY: Number(deltaY),
    });
    return { tabId: id, x: Number(x), y: Number(y), deltaY: Number(deltaY) };
  },

  async click_at({ tabId, x, y, button = "left", clickCount = 1 }) {
    if (x == null || y == null) throw new Error("click_at requires x and y");
    const id = await targetTab(tabId);
    const base = {
      x: Number(x),
      y: Number(y),
      button,
      clickCount: Number(clickCount),
    };
    await cdp(id, "Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
    await cdp(id, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
    return { tabId: id, x: base.x, y: base.y, button, clickCount: base.clickCount };
  },

  // get_attrs({ tabId?, id, attrs? })
  //   id:    backendNodeId from a previous get_visible_dom
  //   attrs: array of attribute names to read; omit to get them all
  //   Returns { tag, attrs: {name: value, ...} }. No click/navigation.
  async get_attrs({ tabId, id: nodeId, attrs }) {
    if (nodeId == null) throw new Error("get_attrs requires id");
    const tab = await targetTab(tabId);
    let resolved;
    try {
      resolved = await cdp(tab, "DOM.resolveNode", { backendNodeId: Number(nodeId) });
    } catch (err) {
      throw new Error(`backend node ${nodeId} not found`);
    }
    const objectId = resolved.object?.objectId;
    if (!objectId) throw new Error(`backend node ${nodeId} has no objectId`);
    const wanted = Array.isArray(attrs) ? attrs : null;
    const { result, exceptionDetails } = await cdp(tab, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function(wanted) {
        const tag = this.tagName.toLowerCase();
        const out = {};
        if (wanted) {
          for (const k of wanted) {
            const v = this.getAttribute(k);
            if (v != null) out[k] = v;
          }
        } else {
          for (const a of this.attributes || []) out[a.name] = a.value;
        }
        // Always expose computed href if it's an <a> — the DOM 'href' property
        // gives the absolute resolved URL, attribute may be relative.
        if (tag === "a" && this.href) out.href_absolute = this.href;
        if (tag === "img" && this.currentSrc) out.src_absolute = this.currentSrc;
        return { tag, attrs: out };
      }`,
      arguments: [{ value: wanted }],
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`page threw: ${exceptionDetails.text}`);
    return { tabId: tab, id: Number(nodeId), ...result.value };
  },

  async click_id({ tabId, id: nodeId }) {
    if (nodeId == null) throw new Error("click_id requires id");
    const id = await targetTab(tabId);
    const point = await resolveBackendNodeCenter(id, Number(nodeId));
    if (!point) throw new Error(`backend node ${nodeId} not found or off-screen`);
    const base = { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 };
    await cdp(id, "Input.dispatchMouseEvent", base);
    await cdp(id, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
    return { tabId: id, nodeId, x: point.x, y: point.y, tag: point.tag };
  },

  // scroll({ tabId?, by?, to?, into? })
  //   by: "page" | "viewport" | number of pixels (positive down, negative up)
  //   to: "top" | "bottom"
  //   into: snapshot id of an element to scroll into view
  async get_url({ tabId } = {}) {
    const id = await activeOrGiven(tabId);
    const tab = await chrome.tabs.get(id);
    return { tabId: id, url: tab.url };
  },

  async get_title({ tabId } = {}) {
    const id = await activeOrGiven(tabId);
    const tab = await chrome.tabs.get(id);
    return { tabId: id, title: tab.title };
  },

  async go_back({ tabId } = {}) {
    const id = await activeOrGiven(tabId);
    await chrome.tabs.goBack(id);
    return { tabId: id };
  },

  async go_forward({ tabId } = {}) {
    const id = await activeOrGiven(tabId);
    await chrome.tabs.goForward(id);
    return { tabId: id };
  },

  async reload({ tabId, bypassCache = false } = {}) {
    const id = await activeOrGiven(tabId);
    await chrome.tabs.reload(id, { bypassCache: !!bypassCache });
    return { tabId: id, bypassCache: !!bypassCache };
  },

  // press_key({ tabId?, key, modifiers? })
  //   key: "Enter" | "Escape" | "Tab" | "ArrowDown" | etc (DOM key name)
  //   modifiers: { ctrl?, alt?, shift?, meta? }
  async press_key({ tabId, key, modifiers = {} }) {
    if (!key) throw new Error("press_key requires key");
    const id = await targetTab(tabId);
    // Derive `code` and `windowsVirtualKeyCode` for single character keys.
    // KEY_CODES/VKEY have the named special keys; letters/digits need
    // auto-derivation so e.g. Cmd+V works (code: "KeyV", vkey: 86).
    let code = KEY_CODES[key];
    let vkey = VKEY[key];
    if (!code) {
      if (/^[a-z]$/i.test(key)) {
        code = "Key" + key.toUpperCase();
        vkey = key.toUpperCase().charCodeAt(0);
      } else if (/^[0-9]$/.test(key)) {
        code = "Digit" + key;
        vkey = key.charCodeAt(0);
      } else {
        code = key;
      }
    }
    let mods = 0;
    if (modifiers.alt) mods |= 1;
    if (modifiers.ctrl) mods |= 2;
    if (modifiers.meta) mods |= 4;
    if (modifiers.shift) mods |= 8;
    const base = { key, code, modifiers: mods };
    if (vkey != null) { base.windowsVirtualKeyCode = vkey; base.nativeVirtualKeyCode = vkey; }
    // Use rawKeyDown for keys with modifiers so the page's keyboard handler
    // sees a real keystroke event (browsers swallow `char` events for shortcuts).
    const hasMods = !!(modifiers.alt || modifiers.ctrl || modifiers.meta || modifiers.shift);
    await cdp(id, "Input.dispatchKeyEvent", { ...base, type: hasMods ? "rawKeyDown" : "keyDown" });
    await cdp(id, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
    return { tabId: id, key, code, modifiers };
  },

  // wait_for_load({ tabId?, timeout?, idleMs? })
  //   Waits for document.readyState=complete AND a quiet network window
  //   (default 500ms with no new requests). Returns once settled, or throws
  //   on timeout.
  async wait_for_load({ tabId, timeout = 15_000, idleMs = 500 } = {}) {
    const id = await targetTab(tabId);
    const deadline = Date.now() + Number(timeout);
    const idleWindow = Number(idleMs);

    // Phase 1 — document ready.
    while (Date.now() < deadline) {
      const { result } = await cdp(id, "Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      if (result.value === "complete") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (Date.now() >= deadline) throw new Error("wait_for_load: document never reached complete");

    // Phase 2 — network idle (CDP Network domain via per-tab event counters).
    // We tap chrome.debugger.onEvent for the tab; debounce.
    return await new Promise((resolve, reject) => {
      let lastEventAt = Date.now();
      const onEvent = (source, method) => {
        if (source.tabId !== id) return;
        if (method && method.startsWith("Network.")) lastEventAt = Date.now();
      };
      chrome.debugger.onEvent.addListener(onEvent);
      const timer = setInterval(() => {
        if (Date.now() - lastEventAt >= idleWindow) {
          clearInterval(timer);
          chrome.debugger.onEvent.removeListener(onEvent);
          resolve({ tabId: id, settled: true, idleMs: idleWindow });
        }
        if (Date.now() > deadline) {
          clearInterval(timer);
          chrome.debugger.onEvent.removeListener(onEvent);
          reject(new Error(`wait_for_load: timed out after ${timeout}ms`));
        }
      }, 100);
    });
  },

  async scroll({ tabId, by, to, into }) {
    const id = await targetTab(tabId);
    let expr;
    if (into != null) {
      expr = `(${RESOLVE_NODE.toString()})(${Number(into)}) ? { ok: true, mode: "into", id: ${Number(into)} } : null`;
    } else if (to === "top") {
      expr = `(window.scrollTo({ top: 0, behavior: "instant" }), { ok: true, mode: "top" })`;
    } else if (to === "bottom") {
      expr = `(window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }), { ok: true, mode: "bottom" })`;
    } else {
      let px;
      if (by === "page" || by === "viewport" || by == null) px = window?.innerHeight ?? 800;
      else if (typeof by === "number") px = by;
      else px = Number(by) || 800;
      expr = `(window.scrollBy({ top: ${px}, behavior: "instant" }), { ok: true, mode: "by", px: ${px} })`;
    }
    const { result, exceptionDetails } = await cdp(id, "Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`scroll threw: ${exceptionDetails.text}`);
    if (!result.value) throw new Error(`scroll target not found`);
    return { tabId: id, ...result.value };
  },

  async type_id({ tabId, id: nodeId, text, submit = false, clear = false }) {
    if (nodeId == null) throw new Error("type_id requires id");
    if (text == null) throw new Error("type_id requires text");
    const id = await targetTab(tabId);
    const focused = await focusBackendNode(id, Number(nodeId), { clear: !!clear });
    if (!focused) throw new Error(`backend node ${nodeId} not found`);
    await cdp(id, "Input.insertText", { text: String(text) });
    if (submit) {
      await cdp(id, "Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdp(id, "Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
    return { tabId: id, nodeId, typed: String(text), submit };
  },
};

// --- Snapshot v3: browser-use port — DOMSnapshot + AX tree + Simplified ----
//
// Implementation lives in ./dom/*.js (ported from browser-use Python).
// This function just orchestrates: fetch CDP data → run the pipeline → return.

async function snapshotV2(tabId, { format = "text", viewportThreshold = 1000 } = {}) {
  // Four CDP calls in parallel — the heart of the browser-use approach.
  const [snapshot, axTree, domDoc, dprResult, layoutMetrics] = await Promise.all([
    cdp(tabId, "DOMSnapshot.captureSnapshot", {
      computedStyles: [
        "display", "visibility", "opacity",
        "overflow", "overflow-x", "overflow-y",
        "cursor", "pointer-events",
        "position", "background-color",
      ],
      includePaintOrder: true,
      includeDOMRects: true,
    }),
    cdp(tabId, "Accessibility.getFullAXTree", {}).catch(() => ({ nodes: [] })),
    cdp(tabId, "DOM.getDocument", { depth: -1, pierce: true }),
    cdp(tabId, "Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true }).catch(() => ({ result: { value: 1 } })),
    cdp(tabId, "Page.getLayoutMetrics", {}),
  ]);

  const dpr = dprResult.result?.value || 1;
  const viewport = {
    width: layoutMetrics.layoutViewport.clientWidth,
    height: layoutMetrics.layoutViewport.clientHeight,
    scrollX: layoutMetrics.layoutViewport.pageX || 0,
    scrollY: layoutMetrics.layoutViewport.pageY || 0,
  };

  // Build lookups
  const snapshotLookup = buildSnapshotLookup(snapshot, dpr);
  const axLookup = buildAxLookup(axTree);

  // Build the enhanced tree (with is_visible populated per-node).
  const root = buildEnhancedTree(domDoc.root, snapshotLookup, axLookup, viewport, viewportThreshold);

  // Run the simplified-tree + paint-order + serialize pipeline
  const { text, selectorMap } = serializeAccessibleElements(root);

  // Pull URL from the DOM root
  const url = domDoc.root.documentURL || "";

  if (format === "text") {
    return { tabId, url, count: selectorMap.size, text };
  }
  // JSON format: emit the same selector map as a list with bbox + role
  const nodes = [];
  for (const [backendId, n] of selectorMap) {
    const sn = n.snapshot_node;
    nodes.push({
      id: backendId,
      tag: n.tag_name,
      role: n.attributes?.role || n.ax_node?.role || n.tag_name,
      name: (n.ax_node?.name || n.attributes?.["aria-label"] || "").slice(0, 160),
      bbox: sn?.bounds
        ? { x: Math.round(sn.bounds.x), y: Math.round(sn.bounds.y), w: Math.round(sn.bounds.width), h: Math.round(sn.bounds.height) }
        : null,
    });
  }
  return { tabId, url, count: nodes.length, nodes };
}

// --- Backend-id based click + type helpers ---------------------------------

async function resolveBackendNodeCenter(tabId, backendNodeId) {
  // Resolve backend id → object id, then call a function on the element that
  // scrolls it into view and returns its center.
  let resolved;
  try {
    resolved = await cdp(tabId, "DOM.resolveNode", { backendNodeId });
  } catch (err) {
    return null;
  }
  const objectId = resolved.object?.objectId;
  if (!objectId) return null;
  const { result, exceptionDetails } = await cdp(tabId, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function() {
      this.scrollIntoView({ block: "center", inline: "center" });
      const r = this.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: this.tagName.toLowerCase() };
    }`,
    returnByValue: true,
  });
  if (exceptionDetails) return null;
  return result.value;
}

async function focusBackendNode(tabId, backendNodeId, opts = {}) {
  let resolved;
  try {
    resolved = await cdp(tabId, "DOM.resolveNode", { backendNodeId });
  } catch (err) {
    return false;
  }
  const objectId = resolved.object?.objectId;
  if (!objectId) return false;
  const { exceptionDetails } = await cdp(tabId, "Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function(opts) {
      this.scrollIntoView({ block: "center", inline: "center" });
      this.focus();
      if (opts && opts.clear) {
        if ("value" in this) this.value = "";
        else if (this.isContentEditable) this.textContent = "";
      }
      return true;
    }`,
    arguments: [{ value: opts }],
    returnByValue: true,
  });
  return !exceptionDetails;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function runCommand(name, args) {
  const fn = COMMANDS[name];
  if (!fn) throw new Error(`Unknown command: ${name}`);
  return await fn(args || {});
}

chrome.tabs.onRemoved.addListener((tabId) => {
  attached.delete(tabId);
  if (sessionTabs.has(tabId)) {
    sessionTabs.delete(tabId);
    reportSessionClose(tabId);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attached.delete(source.tabId);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "wolf.runCommand") {
    runCommand(msg.command, msg.args)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // keep the message channel open for the async response
  }

  if (msg?.type === "wolf.setConnected") {
    if (msg.connected) startPolling();
    else stopPolling();
    sendResponse({ ok: true });
    return;
  }
});

// --- Polling loop -----------------------------------------------------------

async function pollOnce() {
  let next;
  try {
    const res = await fetch(`${SERVER_URL}/commands/next`);
    if (res.status === 204) return;
    if (!res.ok) {
      console.warn("[wolf] poll error", res.status);
      return;
    }
    next = await res.json();
  } catch (err) {
    console.warn("[wolf] poll fetch failed:", err.message);
    return;
  }

  if (!next?.id || !next?.command) return;
  console.log("[wolf] dispatched", next.id, next.command, next.args);

  let payload;
  try {
    const result = await runCommand(next.command, { ...next.args, _commandId: next.id });
    payload = { ok: true, result };
  } catch (err) {
    payload = { ok: false, error: String(err?.message || err) };
  }

  try {
    await fetch(`${SERVER_URL}/commands/${next.id}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log("[wolf] reported", next.id, payload.ok ? "ok" : `error: ${payload.error}`);
  } catch (err) {
    console.warn("[wolf] result post failed:", err.message);
  }
}

const POLL_ALARM = "wolf.poll";

// MV3 service workers get evicted after ~30s idle, which silently stops the
// poll setInterval — commands then pile up in the queue until the 30s alarm
// revives us. To keep the worker ALIVE during an active session, we ping a
// cheap chrome API every ~20s, which resets the idle timer. This is the
// standard MV3 keep-alive and removes the stop-start sawtooth.
let keepAliveTimer = null;
function startKeepAlive() {
  if (keepAliveTimer != null) return;
  keepAliveTimer = setInterval(() => {
    // Any extension-API call resets the SW idle timer.
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20000);
}
function stopKeepAlive() {
  if (keepAliveTimer != null) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function startPolling() {
  console.log("[wolf] polling started");
  if (pollTimer == null) {
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  }
  startKeepAlive();
  // Alarm is the safety net if the worker is evicted despite the keep-alive
  // (e.g. the keep-alive interval itself was killed). Min period is 30s in MV3.
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  pollOnce(); // kick immediately
}

function stopPolling() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopKeepAlive();
  chrome.alarms.clear(POLL_ALARM);
  console.log("[wolf] polling stopped");
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  // SW may have been evicted and just woke up — make sure the interval and the
  // keep-alive are running, then poll right now so we don't wait another 2s.
  if (pollTimer == null) pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  startKeepAlive();
  pollOnce();
});

// On SW startup, resume polling if the user was connected. The alarm above
// would also resurrect us, but this path covers the very first wake.
chrome.storage.local.get("connected").then(({ connected }) => {
  if (connected) startPolling();
});

// On startup, find any existing Wolf-group tabs and report them so the
// server's session view stays in sync across SW restarts.
async function reconcileSession() {
  try {
    const groups = await chrome.tabGroups.query({ title: WOLF_GROUP_TITLE });
    for (const g of groups) {
      const tabs = await chrome.tabs.query({ groupId: g.id });
      for (const t of tabs) {
        if (!sessionTabs.has(t.id)) await reportSessionOpen(t);
      }
    }
  } catch (err) {
    console.warn("[wolf] reconcile failed:", err.message);
  }
}
reconcileSession();
