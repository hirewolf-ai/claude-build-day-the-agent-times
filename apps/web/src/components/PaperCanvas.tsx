"use client";

import { useEffect, useState } from "react";
import { Masthead } from "@/components/Masthead";
import { MOCK_COLUMNS, MOCK_LEAD, type Story } from "@/lib/mockPaper";
import type { PaperStage } from "@/lib/mockEdition";

const order: PaperStage[] = ["blank", "masthead", "lead", "columns", "done"];
const reached = (stage: PaperStage, target: PaperStage) =>
  order.indexOf(stage) >= order.indexOf(target);

export function PaperCanvas({ stage, dateline }: { stage: PaperStage; dateline: string }) {
  const showLead = reached(stage, "lead");
  const showCols = reached(stage, "columns");
  const settled = stage === "done";

  // Masthead fades in on mount — the paper looks alive from the first frame.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-[#f7f4ee] px-8 py-10 text-[#1a1a1a]">
      <div className="mx-auto max-w-3xl">
        {/* Masthead — always present, cinematic fade-in on mount */}
        <div className={`scene ${mounted ? "opacity-100" : "opacity-0 translate-y-3"} transition-all duration-1000`}>
          <div className="border-b-[3px] border-double border-[#1a1a1a] pb-4">
            <Masthead size="text-4xl sm:text-5xl" className="text-[#1a1a1a]" />
            <p className="mt-2 text-center font-serif text-xs uppercase tracking-[0.2em] text-[#5a554c]">
              {dateline || "Today's Edition"} · Written by Agents
            </p>
          </div>
        </div>

        {/* Lead story */}
        {/* The real edition (printing agents) isn't built yet — show ONLY the
            skeleton paper assembling, never mock headlines. Wire real stories in
            once the printing/columnist phase lands. */}
        <div className="relative mt-8">
          <SkeletonLead />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-x-8 gap-y-8 border-t border-[#d8d2c6] pt-8 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonColumn key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function fade(on: boolean) {
  return `transition-all duration-700 ${on ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`;
}

function LeadBlock({ story }: { story: Story }) {
  return (
    <article>
      <h1 className="font-serif text-3xl font-bold leading-tight sm:text-4xl">
        {story.headline}
      </h1>
      <p className="mt-3 font-serif text-lg leading-relaxed text-[#33312c]">{story.dek}</p>
      <p className="mt-3 text-xs uppercase tracking-wide text-[#8a8478]">
        By {story.byline} · {story.minRead} min read
      </p>
    </article>
  );
}

function ColumnBlock({ story }: { story: Story }) {
  return (
    <article>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#a8612f]">
        {story.desk}
      </p>
      <h2 className="font-serif text-xl font-bold leading-snug">{story.headline}</h2>
      <p className="mt-2 font-serif text-[15px] leading-relaxed text-[#3a382f]">{story.dek}</p>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-[#9a9384]">
        {story.byline} · {story.minRead} min
      </p>
    </article>
  );
}

/** Column appears with its desk label but body still "developing". */
function ColumnShimmer({ story, delay }: { story: Story; delay: number }) {
  return (
    <article style={{ animationDelay: `${delay}ms` }}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#a8612f]">
        {story.desk}
      </p>
      <h2 className="font-serif text-xl font-bold leading-snug text-[#1a1a1a]/80">
        {story.headline}
      </h2>
      <div className="mt-3 space-y-2">
        <Bar w="100%" />
        <Bar w="92%" />
        <Bar w="64%" />
      </div>
    </article>
  );
}

function SkeletonLead() {
  return (
    <div>
      <div className="space-y-3">
        <Bar w="90%" h="h-7" />
        <Bar w="70%" h="h-7" />
      </div>
      <div className="mt-4 space-y-2">
        <Bar w="100%" />
        <Bar w="96%" />
        <Bar w="40%" />
      </div>
    </div>
  );
}

function SkeletonColumn() {
  return (
    <div className="space-y-2">
      <Bar w="40%" h="h-3" />
      <Bar w="85%" h="h-5" />
      <Bar w="100%" />
      <Bar w="70%" />
    </div>
  );
}

function Bar({ w, h = "h-4" }: { w: string; h?: string }) {
  return (
    <div
      className={`${h} animate-pulse rounded bg-[#e3ddd0]`}
      style={{ width: w }}
    />
  );
}
