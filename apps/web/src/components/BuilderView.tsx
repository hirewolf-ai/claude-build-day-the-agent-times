"use client";

import { AgentFeed } from "@/components/AgentFeed";
import { PaperCanvas } from "@/components/PaperCanvas";
import { useEditionEvents } from "@/lib/useCollectionStream";
import { usePrintStream } from "@/lib/usePrintStream";

/**
 * The builder workspace: left 30% = newsroom feed, right 70% = the paper.
 * Two modes:
 *  - collection (default): watch the news being gathered.
 *  - print (?print=true): watch the Design Desk lay out the front page live,
 *    section by section, rendering each into the paper with cinematic motion.
 */
export function BuilderView({
  editionId,
  dateline,
  printOnly = false,
}: {
  editionId: string;
  dateline: string;
  printOnly?: boolean;
}) {
  const collection = useEditionEvents(editionId, !printOnly);
  const printing = usePrintStream(editionId, printOnly);

  const lines = printOnly ? printing.lines : collection.lines;
  const state = printOnly ? printing.state : collection.state;
  // Sections come from whichever stream is active: the unified collect→print
  // stream (default) or the print-only stream (&print=true).
  const sections = printOnly ? printing.sections : collection.sections;

  return (
    <div className="flex h-screen w-full">
      {/* Left 30% — the newsroom */}
      <aside className="w-[30%] min-w-[300px] max-w-[460px] border-r border-border bg-background">
        <AgentFeed lines={lines} state={state} />
      </aside>

      {/* Right 70% — the paper */}
      <main className="flex-1 bg-[#f7f4ee]">
        <PaperCanvas
          dateline={dateline}
          stage={collection.stage}
          sections={sections}
          cost={printOnly ? null : collection.cost}
          editionId={editionId}
          done={state === "done"}
        />
      </main>
    </div>
  );
}
