/**
 * ---------------------------------------------------------------------------
 * MATCH ROUNDS (pure)
 * ---------------------------------------------------------------------------
 * The backbone of an S8 match: which round we are on, which phase of it, and
 * which phase is allowed to come next.
 *
 * Everything here is a pure function of state. No clock, no randomness, no
 * database, no React — the same reasons `auction.ts` and `battle.ts` are shaped
 * this way. The authoritative copy of these rules runs inside Postgres
 * (`dw_match_transition_ok`, `dw_advance_match_phase`), because only the
 * database can settle two clients advancing the same match at the same
 * millisecond. This file exists so the UI can grey out impossible buttons
 * before the round trip, and so the rules can be tested without a database.
 *
 * `tests/rounds.test.ts` documents the contract both sides implement, and
 * `tests/migrations.test.ts` holds the two copies to the same transition table
 * so they cannot drift.
 *
 * ## Why a table and not a switch
 *
 * A phase machine written as `if (phase === "X") phase = "Y"` is a machine
 * whose illegal transitions are the ones nobody wrote down. Declaring the
 * legal edges as data makes "AUCTION → CHAMPIONSHIP is not a thing" a property
 * you can assert, print, and mirror into SQL, rather than an absence you hope
 * is still absent after the next edit.
 */

/**
 * Every phase an S8 match can be in, in the order a round plays them.
 *
 * `MATCH_INTRO` and `MATCH_RESULTS` bracket the whole match; the eight in
 * between are one round, and `ROUND_END` is the only place the round number
 * moves. `CHAMPIONSHIP` and `FINAL_COMBAT` replace the ordinary round loop for
 * the last round.
 */
export const MATCH_PHASES = [
  "MATCH_INTRO",
  "ROUND_START",
  "AUCTION",
  "BOARD_UPDATE",
  "POSITIONING",
  "MATCHMAKING",
  "COMBAT",
  "RESOLUTION",
  "ROUND_END",
  "CHAMPIONSHIP",
  "FINAL_COMBAT",
  "MATCH_RESULTS",
] as const;

export type MatchPhase = (typeof MATCH_PHASES)[number];

const PHASE_SET: ReadonlySet<string> = new Set(MATCH_PHASES);

/** Whether a string names a phase. The only way an unknown phase gets in. */
export function isMatchPhase(value: unknown): value is MatchPhase {
  return typeof value === "string" && PHASE_SET.has(value);
}

/**
 * The legal edges of the machine, as data.
 *
 * Total over `MatchPhase`: every phase has an entry, and `MATCH_RESULTS` has
 * an empty one because a finished match goes nowhere. `ROUND_END` is the only
 * phase with two successors, and which one applies is decided by the round
 * number rather than by the caller — see `nextPhaseOf`.
 */
export const PHASE_TRANSITIONS: Readonly<Record<MatchPhase, readonly MatchPhase[]>> = {
  MATCH_INTRO: ["ROUND_START"],
  ROUND_START: ["AUCTION"],
  AUCTION: ["BOARD_UPDATE"],
  BOARD_UPDATE: ["POSITIONING"],
  POSITIONING: ["MATCHMAKING"],
  MATCHMAKING: ["COMBAT"],
  COMBAT: ["RESOLUTION"],
  RESOLUTION: ["ROUND_END"],
  // The fork. Another round, or the final.
  ROUND_END: ["ROUND_START", "CHAMPIONSHIP"],
  CHAMPIONSHIP: ["FINAL_COMBAT"],
  FINAL_COMBAT: ["MATCH_RESULTS"],
  MATCH_RESULTS: [],
};

/** The phases that belong to one round, in play order. */
export const ROUND_PHASES: readonly MatchPhase[] = [
  "ROUND_START",
  "AUCTION",
  "BOARD_UPDATE",
  "POSITIONING",
  "MATCHMAKING",
  "COMBAT",
  "RESOLUTION",
  "ROUND_END",
];

/**
 * How long the match itself gives a phase, in seconds.
 *
 * `null` means **the match does not own this phase's clock**. The auction ends
 * when every roster quota is filled (`dw_total_demand`), and combat ends when
 * the stored battle's `durationMs` has elapsed — both are existing mechanisms
 * with their own deadlines, and duplicating them here would create a second
 * clock that can disagree with the first.
 *
 * TODO(S8.2 / S8.5): those two subsystems are not wired into a match yet, so a
 * match currently waits for the host on `AUCTION` and `COMBAT`. That is
 * deliberate — a placeholder deadline would auto-skip a real auction the day it
 * arrives — and `tests/rounds.test.ts` asserts the two are the only unowned
 * phases, so this stops being true in a commit somebody reviews.
 */
export const PHASE_SECONDS: Readonly<Record<MatchPhase, number | null>> = {
  MATCH_INTRO: 8,
  ROUND_START: 5,
  AUCTION: null,
  BOARD_UPDATE: 25,
  POSITIONING: 30,
  MATCHMAKING: 6,
  COMBAT: null,
  RESOLUTION: 10,
  ROUND_END: 5,
  CHAMPIONSHIP: 10,
  FINAL_COMBAT: null,
  MATCH_RESULTS: null,
};

