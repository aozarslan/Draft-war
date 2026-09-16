import { createRng } from "./rng";
import { MAPS } from "./maps";
import { EVENT_CARDS } from "./events";
import { BOARD_CAPACITY } from "./rounds";
import type { BattleResult, BattleMap, Character, EventCard } from "./types";
import { simulateBattle, type BattleTeamInput, type SimulateInput } from "./battle";

/**
 * ---------------------------------------------------------------------------
 * ROUND COMBAT — orchestration (pure)
 * ---------------------------------------------------------------------------
 * Everything that decides *what fight to run* and *what a result costs*,
 * without running one and without touching a database.
 *
 * `simulateBattle` is not modified and is not wrapped: it stays the
 * authoritative, seeded, already-tested engine. This file assembles its input
 * out of match state and reads its output back into one number — the HP a loss
 * costs. Both halves are pure, so both can be executed by tests rather than
 * inspected as source, which is the lesson S8.3b paid for.
 *
 * ## The two numbers that were measured rather than chosen
 *
 * **The damage curve.** `docs/S8-DESIGN.md` specified
 * `(8 + 2.4 × survivors) × (1 + 0.18 × (round−1))`, fitted when `survivors`
 * was a uniform draw in a toy model. Against the real engine it is not: over
 * 4,000 real 5v5s the winner keeps a mean of 3.07 fighters and the loser is
 * always wiped to zero, so from about round five every loss costs the cap and a
 * four-player table ends on a median of 3 HP. The curve below uses the
 * winner's *remaining health* instead — a continuous signal that says how close
 * the fight was — and lands a match on a median of 38 HP with about one
 * elimination.
 *
 * **The encounter opponent.** Built at the field's median board power, because
 * that is where an encounter round costs the same as a duel round (−1.2 HP at
 * three players, +0.2 at five). The knob is unforgiving: at 0.92× the odd seat
 * wins 87% of the time, at 1.08× it wins 6%. That sensitivity is why
 * `encounterBoardFor` has its own tests rather than a comment promising care.
 */

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * The shape of a loss, in HP.
 *
 * `base` is what a loss costs against an opponent who was themselves wiped out;
 * `sweep` is what it costs on top when the winner walks away untouched. `ramp`
 * makes a late round hurt more than an early one, and the clamp keeps both ends
 * honest: no loss is free, and no single round can end a match on its own.
 */
export const DAMAGE_CURVE = {
  base: 6,
  sweep: 14,
  ramp: 0.12,
  floor: 4,
  cap: 24,
} as const;

/**
 * How much worse it is to lose a fight the forecast expected you to win.
 *
 * The engine flags an upset on roughly 8% of duels, so this rides on a small
 * base and cannot distort the curve. It is kept because it is legible: you were
 * favoured, and it cost you.
 */
export const UPSET_MULTIPLIER = 1.15;

export interface DamageInput {
  /** 1-based. A later round hurts more. */
  roundNo: number;
  /**
   * The winning side's remaining health, 0..1, exactly as the engine reported
   * it. Copied, never recomputed — a second derivation of the same quantity is
   * a second thing that can disagree.
   */
  winnerHpFraction: number;
  /** The engine's own `upset` flag. */
  upset?: boolean;
}

/**
 * What a loss costs the loser, in HP.
 *
 * The two `Number.isFinite` guards are not decoration. `Math.min`/`Math.max`
 * propagate NaN rather than clamping it, so a single unreadable input would
 * return NaN all the way through the clamp — and a NaN damage written to an
 * `int` column is an error at the very end of a transaction that has already
 * decided a winner. An unreadable health reads as *the winner was wiped out
 * too*, which is the cheapest outcome, so the failure falls towards mercy.
 */
