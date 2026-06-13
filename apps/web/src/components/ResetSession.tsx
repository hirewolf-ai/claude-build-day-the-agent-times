"use client";

import { clearSession } from "@/app/actions";

/**
 * Bottom-left control on the paper: clears the session (deletes the row + cookie)
 * and returns to onboarding. Lucide `refresh-cw` icon.
 */
export function ResetSession() {
  return (
    <form action={clearSession} className="fixed bottom-5 left-5 z-20">
      <button
        type="submit"
        title="Clear session & start over"
        aria-label="Clear session and start over"
        className="group flex h-10 w-10 items-center justify-center rounded-full border border-border bg-panel text-muted transition hover:border-accent hover:text-accent"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[18px] w-[18px] transition-transform duration-500 group-hover:rotate-180"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </button>
    </form>
  );
}
