"use client";

import type { StateResponse } from "./api";

/**
 * ---------------------------------------------------------------------------
 * WHICH WALLET IS ON SCREEN
 * ---------------------------------------------------------------------------
 * A room can be playing one of two games, and they keep their money in
 * different places. A legacy draft spends `players.credits`; an S8 match spends
 * `match_players.credits` and never touches the other one. The server decides
 * both — `dw_bid_credits` is the authority and this file cannot disagree with
 * it, because it does no arithmetic at all. It picks a number the server
 * already sent.
 *
 * It exists so that the auction screen has exactly one place to ask "how much
 * has this player got", rather than three components each reaching for
 * `player.credits` and two of them being right. The one that reaches for the
 * wrong wallet does not show a wrong number for long — it shows a MAX button
 * that lets somebody bid credits they do not have, and the server rejects the
 * bid they were invited to make.
 */

/**
 * The credits a player has to bid with right now.
 *
 * Falls back to the legacy wallet whenever there is no live match, which is
 * what keeps every existing screen behaving exactly as it did.
 */
export function creditsOf(snapshot: StateResponse, playerId: string | null): number {
  if (!playerId) return 0;
  const match = snapshot.match;
  if (match && match.status === "ACTIVE") {
    const seat = match.players.find((p) => p.playerId === playerId);
    if (seat) return seat.credits;
  }
  return snapshot.players.find((p) => p.id === playerId)?.credits ?? 0;
}

/** Whether the room is playing a match rather than a one-off draft. */
export function inMatch(snapshot: StateResponse): boolean {
  return Boolean(snapshot.match && snapshot.match.status === "ACTIVE");
}

/**
 * Everything a player owns in the current match, oldest first.
 *
 * Read from the board the server maintains, not accumulated from round rosters
 * on the client: `snapshot.players[].roster` is scoped to the current round's
 * game, so summing it here would quietly drop every earlier round.
 */
export function boardOf(
  snapshot: StateResponse,
  playerId: string,
): { characterId: string; zone: string; slot: number }[] {
  const match = snapshot.match;
  if (!match) return [];
  return match.board
    .filter((b) => b.playerId === playerId)
    .sort((a, b) => a.slot - b.slot);
}

/** What a player paid for each character, keyed by character id. */
export function pricesOf(snapshot: StateResponse): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of snapshot.match?.acquisitions ?? []) out[a.characterId] = a.price;
  return out;
}
