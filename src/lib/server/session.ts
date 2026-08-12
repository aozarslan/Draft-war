import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Identity without accounts.
 *
 * On join we mint `{ playerId, token }`. The browser keeps both in
 * localStorage; every mutating request presents them as headers. The token is
 * stored in `player_secrets`, a table with no anon-readable policy, so a player
 * can only act as themselves. Refreshing the page, closing the tab or losing
 * the network changes nothing — the pair is all that is needed to resume.
 */

export const PLAYER_ID_HEADER = "x-dw-player";
export const PLAYER_TOKEN_HEADER = "x-dw-token";

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** 5-character code from an alphabet without look-alike glyphs. */
export function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(5);
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

export function errorResponse(
  code: string,
  message: string,
  status = 400,
): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export interface AuthedPlayer {
  playerId: string;
  roomId: string;
  roomCode: string;
  isHost: boolean;
}

/**
 * Validates the caller against the room in the URL. Every mutating endpoint
 * starts with this; nothing downstream trusts a body-supplied player id.
 */
export async function authenticate(
  request: Request,
  roomCode: string,
): Promise<AuthedPlayer | NextResponse> {
  const playerId = request.headers.get(PLAYER_ID_HEADER);
  const token = request.headers.get(PLAYER_TOKEN_HEADER);

  if (!playerId || !token) {
    return errorResponse("NO_SESSION", "Session expired. Please join again.", 401);
  }

  // A player id is a uuid. Checking the shape here rather than letting the
  // database reject it turns a DB_ERROR — which reads as "our fault" and tells
  // the caller nothing — into the honest answer: whatever you presented, it is
  // not a session. Reached in practice by a spectator's watcher id, which is
  // deliberately not a uuid.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)) {
    return errorResponse("NO_SESSION", "Session expired. Please join again.", 401);
  }

  const db = supabaseAdmin();

  // Three plain lookups rather than one embedded query.
  //
  // The embedded version broke the moment `category_votes` was added: its
  // primary key is (room_id, player_id), which is exactly the shape PostgREST
  // reads as a many-to-many join table, so "players related to rooms" became
  // ambiguous and every authenticated action started failing. Relationship
  // inference is not something authentication should depend on — these three
  // queries have no such failure mode, and they run in parallel so it costs
  // one round trip either way.
  const [secretResult, playerResult, roomResult] = await Promise.all([
    db.from("player_secrets").select("token").eq("player_id", playerId).maybeSingle(),
    db.from("players").select("id, room_id").eq("id", playerId).maybeSingle(),
    db
      .from("rooms")
      .select("id, code, host_player_id")
      .eq("code", roomCode.toUpperCase())
      .maybeSingle(),
  ]);

  const dbError = secretResult.error ?? playerResult.error ?? roomResult.error;
  if (dbError) return errorResponse("DB_ERROR", dbError.message, 500);

  const secret = secretResult.data as { token: string } | null;
  if (!secret || secret.token !== token) {
    return errorResponse("INVALID_SESSION", "Session expired. Please join again.", 401);
  }

  const player = playerResult.data as { id: string; room_id: string } | null;
  const room = roomResult.data as {
    id: string;
    code: string;
    host_player_id: string | null;
  } | null;

  if (!player || !room || player.room_id !== room.id) {
    return errorResponse("NOT_IN_ROOM", "You are not part of this room.", 403);
  }

  return {
    playerId: player.id,
    roomId: room.id,
    roomCode: room.code,
    isHost: room.host_player_id === player.id,
  };
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
