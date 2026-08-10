import { NextResponse } from "next/server";
import { EngineError, invalidateCharacterCache, rpcOrThrow } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import { resolveCharacter, searchPages } from "@/lib/server/wikipedia";
import {
  CATEGORIES_BY_ID,
  basePriceForPower,
  computeGamePower,
  getCategory,
  rarityForPower,
} from "@/lib/game/categories";
import { slugify } from "@/lib/game/characters";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin — the character importer.
 *
 * Same gate as /api/dev: open in development, and in production only when
 * DRAFT_WAR_DEV_KEY is set and presented. Without that this endpoint answers
 * 404, so a deployed game exposes no way to write to the character table.
 */
function devAllowed(request: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const key = process.env.DRAFT_WAR_DEV_KEY;
  return Boolean(key) && request.headers.get("x-dw-dev-key") === key;
}

interface SaveBody {
  name: string;
  categoryId: string;
  universe?: string;
  version?: string | null;
  title?: string;
  actor?: string | null;
  tags?: string[];
  abilities?: string[];
  stats?: Record<string, number>;
  wikiTitle?: string | null;
  enabled?: boolean;
}

export async function POST(request: Request) {
  if (!devAllowed(request)) {
    return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { op: string } & Record<string, unknown>;

    switch (body.op) {
      // ---- Free-text page search, for resolving an ambiguous name ---------
      case "SEARCH": {
        const query = String(body.query ?? "").trim();
        if (query.length < 2) return errorResponse("BAD_QUERY", "Type at least two characters.");
        return NextResponse.json({ ok: true, results: await searchPages(query, 8) });
      }

      // ---- Fetch everything Wikipedia knows about one character -----------
      case "RESOLVE": {
        const name = String(body.name ?? "").trim();
        const exact = body.wikiTitle ? String(body.wikiTitle) : undefined;
        if (!name) return errorResponse("BAD_NAME", "A name is required.");

        const data = await resolveCharacter(name, exact);
        if (!data) {
          return NextResponse.json({
            ok: true,
            found: false,
            status: "not-found",
            name,
          });
        }
        return NextResponse.json({
          ok: true,
          found: true,
          name,
          status: data.ambiguous
            ? "ambiguous"
            : data.thumbnailUrl
              ? "ok"
              : "no-image",
          data,
        });
      }

      // ---- Resolve a pasted list in one go -------------------------------
      case "BULK_RESOLVE": {
        const names = (Array.isArray(body.names) ? body.names : [])
          .map((n) => String(n).trim())
          .filter(Boolean)
          .slice(0, 40);
        if (names.length === 0) return errorResponse("BAD_LIST", "Paste at least one name.");

        const results = [];
        for (const name of names) {
          const data = await resolveCharacter(name);
          results.push({
            name,
            status: !data
              ? "not-found"
              : data.ambiguous
                ? "ambiguous"
                : data.thumbnailUrl
                  ? "ok"
                  : "no-image",
            data,
          });
        }
        return NextResponse.json({ ok: true, results });
      }

      // ---- Write a character ---------------------------------------------
      case "SAVE": {
        const input = body.character as unknown as SaveBody;
        if (!input?.name || !input?.categoryId) {
          return errorResponse("BAD_CHARACTER", "Name and category are required.");
        }
        if (!CATEGORIES_BY_ID[input.categoryId]) {
          return errorResponse("BAD_CATEGORY", "Unknown category.");
        }

        const category = getCategory(input.categoryId);

        // Fill any stat the form left out with a neutral 60 so a half-filled
        // import is still a playable character rather than a NaN.
        const stats: Record<string, number> = {};
        for (const stat of category.stats) {
          const raw = Number(input.stats?.[stat.key]);
          stats[stat.key] = Number.isFinite(raw)
            ? Math.max(1, Math.min(100, Math.round(raw)))
            : 60;
        }

        const gamePower = computeGamePower(category, stats);
        const wiki = body.wiki as
          | {
              wikiTitle?: string;
              wikiUrl?: string;
              description?: string;
              imageUrl?: string;
              thumbnailUrl?: string;
              imageSource?: string;
              imageLicense?: string;
              imageCredit?: string;
            }
          | undefined;

        const character = {
          id: `${input.categoryId}-${slugify(input.name)}`,
          name: input.name,
          categoryId: input.categoryId,
          universe: input.universe ?? category.name,
          version: input.version ?? null,
          title: input.title ?? "",
          description: wiki?.description ?? "",
          actor: input.actor ?? null,
          rarity: rarityForPower(gamePower),
          stats,
          gamePower,
          abilities: input.abilities ?? [],
          tags: input.tags ?? [],
          basePrice: basePriceForPower(gamePower),
          wikiTitle: wiki?.wikiTitle ?? input.wikiTitle ?? input.name,
          wikiUrl: wiki?.wikiUrl ?? null,
          imageUrl: wiki?.imageUrl ?? null,
          thumbnailUrl: wiki?.thumbnailUrl ?? null,
          imageSource: wiki?.imageSource ?? null,
          imageLicense: wiki?.imageLicense ?? null,
          imageCredit: wiki?.imageCredit ?? null,
          palette: category.palette,
          enabled: input.enabled ?? true,
          metadata: { importedAt: new Date().toISOString() },
        };

        await rpcOrThrow("dw_upsert_character", { p_character: character });
        invalidateCharacterCache();
        return NextResponse.json({ ok: true, id: character.id, gamePower });
      }

      default:
        return errorResponse("UNKNOWN_OP", "Unknown admin operation.");
    }
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
