import "server-only";
import path from "node:path";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { db } from "@/db";
import { editions } from "@/db/schema";
import { COLLECTION_LEAD_PROMPT, COLLECTOR_SUBAGENT_PROMPT } from "./collectionPrompt";

/** apps/chrome — on PATH so the agent can run `chrome-cli` from any cwd. */
const CHROME_DIR = path.resolve(process.cwd(), "..", "chrome");

/**
 * Reader-facing events ONLY. Nothing technical crosses this boundary — no tool
 * names, no chrome-cli, no file paths, no parent_tool_use_id. The server
 * translates the agent's raw activity into friendly newsroom signal here.
 */
export type CollectionEvent =
  | { type: "status"; text: string } // friendly headline-status
  | { type: "reading"; source: string } // a source being read, e.g. "Reuters"
  | { type: "beat"; beat: string; done?: boolean } // a desk started/finished a beat
  | { type: "note"; text: string } // friendly reasoning, one short sentence
  | { type: "personalize"; handle?: string } // reading the reader's X
  | { type: "filed"; beat: string } // a beat file was written
  | { type: "cost"; usd: number } // agent cost for this phase (USD)
  | { type: "done"; fileCount: number }
  | { type: "error"; message: string };

/** Pretty source name from a URL host (for the "Reading …" lines). */
const SOURCE_NAMES: Record<string, string> = {
  "reuters.com": "Reuters", "apnews.com": "the AP wire", "bbc.com": "the BBC",
  "bbc.co.uk": "the BBC", "nytimes.com": "The New York Times", "theguardian.com": "The Guardian",
  "wsj.com": "The Wall Street Journal", "ft.com": "the Financial Times",
  "bloomberg.com": "Bloomberg", "theverge.com": "The Verge", "techcrunch.com": "TechCrunch",
  "arstechnica.com": "Ars Technica", "axios.com": "Axios", "politico.com": "Politico",
  "news.ycombinator.com": "Hacker News", "reddit.com": "Reddit", "x.com": "X",
  "twitter.com": "X", "news.google.com": "Google News", "bing.com": "Bing News",
  "news.yahoo.com": "Yahoo News", "finance.yahoo.com": "Yahoo Finance",
  "google.com": "Google", "marketwatch.com": "MarketWatch", "cnbc.com": "CNBC",
  "finviz.com": "Finviz", "coingecko.com": "CoinGecko", "coindesk.com": "CoinDesk",
  "investing.com": "Investing.com", "arxiv.org": "arXiv", "github.com": "GitHub",
  "huggingface.co": "Hugging Face", "producthunt.com": "Product Hunt",
  "substack.com": "Substack", "espn.com": "ESPN", "pitchfork.com": "Pitchfork",
  "variety.com": "Variety", "eater.com": "Eater",
};

function sourceFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (SOURCE_NAMES[host]) return SOURCE_NAMES[host];
    // longest matching suffix
    for (const key of Object.keys(SOURCE_NAMES)) {
      if (host === key || host.endsWith("." + key)) return SOURCE_NAMES[key];
    }
    // fall back to the bare domain word, title-cased
    const word = host.split(".").slice(-2, -1)[0];
    return word ? word[0].toUpperCase() + word.slice(1) : null;
  } catch {
    return null;
  }
}

/**
 * Build the per-run workspace UNDER THE REPO (not /tmp). This is the fix for the
 * "fetch failed" root cause: when the Agent SDK's Bash runs with a cwd in /tmp it
 * gets sandboxed and localhost networking is blocked, so chrome-cli can't reach
 * the server on :3011. A repo-local cwd is trusted → networking works.
 * Lives at <repo>/.runs/read-<datetime>/ (gitignored).
 */
const RUNS_ROOT = path.resolve(process.cwd(), "..", "..", ".runs");
function workspaceFor(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return path.join(RUNS_ROOT, `read-${stamp}`);
}

