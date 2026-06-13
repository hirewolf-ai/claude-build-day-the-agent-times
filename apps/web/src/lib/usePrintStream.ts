"use client";

import { useEffect, useState } from "react";
import type { FeedLine } from "./mockEdition";
import type { RunState } from "./useCollectionStream";

/**
 * Connects to /api/editions/<id>/print and streams the printed paper section by
 * section — the Design Desk + columnist subagents writing the front page live.
 * Returns the accumulated section HTML (each fades in) plus the newsroom feed.
 */
export function usePrintStream(editionId: string, enabled: boolean) {
  const [sections, setSections] = useState<{ name: string; html: string }[]>([]);
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [state, setState] = useState<RunState>("idle");

  useEffect(() => {
    if (!editionId || !enabled) return;
    setSections([]);
    setLines([]);
    setState("running");

    const controller = new AbortController();
    const push = (line: FeedLine) => setLines((prev) => [...prev, line]);

    (async () => {
      try {
        const res = await fetch(`/api/editions/${editionId}/print`, { signal: controller.signal });
        if (!res.body) throw new Error("no stream");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        push({ agent: "design", text: "The Design Desk is laying out the front page…" });

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
              case "section":
                setSections((prev) =>
                  prev.some((s) => s.name === ev.name)
                    ? prev
                    : [...prev, { name: String(ev.name), html: String(ev.html) }],
                );
                push({ agent: "columnist", text: friendlyForSection(String(ev.name)), done: true });
                break;
              case "note": {
                const t = String(ev.text ?? "").trim();
                if (t && !/```|<article|class=|\.html/.test(t)) push({ agent: "design", text: t });
                break;
              }
              case "status":
                push({ agent: "design", text: String(ev.text) });
                break;
              case "done":
                push({ agent: "design", text: "The edition is printed. ☕", done: true });
                break;
              case "error":
                push({ agent: "design", text: "Trouble at the print desk — hang tight.", done: true });
                break;
              case "end":
                setState("done");
                break;
            }
          }
        }
        setState("done");
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          push({ agent: "design", text: "Lost the print feed — try again?", done: true });
          setState("done");
        }
      }
    })();

    return () => controller.abort();
  }, [editionId, enabled]);

  return { sections, lines, state };
}

function friendlyForSection(name: string): string {
  if (/lead/i.test(name)) return "The lead story is set.";
  return "Another story is filed.";
}
