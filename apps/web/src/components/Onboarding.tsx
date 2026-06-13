"use client";

import { useState } from "react";
import { Masthead } from "@/components/Masthead";
import { EXTENSION_REPO_URL, LOCATIONS } from "@/lib/profile";
import { startReading } from "@/app/actions";

/**
 * First-run onboarding. Collects the reader's name + location and posts to the
 * `startReading` server action (creates the session user, redirects to /read).
 */
export function Onboarding() {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [x, setX] = useState(""); // optional X handle/link

  const ready = name.trim().length > 0 && location.length > 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <form action={startReading} className="w-full max-w-lg">
        <Masthead className="mb-3" size="text-4xl sm:text-5xl" />
        <p className="mb-10 text-center font-serif text-base italic text-muted">
          Your personal newspaper, written by agents. Let&apos;s set up your desk.
        </p>

        <div className="space-y-5 rounded-2xl border border-border bg-panel p-6 shadow-2xl shadow-black/30">
          {/* Name */}
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-muted">
              Your name
            </span>
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What should the byline call you?"
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-foreground outline-none transition focus:border-accent placeholder:text-muted"
            />
          </label>

          {/* Location */}
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-[0.18em] text-muted">
              Where you read it
            </span>
            <select
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={`w-full appearance-none rounded-lg border border-border bg-background px-3.5 py-2.5 outline-none transition focus:border-accent ${
                location ? "text-foreground" : "text-muted"
              }`}
            >
              <option value="" disabled>
                Pick your city…
              </option>
              {LOCATIONS.map((l) => (
                <option key={l.id} value={l.id} className="text-foreground">
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          {/* X handle (optional) — for personalization */}
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted">
              Your 𝕏 <span className="font-sans normal-case tracking-normal text-muted/70">— optional, so we know your taste</span>
            </span>
            <div className="flex items-center rounded-lg border border-border bg-background px-3.5 transition focus-within:border-accent">
              <span className="select-none text-muted">@</span>
              <input
                name="x"
                value={x}
                onChange={(e) => setX(e.target.value)}
                placeholder="aykut  ·  or paste x.com/aykut"
                className="w-full bg-transparent py-2.5 pl-1.5 text-foreground outline-none placeholder:text-muted"
              />
            </div>
          </label>
        </div>

        {/* Extension install step */}
        <div className="mt-5 rounded-2xl border border-border bg-panel/60 p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none">🐌</span>
            <div className="min-w-0">
              <p className="font-serif text-lg leading-tight">Install the newsroom&apos;s browser</p>
              <p className="mt-1 text-sm text-muted">
                The Agent Times reads the live web from your real Chrome. Install the
                extension to let the agents go to work.
              </p>
              <a
                href={EXTENSION_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-accent/50 px-3.5 py-1.5 text-sm text-accent transition hover:bg-accent/10"
              >
                Get the extension ↗
              </a>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={!ready}
          className="mt-6 w-full rounded-full bg-accent px-5 py-3 font-medium text-[#1c1b19] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start the presses →
        </button>
      </form>
    </main>
  );
}
