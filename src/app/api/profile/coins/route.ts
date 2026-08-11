import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import {
  PROFILE_TOKEN_HEADER,
  getCoinLedger,
  optionalProfile,
} from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/coins — balance and the recent ledger.
 * POST /api/profile/coins — claim the daily login reward.
 *
 * The browser sends nothing but its profile token. It cannot propose an amount,
 * and there is no endpoint anywhere that accepts one: coins are only ever
 * created by `dw_award_coins`, called from our own server on the service role.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await getCoinLedger(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    // The day is decided by the database clock, not the caller's, and a repeat
    // claim is refused by the ledger rather than by anything we check here.
    const result = await rpc("dw_claim_daily", {
      p_profile_id: profile.profileId,
      p_token: request.headers.get(PROFILE_TOKEN_HEADER),
    });
    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 400);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
