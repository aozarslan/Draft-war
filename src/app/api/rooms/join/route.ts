import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { optionalProfile } from "@/lib/server/profile";
import { errorResponse, newToken } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** POST /api/rooms/join — take a free seat in an existing lobby. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { code?: string; nickname?: string };

    const code = (body.code ?? "").trim().toUpperCase();
    const nickname = (body.nickname ?? "").trim().slice(0, 18);

    if (code.length !== 5) return errorResponse("BAD_CODE", "Room codes are 5 characters.");
    if (nickname.length < 2) {
      return errorResponse("BAD_NICKNAME", "Pick a nickname with at least 2 characters.");
    }

    const token = newToken();
    const result = await rpc("dw_join_room", {
      p_code: code,
      p_nickname: nickname,
      p_token: token,
    });

    if (result.ok === false) {
      const status = result.code === "ROOM_NOT_FOUND" ? 404 : 409;
      return errorResponse(String(result.code), String(result.message), status);
    }

    const profile = await optionalProfile(request);
    if (profile && result.playerId) {
      await rpc("dw_link_player_profile", {
        p_player_id: result.playerId,
        p_profile_id: profile.profileId,
        p_token: request.headers.get("x-dw-profile-token"),
      });
    }

    return NextResponse.json({ ...result, token });
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
