import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import {
  PROFILE_TOKEN_HEADER,
  getNotifications,
  optionalProfile,
} from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/notifications — the inbox and the unread count.
 * POST /api/profile/notifications — mark read (all, or the ids given).
 *
 * Marking read is the only thing a client may do to a notification. It cannot
 * create one, delete one, or touch anybody else's.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await getNotifications(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
    const ids = Array.isArray(body.ids) && body.ids.length > 0 ? body.ids.slice(0, 100) : null;

    const result = await rpc("dw_read_notifications", {
      p_profile_id: profile.profileId,
      p_token: request.headers.get(PROFILE_TOKEN_HEADER),
      p_ids: ids,
    });

    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 409);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
