import { NextResponse } from "next/server";
import { EngineError } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { getCollection, optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET /api/profile/collection — mastery per character and completion per
 * category, both derived from the caller's own match history.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await getCollection(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
