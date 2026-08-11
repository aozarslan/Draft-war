import { NextResponse } from "next/server";
import {
  EngineError,
  beginCategorySelection,
  beginMapSelection,
  lockCategory,
  getSnapshot,
  lockBattlefield,
  resolveCategoryAndStart,
  rpcOrThrow,
  runBattle,
} from "@/lib/server/engine";
import { authenticate, errorResponse, isNextResponse } from "@/lib/server/session";
import { CATEGORIES } from "@/lib/game/categories";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:code/action
 *
 * Every mutation the game supports, behind one authenticated entry point. The
 * body never carries a player id — identity comes from the session headers, so
 * a doctored request can only ever act as its own player.
 */
type Action =
  | { type: "HEARTBEAT" }
  | { type: "READY"; ready: boolean }
  | { type: "START"; mode?: "HOST" | "VOTE" | "RANDOM" }
  | { type: "PICK_CATEGORY"; categoryIds: string[] }
  | { type: "SET_MAX_PLAYERS"; maxPlayers: number }
  | { type: "VOTE_CATEGORY"; categoryId: string }
  | { type: "BID"; auctionId: string; amount: number }
  | { type: "PASS"; auctionId: string }
  | { type: "CHAT"; body: string }
  | { type: "REACTION"; body: string }
  | { type: "VOTE_MAP"; mapId: string }
  | { type: "ADVANCE" }
  | { type: "PLAY_AGAIN" };

export async function POST(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    const auth = await authenticate(request, code);
    if (isNextResponse(auth)) return auth;

    const action = (await request.json()) as Action;
    const { playerId, roomId, isHost } = auth;

    switch (action.type) {
      case "HEARTBEAT": {
        const result = await rpcOrThrow("dw_heartbeat", { p_player_id: playerId });
        return NextResponse.json(result);
      }

      case "READY": {
        const result = await rpcOrThrow("dw_set_ready", {
          p_player_id: playerId,
          p_ready: Boolean(action.ready),
        });
        return NextResponse.json(result);
      }

      // START no longer jumps straight to the auction: it opens the category
      // phase, which then starts the game once a category is settled.
      case "START": {
        const snap = await getSnapshot(roomId);
        const preset = (snap.room.config.categories ?? []).filter((id) =>
          CATEGORIES.some((c) => c.id === id),
        );
        const mode = action.mode ?? snap.room.config.categoryMode ?? "HOST";

        await beginCategorySelection(
          roomId,
          playerId,
          mode,
          snap.room.config.categoryVoteSeconds ?? 25,
        );

        // The host already chose when the room was created: lock it in right
        // away so the table gets the reveal and the auction opens, instead of
        // being asked the same question twice.
        if (mode === "HOST" && preset.length > 0) {
          await lockCategory(roomId, preset);
          return NextResponse.json({ ok: true, mode, categoryIds: preset });
        }

        // A random draw resolves on its own after the reveal; a host pick with
        // no preset and a vote both wait for input.
        return NextResponse.json({ ok: true, mode });
      }

      case "PICK_CATEGORY": {
        if (!isHost) return errorResponse("NOT_HOST", "Only the host can do that.", 403);
        const valid = CATEGORIES.map((c) => c.id);
        const ids = [...new Set(action.categoryIds ?? [])]
          .filter((id) => valid.includes(id))
          .slice(0, 4);
        if (ids.length === 0) {
          return errorResponse("INVALID_CATEGORY", "Pick at least one category.");
        }
        await lockCategory(roomId, ids);
        return NextResponse.json({ ok: true });
      }

      case "SET_MAX_PLAYERS": {
        if (!isHost) return errorResponse("NOT_HOST", "Only the host can do that.", 403);
        const max = Math.round(Number(action.maxPlayers));
        if (!Number.isFinite(max) || max < 2 || max > 5) {
          return errorResponse("BAD_SIZE", "A room holds between 2 and 5 players.");
        }
        const result = await rpcOrThrow("dw_set_max_players", {
          p_room_id: roomId,
          p_player_id: playerId,
          p_max: max,
        });
        return NextResponse.json(result);
      }

      case "VOTE_CATEGORY": {
        const result = await rpcOrThrow("dw_vote_category", {
          p_player_id: playerId,
          p_category_id: String(action.categoryId),
        });
        return NextResponse.json(result);
      }

      case "BID": {
        const amount = Number(action.amount);
        if (!Number.isInteger(amount) || amount < 1) {
          return errorResponse("BID_TOO_LOW", "That is not a valid bid.");
        }
        const result = await rpcOrThrow("dw_place_bid", {
          p_player_id: playerId,
          p_auction_id: action.auctionId,
          p_amount: amount,
        });
        return NextResponse.json(result);
      }

      case "PASS": {
        const result = await rpcOrThrow("dw_pass_auction", {
          p_player_id: playerId,
          p_auction_id: action.auctionId,
        });
        return NextResponse.json(result);
      }

      case "CHAT":
      case "REACTION": {
        const body = String(action.body ?? "").trim();
        if (!body) return errorResponse("EMPTY_MESSAGE", "Nothing to send.");
        const result = await rpcOrThrow("dw_send_chat", {
          p_player_id: playerId,
          p_kind: action.type,
          p_body: body.slice(0, 240),
        });
        return NextResponse.json(result);
      }

      case "VOTE_MAP": {
        const result = await rpcOrThrow("dw_vote_map", {
          p_player_id: playerId,
          p_map_id: String(action.mapId),
        });
        return NextResponse.json(result);
      }

      // Host-driven "skip ahead". Each branch is the same operation the tick
      // would have performed on its own once the deadline passed.
      case "ADVANCE": {
        if (!isHost) return errorResponse("NOT_HOST", "Only the host can do that.", 403);
        const snap = await getSnapshot(roomId);

        switch (snap.room.phase) {
          case "CATEGORY":
            await resolveCategoryAndStart(roomId, playerId);
            break;
          case "TEAM_REVIEW":
            await beginMapSelection(roomId, playerId);
            break;
          case "MAP_SELECTION":
            await lockBattlefield(roomId);
            break;
          case "EVENT":
            await runBattle(roomId);
            break;
          case "BATTLE":
            await rpcOrThrow("dw_advance_phase", {
              p_room_id: roomId,
              p_player_id: playerId,
              p_from: "BATTLE",
              p_to: "RESULTS",
              p_deadline_seconds: null,
              p_map_candidates: null,
            });
            break;
          default:
            return errorResponse("WRONG_PHASE", "Nothing to advance right now.");
        }
        return NextResponse.json({ ok: true });
      }

      case "PLAY_AGAIN": {
        const result = await rpcOrThrow("dw_return_to_lobby", {
          p_room_id: roomId,
          p_player_id: playerId,
        });
        return NextResponse.json(result);
      }

      default:
        return errorResponse("UNKNOWN_ACTION", "Unknown action.");
    }
  } catch (err) {
    if (err instanceof EngineError) return errorResponse(err.code, err.message, err.status);
    return errorResponse("SERVER_ERROR", err instanceof Error ? err.message : "Unexpected error.", 500);
  }
}
