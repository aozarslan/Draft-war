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

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("player_secrets")
    .select("token, players!inner(id, room_id, rooms!inner(id, code, host_player_id))")
    .eq("player_id", playerId)
    .maybeSingle();

  if (error) return errorResponse("DB_ERROR", error.message, 500);
  if (!data || data.token !== token) {
    return errorResponse("INVALID_SESSION", "Session expired. Please join again.", 401);
  }

  // supabase-js types embedded relations loosely; shape is guaranteed by !inner.
  const player = data.players as unknown as {
    id: string;
    room_id: string;
    rooms: { id: string; code: string; host_player_id: string | null };
  };

  if (player.rooms.code !== roomCode.toUpperCase()) {
    return errorResponse("NOT_IN_ROOM", "You are not part of this room.", 403);
  }

  return {
    playerId: player.id,
    roomId: player.room_id,
    roomCode: player.rooms.code,
    isHost: player.rooms.host_player_id === player.id,
  };
}

export function isNextResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}
