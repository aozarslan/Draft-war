import { NextResponse } from "next/server";
import {
  EngineError,
  abandonMatch,
  advanceMatchPhase,
  beginCategorySelection,
  beginMapSelection,
  lockCategory,
  getSnapshot,
  lockBattlefield,
  resolveCategoryAndStart,
  rpcOrThrow,
  runBattle,
  startMatch,
} from "@/lib/server/engine";
import { authenticate, errorResponse, isNextResponse } from "@/lib/server/session";
import { CATEGORIES } from "@/lib/game/categories";

/**
 * Sanitises the client's action id.
 *
 * It is only ever used as an idempotency key, never as an identity: the player
 * is authenticated separately, so the worst a forged id can do is collide with
 * the sender's own earlier action and return that result. Length is capped
 * because it becomes a primary key.
 */
function actionId(raw: unknown): string | null {
  const id = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

export const dynamic = "force-dynamic";

/**
 * The largest number that may be called a bid.
 *
 * Well inside a Postgres `int`, and vastly above any reachable balance — the
 * point is not to constrain play but to keep an absurd number from becoming a
 * database error instead of a rejected request.
 */
const MAX_BID = 1_000_000;

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
  | { type: "BID"; auctionId: string; amount: number; actionId?: string }
  | { type: "PASS"; auctionId: string; actionId?: string }
  | { type: "SET_FORMATION"; formation: string }
  | { type: "CHAT"; body: string }
  | { type: "REACTION"; body: string }
  | { type: "VOTE_MAP"; mapId: string }
  | { type: "ADVANCE" }
  | { type: "PLAY_AGAIN" }
  | { type: "REMATCH"; mode?: "SAME" | "NEW" | "RANDOM" }
  // S8. Note what is absent: none of these carries a phase, a round number, a
  // matchup, an HP value or a reward. The client sends an intention and the
  // server derives every consequence — a match action that named its own
  // destination phase would be a client that can end a match four rounds early.
  | { type: "START_MATCH" }
  | { type: "ADVANCE_MATCH" }
  | { type: "ABANDON_MATCH" };

export async function POST(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await ctx.params;
    const auth = await authenticate(request, code);
    if (isNextResponse(auth)) return auth;

    // Malformed JSON is the caller's mistake, not ours. Without this it
    // reaches the outer catch and is reported as a 500, which says the server
    // broke when in fact it refused.
    let action: Action;
    try {
      action = (await request.json()) as Action;
    } catch {
      return errorResponse("BAD_REQUEST", "That request could not be read.", 400);
    }
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
        if (!Number.isFinite(max) || max < 2 || max > 6) {
          return errorResponse("BAD_SIZE", "A room holds between 2 and 6 players.");
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
        // Bounded here rather than at the database. `credits` is a Postgres
        // `int`, so a bid past 2^31 raises an overflow deep inside the bid
        // function and surfaces as a 500 — a hostile number reported as our
        // fault. No legitimate bid is anywhere near this.
        if (!Number.isInteger(amount) || amount < 1 || amount > MAX_BID) {
          return errorResponse("BID_TOO_LOW", "That is not a valid bid.");
        }
        // The action id makes a retry safe: a double tap, or the same POST
        // replayed after a flaky mobile connection, gets the first answer back
        // instead of placing a second bid.
        const result = await rpcOrThrow("dw_place_bid", {
          p_player_id: playerId,
          p_auction_id: action.auctionId,
          p_amount: amount,
          p_action_id: actionId(action.actionId),
        });
        return NextResponse.json(result);
      }

      case "PASS": {
        const result = await rpcOrThrow("dw_pass_auction", {
          p_player_id: playerId,
          p_auction_id: action.auctionId,
          p_action_id: actionId(action.actionId),
        });
        return NextResponse.json(result);
      }

      case "SET_FORMATION": {
        const result = await rpcOrThrow("dw_set_formation", {
          p_player_id: playerId,
          p_formation: String(action.formation ?? ""),
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

      case "REMATCH": {
        // Same people, straight back in, with the category settled up front so
        // nobody has to negotiate it twice.
        const result = await rpcOrThrow("dw_rematch", {
          p_room_id: roomId,
          p_player_id: playerId,
          p_mode: action.mode ?? "SAME",
        });
        return NextResponse.json(result);
      }

      // ---- S8 match backbone ------------------------------------------
      case "START_MATCH": {
        if (!isHost) return errorResponse("NOT_HOST", "Only the host can do that.", 403);
        const result = await startMatch(roomId, playerId);
        return NextResponse.json({ ok: true, ...result });
      }

      // The host nudging a phase along. Deliberately parameterless: the server
      // reads the current phase and derives the only legal successor, so this
      // is "next", never "go to X".
      case "ADVANCE_MATCH": {
        if (!isHost) return errorResponse("NOT_HOST", "Only the host can do that.", 403);
        const result = await advanceMatchPhase(roomId, playerId);
        if (!result) return errorResponse("NO_MATCH", "Nothing to advance right now.");
        // A request that lost the race is told it lost. The database already
        // refuses to advance twice, so this changes no state — but a caller
        // that is told "ok" for a transition somebody else made will believe
        // its own stale screen, which is the whole failure this guard exists
        // to prevent. The clock path passes playerId = null and ignores it.
        if (result.noop) {
          return errorResponse(
            "CONCURRENT_PHASE_ADVANCE",
            "The phase already moved — refreshing.",
            409,
          );
        }
        return NextResponse.json({ ok: true, phase: result.phase, roundNo: result.roundNo });
      }

      case "ABANDON_MATCH": {
        if (!isHost) return errorResponse("NOT_HOST", "Only the host can do that.", 403);
        await abandonMatch(roomId, playerId);
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
