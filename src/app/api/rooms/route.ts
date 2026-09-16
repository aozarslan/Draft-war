import { NextResponse } from "next/server";
import { DEFAULT_CONFIG, type CategoryMode, type RoomConfig } from "@/lib/game/types";
import { CATEGORIES } from "@/lib/game/categories";
import { EngineError, getCharacters, rpc } from "@/lib/server/engine";
import { errorResponse, newRoomCode, newToken } from "@/lib/server/session";
import { optionalProfile } from "@/lib/server/profile";

export const dynamic = "force-dynamic";

/** POST /api/rooms — create a room and seat the creator as host. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      nickname?: string;
      roomName?: string;
      config?: Partial<RoomConfig>;
    };

    const nickname = (body.nickname ?? "").trim().slice(0, 18);
    if (nickname.length < 2) {
      return errorResponse("BAD_NICKNAME", "Pick a nickname with at least 2 characters.");
    }

    const pool = await getCharacters();

    // The host can pin the categories at creation time. Anything unknown is
    // dropped rather than rejected, so a stale client cannot lock somebody out
    // of making a room.
    const validIds = CATEGORIES.map((c) => c.id);
    const categories = [...new Set(body.config?.categories ?? [])]
      .filter((id) => validIds.includes(id))
      .slice(0, 4);
    const requestedMode = body.config?.categoryMode;
    const categoryMode: CategoryMode =
      requestedMode === "VOTE" || requestedMode === "RANDOM" ? requestedMode : "HOST";

    const config: RoomConfig = {
      ...DEFAULT_CONFIG,
      ...body.config,
      categories,
      // A host who picked nothing has to settle it in the lobby.
      categoryMode: categories.length === 0 && categoryMode === "HOST" ? "HOST" : categoryMode,
      // Two to six players; five is the standard game.
      maxPlayers: Math.min(Math.max(body.config?.maxPlayers ?? DEFAULT_CONFIG.maxPlayers, 2), 6),
      // Credits and roster size are fixed for now. The plumbing is here so
      // they can be opened up later without another migration.
      startingCredits: DEFAULT_CONFIG.startingCredits,
      charactersPerPlayer: DEFAULT_CONFIG.charactersPerPlayer,
      ranked: Boolean(body.config?.ranked),
    };

    // A room is only creatable if some category can actually fill it.
    const largestCategory = Math.max(
      ...Object.values(
        pool.reduce<Record<string, number>>((acc, c) => {
          acc[c.categoryId] = (acc[c.categoryId] ?? 0) + 1;
          return acc;
        }, {}),
      ),
      0,
    );
    if (largestCategory < config.maxPlayers * config.charactersPerPlayer) {
      return errorResponse(
        "POOL_TOO_SMALL",
        "No category has enough characters for that many players.",
      );
    }

    const token = newToken();

    // Room codes are random; a collision just means we roll again.
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = newRoomCode();
      try {
        const result = await rpc("dw_create_room", {
          p_code: code,
          p_room_name: (body.roomName ?? "").trim().slice(0, 40),
          p_nickname: nickname,
          p_config: config,
          p_token: token,
        });
        // Attach the creator's profile to their seat when they have one.
        const profile = await optionalProfile(request);
        if (profile && result.playerId) {
          await rpc("dw_link_player_profile", {
            p_player_id: result.playerId,
            p_profile_id: profile.profileId,
            p_token: request.headers.get("x-dw-profile-token"),
          });
        }
        return NextResponse.json({ ...result, token });
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!message.includes("rooms_code_key") && !message.includes("duplicate key")) {
          throw err;
        }
      }
    }

    return errorResponse("CODE_COLLISION", "Could not allocate a room code. Try again.", 503);
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
