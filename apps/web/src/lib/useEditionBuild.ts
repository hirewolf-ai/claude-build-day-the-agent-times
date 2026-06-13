"use client";

import { useEffect, useRef, useState } from "react";
import { buildEditionScript, type FeedLine, type PaperStage } from "./mockEdition";

export type RunState = "idle" | "running" | "done";

/**
 * Plays the mock edition script: emits feed lines on a timeline and advances the
 * paper-build stage. Returns everything the builder UI needs to render.
 *
 * When the real backend lands, swap the timeout-driven loop for a stream
 * (SSE/WebSocket) from the-agent-times-agents — the shape (lines + stage) stays.
 */
export function useEditionBuild(prompt: string, active: boolean) {
  const [lines, setLines] = useState<FeedLine[]>([]);
  const [stage, setStage] = useState<PaperStage>("blank");
  const [state, setState] = useState<RunState>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!active) return;
    setLines([]);
    setStage("blank");
    setState("running");

    const beats = buildEditionScript(prompt);
    let t = 0;
    beats.forEach((beat) => {
      t += beat.delay;
      const id = setTimeout(() => {
        if (beat.line) setLines((prev) => [...prev, beat.line!]);
        if (beat.stage) setStage(beat.stage);
      }, t);
      timers.current.push(id);
    });

    const endId = setTimeout(() => setState("done"), t + 400);
    timers.current.push(endId);

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // Re-run only when activation flips or the prompt changes.
  }, [active, prompt]);

  return { lines, stage, state };
}
