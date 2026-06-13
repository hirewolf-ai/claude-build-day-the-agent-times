import "server-only";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { db } from "@/db";
import { editions } from "@/db/schema";
import { PRINTING_PROMPT } from "./printingPrompt";

export type PrintEvent =
  | { type: "status"; text: string }
  | { type: "note"; text: string }
  | { type: "section"; html: string; name: string } // a story, streamed live
  | { type: "done"; ok: boolean }
  | { type: "error"; message: string };

/**
 * Printing phase (Step 2). The Design Desk reads the collected MDs and writes the
 * paper one <article> at a time into sections/. We WATCH that folder and stream
 * each section the moment it lands, so the reader sees the paper assemble live
 * with cinematic motion. No browser — just Read/Write over the workspace.
 */
export async function* runPrinting(editionId: string): AsyncGenerator<PrintEvent> {
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  const dir = edition?.workspaceDir;
  if (!dir) {
    yield { type: "error", message: "No workspace for this edition." };
    return;
  }

  const sectionsDir = path.join(dir, "sections");
  await mkdir(sectionsDir, { recursive: true });
  yield { type: "status", text: "The Design Desk is laying out the front page…" };

  const emitted = new Set<string>();

  // Drain any complete section files that aren't already emitted, in name order.
  async function* drainSections(): AsyncGenerator<PrintEvent> {
    let names: string[] = [];
    try {
      names = (await readdir(sectionsDir)).filter((n) => n.endsWith(".html")).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (emitted.has(name)) continue;
      const html = await readFile(path.join(sectionsDir, name), "utf8").catch(() => "");
      // Only stream once the article looks closed (avoid a half-written file).
      if (html.includes("</article>")) {
        emitted.add(name);
        yield { type: "section", html, name };
      }
    }
  }

  try {
    const q = query({
      prompt:
        `Lay out today's edition. Read reader-profile.md and every file under ` +
        `collected/, then write the front page one story at a time into ` +
        `${sectionsDir}/ (01-lead.html first, then 02.html, 03.html, …). ` +
        `The workspace is the current directory.`,
      options: {
        model: "claude-opus-4-8",
        systemPrompt: PRINTING_PROMPT,
        cwd: dir,
        allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
        disallowedTools: ["WebFetch", "WebSearch", "Bash"], // no browser/shell in printing
        permissionMode: "bypassPermissions",
        env: { ...process.env, API_TIMEOUT_MS: "1800000" },
      },
    });

    for await (const message of q) {
      // Whenever the agent finishes a tool turn, check for new section files.
      yield* drainSections();
      if (message.type === "assistant") {
        const text = textOf(message);
        if (text) yield { type: "note", text: trim(text) };
      }
    }

    // Final sweep for anything written right at the end.
    yield* drainSections();

    if (emitted.size === 0) {
      yield { type: "error", message: "The edition didn't come out — no sections written." };
      await db.update(editions).set({ status: "failed" }).where(eq(editions.id, editionId));
      return;
    }

    await db.update(editions).set({ status: "ready" }).where(eq(editions.id, editionId));
    yield { type: "done", ok: true };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    await db.update(editions).set({ status: "failed" }).where(eq(editions.id, editionId));
  }
}

/** Concatenate all section files into the full edition HTML (for re-render/refresh). */
export async function readEditionHtml(editionId: string): Promise<string | null> {
  const [edition] = await db.select().from(editions).where(eq(editions.id, editionId)).limit(1);
  if (!edition?.workspaceDir) return null;
  const sectionsDir = path.join(edition.workspaceDir, "sections");
  try {
    const names = (await readdir(sectionsDir)).filter((n) => n.endsWith(".html")).sort();
    const parts = await Promise.all(
      names.map((n) => readFile(path.join(sectionsDir, n), "utf8").catch(() => "")),
    );
    const html = parts.filter((p) => p.includes("</article>")).join("\n");
    return html || null;
  } catch {
    return null;
  }
}

function textOf(message: unknown): string {
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("")
      .trim();
  }
  return "";
}

function trim(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? t.slice(0, 137).replace(/\s\S*$/, "") + "…" : t;
}
