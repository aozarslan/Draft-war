import { NextResponse } from "next/server";
import { DEFAULT_CONFIG, type RoomConfig } from "@/lib/game/types";
import { EngineError, getCharacters, rpc } from "@/lib/server/engine";
import { errorResponse, newRoomCode, newToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** POST /api/rooms — create a room and seat the creator as host. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      nickname?: string;
      roomName?: string;
      config?: Partial<RoomConfig>;
    };

    const nickname = (body.nickname ?? "").trim().slice(0, 18);
    if (nickname.length < 2) {
      return errorResponse("BAD_NICKNAME", "Pick a nickname with at least 2 characters.");
    }

    const pool = await getCharacters();
    const config: RoomConfig = {
      ...DEFAULT_CONFIG,
      ...body.config,
      // Never let the client ask for a pool bigger than what exists.
      poolSize: Math.min(
        body.config?.poolSize ?? DEFAULT_CONFIG.poolSize,
        pool.length,
      ),
      maxPlayers: Math.min(Math.max(body.config?.maxPlayers ?? 4, 2), 8),
      startingCredits: Math.min(
        Math.max(body.config?.startingCredits ?? DEFAULT_CONFIG.startingCredits, 5),
        999,
      ),
    };

    const token = newToken();

    // Room codes are random; a collision just means we roll again.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newRoomCode();
      try {
        const result = await rpc("dw_create_room", {
          p_code: code,
          p_room_name: (body.roomName ?? "").trim().slice(0, 40),
          p_nickname: nickname,
          p_config: config,
          p_token: token,
        });
        return NextResponse.json({ ...result, token });
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!message.includes("rooms_code_key") && !message.includes("duplicate key")) {
          throw err;
        }
      }
    }

    return errorResponse("CODE_COLLISION", "Could not allocate a room code. Try again.", 503);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
