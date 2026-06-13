import { runPrinting } from "@/agents/runPrinting";

export const dynamic = "force-dynamic";

/**
 * GET /api/editions/<id>/print  → SSE stream of the printing phase.
 * The Design Desk reads the already-collected MDs and writes the paper one
 * <article> at a time; each section streams here the moment it lands, so the
 * reader watches the front page assemble live. Use ?print=true on /read to
 * test printing against an existing edition without re-collecting.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        for await (const ev of runPrinting(id)) send(ev);
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        send({ type: "end" });
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
