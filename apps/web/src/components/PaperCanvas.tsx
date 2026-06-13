"use client";

import { useEffect, useState } from "react";
import { Masthead } from "@/components/Masthead";
import { MOCK_COLUMNS, MOCK_LEAD, type Story } from "@/lib/mockPaper";
import type { PaperStage } from "@/lib/mockEdition";

const order: PaperStage[] = ["blank", "masthead", "lead", "columns", "done"];
const reached = (stage: PaperStage, target: PaperStage) =>
  order.indexOf(stage) >= order.indexOf(target);

export function PaperCanvas({
  dateline,
  sections,
  cost,
  editionId,
  done = false,
}: {
  dateline: string;
  stage?: PaperStage;
  sections?: { name: string; html: string }[];
  cost?: number | null;
  editionId?: string;
  done?: boolean;
}) {
  // Masthead fades in on mount — the paper looks alive from the first frame.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Fallback: if the live stream didn't give a cost (e.g. reconnecting to a
  // finished edition), pull the saved cost from the DB.
  const [savedCost, setSavedCost] = useState<number | null>(null);
  useEffect(() => {
    if (cost != null || !editionId) return;
    let alive = true;
    fetch(`/api/editions/${editionId}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.costUsd === "number") setSavedCost(d.costUsd);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [cost, editionId, done]);
  const shownCost = cost ?? savedCost;

  // Split the printed sections into the lead (full width) and the rest (grid).
  const printed = sections ?? [];
  const lead = printed.find((s) => /lead/i.test(s.name)) ?? printed[0];
  const cols = printed.filter((s) => s !== lead);
  const hasPrinted = printed.length > 0;

  return (
    <div className="paper h-full overflow-y-auto bg-[#f7f4ee] px-6 py-10 text-[#1a1a1a] sm:px-10">
      <div className="edition mx-auto max-w-5xl">
        {/* Masthead — always present, cinematic fade-in on mount */}
        <div className={`scene ${mounted ? "opacity-100" : "opacity-0 translate-y-3"} transition-all duration-1000`}>
          <div className="relative border-b-[3px] border-double border-[#1a1a1a] pb-4">
            {/* Price stamp (left) — boxed, vintage "PRICE / 10c" style. Only
                appears once the whole edition is done and we have a cost. */}
            {shownCost != null && (
              <div className="absolute left-0 top-0 hidden border-[1.5px] border-[#1a1a1a] px-2.5 py-1 text-center font-serif leading-none text-[#1a1a1a] sm:block">
                <div className="text-[10px] font-bold tracking-[0.12em]">PRICE</div>
                <div className="mt-0.5 text-[13px] font-bold">${shownCost.toFixed(2)}</div>
              </div>
            )}

            {/* Full edition (right) — plain clickable text */}
            {(done || savedCost != null) && editionId && (
              <a
                href={`/edition/${editionId}`}
                title="Read the full edition"
                className="absolute right-0 top-1.5 hidden font-serif text-[12px] uppercase tracking-wide text-[#1a1a1a] transition hover:text-[#b5471f] sm:block"
              >
                Full edition
              </a>
            )}

            <Masthead size="text-4xl sm:text-6xl" className="text-[#1a1a1a]" />
            <p className="mt-2 text-center font-serif text-xs uppercase tracking-[0.2em] text-[#5a554c]">
              {dateline || "Today's Edition"} · Written by Agents
            </p>
          </div>
        </div>

        {/* Lead — printed story fades in, else skeleton */}
        <div className="relative mt-8">
          {lead ? (
            <Section key={lead.name} html={lead.html} />
          ) : (
            <SkeletonLead />
          )}
        </div>

        {/* Columns — printed stories fade in as they arrive (CSS .columns grids them) */}
        {hasPrinted ? (
          <div className="columns mt-9 border-t border-[#cfc9bb] pt-8">
            {cols.map((s) => (
              <Section key={s.name} html={s.html} />
            ))}
          </div>
        ) : (
          <div className="mt-9 grid grid-cols-1 gap-x-8 gap-y-8 border-t border-[#cfc9bb] pt-8 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonColumn key={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Render one streamed HTML section. `display:contents` so the agent's <article>
 * becomes the real grid child; the CSS keyframe `printin` fades it in.
 */
function Section({ html }: { html: string }) {
  return (
    <div
      style={{ display: "contents" }}
      className="print-section"
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
