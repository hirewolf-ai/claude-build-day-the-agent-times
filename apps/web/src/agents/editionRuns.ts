import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { editions } from "@/db/schema";
import { runCollection, type CollectionEvent } from "./runCollection";
import { runPrinting, type PrintEvent } from "./runPrinting";

/**
 * In-memory registry of running/finished edition collections, keyed by editionId.
 * Decouples the agent run from any single HTTP request: the run starts ONCE, its
 * events are buffered, and any number of consumers (a fresh page load, a refresh)
 * can replay the buffer + tail live events by edition id.
 *
 * Survives across requests within one server process (fine for the hackathon /
 * single-instance deploy). Not shared across instances — that'd need Redis.
 */

type Listener = (ev: StoredEvent) => void;

export type StoredEvent =
  | CollectionEvent
  | PrintEvent
  | { type: "phase"; phase: "collecting" | "printing" }
  | { type: "cost"; usd: number; total?: boolean }
  | { type: "end" };

type Run = {
  editionId: string;
  events: StoredEvent[];
  done: boolean;
  listeners: Set<Listener>;
};

// Reuse across hot reloads in dev.
const g = globalThis as unknown as { _atRuns?: Map<string, Run> };
const runs: Map<string, Run> = g._atRuns ?? new Map();
if (process.env.NODE_ENV !== "production") g._atRuns = runs;

/** Start the collection for an edition if it isn't already running. Idempotent. */
export function startEditionRun(
  editionId: string,
  prompt: string,
  reader?: Parameters<typeof runCollection>[2],
): void {
  if (runs.has(editionId)) return;
  const run: Run = { editionId, events: [], done: false, listeners: new Set() };
  runs.set(editionId, run);

  (async () => {
    let totalCost = 0;
    try {
      // Phase 1 — gather the news.
      emit(run, { type: "phase", phase: "collecting" });
      let collected = 0;
      for await (const ev of runCollection(editionId, prompt, reader)) {
        if (ev.type === "done") collected = ev.fileCount;
        if (ev.type === "cost") totalCost += ev.usd;
        emit(run, ev);
      }

      // Phase 2 — print the paper (auto handoff). Skip only if collection
      // produced nothing to print.
      if (collected > 0) {
        emit(run, { type: "phase", phase: "printing" });
        for await (const ev of runPrinting(editionId)) {
          if (ev.type === "cost") totalCost += ev.usd;
          emit(run, ev);
        }
      }
    } catch (err) {
      emit(run, { type: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      // Persist + announce the total cost of both agents.
      if (totalCost > 0) {
        const usd = Number(totalCost.toFixed(2));
        emit(run, { type: "cost", usd, total: true } as StoredEvent);
        await db
          .update(editions)
          .set({ costUsd: String(usd) })
          .where(eq(editions.id, editionId))
          .catch(() => {});
      }
      run.done = true;
      emit(run, { type: "end" });
    }
  })();
}

function emit(run: Run, ev: StoredEvent) {
  run.events.push(ev);
  for (const l of run.listeners) {
    try {
      l(ev);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Subscribe to an edition's events: synchronously replays everything buffered so
 * far, then streams live ones. Returns an unsubscribe fn. If the run is already
 * finished, you still get the full replay (ending with the "end" event).
 */
export function subscribe(
  editionId: string,
  onEvent: (ev: StoredEvent) => void,
): () => void {
  const run = runs.get(editionId);
  if (!run) {
    // Unknown edition — emit an end so the consumer doesn't hang.
    onEvent({ type: "error", message: "This edition isn't being collected." });
    onEvent({ type: "end" });
    return () => {};
  }
  // Replay buffered events first.
  for (const ev of run.events) onEvent(ev);
  if (run.done) return () => {};
  // Then tail live ones.
  run.listeners.add(onEvent);
  return () => run.listeners.delete(onEvent);
}

export function isRunning(editionId: string): boolean {
  const run = runs.get(editionId);
  return !!run && !run.done;
}
