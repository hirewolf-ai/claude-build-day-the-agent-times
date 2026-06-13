import { eq } from "drizzle-orm";
import { db } from "@/db";
import { editions } from "@/db/schema";
import { locationById, localTimeFor } from "@/lib/profile";
import { getCurrentUser } from "@/lib/users";
import { readEditionHtml } from "@/agents/runPrinting";
import { Masthead } from "@/components/Masthead";

/** Full-page view of a finished edition — the whole paper, clean, no newsroom. */
export default async function EditionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [edition] = await db.select().from(editions).where(eq(editions.id, id)).limit(1);
  const html = await readEditionHtml(id);

  const user = await getCurrentUser();
  const tz = user ? (locationById(user.location)?.tz ?? "UTC") : "UTC";
  const dateline = localTimeFor(tz, user?.name ?? "").dateline;

  const lead = extractLead(html ?? "");
  const cols = (html ?? "").replace(lead, "");

  return (
    <div className="paper min-h-screen bg-[#f7f4ee] px-6 py-10 text-[#1a1a1a] sm:px-10">
      <div className="edition mx-auto max-w-5xl">
        <div className="relative border-b-[3px] border-double border-[#1a1a1a] pb-4">
          {edition?.costUsd && (
            <div className="absolute left-0 top-0 hidden border-[1.5px] border-[#1a1a1a] px-2.5 py-1 text-center font-serif leading-none text-[#1a1a1a] sm:block">
              <div className="text-[10px] font-bold tracking-[0.12em]">PRICE</div>
              <div className="mt-0.5 text-[13px] font-bold">${edition.costUsd}</div>
            </div>
          )}
          {/* Close — back to the live builder for this edition */}
          <a
            href={`/read?e=${id}`}
            title="Back"
            className="absolute right-0 top-1.5 hidden font-serif text-[12px] uppercase tracking-wide text-[#1a1a1a] transition hover:text-[#b5471f] sm:block"
          >
            Close
          </a>
          <Masthead size="text-4xl sm:text-6xl" className="text-[#1a1a1a]" />
          <p className="mt-2 text-center font-serif text-xs uppercase tracking-[0.2em] text-[#5a554c]">
            {dateline} · Written by Agents
          </p>
        </div>

        {html ? (
          <>
            <div className="mt-8" dangerouslySetInnerHTML={{ __html: lead }} />
            <div className="columns mt-9 border-t border-[#cfc9bb] pt-8" dangerouslySetInnerHTML={{ __html: cols }} />
          </>
        ) : (
          <p className="mt-12 text-center font-serif italic text-[#8a8478]">
            This edition isn&apos;t ready yet.
          </p>
        )}
      </div>
    </div>
  );
}

/** Pull the lead <article> out so it renders full-width above the column grid. */
function extractLead(html: string): string {
  const m = html.match(/<article class="lead"[\s\S]*?<\/article>/i);
  return m ? m[0] : "";
}
