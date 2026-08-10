import { NextResponse } from "next/server";
import {
  EngineError,
  categoryCounts,
  getCharacters,
  getSnapshot,
  roomIdByCode,
  tickRoom,
} from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { EVENT_CARDS } from "@/lib/game/events";
import { MAPS } from "@/lib/game/maps";
import { CATEGORIES } from "@/lib/game/categories";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:code/state
 *
 * The single read endpoint. `?tick=1` also applies any expired timers first,
 * which is how auctions close without a server process: whichever client asks
 * next does the work, atomically, on everybody's behalf.
 *
 * `?full=1` additionally returns the static reference data (characters, maps,
 * events) so a fresh page load needs exactly one request.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    const url = new URL(request.url);
    const roomId = await roomIdByCode(code);

    const snapshot =
      url.searchParams.get("tick") === "1"
        ? await tickRoom(roomId)
        : await getSnapshot(roomId);

    if (url.searchParams.get("full") === "1") {
      return NextResponse.json({
        ...snapshot,
        reference: {
          characters: await getCharacters(),
          maps: MAPS,
          events: EVENT_CARDS,
          categories: CATEGORIES,
          categoryCounts: await categoryCounts(),
        },
      });
    }

    return NextResponse.json(snapshot);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
