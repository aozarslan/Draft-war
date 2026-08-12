import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/event — the live event, or null.
 *
 * Public: an event nobody can see is not an event, and there is nothing here
 * that is not already on the poster.
 */
export async function GET() {
  try {
    const rows = await rpc("dw_live_event", {});
    // A set-returning function comes back as the row itself, or nulls when
    // nothing is running.
    const event = rows && (rows as { id?: string }).id ? rows : null;
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