/** Whether the match's own clock advances this phase when it expires. */
export function isClockDriven(phase: MatchPhase): boolean {
  return PHASE_SECONDS[phase] !== null;
}

/** What a player reads on the round rail. */
export const PHASE_LABELS: Readonly<Record<MatchPhase, string>> = {
  MATCH_INTRO: "Match intro",
  ROUND_START: "Round start",
  AUCTION: "Auction",
  BOARD_UPDATE: "Board",
  POSITIONING: "Positioning",
  MATCHMAKING: "Matchmaking",
  COMBAT: "Combat",
  RESOLUTION: "Damage & rewards",
  ROUND_END: "Round end",
  CHAMPIONSHIP: "Championship",
  FINAL_COMBAT: "Final",
  MATCH_RESULTS: "Results",
};

// ---------------------------------------------------------------------------
// Match shape
// ---------------------------------------------------------------------------

/**
 * Rounds by table size.
 *
 * Two players play a shorter match on purpose: with only one possible pairing
 * every round is the same duel, so eight of them is four too many. Measured
 * rather than guessed — the S8 economy simulation put a two-player "runaway"
 * at 28% against 2–7% for larger tables, because at two players there is no
 * third result for a round to have.
 */
export const SHORT_MATCH_ROUNDS = 6;
export const STANDARD_MATCH_ROUNDS = 8;

export function totalRoundsFor(playerCount: number): number {
  return playerCount <= 2 ? SHORT_MATCH_ROUNDS : STANDARD_MATCH_ROUNDS;
}

/**
 * The first round in which a player can actually be knocked out.
 *
 * Before this, HP is clamped at 1. Losing a friend from the table on round two
 * of eight is the failure mode that ends the evening, and the floor costs the
 * design nothing: a player on 1 HP going into round 6 is already in exactly the
 * situation the rule is meant to produce.
 */
export const ELIMINATION_FROM_ROUND = 6;

export function eliminationAllowed(roundNo: number): boolean {
  return roundNo >= ELIMINATION_FROM_ROUND;
}

/**
 * HP after a hit, with the early-round floor applied.
 *
 * Lives here rather than wherever damage is computed so that the floor is a
 * property of the *match*, not of one damage formula that might be joined by
 * another later.
 */
export function clampHp(hp: number, roundNo: number): number {
  const floor = eliminationAllowed(roundNo) ? 0 : 1;
  return Math.max(floor, Math.round(hp));
}

export interface MatchPlayerState {
  playerId: string;
  hp: number;
  credits: number;
  roundWins: number;
  streak: number;
  /** The round they went out in. Null while they are still playing. */
  eliminatedAt: number | null;
}

export interface MatchState {
  matchId: string;
  phase: MatchPhase;
  /** 0 during `MATCH_INTRO`; 1..totalRounds once the match is running. */
  roundNo: number;
  totalRounds: number;
  players: MatchPlayerState[];
}

export function isAlive(player: MatchPlayerState): boolean {
  return player.eliminatedAt === null && player.hp > 0;
}

