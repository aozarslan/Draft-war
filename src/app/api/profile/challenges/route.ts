import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import {
  PROFILE_TOKEN_HEADER,
  getChallenges,
  optionalProfile,
} from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/challenges — today's and this week's tasks with progress.
 * POST /api/profile/challenges — claim a finished one.
 *
 * The claim names a challenge and nothing else. Whether it is finished is
 * recomputed from the metrics before anything is paid, so a client that says
 * it is done gets checked rather than believed.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await getChallenges(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const body = (await request.json()) as { challengeId?: string };
    const challengeId = (body.challengeId ?? "").trim();
    if (!challengeId) return errorResponse("NO_CHALLENGE", "Which challenge?");

    const result = await rpc("dw_claim_challenge", {
      p_profile_id: profile.profileId,
      p_token: request.headers.get(PROFILE_TOKEN_HEADER),
      p_template_id: challengeId.slice(0, 60),
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
