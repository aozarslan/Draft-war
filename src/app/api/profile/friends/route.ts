import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { PROFILE_TOKEN_HEADER, getFriends, optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/friends — friends and pending requests both ways.
 * POST /api/profile/friends — add, answer, remove, block or invite.
 *
 * There is no endpoint that lists or searches profiles: a request names an
 * exact username, which keeps the privacy floor at "you have to know who you
 * are looking for". Every action is checked against the caller's own token,
 * and a request can only be answered by the person it was sent to.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await getFriends(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

type Body =
  | { action: "ADD"; username: string }
  | { action: "RESPOND"; friendshipId: string; accept: boolean }
  | { action: "REMOVE"; profileId: string; block?: boolean }
  | { action: "INVITE"; profileId: string; roomCode: string };

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const token = request.headers.get(PROFILE_TOKEN_HEADER);
    const body = (await request.json()) as Body;

    let result: Record<string, unknown>;

    switch (body.action) {
      case "ADD":
        result = await rpc("dw_send_friend_request", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_username: (body.username ?? "").trim().slice(0, 16),
        });
        break;

      case "RESPOND":
        result = await rpc("dw_respond_friend_request", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_friendship_id: body.friendshipId,
          p_accept: Boolean(body.accept),
        });
        break;

      case "REMOVE":
        result = await rpc("dw_remove_friend", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_friend_id: body.profileId,
          p_block: Boolean(body.block),
        });
        break;

      case "INVITE":
        result = await rpc("dw_invite_friend", {
          p_profile_id: profile.profileId,
          p_token: token,
          p_friend_id: body.profileId,
          p_room_code: (body.roomCode ?? "").trim().slice(0, 8),
        });
        break;

      default:
        return errorResponse("BAD_ACTION", "That is not something you can do here.");
    }

    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 409);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
