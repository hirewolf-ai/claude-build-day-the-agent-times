"use client";

import { useEffect, useRef } from "react";
import { AGENT_META, type FeedLine } from "@/lib/mockEdition";
import type { RunState } from "@/lib/useEditionBuild";

export function AgentFeed({
  lines,
  state,
}: {
  lines: FeedLine[];
  state: RunState;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest activity in view as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  const running = state === "running";

  return (
    <div className="flex h-full flex-col">
      {/* Activity stream — no header; the live progress IS the story. */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {lines.map((line, i) => (
          <FeedRow key={i} line={line} latest={i === lines.length - 1 && running} />
        ))}
        {lines.length === 0 && (
          <p className="mt-6 text-sm italic text-muted">Warming up the presses…</p>
        )}
      </div>

      {/* Steering input — disabled while agents work */}
      <div className="border-t border-border p-4">
        <div
          className={`rounded-xl border border-border bg-panel px-4 py-3 transition ${
            running ? "opacity-50" : "opacity-100"
          }`}
        >
          <input
            disabled={running}
            placeholder={
              running ? "Steering unlocks once it's printed…" : "Tweak it — “make Markets spicier”"
            }
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
}

function FeedRow({ line, latest }: { line: FeedLine; latest: boolean }) {
  const meta = AGENT_META[line.agent];
  return (
    <div className="animate-[fadein_0.4s_ease] text-sm">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{
            background: line.done ? "transparent" : meta.color,
            border: line.done ? `2px solid ${meta.color}` : "none",
            boxShadow: latest && !line.done ? `0 0 8px ${meta.color}` : "none",
          }}
        />
        <div className="min-w-0">
          <p className={line.done ? "text-foreground/70" : "text-foreground"}>
            {line.done && <span className="mr-1 text-[#7a9e7e]">✓</span>}
            {line.text}
          </p>
          {line.sub && (
            <p className="mt-0.5 truncate font-mono text-xs text-muted">{line.sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}
