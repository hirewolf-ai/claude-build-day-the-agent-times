import { subscribe } from "@/agents/editionRuns";

export const dynamic = "force-dynamic";

/**
 * GET /api/editions/<id>/events  → SSE stream of this edition's collection.
 * Replays everything buffered so far, then tails live events. A page refresh
 * reconnects here and gets the full story again — the run is decoupled from any
 * single request, so reconnecting never restarts collection.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      const unsubscribe = subscribe(id, (ev) => {
        if (ev.type === "end") {
          send(ev);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
          return;
        }
        send(ev);
      });

      // Clean up if the client disconnects.
      _req.signal?.addEventListener("abort", () => {
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
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
