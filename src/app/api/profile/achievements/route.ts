import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { getAchievements, optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/achievements — the list, with progress for the caller.
 * POST /api/profile/achievements — re-run the evaluation.
 *
 * The POST carries no body at all: it asks the server to look at what it
 * already knows, and everything it can unlock is derived from match history,
 * the coin ledger and the inventory. A client cannot nominate an achievement,
 * a metric or a value.
 *
 * Evaluation normally happens on its own after a match, a purchase or a daily
 * claim. This exists for the case where an achievement was added to the
 * catalog after somebody had already earned it.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    return NextResponse.json(await getAchievements(profile?.profileId ?? null));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const result = await rpc("dw_evaluate_achievements", { p_profile_id: profile.profileId });
    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 400);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
