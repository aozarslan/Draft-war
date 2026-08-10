import { NextResponse } from "next/server";
import { EngineError, categoryCounts, getDraftableCharacters } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { CATEGORIES } from "@/lib/game/categories";

export const dynamic = "force-dynamic";

/**
 * GET /api/characters
 *
 * The whole browsable database in one response. It is a few hundred rows of
 * static reference data, so the character page fetches it once and then filters
 * and searches instantly on the client instead of round-tripping per keystroke.
 *
 * Retired V1 rows are excluded here — they are not part of the catalogue any
 * more, even though they still resolve inside finished games.
 */
export async function GET() {
  try {
    const [characters, counts] = await Promise.all([
      getDraftableCharacters(),
      categoryCounts(),
    ]);

    return NextResponse.json(
      {
        ok: true,
        categories: CATEGORIES,
        categoryCounts: counts,
        characters,
      },
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
    );
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
