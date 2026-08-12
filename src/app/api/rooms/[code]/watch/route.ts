import { NextResponse } from "next/server";
import { EngineError, roomIdByCode, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:code/watch
 *
 * Marks a spectator present. Deliberately not a join: no seat, no credits, no
 * token. The row exists only so the room can say "3 watching" and it ages out
 * on its own, so a closed tab stops counting without telling us.
 *
 * Unauthenticated by design — you should not need an account to be shown a
 * game — but a watcher can do nothing else: every mutation goes through
 * `authenticate()`, which needs a (playerId, token) pair only joining issues.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    const body = (await request.json().catch(() => ({}))) as { watcherId?: string };
    const watcherId = String(body.watcherId ?? "").trim();

    if (!/^[A-Za-z0-9_-]{8,64}$/.test(watcherId)) {
      return errorResponse("BAD_WATCHER", "Invalid watcher.", 400);
    }

    const roomId = await roomIdByCode(code);
    const result = await rpc("dw_watch", { p_room_id: roomId, p_watcher_id: watcherId });
    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 429);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
