import { createRng } from "./rng";
import { BOARD_CAPACITY } from "./rounds";

/**
 * ---------------------------------------------------------------------------
 * MATCHMAKING (pure)
 * ---------------------------------------------------------------------------
 * Who fights whom, this round.
 *
 * A pure function of the match seed, the round number, the seats and the
 * matchups already played. No clock, no `Math.random`, no database, no React —
 * the same discipline `auction.ts`, `battle.ts` and `rounds.ts` follow, and for
 * a sharper reason here: a pairing that could not be recomputed identically
 * would change under a refresh, and a player watching their opponent change
 * would be right not to trust it.
 *
 * ## The one thing this file must not become
 *
 * A handicap system. It is trivially easy to write a scheduler that quietly
 * punishes whoever is winning — sort by strength, pair the leaders together,
 * and the best draft in the room never gets an easy round again. Measured over
 * 10,000 simulated matches, that arrangement puts the strongest player against
 * the 74th percentile of the table every single round, and a player would feel
 * it long before they could name it.
 *
 * The defence is the weight ordering in `PAIRING_COSTS`: schedule fairness is
 * three orders of magnitude heavier than strength. A rating difference decides
 * a pairing only when the history is genuinely indifferent between the
 * candidates — which is what lets the game answer *why did I get this opponent*
 * with something other than "because you are winning".
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One seat, as the server knows it. Everything here is server state. */
export interface MatchmakingSeat {
  playerId: string;
  /** Seating order. The last tie-break, so a pairing never depends on row order. */
  seat: number;
  hp: number;
  /** The round they went out in, or null while they are still playing. */
  eliminatedAt: number | null;
  /** `gamePower` of everything they own, in any order. */
  board: number[];
  /**
   * Rolling combat form, 0..1.
   *
   * Absent until S8.5, because round combat does not exist yet and nothing
   * writes `round_matchups.winner_player_id`. See `MATCHMAKING_WEIGHTS`.
   */
  recentForm?: number;
}

/** A matchup that has already happened, as stored. */
export interface PriorMatchup {
  roundNo: number;
  playerA: string;
  /** Null when this was the odd seat's round. */
  playerB: string | null;
}

/** Why this matchup exists, in the player's terms. Presentation only. */
export type MatchupReason =
  | "ONLY_PAIRING"
  | "NEW_OPPONENT"
  | "CLOSEST_STRENGTH"
  | "REMATCH_UNAVOIDABLE"
  | "ODD_SEAT";

export interface Pairing {
  pairingIndex: number;
  playerA: string;
  /** Null for the odd seat. */
  playerB: string | null;
  kind: "DUEL" | "ENCOUNTER";
  /** The rating that decided this pairing, recorded because it cannot be
   *  reconstructed later — the board grows every round. */
  ratingA: number;
  ratingB: number | null;
  reason: MatchupReason;
}

// ---------------------------------------------------------------------------
// Rating
// ---------------------------------------------------------------------------

/**
 * How the four terms of a rating are weighted.
 *
 * `recentForm` is **declared and disabled**. Round combat lands in S8.5; until
 * then every seat would report the same neutral 0.5, which is not harmless —
 * it is a constant offset applied to every rating that nobody would remember
 * introducing on the day it starts moving. So it carries weight zero and the
 * other three are renormalised to sum to one.
 *
 * When combat arrives the weights become
 * `{ power: 0.55, roster: 0.20, form: 0.15, health: 0.10 }`, and this comment
 * is the record of what changed and why.
 */
export const MATCHMAKING_WEIGHTS = {
  /** The board the player actually built. Dominant, but under half. */
  power: 0.6,
  /** Board *size*, which matters on its own while boards are still filling. */
  roster: 0.25,
  /** Inert until S8.5. */
  form: 0,
  /**
   * Remaining life, not strength. Lowest on purpose: weighting it heavily
   * would pair the wounded with the wounded and build a losers' bracket
   * nobody asked for.
   */
  health: 0.15,
} as const;

/** The score a full board of the strongest characters could reach. */
const MAX_BOARD_POWER = BOARD_CAPACITY * 100;

