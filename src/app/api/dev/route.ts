import { NextResponse } from "next/server";
import {
  EngineError,
  getSnapshot,
  lockBattlefield,
  roomIdByCode,
  rpcOrThrow,
  runBattle,
  beginMapSelection,
} from "@/lib/server/engine";
import { errorResponse, newToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev — development-only shortcuts (reset a room, add test players,
 * skip the auction, force the battle).
 *
 * Locked behind two gates: `NODE_ENV !== "production"` OR a matching
 * `DRAFT_WAR_DEV_KEY`. On a normal Vercel production deploy without that
 * variable this endpoint always answers 404, so players can never reach it.
 */
function devAllowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const key = process.env.DRAFT_WAR_DEV_KEY;
  return Boolean(key) && request.headers.get("x-dw-dev-key") === key;
}

export async function POST(request: Request) {
  if (!devAllowed(request)) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as {
      op: "RESET" | "ADD_BOT" | "SKIP_AUCTION" | "FORCE_BATTLE";
      code: string;
      nickname?: string;
    };

    const roomId = await roomIdByCode(body.code);

    switch (body.op) {
      case "RESET":
        await rpcOrThrow("dw_dev_reset_room", { p_room_id: roomId });
        break;

      case "ADD_BOT": {
        const result = await rpcOrThrow("dw_dev_add_bot", {
          p_room_id: roomId,
          p_nickname: body.nickname ?? `Bot${Math.floor(Math.random() * 90 + 10)}`,
          p_token: newToken(),
        });
        return NextResponse.json(result);
      }

      case "SKIP_AUCTION":
        await rpcOrThrow("dw_dev_skip_auction", { p_room_id: roomId });
        break;

      case "FORCE_BATTLE": {
        const snap = await getSnapshot(roomId);
        if (snap.room.phase === "TEAM_REVIEW") await beginMapSelection(roomId, null);
        await lockBattlefield(roomId);
        await runBattle(roomId);
        break;
      }

      default:
        return errorResponse("UNKNOWN_OP", "Unknown dev operation.");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