/**
 * Run the collection agent. The collected news is written by the AGENTS as
 * markdown files into a per-edition folder (/tmp/read-<datetime>/) — that folder
 * IS the warehouse. Each beat-subagent writes collected/<beat>.md; the lead
 * writes a CLAUDE.md index so the writer agents can navigate it later.
 *
 * Full toolset, no permission gating (hack project). cwd = the workspace folder;
 * `chrome-cli` is on PATH so the browser is reachable from there.
 */
export async function* runCollection(
  editionId: string,
  prompt: string,
  reader?: { name?: string; city?: string; xHandle?: string | null; xUrl?: string | null },
): AsyncGenerator<CollectionEvent> {
  const dir = workspaceFor(new Date());
  await mkdir(path.join(dir, "collected"), { recursive: true });
  await db.update(editions).set({ workspaceDir: dir }).where(eq(editions.id, editionId));
  // (workspace path is saved to the DB, not surfaced to the reader)

  const { name, city, xHandle, xUrl } = reader ?? {};

  // QUICK TEST MODE (Surprise me) — a fast single-pass to iterate on the pipeline
  // without a full edition: read X + TechCrunch, write ONE file, done.
  const quick = prompt.trim() === "__quick__";
  if (quick) {
   try {
    yield { type: "status", text: "Quick scan — X + TechCrunch…" };
    const quickPrompt = [
      "QUICK TEST RUN — be fast. Do NOT spawn subagents. Do NOT cover all beats.",
      "Just two sources, then write one file and finish:",
      xUrl
        ? `  1. Open https://x.com/home (the reader's logged-in feed) via ./cli/chrome-cli,`
        : "  1. Open https://x.com/explore/tabs/trending via ./cli/chrome-cli,",
      `     read ~5 recent posts.${xUrl ? ` (Reader is ${xHandle ? "@" + xHandle : "our reader"}.)` : ""}`,
      "     For EACH post capture its FULL text AND its permalink URL (the",
      "     https://x.com/<handle>/status/<id> link) — these become a 'From Your Feed' section.",
      "  2. Open https://techcrunch.com/category/artificial-intelligence/ , read ~5 latest AI headlines.",
      "     For the top 2-3 items, OPEN the article (openTab its URL) and grab its cover image via",
      "     evaluate document.querySelector('meta[property=\"og:image\"]')?.content — the strongest",
      "     story (the likely lead) MUST have an Image. Also grab a 1-2 sentence summary.",
      `  3. WRITE your findings with the Write tool to: ${dir}/collected/surprise.md`,
      "     (markdown — one section per item: ## headline, then '- Source · URL · Image: <url>',",
      "      then a 1-line summary. For X posts include the exact status URL and the post text.)",
      "  4. Close your tabs (./cli/chrome-cli sessions close). Done — no other beats, no CLAUDE.md needed.",
      "Use ./cli/chrome-cli (not bare chrome-cli). The file MUST exist on disk before you finish.",
    ].join("\n");
    const log = makeLogger(dir);
    await log("=== QUICK TEST RUN ===");
    const q = query({
      prompt: quickPrompt,
      options: {
        model: "claude-opus-4-8" as const,
        cwd: dir,
        allowedTools: ["Bash", "Write", "Read"], // no Agent — single pass
        disallowedTools: ["WebFetch", "WebSearch"],
        permissionMode: "bypassPermissions" as const,
        env: {
          ...process.env,
          PATH: `${CHROME_DIR}:${process.env.PATH ?? ""}`,
          API_TIMEOUT_MS: "1800000",
        },
      },
    });
    const seen = new Set<string>();
    for await (const message of q) {
      await logMessage(log, message);
      if (message.type === "assistant") {
        for (const ev of friendlyEventsFromBlocks(message, seen, seen)) yield ev;
      } else if (message.type === "result") {
        const usd = (message as { total_cost_usd?: number }).total_cost_usd;
        if (typeof usd === "number") yield { type: "cost", usd };
      }
    }
    const fileCount = await beatFileCount(dir);
    yield { type: "done", fileCount };
    await db.update(editions).set({ status: "printing" }).where(eq(editions.id, editionId));
   } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    await db.update(editions).set({ status: "failed" }).where(eq(editions.id, editionId));
   }
   return;
  }

  // If the reader gave an X handle, personalize first: read their profile and
  // write reader-profile.md, then let it flavor every beat.
  const personalize = xUrl
    ? [
        "## STEP 0 — Quick personalization from the reader's X (TIME-BOXED)",
        `The reader is ${name ?? "our reader"}${city ? ` in ${city}` : ""} and their X is ${xUrl} (@${xHandle}).`,
        "Give this ONE quick attempt, then MOVE ON no matter what — do not get stuck here:",
        `  - openTab --url ${xUrl}  (capture the tabId), wait_for_load, then evaluate to read`,
        "    the bio + a few recent post texts. ONE or two reads, max.",
        "  - If X shows a login/OAuth wall, is blank, or takes more than a couple of reads:",
        "    STOP immediately. Write reader-profile.md noting 'X not accessible — using city",
        `    + general interests' and PROCEED to the beats. Do NOT retry X repeatedly.`,
        "Write `reader-profile.md` at the workspace root (interests, vibe, 2–3 fun facts if",
        "you got them, beats to emphasize). Then weight beats accordingly — but the beats",
        "are the priority. Personalization is a nice-to-have, never a blocker.",
        "",
      ]
    : [
        name || city
          ? `## The reader${name ? `: ${name}` : ""}${city ? ` (in ${city})` : ""} — tailor where you can.`
          : "",
        "",
      ];

  if (xUrl) yield { type: "personalize", handle: xHandle ?? undefined };
  else yield { type: "status", text: "Sending the newsroom out to gather today's stories." };

  const cityLine = city ? `The reader is in ${city} — use that for the Local beat.` : "";
  const readerPrompt = [
    prompt.trim()
      ? `Reader's request for today's edition: "${prompt.trim()}" (bias emphasis, still cover all beats).`
      : "No reader prompt — produce a balanced general edition covering all beats.",
    cityLine,
    "",
    ...personalize,
    `WORKSPACE (absolute path): ${dir}`,
    `Beat files go in: ${dir}/collected/   (already exists)`,
    "When you spawn each collector subagent, give it the EXACT absolute file path to",
    `write, e.g. "Write your findings to: ${dir}/collected/markets.md". The subagent`,
    "writes its own file with the Write tool. After all subagents finish, VERIFY each",
    `file exists in ${dir}/collected/, re-dispatch any missing beat, then write`,
    `${dir}/CLAUDE.md as the index for the printing/writer agents (list each beat file,`,
    "item count, and a one-line note on what's strong today). The files ARE the deliverable.",
  ].join("\n");

  try {
    // NO WebFetch / WebSearch — the ONLY way to read the web is the real browser
    // via chrome-cli (Bash). Agent IS enabled — the lead fans out one subagent per
    // beat (the swarm). Subagents inherit cwd=.runs/ so chrome-cli reaches the
    // server (the sandbox fix applies to them too).
    const TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "TodoWrite"];

    const agentEnv = {
      ...process.env,
      // apps/chrome on PATH so `chrome-cli` resolves from the workspace cwd.
      PATH: `${CHROME_DIR}:${process.env.PATH ?? ""}`,
      // Be patient with a flaky/asleep MV3 extension — don't bail early.
      API_TIMEOUT_MS: "1800000", // 30 min/request
      CLAUDE_CODE_MAX_RETRIES: "15",
      CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: "1800000",
    };
    // No maxTurns — we have credits; let it run until it finishes the job.
    const baseOptions = {
      model: "claude-opus-4-8" as const,
      systemPrompt: COLLECTION_LEAD_PROMPT,
      cwd: dir, // the workspace folder — agents Write the news here
      allowedTools: TOOLS,
      // NOTE on the sandbox / "fetch failed": chrome-cli's Node fetch to
      // localhost:3011 fails ONLY when the web server was spawned inside another
      // Claude Code session's OS sandbox (env CLAUDE_CODE_CHILD_SESSION=1). The
      // fix is to run `pnpm dev` in a NORMAL terminal — then no sandbox, no
      // failures, no retries. Not an SDK option we can set here.
      // Belt-and-suspenders: even if a web tool sneaks in, deny it. The browser
      // (chrome-cli via Bash) is the only sanctioned way to read the web.
      disallowedTools: ["WebFetch", "WebSearch"],
      permissionMode: "bypassPermissions" as const,
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        if (toolName === "WebFetch" || toolName === "WebSearch") {
          return {
            behavior: "deny" as const,
            message:
              "WebFetch/WebSearch are disabled. Read the web ONLY by driving the real browser with chrome-cli (openTab → wait_for_load → evaluate).",
          };
        }
        return { behavior: "allow" as const, updatedInput: input };
      },
      // The per-beat collector subagent. The lead spawns one per beat (the swarm),
      // each driving chrome-cli in parallel. Browser-only; inherits cwd=.runs/.
      agents: {
        collector: {
          description:
            "Collects ONE news beat by driving the real browser via chrome-cli (openTab → wait_for_load → evaluate), then writes collected/<beat>.md. Browser only — never WebFetch. No article prose, just structured data.",
          prompt: COLLECTOR_SUBAGENT_PROMPT,
          tools: ["Bash", "Read", "Write", "Edit"],
        },
      },
      env: agentEnv,
    };

    const seenSources = new Set<string>();
    const seenBeats = new Set<string>();
    const EXPECTED_BEATS = 7;
    // A single query() already loops autonomously through all its tool calls until
    // Claude finishes (no maxTurns = no early stop). This OUTER loop is only a
    // safety net: if the run ends ABNORMALLY (e.g. the extension died mid-run) and
    // beats are still missing, we resume the same session and keep going. Generous
    // backstop, not a real cap — exits the moment every beat file exists.
    const MAX_ROUNDS = 25;
    let sessionId: string | undefined;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const q = query({
        prompt:
          round === 0
            ? readerPrompt
            : "Keep going until every beat is done. Some beats are still missing their " +
              "collected/<beat>.md file — finish the remaining beats (retry any source that " +
              "was slow), write any missing files, then the workspace CLAUDE.md. " +
              "Do not stop until all beats are filed.",
        options:
          round === 0
            ? baseOptions
            : { ...baseOptions, ...(sessionId ? { resume: sessionId } : { continue: true }) },
      });

      let subtype: string | undefined;
      const log = makeLogger(dir);
      await log(`\n=== round ${round} start ===`);
      for await (const message of q) {
        await logMessage(log, message); // full debug trace → <dir>/debug.log
        if (message.type === "system" && (message as { subtype?: string }).subtype === "init") {
          sessionId = (message as { session_id?: string }).session_id ?? sessionId;
        } else if (message.type === "assistant") {
          for (const ev of friendlyEventsFromBlocks(message, seenSources, seenBeats)) {
            yield ev;
          }
        } else if (message.type === "result") {
          subtype = (message as { subtype?: string }).subtype;
          sessionId = (message as { session_id?: string }).session_id ?? sessionId;
          const usd = (message as { total_cost_usd?: number }).total_cost_usd;
          if (typeof usd === "number") yield { type: "cost", usd };
          await log(`=== result: ${subtype} ($${usd ?? "?"}) ===`);
        }
      }

      const have = await beatFileCount(dir);
      if (have >= EXPECTED_BEATS) break;
      // If the agent finished cleanly but somehow under-delivered, or it errored —
      // loop again. Tell the reader we're still on it.
      if (round + 1 < MAX_ROUNDS) {
        yield { type: "status", text: "Still chasing a few stories — almost there." };
      }
      void subtype; // (kept for debugging; we loop on missing beats regardless)
    }

    const fileCount = await finalize(editionId, dir);
    yield { type: "done", fileCount };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    await db.update(editions).set({ status: "failed" }).where(eq(editions.id, editionId));
  }
}

