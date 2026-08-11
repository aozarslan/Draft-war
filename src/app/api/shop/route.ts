import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { PROFILE_TOKEN_HEADER, getShop, optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/shop — today's rotation, prices and what the caller already owns.
 * POST /api/shop — buy an item.
 *
 * The request names an item and nothing else. Price, discount and whether the
 * rotation is even running are all decided in the database, so a browser that
 * edits the number on the card still pays the real one.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    return NextResponse.json(await getShop(profile?.profileId ?? null));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) {
      return errorResponse("NO_PROFILE", "Claim a name before you go shopping.", 401);
    }

    const body = (await request.json()) as { itemId?: string };
    const itemId = (body.itemId ?? "").trim();
    if (!itemId) return errorResponse("NO_ITEM", "Pick something to buy.");

    const result = await rpc("dw_buy_item", {
      p_profile_id: profile.profileId,
      p_token: request.headers.get(PROFILE_TOKEN_HEADER),
      p_item_id: itemId.slice(0, 60),
    });

    if (result.ok === false) {
      // INSUFFICIENT_COINS and ALREADY_OWNED are the player's problem, not a
      // server fault — 409 keeps them out of the error logs.
      return errorResponse(String(result.code), String(result.message), 409);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
