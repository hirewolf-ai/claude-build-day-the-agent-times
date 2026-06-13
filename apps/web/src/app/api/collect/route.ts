import { db } from "@/db";
import { editions } from "@/db/schema";
import { getCurrentUser } from "@/lib/users";
import { locationById } from "@/lib/profile";
import { startEditionRun } from "@/agents/editionRuns";

export const dynamic = "force-dynamic";

/**
 * POST /api/collect  { prompt?: string }
 * Creates an edition and kicks off the collection agent in the BACKGROUND (the
 * run is decoupled from this request). Returns { editionId } immediately. The
 * client then navigates to /read?q=<editionId> and streams live events from
 * /api/editions/<id>/events — so a refresh reconnects to the same run.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = (body.prompt ?? "").toString();

  const user = await getCurrentUser();
  const reader = user
    ? {
        name: user.name,
        city: locationById(user.location)?.label,
        xHandle: user.xHandle,
        xUrl: user.xUrl,
      }
    : undefined;

  const [edition] = await db
    .insert(editions)
    .values({ sessionId: user?.sessionId ?? null, prompt, status: "collecting" })
    .returning();

  // Fire-and-forget: the run lives in the edition registry, not this request.
  startEditionRun(edition.id, prompt, reader);

  return Response.json({ editionId: edition.id });
}