/** Append-only debug logger → <dir>/debug.log. `tail -f` it to watch the agents. */
function makeLogger(dir: string) {
  const file = path.join(dir, "debug.log");
  return async (line: string) => {
    try {
      await writeFile(file, line.endsWith("\n") ? line : line + "\n", { flag: "a" });
    } catch {
      /* logging must never break the run */
    }
  };
}

/**
 * Log one SDK message in a readable, greppable form. Tags subagent activity via
 * parent_tool_use_id so you can tell the lead from the per-beat collectors.
 */
async function logMessage(log: (l: string) => Promise<void>, message: unknown): Promise<void> {
  const m = message as {
    type?: string;
    parent_tool_use_id?: string | null;
    subtype?: string;
    message?: { content?: unknown };
    is_error?: boolean;
  };
  const who = m.parent_tool_use_id ? `sub:${m.parent_tool_use_id.slice(-6)}` : "lead";

  if (m.type === "assistant") {
    const content = m.message?.content;
    if (Array.isArray(content)) {
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "text" && String(b.text).trim()) {
          await log(`[${who}] TEXT ${String(b.text).replace(/\s+/g, " ").slice(0, 240)}`);
        } else if (b.type === "tool_use") {
          const name = String(b.name);
          const input = b.input as Record<string, unknown>;
          const detail =
            name === "Bash"
              ? String(input.command ?? "")
              : name === "Write" || name === "Edit"
                ? String(input.file_path ?? input.path ?? "")
                : name === "Agent" || name === "Task"
                  ? String(input.description ?? input.subagent_type ?? "spawn")
                  : JSON.stringify(input).slice(0, 160);
          await log(`[${who}] TOOL ${name} → ${detail.slice(0, 200)}`);
        }
      }
    }
  } else if (m.type === "user") {
    // tool results
    const content = (m.message?.content ?? []) as Array<Record<string, unknown>>;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === "tool_result") {
          const txt = JSON.stringify(b.content).replace(/\s+/g, " ").slice(0, 220);
          await log(`[${who}] RESULT ${b.is_error ? "❌ " : ""}${txt}`);
        }
      }
    }
  } else if (m.type === "system" && m.subtype) {
    await log(`[${who}] SYSTEM ${m.subtype}`);
  }
}

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: string; [k: string]: unknown };

