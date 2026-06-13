"use client";

import { useEffect, useRef, useState } from "react";
import { Masthead } from "@/components/Masthead";
import { BuilderView } from "@/components/BuilderView";

const SECTIONS = [
  { label: "Top Stories", icon: "★", prompt: "The biggest stories of the day." },
  { label: "Tech & Agents", icon: "⌘", prompt: "What's happening in AI and agents." },
  { label: "Markets", icon: "$", prompt: "Markets, money, and what moved." },
  { label: "Culture", icon: "✎", prompt: "Culture, ideas, and the conversation." },
  { label: "Surprise me", icon: "✦", prompt: "" },
];

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

type Phase = "entry" | "builder";

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("entry");
  const [leaving, setLeaving] = useState(false); // entry is exiting
  const [submitted, setSubmitted] = useState(""); // the prompt we actually ran with
  const [hello, setHello] = useState("Good morning, Aykut");
  const [dateline, setDateline] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHello(greeting("Aykut"));
    setDateline(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
    // Dev/demo deep-link: ?build=... jumps straight into the builder.
    const q = new URLSearchParams(window.location.search).get("build");
    if (q !== null) {
      setSubmitted(q);
      setPhase("builder");
      return;
    }
    textareaRef.current?.focus();
  }, []);

  function startEdition(seed?: string) {
    const topic = (seed ?? prompt).trim();
    setSubmitted(topic);
    setLeaving(true); // fade the entry scene out
    // After the crossfade, swap to the builder scene (which auto-plays the build).
    window.setTimeout(() => setPhase("builder"), 600);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startEdition();
    }
  }

  const entering = phase === "builder";

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/* ENTRY SCENE */}
      {phase === "entry" && (
        <div
          className={`scene flex min-h-screen flex-col items-center justify-center px-6 ${
            leaving ? "scene-hidden entry-exit" : ""
          }`}
        >
          <div className="w-full max-w-2xl">
            <Masthead className="mb-3" />
            <p className="mb-9 text-center font-serif text-base italic text-muted">
              {dateline} · {hello}
            </p>

            {/* Prompt box */}
            <div className="rounded-2xl border border-border bg-panel shadow-2xl shadow-black/30">
              <div className="px-5 pb-3 pt-4">
                <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                  The Agent Times · Today&apos;s edition
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
      )}

      {/* BUILDER SCENE */}
      {phase === "builder" && (
        <div className={`scene ${entering ? "builder-enter" : "builder-enter-from"}`}>
          <BuilderView prompt={submitted} active={entering} dateline={dateline} />
        </div>
      )}
    </div>
  );
}
