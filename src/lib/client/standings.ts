"use client";

import type { StateResponse } from "./api";
import type { Character } from "@/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * HOW THE MATCH ENDED
 * ---------------------------------------------------------------------------
 * The final table, and the handful of things worth saying about it.
 *
 * Every figure here is one the server already recorded — HP, round wins,
 * credits, what each squad cost. Nothing is reconstructed and nothing is
 * estimated, which matters more on this screen than anywhere else: it is the
 * last thing five people look at, and a number that disagrees with the match
 * they just played is the one they will remember.
 *
 * **The champion is only crowned when the match actually decided one.** Round
 * combat is not wired up yet, so a match played today ends with everybody on
 * full health and no round wins — a four-way tie. Declaring a winner from a
 * tie-break would be inventing a result, so `decided` is false and the screen
 * says so. The moment S8.5 starts writing winners, this lights up on its own.
 */

export interface StandingRow {
  playerId: string;
  nickname: string;
  colorIndex: number;
  rank: number;
  hp: number;
  roundWins: number;
  credits: number;
  /** The round they went out in, or null. */
  eliminatedAt: number | null;
  /** How many characters they ended up owning. */
  squadSize: number;
  /** What the whole squad cost. */
  spent: number;
}

export interface MatchStandings {
  rows: StandingRow[];
  /**
   * Whether anything in this match separated the players.
   *
   * False when no matchup recorded a winner — which is every match until round
   * combat lands. A champion crowned out of a tie is a fabricated result.
   */
  decided: boolean;
  champion: StandingRow | null;
  roundsPlayed: number;
  totalRounds: number;
}

/**
 * The final table.
 *
 * Ordered by health, then rounds won, then seat — the same ordering the
 * rulebook seeds the championship bracket with, so the screen and the bracket
 * cannot disagree about who was ahead.
 */
export function matchStandings(snapshot: StateResponse): MatchStandings | null {
  const match = snapshot.match;
  if (!match) return null;

  const seatOf = new Map(snapshot.players.map((p) => [p.id, p]));
  const spentOf = new Map<string, number>();
  const ownedOf = new Map<string, number>();
  for (const a of match.acquisitions) {
    spentOf.set(a.playerId, (spentOf.get(a.playerId) ?? 0) + a.price);
    ownedOf.set(a.playerId, (ownedOf.get(a.playerId) ?? 0) + 1);
  }

  const rows: StandingRow[] = match.players
    .map((p) => {
      const seat = seatOf.get(p.playerId);
      return {
        playerId: p.playerId,
        nickname: seat?.nickname ?? "—",
        colorIndex: seat?.colorIndex ?? 0,
        rank: 0,
        hp: p.hp,
        roundWins: p.roundWins,
        credits: p.credits,
        eliminatedAt: p.eliminatedAt,
        squadSize: ownedOf.get(p.playerId) ?? 0,
        spent: spentOf.get(p.playerId) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.hp - a.hp ||
        b.roundWins - a.roundWins ||
        (seatOf.get(a.playerId)?.seat ?? 0) - (seatOf.get(b.playerId)?.seat ?? 0),
    );

  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  // Something has to have separated them. Until round combat writes winners,
  // nothing has.
  const decided = match.matchups.some((m) => m.winnerPlayerId !== null);

  return {
    rows,
    decided,
    champion: decided ? (rows[0] ?? null) : null,
    roundsPlayed: match.roundNo,
    totalRounds: match.totalRounds,
  };
}

export interface MatchAward {
  key: "STRONGEST_SQUAD" | "BIGGEST_SPENDER" | "BEST_VALUE" | "DEEPEST_BENCH";
  label: string;
  playerId: string;
  nickname: string;
  /** The figure behind it, already formatted. */
  detail: string;
}

/**
 * The few things worth saying about a finished draft.
 *
 * All four are facts about what people bought, which is the half of the match
 * that already works. None of them is a judgement about how somebody played —
 * that needs combat, and combat is not here yet.
 *
 * An award is **omitted** when nothing qualifies, rather than being handed to
 * whoever came closest. A "Best value" with nobody in it says nothing; a "Best
 * value" awarded to a player who spent nothing says something false.
 */
export function matchAwards(
  snapshot: StateResponse,
  charactersById: Record<string, Character>,
): MatchAward[] {
  const match = snapshot.match;
  if (!match) return [];

  const nameOf = (id: string) =>
    snapshot.players.find((p) => p.id === id)?.nickname ?? "—";

  const power = new Map<string, number>();
  const spent = new Map<string, number>();
  const owned = new Map<string, number>();
  const benched = new Map<string, number>();

  for (const a of match.acquisitions) {
    spent.set(a.playerId, (spent.get(a.playerId) ?? 0) + a.price);
    owned.set(a.playerId, (owned.get(a.playerId) ?? 0) + 1);
  }
  for (const slot of match.board) {
    const character = charactersById[slot.characterId];
    if (!character) continue;
    if (slot.zone === "BENCH") {
      benched.set(slot.playerId, (benched.get(slot.playerId) ?? 0) + 1);
      continue;
    }
    power.set(slot.playerId, (power.get(slot.playerId) ?? 0) + character.gamePower);
  }

  const best = (m: Map<string, number>, min = 1) => {
    let winner: { playerId: string; value: number } | null = null;
    for (const [playerId, value] of m) {
      if (value < min) continue;
      if (!winner || value > winner.value) winner = { playerId, value };
    }
    return winner;
  };

  const awards: MatchAward[] = [];

  const strongest = best(power);
  if (strongest) {
    awards.push({
      key: "STRONGEST_SQUAD",
      label: "Strongest squad",
      playerId: strongest.playerId,
      nickname: nameOf(strongest.playerId),
      detail: `${strongest.value} total power`,
    });
  }

  const spender = best(spent);
  if (spender) {
    awards.push({
      key: "BIGGEST_SPENDER",
      label: "Biggest spender",
      playerId: spender.playerId,
      nickname: nameOf(spender.playerId),
      detail: `${spender.value} credits`,
    });
  }

  // Power per credit, and only for somebody who actually spent — dividing by a
  // spend of zero produces an infinity, and an award of infinity is not an
  // award.
  const value = new Map<string, number>();
  for (const [playerId, total] of power) {
    const cost = spent.get(playerId) ?? 0;
    if (cost > 0) value.set(playerId, Math.round((total / cost) * 10) / 10);
  }
  const bargain = best(value);
  if (bargain) {
    awards.push({
      key: "BEST_VALUE",
      label: "Best value",
      playerId: bargain.playerId,
      nickname: nameOf(bargain.playerId),
      detail: `${bargain.value} power per credit`,
    });
  }

  const bench = best(benched);
  if (bench) {
    awards.push({
      key: "DEEPEST_BENCH",
      label: "Deepest bench",
      playerId: bench.playerId,
      nickname: nameOf(bench.playerId),
      detail: `${bench.value} in reserve`,
    });
  }

  return awards;
}
