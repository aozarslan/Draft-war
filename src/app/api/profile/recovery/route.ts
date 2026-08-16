import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse, newToken } from "@/lib/server/session";
import { PROFILE_TOKEN_HEADER, hasRecovery, optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/recovery — whether this profile has a code yet.
 * POST /api/profile/recovery — issue one (returns it exactly once), or use one.
 *
 * The issued code is never stored in the clear and never re-shown: a code the
 * server can reprint is a code an attacker can ask it to reprint.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await hasRecovery(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "ISSUE" | "USE";
      username?: string;
      code?: string;
    };

    // Using a code is how somebody with no session gets one, so this branch
    // deliberately does not require a profile.
    if (body.action === "USE") {
      const token = newToken();
      const result = await rpc("dw_recover_profile", {
        p_username: String(body.username ?? "").slice(0, 16),
        p_code: String(body.code ?? "").slice(0, 20),
        p_new_token: token,
      });
      if (result.ok === false) {
        return errorResponse(String(result.code), String(result.message), 401);
      }
      return NextResponse.json({ ...result, token });
    }

    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const result = await rpc("dw_set_recovery", {
      p_profile_id: profile.profileId,
      p_token: request.headers.get(PROFILE_TOKEN_HEADER),
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