/**
 * Translate an assistant message's content blocks into reader-facing events.
 * NOTHING technical leaks: tool calls become "reading <source>" / "<beat> desk";
 * the agent's own text becomes a short friendly note. We dedupe sources & beats.
 */
function* friendlyEventsFromBlocks(
  message: unknown,
  seenSources: Set<string>,
  seenBeats: Set<string>,
): Generator<CollectionEvent> {
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(content)) return;

  for (const raw of content as Block[]) {
    if (raw.type === "text") {
      const note = friendlyNote(String((raw as { text: string }).text));
      if (note) yield { type: "note", text: note };
      continue;
    }
    if (raw.type === "tool_use") {
      const name = (raw as { name: string }).name;
      const input = (raw as { input: Record<string, unknown> }).input ?? {};

      // Spawning a per-beat desk (Agent tool).
      if (name === "Agent" || name === "Task") {
        const beat = beatFromText(JSON.stringify(input));
        if (beat && !seenBeats.has(beat)) {
          seenBeats.add(beat);
          yield { type: "beat", beat };
        }
        continue;
      }

      // Driving the browser (Bash → chrome-cli) — pull the URL → friendly source.
      if (name === "Bash") {
        const cmd = String(input.command ?? "");
        const url = (cmd.match(/--url\s+(\S+)/) ?? [])[1];
        if (url) {
          const src = sourceFromUrl(url.replace(/^["']|["']$/g, ""));
          if (src && !seenSources.has(src)) {
            seenSources.add(src);
            yield { type: "reading", source: src };
          }
        } else if (/chrome-cli/.test(cmd) && !seenSources.has("__orienting__")) {
          // First browser command before any page opens — show life in the feed.
          seenSources.add("__orienting__");
          yield { type: "note", text: "Settling into the newsroom and warming up the browser." };
        }
        continue;
      }

      // Writing a beat file → "filed".
      if (name === "Write" || name === "Edit") {
        const fp = String(input.file_path ?? input.path ?? "");
        const m = fp.match(/collected\/([a-z0-9-]+)\.md/i);
        if (m) {
          const beat = m[1].replace(/-/g, " ");
          yield { type: "filed", beat };
        }
        continue;
      }
    }
  }
}

/**
 * A short, friendly one-liner from the agent's own prose — or null to skip.
 * The reader is non-technical: drop ANYTHING that reads like debugging, tooling,
 * code, errors, or system internals. Only warm, news-flavored notes survive.
 */
const TECH_VOCAB =
  /chrome-cli|tabid|\bjson\b|backendnodeid|\bdom\b|\bcli\b|http[s]?:\/\/|\bstatus\b|inflight|in.?flight|enqueu|dispatch|pending|queue|\bok:\s*true|\bcommand(s)?\b|extension|server|timed?.?out|timeout|retry|debug|error|fail|stuck|diagnos|smoke.?test|loop|fetch|api|endpoint|\bnull\b|\bundefined\b|stderr|stdout|exit code|`[^`]*`|\bnav(igat)?e\b|selector|scroll|click|evaluate/i;

function friendlyNote(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.includes("`")) return null; // any code/backtick = technical, drop it
  if (TECH_VOCAB.test(t)) return null;
  // Take the first sentence, cap length.
  const first = t.split(/(?<=[.!?])\s/)[0];
  const out = first.length > 130 ? first.slice(0, 127).replace(/\s\S*$/, "") + "…" : first;
  return out.length > 12 ? out : null;
}

