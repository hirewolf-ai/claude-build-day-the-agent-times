"use client";

import { useEffect, useState } from "react";
import type { FeedLine, PaperStage } from "./mockEdition";

export type RunState = "idle" | "running" | "done";

/**
 * Connects to an edition's event stream by id and renders it for a NON-TECHNICAL
 * reader: warm newsroom lines — sources being read, desks at work, gentle
 * reasoning. Replays buffered events then tails live ones, so a page refresh
 * reconnects to the same run. Nothing technical is shown.
 */
export function useEditionEvents(editionId: string) {
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [stage, setStage] = useState<PaperStage>("blank");
  const [state, setState] = useState<RunState>("idle");

  useEffect(() => {
    if (!editionId) return;
    // Reconnect cleanly every time the edition changes (and survive Strict Mode's
    // dev double-mount — the abort below just cancels the throwaway first mount).
    setLines([]);
    setStage("blank");
    setState("running");

    const controller = new AbortController();
    const push = (line: FeedLine) => setLines((prev) => [...prev, line]);

    (async () => {
      try {
        const res = await fetch(`/api/editions/${editionId}/events`, {
          signal: controller.signal,
        });
        if (!res.body) throw new Error("no stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }

            switch (ev.type) {
              case "personalize":
                setStage("masthead");
                push({
                  agent: "researcher",
                  text: ev.handle
                    ? `Getting to know you from @${ev.handle} — tailoring today's edition…`
                    : "Tailoring today's edition to you…",
                });
                break;
              case "status":
                setStage((s) => (s === "blank" ? "masthead" : s));
                push({ agent: "researcher", text: String(ev.text) });
                break;
              case "reading":
                setStage((s) => (s === "masthead" || s === "blank" ? "lead" : s));
                push({ agent: "researcher", text: `Reading ${ev.source}…` });
                break;
              case "beat":
                setStage((s) => (s === "lead" ? "columns" : s));
                push({ agent: "design", text: `The ${ev.beat} desk is on it.` });
                break;
              case "note": {
                const text = String(ev.text ?? "").trim();
                if (text) push({ agent: "researcher", text });
                break;
              }
              case "filed":
                setStage("columns");
                push({ agent: "columnist", text: `${cap(String(ev.beat))} is filed.`, done: true });
                break;
              case "done":
                setStage("done");
                push({
                  agent: "design",
                  text: "Today's edition is in. Enjoy your coffee. ☕",
                  done: true,
                });
                break;
              case "error":
                push({
                  agent: "design",
                  text: "We hit a snag gathering the news — hang tight.",
                  done: true,
                });
                break;
              case "end":
                setStage((s) => (s === "done" ? s : "done"));
                setState("done");
                break;
            }
          }
        }
        // Stream closed.
        setState((s) => (s === "done" ? s : "done"));
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          push({ agent: "design", text: "The newsroom lost its connection — try again?", done: true });
          setState("done");
        }
      }
    })();

    return () => controller.abort();
  }, [editionId]);

  return { lines, stage, state };
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
