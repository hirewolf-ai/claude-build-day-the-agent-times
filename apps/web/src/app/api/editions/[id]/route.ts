import { eq } from "drizzle-orm";
import { db } from "@/db";
import { editions } from "@/db/schema";

export const dynamic = "force-dynamic";

/** GET /api/editions/<id> → lightweight edition metadata (status + saved cost). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [edition] = await db.select().from(editions).where(eq(editions.id, id)).limit(1);
  if (!edition) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    status: edition.status,
    costUsd: edition.costUsd ? Number(edition.costUsd) : null,
  });
}
