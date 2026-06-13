"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Masthead } from "@/components/Masthead";
import { BuilderView } from "@/components/BuilderView";
import { ResetSession } from "@/components/ResetSession";

const SECTIONS = [
  { label: "Top Stories", icon: "★", prompt: "The biggest stories of the day." },
  { label: "AI & Agents", icon: "⌘", prompt: "What's happening in AI and agents." },
  { label: "Markets", icon: "$", prompt: "Markets, money, and what moved." },
  { label: "Culture", icon: "✎", prompt: "Culture, ideas, and the conversation." },
  // Quick-test mode: a fast single-pass (X + TechCrunch only, one file) so we can
  // iterate on the pipeline without a full ~5-min edition.
  { label: "Surprise me", icon: "✦", prompt: "__quick__" },
];

/**
 * The reader-facing paper. Entry state shows the prompt box; when `?q=` is set,
 * we crossfade into the builder. Greeting/dateline/clock come from the server
 * (the reader's chosen city), but we re-tick the clock on the client.
 */
export function ReadView({
  greeting,
  dateline: serverDateline,
  clock: serverClock,
}: {
  greeting: string;
  dateline: string;
  clock: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const editionId = params.get("e"); // /read?e=<editionId> — reconnectable
  const inBuilder = editionId !== null;

  const [prompt, setPrompt] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [clock, setClock] = useState(serverClock);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!inBuilder) textareaRef.current?.focus();
  }, [inBuilder]);

  // Light client tick so the displayed time doesn't go stale.
  useEffect(() => {
    const id = window.setInterval(() => {
      setClock(
        new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date()),
      );
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  async function startEdition(seed?: string) {
    const topic = (seed ?? prompt).trim();
    setLeaving(true);
    // Kick off the run, get the edition id, then route to it. The question is
    // saved server-side on the editions row; the URL only carries the id.
    try {
      const res = await fetch("/api/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: topic }),
      });
      const { editionId: id } = (await res.json()) as { editionId: string };
      router.push(`/read?e=${id}`);
    } catch {
      setLeaving(false); // let them retry
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startEdition();
    }
  }

  if (inBuilder) {
    return (
      <div className="scene builder-enter">
        <BuilderView editionId={editionId!} dateline={serverDateline} />
      </div>
    );
  }

  return (
    <div
      className={`scene flex min-h-screen flex-col items-center justify-center px-6 ${
        leaving ? "scene-hidden entry-exit" : ""
      }`}
    >
      <ResetSession />
      <div className="w-full max-w-2xl">
        <Masthead className="mb-3" />
        <p className="mb-9 text-center font-serif text-base italic text-muted">
          {greeting} · {serverDateline}
          {clock ? ` · ${clock}` : ""}
        </p>

        {/* Prompt box */}
        <div className="rounded-2xl border border-border bg-panel shadow-2xl shadow-black/30">
          <div className="px-5 pb-3 pt-4">
            <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
              Today&apos;s edition
            </p>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="What would you like to read?"
              className="w-full resize-none bg-transparent text-lg leading-relaxed text-foreground outline-none placeholder:text-muted"
            />
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-3">
            <span className="text-sm text-muted">Leave it blank for a general edition.</span>
            <button
              onClick={() => startEdition()}
              className="flex items-center gap-2 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-[#1c1b19] transition hover:opacity-90"
            >
              Read ↵
            </button>
          </div>
        </div>

        {/* Section chips */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {SECTIONS.map((s) => (
            <button
              key={s.label}
              onClick={() => {
                setPrompt(s.prompt);
                startEdition(s.prompt);
              }}
              className="flex items-center gap-2 rounded-full border border-border bg-panel px-4 py-2 text-sm text-foreground/90 transition hover:bg-panel-hover"
            >
              <span className="text-accent">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-muted">
          Written by agents. Collected live. Served fresh with your coffee.
        </p>
      </div>
    </div>
  );
}