/** Map free text → a known beat name (for the "desk" lines). */
function beatFromText(s: string): string | null {
  const t = s.toLowerCase();
  if (/top.?stor|breaking|front page|lead/.test(t)) return "Top Stories";
  if (/market|finance|stock|crypto|money/.test(t)) return "Markets";
  if (/tech|\bai\b|agent|startup|hacker news/.test(t)) return "AI & Agents";
  if (/cultur|arts|music|film|food/.test(t)) return "Culture";
  if (/local|city|neighborhood/.test(t)) return "Local";
  if (/surprise|wildcard|reddit|trending/.test(t)) return "Surprise Me";
  if (/world|politic|geopolit|global/.test(t)) return "World & Politics";
  return null;
}

/** How many collected/<beat>.md files exist so far. */
async function beatFileCount(dir: string): Promise<number> {
  try {
    const files = await readdir(path.join(dir, "collected"));
    return files.filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Count what the agents wrote and flip the edition to "printing". Ensures a
 * CLAUDE.md exists (writes a minimal fallback if the agent didn't make one).
 */
async function finalize(editionId: string, dir: string): Promise<number> {
  let files: string[] = [];
  try {
    files = await readdir(path.join(dir, "collected"));
  } catch {
    files = [];
  }
  const beatFiles = files.filter((f) => f.endsWith(".md"));

  // Fallback index if the lead didn't write one.
  const hasIndex = await readdir(dir)
    .then((entries) => entries.includes("CLAUDE.md"))
    .catch(() => false);
  if (!hasIndex) {
    const list = beatFiles.map((f) => `- collected/${f}`).join("\n");
    await writeFile(
      path.join(dir, "CLAUDE.md"),
      `# Collected news for this edition\n\nBeat files written by the Research Desk:\n\n${list || "(none)"}\n\nWriter agents: read each file under collected/ and write the paper from these.\n`,
    );
  }

  await db.update(editions).set({ status: "printing" }).where(eq(editions.id, editionId));
  return beatFiles.length;
}