/**
 * A seat's effective strength, 0..1.
 *
 * Used for exactly one thing: the `|rating(a) − rating(b)|` term of the pairing
 * cost. It is not a score, not a ladder, and never reaches combat —
 * `simulateBattle` computes its own team rating from axes and knows nothing
 * about this one.
 */
export function ratingOf(seat: MatchmakingSeat): number {
  const top = [...seat.board].sort((a, b) => b - a).slice(0, BOARD_CAPACITY);
  const power = top.reduce((sum, v) => sum + v, 0) / MAX_BOARD_POWER;
  const roster = Math.min(1, top.length / BOARD_CAPACITY);
  const form = seat.recentForm ?? 0.5;
  const health = Math.max(0, Math.min(1, seat.hp / 100));

  const raw =
    MATCHMAKING_WEIGHTS.power * Math.max(0, Math.min(1, power)) +
    MATCHMAKING_WEIGHTS.roster * roster +
    MATCHMAKING_WEIGHTS.form * form +
    MATCHMAKING_WEIGHTS.health * health;

  // Rounded to the precision the database column stores, so the number that
  // decided a pairing is the number that gets written down.
  return Math.round(raw * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * What each consideration is worth, and therefore which one wins.
 *
 * The magnitudes matter far more than the units. History is 500–1000; strength
 * is 1. Strength can only decide among pairings the history does not care
 * about — it can never force a hard matchup, which is the difference between
 * matchmaking and a handicap.
 */
export const PAIRING_COSTS = {
  /** Meeting somebody again at all, per previous meeting. */
  rematch: 1000,
  /** Meeting the same person two rounds running. The thing players notice. */
  consecutive: 500,
  /** Taking the odd seat again, per previous time. */
  bye: 300,
  /** Rating difference, per unit. Deliberately the smallest. */
  strength: 1,
} as const;

/** How many times two seats have already met. */
export function timesMet(history: PriorMatchup[], a: string, b: string): number {
  // An odd round is stored with `playerB` null, and a null matches neither of
  // two real ids, so it is excluded by the comparison rather than by a guard.
  return history.filter(
    (m) => (m.playerA === a && m.playerB === b) || (m.playerA === b && m.playerB === a),
  ).length;
}

/** Who a seat faced most recently, or null if they sat out or have not played. */
export function lastOpponentOf(history: PriorMatchup[], playerId: string): string | null {
  let best: PriorMatchup | null = null;
  for (const m of history) {
    if (m.playerA !== playerId && m.playerB !== playerId) continue;
    if (!best || m.roundNo > best.roundNo) best = m;
  }
  if (!best) return null;
  return best.playerA === playerId ? best.playerB : best.playerA;
}

/** How many rounds a seat has spent as the odd one out. */
export function byeCountOf(history: PriorMatchup[], playerId: string): number {
  return history.filter((m) => m.playerB === null && m.playerA === playerId).length;
}

// ---------------------------------------------------------------------------
// Turning a match into a pairing question
// ---------------------------------------------------------------------------

/**
 * The little a match has to expose to be paired.
 *
 * Declared structurally rather than importing the snapshot type, so this file
 * keeps its only dependency on `rng` and `rounds` and can be tested without a
 * server, a database or a network client.
 */
export interface PairableMatch {
  status: string;
  phase: string;
  roundNo: number;
  seed: string;
  players: { playerId: string; hp: number; eliminatedAt: number | null }[];
  board: { playerId: string; characterId: string }[];
  matchups: { roundNo: number; playerA: string; playerB: string | null }[];
}

/**
 * The question to ask `pairRound`, or null when this match should not be asked.
 *
 * Split out from the server plumbing on purpose. Three conditions decide
 * whether a round gets paired — the match is running, it is at its matchmaking
 * phase, and this round has not already been paired — and all three are pure.
 * Left inside an `async` function that needs a database they would be checked
 * by reading the source and hoping; here they are executed.
 */
export function pairingInputFor(
  match: PairableMatch,
  seatOf: (playerId: string) => number,
  powerOf: (characterId: string) => number | undefined,
): PairRoundInput | null {
  if (match.status !== "ACTIVE") return null;
  if (match.phase !== "MATCHMAKING") return null;
  // This round, specifically. Asking whether *any* round has been paired would
  // pair round one and then never pair another.
  if (match.matchups.some((m) => m.roundNo === match.roundNo)) return null;

  const boards = new Map<string, number[]>();
  for (const slot of match.board) {
    const power = powerOf(slot.characterId);
    if (power === undefined) continue;
    boards.set(slot.playerId, [...(boards.get(slot.playerId) ?? []), power]);
  }

  return {
    matchSeed: match.seed,
    roundNo: match.roundNo,
    seats: match.players.map((p) => ({
      playerId: p.playerId,
      seat: seatOf(p.playerId),
      hp: p.hp,
      eliminatedAt: p.eliminatedAt,
      board: boards.get(p.playerId) ?? [],
      // `recentForm` is deliberately absent: round combat lands in S8.5 and
      // nothing writes a winner yet. Its weight is zero until then.
    })),
    history: match.matchups.map((m) => ({
      roundNo: m.roundNo,
      playerA: m.playerA,
      playerB: m.playerB,
    })),
  };
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export interface PairRoundInput {
  /** `matches.seed`. The only source of variety, and it is fixed per match. */
  matchSeed: string;
  roundNo: number;
  seats: MatchmakingSeat[];
  /** Every matchup already played in this match. */
  history: PriorMatchup[];
}

interface Ranked {
  seat: MatchmakingSeat;
  rating: number;
  /** Position in the seeded order. Every tie-break runs on this. */
  order: number;
}

/**
 * The pairings for one round.
 *
 * Deterministic: the same seed, round, seats and history always produce the
 * same answer, whatever order the seats arrive in. The seed is consumed exactly
 * once, to permute the seats; everything after that is arithmetic and a
 * lexicographic tie-break, so there is no draw whose count could drift.
 *
 * Returns an empty list when there is nobody left to pair, which is a real
 * state rather than an error: the last survivor's match is over, and the state
 * machine forks to the championship on its own.
 */
export function pairRound(input: PairRoundInput): Pairing[] {
  const live = input.seats.filter((s) => s.eliminatedAt === null && s.hp > 0);
  if (live.length < 2) return [];

  // The seed enters here and nowhere else. Ordering by `seat` first makes the
  // permutation independent of the order the caller happened to supply.
  const rng = createRng(`matchmaking:${input.matchSeed}:${input.roundNo}`);
  const permuted = rng.shuffle([...live].sort((a, b) => a.seat - b.seat));

  const ranked: Ranked[] = permuted.map((seat, order) => ({
    seat,
    rating: ratingOf(seat),
    order,
  }));

  // Two players have exactly one pairing, so there is nothing to weigh. Scoring
  // it would apply a rematch penalty to a rematch that cannot be avoided, and a
  // rule that can never be satisfied is a rule that means nothing.
  if (ranked.length === 2) {
    const [a, b] = ranked;
    return [duel(0, a, b, "ONLY_PAIRING")];
  }

  const best = cheapestMatching(ranked, input.history);
  return describe(best, ranked, input.history);
}

type Candidate = { pairs: [Ranked, Ranked | null][]; cost: number };

/**
 * Every legal way to pair the table, scored, cheapest first.
 *
 * Exhaustive rather than approximate. A table is at most five seats, which is
 * at most fifteen candidate matchings — enumerating them costs less than any
 * heuristic would, and removes the entire class of "the approximation chose
 * badly on this input" bug.
 */
function cheapestMatching(ranked: Ranked[], history: PriorMatchup[]): Candidate {
  const pairCost = (x: Ranked, y: Ranked): number => {
    const met = timesMet(history, x.seat.playerId, y.seat.playerId);
    const consecutive =
      lastOpponentOf(history, x.seat.playerId) === y.seat.playerId ? 1 : 0;
    return (
      PAIRING_COSTS.rematch * met +
      PAIRING_COSTS.consecutive * consecutive +
      PAIRING_COSTS.strength * Math.abs(x.rating - y.rating)
    );
  };
  const byeCost = (x: Ranked): number =>
    PAIRING_COSTS.bye * byeCountOf(history, x.seat.playerId) +
    // Among seats with equal bye history, the one having the worse match takes
    // the gentler round. A nudge, dominated by the bye count above it — this is
    // the only place catch-up appears in matchmaking at all.
    PAIRING_COSTS.strength * x.rating;

  let best: Candidate | null = null;

  const consider = (candidate: Candidate) => {
    if (!best) {
      best = candidate;
      return;
    }
    const delta = candidate.cost - best.cost;
    if (delta < -1e-9) {
      best = candidate;
      return;
    }
    // Equal cost: the lexicographically smaller arrangement wins, measured in
    // the seeded order. Deterministic, and varied across matches because the
    // permutation is.
    if (delta < 1e-9 && keyOf(candidate) < keyOf(best)) best = candidate;
  };

  const walk = (pool: Ranked[], acc: [Ranked, Ranked | null][], cost: number) => {
    if (pool.length === 0) {
      consider({ pairs: acc, cost });
      return;
    }
    const [head, ...rest] = pool;

    // The odd seat, when what remains can still be paired evenly.
    //
    // The parity of the pool does the rest of the work, which mutation testing
    // is what showed: an even pool leaves an odd `rest` at every depth, so this
    // branch cannot fire; an odd pool leaves an even `rest` only at the top,
    // so it can fire only once. Guards for "the table is odd" and "no bye taken
    // yet" were unreachable, and an unreachable guard is a claim nobody checks.
    if (rest.length % 2 === 0) {
      walk(rest, [...acc, [head, null]], cost + byeCost(head));
    }

    for (let i = 0; i < rest.length; i++) {
      const partner = rest[i];
      walk(
        rest.filter((_, j) => j !== i),
        [...acc, [head, partner]],
        cost + pairCost(head, partner),
      );
    }
  };

  walk([...ranked].sort((a, b) => a.order - b.order), [], 0);
  return best!;
}

/** A stable, comparable description of one arrangement. */
function keyOf(candidate: Candidate): string {
  return candidate.pairs
    .map(([a, b]) => {
      if (b === null) return `${String(a.order).padStart(2, "0")}-xx`;
      const [lo, hi] = a.order < b.order ? [a.order, b.order] : [b.order, a.order];
      return `${String(lo).padStart(2, "0")}-${String(hi).padStart(2, "0")}`;
    })
    .sort()
    .join(",");
}

function duel(index: number, a: Ranked, b: Ranked, reason: MatchupReason): Pairing {
  return {
    pairingIndex: index,
    playerA: a.seat.playerId,
    playerB: b.seat.playerId,
    kind: "DUEL",
    ratingA: a.rating,
    ratingB: b.rating,
    reason,
  };
}

/**
 * Turns the winning arrangement into pairings, each carrying the reason it
 * exists.
 *
 * The reason is the check on everything above it: if the honest explanation for
 * a matchup would be *"because you are winning"*, the design is wrong. None of
 * the five reasons can say that.
 */
function describe(best: Candidate, ranked: Ranked[], history: PriorMatchup[]): Pairing[] {
  const ordered = [...best.pairs].sort((x, y) => {
    const ax = x[1] === null ? Infinity : Math.min(x[0].order, x[1].order);
    const ay = y[1] === null ? Infinity : Math.min(y[0].order, y[1].order);
    return ax - ay;
  });

  return ordered.map(([a, b], index) => {
    if (b === null) {
      return {
        pairingIndex: index,
        playerA: a.seat.playerId,
        playerB: null,
        // Never a free round. The odd seat fights a board the server builds;
        // a bye measured +20 points of championship probability, which is the
        // largest single effect in S8 outside the damage curve.
        kind: "ENCOUNTER" as const,
        ratingA: a.rating,
        ratingB: null,
        reason: "ODD_SEAT" as const,
      };
    }
    const met = timesMet(history, a.seat.playerId, b.seat.playerId);
    const reason: MatchupReason =
      met === 0
        ? "NEW_OPPONENT"
        : everyoneAlreadyMet(ranked, history)
          ? "REMATCH_UNAVOIDABLE"
          : "CLOSEST_STRENGTH";
    return duel(index, a, b, reason);
  });
}

/** Whether the table has run out of unused pairings. */
function everyoneAlreadyMet(ranked: Ranked[], history: PriorMatchup[]): boolean {
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (timesMet(history, ranked[i].seat.playerId, ranked[j].seat.playerId) === 0) {
        return false;
      }
    }
  }
  return true;
}
