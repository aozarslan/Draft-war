import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import {
  PROFILE_TOKEN_HEADER,
  getInventory,
  optionalProfile,
} from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/**
 * GET  /api/profile/inventory — what the caller owns and is wearing.
 * POST /api/profile/inventory — equip an owned item.
 *
 * The POST body names an item, never a slot and never an appearance: the slot
 * comes from the item's own kind and ownership is checked in the database. The
 * worst a forged request can do is ask to wear something it does not own.
 */
export async function GET(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);
    return NextResponse.json(await getInventory(profile.profileId));
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await optionalProfile(request);
    if (!profile) return errorResponse("NO_PROFILE", "No profile on this device.", 401);

    const body = (await request.json()) as { itemId?: string };
    const itemId = (body.itemId ?? "").trim();
    if (!itemId) return errorResponse("NO_ITEM", "Pick an item to equip.");

    const result = await rpc("dw_equip_item", {
      p_profile_id: profile.profileId,
      p_token: request.headers.get(PROFILE_TOKEN_HEADER),
      p_item_id: itemId.slice(0, 60),
    });
    if (result.ok === false) {
      return errorResponse(String(result.code), String(result.message), 403);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