export function damageFor(input: DamageInput): number {
  const health = Number.isFinite(input.winnerHpFraction)
    ? Math.max(0, Math.min(1, input.winnerHpFraction))
    : 0;
  const round = Number.isFinite(input.roundNo) ? Math.max(1, Math.floor(input.roundNo)) : 1;
  const raw =
    (DAMAGE_CURVE.base + DAMAGE_CURVE.sweep * health) *
    (1 + DAMAGE_CURVE.ramp * (round - 1)) *
    (input.upset ? UPSET_MULTIPLIER : 1);
  return Math.max(DAMAGE_CURVE.floor, Math.min(DAMAGE_CURVE.cap, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/**
 * The seed for one fight.
 *
 * Deliberately **unprefixed**: `simulateBattle` prepends `battle:` itself, and
 * passing an already-prefixed string produced `battle:battle:…`. Harmless, but
 * a seed nobody can read is a seed nobody checks.
 *
 * `pairingIndex` is in it because without it two matchups of the same round
 * would be the same fight.
 */
export function battleSeedFor(matchSeed: string, roundNo: number, pairingIndex: number): string {
  return `${matchSeed}:${roundNo}:${pairingIndex}`;
}

/** The arena's own board. A different namespace, so it cannot shadow the fight. */
export function encounterSeedFor(matchSeed: string, roundNo: number, pairingIndex: number): string {
  return `encounter:${matchSeed}:${roundNo}:${pairingIndex}`;
}

/** One battlefield per round, shared by every matchup in it. */
export function battlefieldSeedFor(matchSeed: string, roundNo: number): string {
  return `env:${matchSeed}:${roundNo}`;
}

/**
 * The map and event card a round is fought on.
 *
 * A match has no map vote and no event draw — those are the legacy game's
 * phases, and match events are S8.8 — so the battlefield is drawn from the
 * match seed. Every matchup in a round shares it: it is one round, on one
 * field, and neither side chose it.
 */
export function battlefieldFor(
  matchSeed: string,
  roundNo: number,
): { map: BattleMap; event: EventCard } {
  const rng = createRng(battlefieldSeedFor(matchSeed, roundNo));
  return { map: rng.pick(MAPS), event: rng.pick(EVENT_CARDS) };
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

/** One row of `board_slots`, structurally. */
export interface BoardSlot {
  playerId: string;
  characterId: string;
  zone: string;
  slot: number;
}

/**
 * The characters that actually fight.
 *
 * The bench does not. Ordered by slot so the fight does not depend on the order
 * rows came back in, and capped at the board size so a bench mislabelled as
 * FRONT cannot field a sixth fighter.
 */
export function fightingBoardOf(
  slots: BoardSlot[],
  playerId: string,
  priceOf: (characterId: string) => number | undefined,
): { characterId: string; price: number }[] {
  return slots
    .filter((s) => s.playerId === playerId && s.zone !== "BENCH")
    .sort((a, b) => a.slot - b.slot)
    .slice(0, BOARD_CAPACITY)
    .map((s) => ({ characterId: s.characterId, price: priceOf(s.characterId) ?? 1 }));
}

/**
 * The player id the arena fights under.
 *
 * Reserved, and never written to `round_matchups.player_b`, which is a foreign
 * key to a real seat. It exists only inside the stored `BattleResult`, where the
 * replay needs *some* id to hang the other side of the arena on.
 */
export const ENCOUNTER_PLAYER_ID = "encounter";
export const ENCOUNTER_NICKNAME = "The Arena";

/**
 * How strong the arena is: the median of each live seat's average board power.
 *
 * The median rather than the mean, so one runaway board does not drag the
 * arena up for everybody, and the *average* per seat rather than the sum, so a
 * player with three fighters is compared on quality rather than punished for
 * having fewer.
 */
export function medianBoardPowerOf(boards: number[][]): number {
  const averages = boards
    .filter((b) => b.length > 0)
    .map((b) => b.reduce((sum, p) => sum + p, 0) / b.length)
    .sort((a, b) => a - b);
  if (averages.length === 0) return 0;
  return averages[Math.floor(averages.length / 2)];
}

export interface EncounterBoardInput {
  seed: string;
  /** The power to aim at. See `medianBoardPowerOf`. */
  targetPower: number;
  /** How many fighters to field. Never more than the board can hold. */
  size: number;
  /** The catalogue this match is drafting from. */
  pool: Character[];
  /** Everything the match has already sold. The arena never fields those. */
  excluded: ReadonlySet<string>;
}

/**
 * The board the arena brings.
 *
 * Deterministic in its seed and stable under the order `pool` arrives in: the
 * candidates are ranked by distance from the target power with the character id
 * as the tie-break, and only then shuffled. A shuffle over an unstably ordered
 * list would be a different arena on two machines.
 *
 * Characters the match has already sold are excluded, because the arena
 * fielding somebody's own draft pick reads as a bug even when it is not.
 */
export function encounterBoardFor(
  input: EncounterBoardInput,
): { characterId: string; price: number }[] {
  const size = Math.max(1, Math.min(BOARD_CAPACITY, Math.floor(input.size)));

  const candidates = input.pool
    .filter((c) => !input.excluded.has(c.id))
    .sort(
      (a, b) =>
        Math.abs(a.gamePower - input.targetPower) - Math.abs(b.gamePower - input.targetPower) ||
        a.id.localeCompare(b.id),
    );

  if (candidates.length === 0) return [];

  // A window three times the board, so the arena is not the same five
  // characters every time it appears at the same power.
  const window = candidates.slice(0, Math.min(candidates.length, size * 3));
  return createRng(input.seed)
    .shuffle(window)
    .slice(0, size)
    .map((c, i) => ({ characterId: c.id, price: i + 1 }));
}

// ---------------------------------------------------------------------------
// Battle input
// ---------------------------------------------------------------------------

/** What both builders need from the match. */
export interface CombatContext {
  matchSeed: string;
  roundNo: number;
  pairingIndex: number;
  categoryIds: string[];
  charactersById: Record<string, Character>;
  bands: SimulateInput["bands"];
}

export interface Combatant {
  playerId: string;
  nickname: string;
  formation?: BattleTeamInput["formation"];
  board: { characterId: string; price: number }[];
}

/** A fight that could not be built, and why. Never a half-built one. */
export type BattleInput =
  | { ok: true; input: SimulateInput }
  | { ok: false; code: "EMPTY_BOARD" | "NO_POOL"; message: string };

function baseInput(ctx: CombatContext, teams: BattleTeamInput[]): SimulateInput {
  const { map, event } = battlefieldFor(ctx.matchSeed, ctx.roundNo);
  return {
    teams,
    map,
    event,
    charactersById: ctx.charactersById,
    seed: battleSeedFor(ctx.matchSeed, ctx.roundNo, ctx.pairingIndex),
    categoryIds: ctx.categoryIds,
    bands: ctx.bands,
  };
}

/** Two seats, both real. */
export function buildDuelInput(
  ctx: CombatContext,
  a: Combatant,
  b: Combatant,
): BattleInput {
  if (a.board.length === 0 || b.board.length === 0) {
    return {
      ok: false,
      code: "EMPTY_BOARD",
      message: "A side has nobody to field.",
    };
  }
  return {
    ok: true,
    input: baseInput(ctx, [
      { playerId: a.playerId, nickname: a.nickname, characters: a.board, formation: a.formation },
      { playerId: b.playerId, nickname: b.nickname, characters: b.board, formation: b.formation },
    ]),
  };
}

/** One seat against a board the server builds. */
export function buildEncounterInput(
  ctx: CombatContext,
  seat: Combatant,
  arena: { targetPower: number; pool: Character[]; excluded: ReadonlySet<string> },
): BattleInput {
  if (seat.board.length === 0) {
    return { ok: false, code: "EMPTY_BOARD", message: "A side has nobody to field." };
  }

  const board = encounterBoardFor({
    seed: encounterSeedFor(ctx.matchSeed, ctx.roundNo, ctx.pairingIndex),
    targetPower: arena.targetPower,
    size: seat.board.length,
    pool: arena.pool,
    excluded: arena.excluded,
  });

  if (board.length === 0) {
    return {
      ok: false,
      code: "NO_POOL",
      message: "There is nobody left for the arena to field.",
    };
  }

  return {
    ok: true,
    input: baseInput(ctx, [
      { playerId: seat.playerId, nickname: seat.nickname, characters: seat.board, formation: seat.formation },
      {
        playerId: ENCOUNTER_PLAYER_ID,
        nickname: ENCOUNTER_NICKNAME,
        characters: board,
        // The arena has no opinion about formation, and giving it one would be
        // a hidden thumb on the scale.
        formation: "BALANCED",
      },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Which fights a round still owes
// ---------------------------------------------------------------------------

/** The little a match has to expose to be fought. */
export interface FightableMatch {
  status: string;
  phase: string;
  roundNo: number;
  seed: string;
  categoryIds: string[];
  players: { playerId: string; hp: number; eliminatedAt: number | null }[];
  board: BoardSlot[];
  acquisitions: { characterId: string; price: number }[];
  matchups: {
    roundNo: number;
    pairingIndex: number;
    playerA: string;
    playerB: string | null;
    battleResult?: unknown | null;
  }[];
}

export interface PlannedFight {
  pairingIndex: number;
  input: SimulateInput;
}

export interface CombatPlanDeps {
  charactersById: Record<string, Character>;
  bands: SimulateInput["bands"];
  /** Nickname and formation per seat. */
  seatOf: (playerId: string) => { nickname: string; formation?: BattleTeamInput["formation"] };
  /** The catalogue this match drafts from, for the arena's board. */
  pool: Character[];
}

/**
 * The fights this match owes right now, already assembled.
 *
 * Pure, so the three questions that decide it can be executed by a test rather
 * than read out of a source file: is this match at its combat, is this matchup
 * in *this* round, and has it already been fought. An earlier version left all
 * three inside the async function that talks to the database, where a mutation
 * removing any of them changed nothing a test could see.
 *
 * A matchup whose input cannot be built is **omitted**, never defaulted — a
 * fight nobody can assemble is not a fight somebody wins.
 */
export function combatPlanFor(match: FightableMatch, deps: CombatPlanDeps): PlannedFight[] {
  if (match.status !== "ACTIVE") return [];
  if (match.phase !== "COMBAT" && match.phase !== "FINAL_COMBAT") return [];

  const priceOf = new Map(match.acquisitions.map((a) => [a.characterId, a.price]));
  const owned = new Set(match.acquisitions.map((a) => a.characterId));
  const board = (playerId: string) =>
    fightingBoardOf(match.board, playerId, (id) => priceOf.get(id));

  const live = match.players.filter((p) => p.eliminatedAt === null && p.hp > 0);
  const arenaPower = medianBoardPowerOf(
    live.map((p) => board(p.playerId).map((c) => deps.charactersById[c.characterId]?.gamePower ?? 0)),
  );

  const out: PlannedFight[] = [];
  for (const m of match.matchups) {
    // This round only, and only what has not been fought.
    if (m.roundNo !== match.roundNo) continue;
    if (m.battleResult !== null && m.battleResult !== undefined) continue;

    const ctx: CombatContext = {
      matchSeed: match.seed,
      roundNo: m.roundNo,
      pairingIndex: m.pairingIndex,
      categoryIds: match.categoryIds,
      charactersById: deps.charactersById,
      bands: deps.bands,
    };
    const a = { playerId: m.playerA, ...deps.seatOf(m.playerA), board: board(m.playerA) };

    const built = m.playerB
      ? buildDuelInput(ctx, a, {
          playerId: m.playerB, ...deps.seatOf(m.playerB), board: board(m.playerB),
        })
      : buildEncounterInput(ctx, a, { targetPower: arenaPower, pool: deps.pool, excluded: owned });

    if (!built.ok) continue;
    out.push({ pairingIndex: m.pairingIndex, input: built.input });
  }
  return out;
}

/**
 * One fight, and what it costs.
 *
 * The engine is called here rather than in the server layer, so that "the
 * result came from `simulateBattle`" is a property a test can execute instead
 * of grep for.
 */
export function fightOne(
  input: SimulateInput,
  roundNo: number,
  realPlayerIds: ReadonlySet<string>,
): { result: BattleResult; outcome: CombatOutcome } {
  const result = simulateBattle(input);
  return { result, outcome: outcomeOf(result, roundNo, realPlayerIds) };
}

// ---------------------------------------------------------------------------
// Reading a result
// ---------------------------------------------------------------------------

export interface CombatOutcome {
  /** Null when the arena won an encounter — there is no player to credit. */
  winnerPlayerId: string | null;
  /** Null when the arena won: the seat that lost is the only real one. */
  loserPlayerId: string | null;
  /** HP the loser pays. Zero only when nobody real lost. */
  damage: number;
  upset: boolean;
}

/**
 * What a stored result costs, in match terms.
 *
 * Every figure is read off the result the engine already produced. Nothing here
 * re-runs a fight, re-derives a winner or recomputes a health total — the one
 * arithmetic step is `damageFor`, and its only input is a number the engine
 * reported.
 */
export function outcomeOf(
  result: Pick<BattleResult, "teams" | "winnerPlayerId" | "upset">,
  roundNo: number,
  realPlayerIds: ReadonlySet<string>,
): CombatOutcome {
  const winner = result.teams.find((t) => t.playerId === result.winnerPlayerId) ?? null;
  const loser = result.teams.find((t) => t.playerId !== result.winnerPlayerId) ?? null;

  const winnerIsReal = winner !== null && realPlayerIds.has(winner.playerId);
  const loserIsReal = loser !== null && realPlayerIds.has(loser.playerId);

  const damage =
    winner && loserIsReal
      ? damageFor({
          roundNo,
          winnerHpFraction: winner.remainingHpPct / 100,
          upset: Boolean(result.upset),
        })
      : 0;

  return {
    winnerPlayerId: winnerIsReal ? winner!.playerId : null,
    loserPlayerId: loserIsReal ? loser!.playerId : null,
    damage,
    upset: Boolean(result.upset),
  };
}

// ---------------------------------------------------------------------------
// Round completion
// ---------------------------------------------------------------------------

/** The little a matchup has to expose for the round to be counted. */
export interface ResolvableMatchup {
  roundNo: number;
  pairingIndex: number;
  battleResult?: unknown | null;
}

export interface CombatProgress {
  total: number;
  resolved: number;
  unresolved: number;
  /** True only when the round has fights and every one of them has finished. */
  complete: boolean;
}

/**
 * How far through its combat a round is.
 *
 * Returns the counts rather than a bare boolean so the caller can say *which*
 * of the three fights is missing, and so "no fights at all" is distinguishable
 * from "every fight finished". A round with no matchups is **not** complete:
 * that is a round nobody played, and the decision about whether it is legal
 * belongs to the state machine, which knows how many seats are still alive.
 */
export function combatProgress(
  matchups: ResolvableMatchup[],
  roundNo: number,
): CombatProgress {
  const mine = matchups.filter((m) => m.roundNo === roundNo);
  const resolved = mine.filter(
    (m) => m.battleResult !== null && m.battleResult !== undefined,
  ).length;
  return {
    total: mine.length,
    resolved,
    unresolved: mine.length - resolved,
    complete: mine.length > 0 && resolved === mine.length,
  };
}
