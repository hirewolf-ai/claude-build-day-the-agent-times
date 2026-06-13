"use client";

import { AgentFeed } from "@/components/AgentFeed";
import { PaperCanvas } from "@/components/PaperCanvas";
import { useEditionEvents } from "@/lib/useCollectionStream";

/**
 * The builder workspace: left 30% = agent newsroom feed, right 70% = the paper
 * assembling live. Connects to an edition's event stream by id, so a refresh
 * reconnects to the same run.
 */
export function BuilderView({
  editionId,
  dateline,
}: {
  editionId: string;
  dateline: string;
}) {
  const { lines, stage, state } = useEditionEvents(editionId);

  return (
    <div className="flex h-screen w-full">
      {/* Left 30% — the newsroom */}
      <aside className="w-[30%] min-w-[300px] max-w-[460px] border-r border-border bg-background">
        <AgentFeed lines={lines} state={state} />
      </aside>

      {/* Right 70% — the paper */}
      <main className="flex-1 bg-[#f7f4ee]">
        <PaperCanvas stage={stage} dateline={dateline} />
      </main>
    </div>
  );
}
