import { NextResponse } from "next/server";
import { EngineError, rpc } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/leaderboard — the current season's standings. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(5, Number(url.searchParams.get("limit") ?? 50)));
    const data = await rpc("dw_leaderboard", { p_limit: limit });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
