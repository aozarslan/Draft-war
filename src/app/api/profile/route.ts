import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse, newToken } from "@/lib/server/session";
import { getProfile, optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile — the caller's profile, or 401 when playing as a guest.
 * POST /api/profile — claim a username and mint a persistent profile.
 *
 * Everything the profile reports (level, XP, rank, history) is read from the
 * database on the service role. The browser holds only an opaque token; it
 * never sends its own numbers and they would be ignored if it did.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) {
      return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    }
    return NextResponse.json(await getProfile(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; avatar?: string };
    const username = (body.username ?? "").trim();

    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      return errorResponse(
        "INVALID_USERNAME",
        "Usernames are 3-16 characters: letters, numbers and underscores.",
      );
    }

    const token = newToken();
    const result = await rpc("dw_create_profile", {
      p_username: username,
      p_avatar: (body.avatar ?? "default").slice(0, 40),
      p_token: token,
    });

    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 409);
    }
    return NextResponse.json({ ...result, token });
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