export function livePlayers(state: MatchState): MatchPlayerState[] {
  return state.players.filter(isAlive);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export const TRANSITION_ERRORS = {
  UNKNOWN_PHASE: "That is not a phase of a match.",
  INVALID_TRANSITION: "A match cannot go there from here.",
  MATCH_OVER: "This match has already finished.",
  WRONG_ROUND: "That transition does not belong to this round.",
} as const;

export type TransitionErrorCode = keyof typeof TRANSITION_ERRORS;

export interface TransitionResult {
  ok: boolean;
  code?: TransitionErrorCode;
  message?: string;
}

const OK: TransitionResult = { ok: true };

const fail = (code: TransitionErrorCode): TransitionResult => ({
  ok: false,
  code,
  message: TRANSITION_ERRORS[code],
});

/**
 * The one phase a match may move to from where it is, or null when it is over.
 *
 * The successor is derived, never supplied. A caller that could *choose*
 * between `ROUND_START` and `CHAMPIONSHIP` is a caller that can end a match
 * four rounds early, and the client is a caller.
 */
export function nextPhaseOf(
  phase: MatchPhase,
  state: Pick<MatchState, "roundNo" | "totalRounds">,
): MatchPhase | null {
  const options = PHASE_TRANSITIONS[phase];
  if (options.length === 0) return null;
  if (options.length === 1) return options[0];

  // ROUND_END is the only fork, and the round number decides it.
  return state.roundNo >= state.totalRounds ? "CHAMPIONSHIP" : "ROUND_START";
}

/**
 * Whether a match at `from` may move to `to`.
 *
 * Checks membership in the transition table *and* the round condition on the
 * fork, so "ROUND_END → CHAMPIONSHIP on round 3" is rejected as firmly as
 * "AUCTION → CHAMPIONSHIP".
 */
export function canTransition(
  from: MatchPhase,
  to: MatchPhase,
  state: Pick<MatchState, "roundNo" | "totalRounds">,
): TransitionResult {
  if (!isMatchPhase(from) || !isMatchPhase(to)) return fail("UNKNOWN_PHASE");
  if (PHASE_TRANSITIONS[from].length === 0) return fail("MATCH_OVER");
  if (!PHASE_TRANSITIONS[from].includes(to)) return fail("INVALID_TRANSITION");
  if (nextPhaseOf(from, state) !== to) return fail("WRONG_ROUND");
  return OK;
}

/**
 * The match after one legal step, or the reason it could not take one.
 *
 * Entering `ROUND_START` is the only thing that moves the round number, which
 * is what makes "how many rounds have been played" a fact with exactly one
 * writer. Note *entering*, not "arriving from ROUND_END": an earlier draft
 * incremented only on the loop back and left the very first round numbered
 * zero, so a match opened on "ROUND 0 / 8" and played nine of them. Caught by
 * `plays a two-player match in six`.
 */
export function advanceMatch(
  state: MatchState,
): { ok: true; state: MatchState } | ({ ok: false } & TransitionResult) {
  const to = nextPhaseOf(state.phase, state);
  if (to === null) return { ...fail("MATCH_OVER"), ok: false };

  const check = canTransition(state.phase, to, state);
  if (!check.ok) return { ...check, ok: false };

  const roundNo = to === "ROUND_START" ? state.roundNo + 1 : state.roundNo;

  return { ok: true, state: { ...state, phase: to, roundNo } };
}

/** A fresh match, before its first round. */
export function openingState(input: {
  matchId: string;
  players: { playerId: string; credits: number }[];
  totalRounds?: number;
  startingHp?: number;
}): MatchState {
  const hp = input.startingHp ?? STARTING_HP;
  return {
    matchId: input.matchId,
    phase: "MATCH_INTRO",
    roundNo: 0,
    totalRounds: input.totalRounds ?? totalRoundsFor(input.players.length),
    players: input.players.map((p) => ({
      playerId: p.playerId,
      hp,
      credits: p.credits,
      roundWins: 0,
      streak: 0,
      eliminatedAt: null,
    })),
  };
}

export const STARTING_HP = 100;

/**
 * Which acquisitions a round demands.
 *
 * Rounds 1–5 fill the board and buying is mandatory; from round 6 the board is
 * full and a buy is an upgrade, so passing is a real move. This is also the
 * rule that makes the catalogue big enough: mandatory lots are
 * `players × BOARD_CAPACITY` rather than `players × totalRounds`, which is the
 * difference between a five-player game being impossible in every category and
 * being possible in three of them.
 */
export const BOARD_CAPACITY = 5;
export const BENCH_CAPACITY = 3;

export function acquisitionRequired(roundNo: number): boolean {
  return roundNo >= 1 && roundNo <= BOARD_CAPACITY;
}

/** Board slots a player is expected to have filled by the end of a round. */
export function boardTargetFor(roundNo: number): number {
  return Math.max(0, Math.min(BOARD_CAPACITY, roundNo));
}

/**
 * How long a phase must have been on screen before a person may advance it.
 *
 * The S8.1 live test found six simultaneous host advances moving a match three
 * phases. The row lock was never the problem: each request read a phase that
 * was genuinely current when it read it, and advanced from there. What is
 * missing without a clock is any way to tell a decision from the same tap
 * arriving twice — so the match records when each phase began and refuses a
 * manual advance inside this window.
 *
 * A second is far below anything a person means to do twice, and far above the
 * spread of a burst of concurrent requests. It is deliberately *not* applied to
 * the clock path, which is already idempotent through the deadline, nor to the
 * auction and combat phases, which are advanced by their own subsystems.
 *
 * Mirrored by `dw_min_phase_dwell()`; `tests/round-auction.test.ts` holds the
 * two to the same number.
 */
export const MIN_PHASE_DWELL_SECONDS = 1;

/**
 * How many characters go on the block in one round.
 *
 * One lot per player who still owes the round a purchase, plus the same
 * reserve the legacy draft uses, so passing is a real move and a lot can go
 * unsold without leaving somebody short. Small on purpose: a round is one
 * decision, not a whole draft, and ten lots for five players already means
 * nobody is forced to take the first thing they see.
 */
export function roundQueueSize(livePlayers: number): number {
  const required = Math.max(1, livePlayers);
  return required + Math.max(5, Math.round(required * 0.4));
}

/**
 * The smallest draftable pool a match needs.
 *
 * Mandatory lots plus the same 40% reserve the existing auction uses, so
 * passing stays a legal move and an unsold character can be replaced rather
 * than shrinking the draft.
 */
export function minimumPoolFor(playerCount: number): number {
  const required = Math.max(1, playerCount) * BOARD_CAPACITY;
  return required + Math.max(5, Math.round(required * 0.4));
}
