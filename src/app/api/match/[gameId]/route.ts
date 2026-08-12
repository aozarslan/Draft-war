import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/match/:gameId — a finished match, readable by anybody with the link.
 *
 * No authentication: that is the point of a shareable result. The database
 * refuses matches that have not finished, so an in-progress game cannot leak
 * rosters or credits to somebody who is not playing, and nothing private
 * travels — the usernames and nicknames players chose, what they drafted, and
 * what happened.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ gameId: string }> },
) {
  try {
    const { gameId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(gameId)) {
      return errorResponse("MATCH_NOT_FOUND", "No such match.", 404);
    }
    const data = await rpc("dw_public_match", { p_game_id: gameId });
    if (data.ok === false) {
      return errorResponse(String(data.code), String(data.message), 404);
    }
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
