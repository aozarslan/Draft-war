import { supabaseAdmin } from "@/lib/supabase/admin";
import { createRng, randomSeed } from "@/lib/game/rng";
import { computeAxisBands, simulateBattle } from "@/lib/game/battle";
import type { FormationId } from "@/lib/game/formations";
import { buildAuctionQueue, draftSize, queueSize, rosterSize } from "@/lib/game/auction";
import { MAPS, MAPS_BY_ID } from "@/lib/game/maps";
import { EVENT_CARDS, EVENTS_BY_ID } from "@/lib/game/events";
import { CATEGORIES, LEGACY_CATEGORY_ID, resolveCategoryVote } from "@/lib/game/categories";
import { pairRound, pairingInputFor } from "@/lib/game/matchmaking";
import { combatPlanFor, fightOne } from "@/lib/game/combat";
import {
  PHASE_SECONDS,
  isMatchPhase,
  minimumPoolFor,
  nextPhaseOf,
  roundQueueSize,
  totalRoundsFor,
  type MatchPhase,
} from "@/lib/game/rounds";
import type { BattleResult, Character, RoomConfig } from "@/lib/game/types";

/**
 * Server-side orchestration between the HTTP layer and the database functions.
 * Anything too complex for plpgsql (the battle simulation, category resolution,
 * queue building) lives here, but every write still lands through a guarded SQL
 * function, so running this twice concurrently is safe.
 */

export interface Snapshot {
  ok: true;
  serverTime: string;
  room: {
    id: string;
    code: string;
    name: string | null;
    phase: string;
    hostPlayerId: string | null;
    config: RoomConfig;
    stateVersion: number;
    gamesPlayed: number;
    /** How many people are watching without a seat. */
    watching: number;
    categoryIds: string[];
    categoryCandidates: string[] | null;
    categoryDeadline: string | null;
    categoryMode: "HOST" | "VOTE" | "RANDOM";
  };
  players: {
    id: string;
    nickname: string;
    seat: number;
    colorIndex: number;
    isHost: boolean;
    isReady: boolean;
    formation: FormationId;
    connected: boolean;
    credits: number;
    wins: number;
    losses: number;
    points: number;
    gamesPlayed: number;
    roster: { characterId: string; price: number }[];
  }[];
  game: {
    id: string;
    gameNo: number;
    status: string;
    seed: string;
    queue: string[];
    queueIndex: number;
    charactersPerPlayer: number;
    /** players x roster — what "17 / 25" counts. */
    requiredAllocations: number;
    allocated: number;
    categoryIds: string[];
    mapId: string | null;
    eventId: string | null;
    mapCandidates: string[] | null;
    phaseDeadline: string | null;
    battleStartedAt: string | null;
    battleResult: BattleResult | null;
  } | null;
  auction: {
    id: string;
    characterId: string;
    orderIndex: number;
    status: "ACTIVE" | "SOLD" | "UNSOLD";
    currentBid: number;
    highBidderId: string | null;
    endsAt: string;
    startedAt: string;
    passedPlayerIds: string[];
    winnerId: string | null;
    finalPrice: number | null;
    history: { playerId: string; amount: number; at: string }[];
  } | null;
  /**
   * The S8 match this room is playing, or null.
   *
   * Null on every legacy room and on every room between matches, which is what
   * makes the whole milestone additive: a client that never sees a match
   * renders exactly the game it rendered yesterday.
   */
  match: MatchSnapshot | null;
  mapVotes: Record<string, string>;
  categoryVotes: Record<string, string>;
  events: { type: string; payload: Record<string, unknown>; at: string }[];
  chat: {
    id: string;
    playerId: string | null;
    kind: string;
    body: string;
    at: string;
  }[];
}

/** One player's state inside a match. Authored by the server, never by a client. */
export interface MatchPlayerSnapshot {
  playerId: string;
  hp: number;
  credits: number;
  roundWins: number;
  streak: number;
  /** The round they went out in. Null while they are still playing. */
  eliminatedAt: number | null;
  modifiers: unknown[];
}

export interface MatchSnapshot {
  id: string;
  matchNo: number;
  status: "ACTIVE" | "FINISHED" | "ABANDONED";
  phase: MatchPhase;
  /** 0 during MATCH_INTRO; 1..totalRounds once the match is running. */
  roundNo: number;
  totalRounds: number;
  seed: string;
  categoryIds: string[];
  /** When the match's own clock advances this phase. Null when it does not. */
  phaseDeadline: string | null;
  /** When the current phase began. The manual-advance guard measures from it. */
  phaseStartedAt: string | null;
  championPlayerId: string | null;
  /** The `games` row holding this round's draft, once it has been opened. */
  roundGameId: string | null;
  roundAuctionStatus: string | null;
  /** Rounds 1-5 demand a purchase; from 6 it is a choice. Decided server-side. */
  acquisitionRequired: boolean;
  /** Seats this round is still waiting on. Server-derived, never inferred here. */
  pendingPlayerIds: string[];
  /** Every sale this match has made, in order. The consumed set and the record. */
  acquisitions: {
    roundNo: number;
    playerId: string;
    characterId: string;
    price: number;
    acquiredAt: string;
  }[];
  players: MatchPlayerSnapshot[];
  /** Everything each player owns, accumulated across rounds. */
  board: { playerId: string; characterId: string; zone: string; slot: number }[];
  /** Who faces whom, this round and every round before it. */
  matchups: {
    id: string;
    roundNo: number;
    pairingIndex: number;
    playerA: string;
    /** Null for the odd seat. */
    playerB: string | null;
    kind: string;
    /**
     * The ratings that decided this pairing, and the reason it exists.
     *
     * Recorded rather than derived later: a rating is computed from the board
     * as it stood at the time, and boards grow every round. Null on rows
     * written before 0032.
     */
    ratingA: number | null;
    ratingB: number | null;
    reason: string | null;
    /**
     * The real player whose board the odd seat copied.
     * Null for ordinary duels and for rows written before 0035.
     */
    ghostPlayerId: string | null;
    /** The stored fight, or null until it has been resolved. */
    battleResult: BattleResult | null;
    startedAt: string | null;
    settledAt: string | null;
    winnerPlayerId: string | null;
    damage: number | null;
  }[];
}

export class EngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type RpcResult = { ok: boolean; code?: string; message?: string } & Record<
  string,
  unknown
>;

export async function rpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) throw new EngineError("DB_ERROR", error.message, 500);
  return (data ?? { ok: true }) as RpcResult;
}

/**
 * Calls an RPC that the database may not have yet, and returns null if so.
 *
 * Exactly one thing uses this, and the reason is a deploy-order hazard rather
 * than laziness. Vercel ships the JavaScript and a human runs the migration;
 * between those two moments the code is newer than the schema. `getSnapshot`
 * is on the path of *every* request a room makes, so a hard failure there would
 * take every live room down for the length of that window — including rooms
 * playing the legacy game, which have nothing to do with S8.
 *
 * "The database has no matches table" and "this room has no match" are the same
 * answer to the client, so answering it is correct rather than merely
 * convenient. It is deliberately NOT used for anything that writes: a missing
 * function on a write must fail loudly.
 */
async function rpcOptional(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult | null> {
  const { data, error } = await supabaseAdmin().rpc(fn, args);
  if (error) {
    if (!warnedMissing.has(fn)) {
      warnedMissing.add(fn);
      console.warn(`[DRAFT WAR] ${fn} unavailable — treating as absent. ${error.message}`);
    }
    return null;
  }
  return (data ?? { ok: true }) as RpcResult;
}

/** Functions we have already complained about, so a room does not spam the log. */
const warnedMissing = new Set<string>();

/** Calls an RPC and throws on a rules failure so routes can stay thin. */
export async function rpcOrThrow(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const result = await rpc(fn, args);
  if (result.ok === false) {
    throw new EngineError(
      String(result.code ?? "REJECTED"),
      String(result.message ?? "Action rejected."),
      409,
    );
  }
  return result;
}

export async function roomIdByCode(code: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .from("rooms")
    .select("id")
    .eq("code", code.toUpperCase())
    .maybeSingle();
  if (error) throw new EngineError("DB_ERROR", error.message, 500);
  if (!data) throw new EngineError("ROOM_NOT_FOUND", "Room not found.", 404);
  return data.id as string;
}

/**
 * The room, plus its match if it has one.
 *
 * Two RPCs rather than one, issued in parallel so the round trip cost is one.
 * `dw_snapshot` is the function every connected client polls; replacing it in
 * the first milestone that touches match state would put every live room behind
 * one untested statement. Merging the two is migration 0034's job, once the
 * match shape has stopped moving.
 */
export async function getSnapshot(roomId: string): Promise<Snapshot> {
  const [snap, match] = await Promise.all([
    rpc("dw_snapshot", { p_room_id: roomId }) as Promise<unknown>,
    rpcOptional("dw_match_snapshot", { p_room_id: roomId }),
  ]);

  const typed = snap as Snapshot & { ok: boolean; message?: string };
  if (!typed.ok) {
    throw new EngineError("ROOM_NOT_FOUND", typed.message ?? "Room not found.", 404);
  }

  const wrapper = match as { ok?: boolean; match?: MatchSnapshot | null };
  typed.match = wrapper?.ok ? (wrapper.match ?? null) : null;
  return typed;
}

// ---------------------------------------------------------------------------
// Matches (S8)
// ---------------------------------------------------------------------------

/**
 * Opens a match on a room sitting in the lobby.
 *
 * The round count is derived from the table size rather than configured: two
 * players play six rounds because with one possible pairing every round is the
 * same duel. The pool check runs here, before anything is drawn, so a match
 * that cannot be drafted is refused at the point somebody can still fix it —
 * the same reason `startGame` checks it before the first character opens.
 */
export async function startMatch(
  roomId: string,
  playerId: string,
): Promise<{ matchId: string; roundCount: number }> {
  const snap = await getSnapshot(roomId);
  const playerCount = Math.max(1, snap.players.length);
  const roundCount = totalRoundsFor(playerCount);

  const categories = (snap.room.config.categories ?? []).filter((id) =>
    CATEGORIES.some((c) => c.id === id),
  );

  if (categories.length > 0) {
    const pool = (await getDraftableCharacters()).filter((c) =>
      categories.includes(c.categoryId),
    );
    const needed = minimumPoolFor(playerCount);
    if (pool.length < needed) {
      throw new EngineError(
        "POOL_TOO_SMALL",
        `A ${playerCount}-player match needs ${needed} characters and that selection has ${pool.length}. Mix in another category.`,
        409,
      );
    }
  }

  const result = await rpcOrThrow("dw_start_match", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_seed: randomSeed(),
    p_round_count: roundCount,
    p_category_ids: categories,
    p_intro_seconds: PHASE_SECONDS.MATCH_INTRO,
  });

  return { matchId: String(result.matchId), roundCount };
}

/**
 * Moves a match on by exactly one phase.
 *
 * The destination is computed here and checked again in SQL against the same
 * derivation, so neither the host's browser nor this process can name a phase
 * the machine would not have chosen for itself. `playerId` is null when the
 * clock is driving, which is how any client can advance an expired phase
 * without being the host.
 */
export async function advanceMatchPhase(
  roomId: string,
  playerId: string | null,
): Promise<{ phase: MatchPhase; roundNo: number; noop: boolean } | null> {
  const snap = await getSnapshot(roomId);
  const match = snap.match;
  if (!match || match.status !== "ACTIVE") return null;
  if (!isMatchPhase(match.phase)) {
    throw new EngineError("UNKNOWN_PHASE", "That is not a phase of a match.", 409);
  }

  const to = nextPhaseOf(match.phase, {
    ...match,
    liveCount: match.players.filter((p) => p.eliminatedAt === null && p.hp > 0).length,
  });
  if (to === null) return null;

  const result = await rpcOrThrow("dw_advance_match_phase", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_from: match.phase,
    p_to: to,
    p_deadline_seconds: PHASE_SECONDS[to],
  });

  const phase = (result.phase as MatchPhase) ?? to;
  const roundNo = Number(result.roundNo ?? match.roundNo);
  // Somebody else applied this step between our read and our write. The
  // database is right either way — but reporting it as a success is not: the
  // caller would believe it caused a transition it did not cause, and a UI
  // built on that belief shows a phase that has already moved on.
  const noop = result.noop === true;

  // Arriving at a round's draft opens it. Done here rather than in SQL because
  // the queue is selected in TypeScript — the same place, and for the same
  // reason, as the legacy draft's queue.

  // FINAL_COMBAT needs its matchup (or direct champion) before the fight runs.
  if (phase === "FINAL_COMBAT" && !noop) {
    try {
      await pairFinalRound(roomId);
    } catch (err) {
      // Pairing failed but the phase moved. The tick fires NEEDS_COMBAT for
      // FINAL_COMBAT when the FINAL matchup is absent, which retries both
      // pairFinalRound and resolveRoundCombat.
      console.error("[DRAFT WAR] final combat pairing failed; the tick will retry", err);
    }
  }

  if ((phase === "COMBAT" || phase === "FINAL_COMBAT") && !noop) {
    try {
      await resolveRoundCombat(roomId);
    } catch (err) {
      // The phase has moved and the fights are recoverable: the guard refuses
      // to leave COMBAT while any matchup is unresolved, and the next tick
      // reports NEEDS_COMBAT.
      console.error("[DRAFT WAR] round combat did not resolve; the tick will retry", err);
    }
  }

  if (phase === "MATCHMAKING" && !noop) {
    try {
      await pairMatchRound(roomId);
    } catch (err) {
      // As with the draft below: the phase moved, and the next tick reports
      // NEEDS_ROUND_PAIRING for a round that has none. The phase guard will not
      // let the match leave MATCHMAKING unpaired, so this cannot skip a round.
      console.error("[DRAFT WAR] round pairing failed; the tick will retry", err);
    }
  }

  if (phase === "AUCTION" && !noop) {
    try {
      await startRoundAuction(roomId);
    } catch (err) {
      // The phase has already moved, and the draft is recoverable: the next
      // tick sees a round at AUCTION with no game and reports
      // NEEDS_ROUND_AUCTION. Failing the host's request here would report an
      // error about a transition that did succeed, and invite them to tap
      // again — which the dwell guard would then refuse.
      console.error("[DRAFT WAR] round auction did not open; the tick will retry", err);
    }
  }

  return { phase, roundNo, noop };
}

/**
 * Opens the draft for the round a match is currently on.
 *
 * The pool is the match's categories minus everything the match has already
 * sold, so a character can be won once and never appears again — enforced
 * twice over, here by exclusion and in the database by
 * `match_acquisitions (match_id, character_id)`. A filter is a good first line
 * and a poor only line.
 *
 * Selection is deterministic in `${match.seed}:${round}`, so the same match on
 * the same round always opens with the same characters. What happens to them
 * is decided by the people bidding.
 */
export async function startRoundAuction(roomId: string): Promise<void> {
  const snap = await getSnapshot(roomId);
  const match = snap.match;
  if (!match || match.status !== "ACTIVE") return;
  if (match.phase !== "AUCTION") return;
  if (match.roundGameId) return;

  const consumed = new Set(match.acquisitions.map((a) => a.characterId));
  const categories = match.categoryIds.length ? match.categoryIds : [LEGACY_CATEGORY_ID];

  const pool = (await getDraftableCharacters()).filter(
    (c) => categories.includes(c.categoryId) && !consumed.has(c.id),
  );

  if (pool.length === 0) {
    throw new EngineError(
      "POOL_EXHAUSTED",
      "This match has drafted every character in its categories.",
      409,
    );
  }

  const live = match.players.filter((p) => p.eliminatedAt === null).length;
  const seed = `${match.seed}:${match.roundNo}`;
  const queue = buildAuctionQueue(pool, snap.room.config, seed, roundQueueSize(live));

  await rpcOrThrow("dw_start_round_auction", {
    p_room_id: roomId,
    p_seed: seed,
    p_queue: queue,
  });
}

/**
 * Decides and stores who fights whom this round.
 *
 * The decision is `pairRound`'s — a pure function with its own test and
 * mutation suite — and this is the plumbing around it: gather the seats and the
 * history the server already holds, hand them over, write the answer once.
 *
 * Idempotent twice over. `dw_pair_round` refuses a round that already has
 * pairings, and the pairing itself is deterministic, so a retry that somehow
 * got past that would be writing the same rows anyway.
 */
export async function pairMatchRound(roomId: string): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (!snap.match) return;

  const characters = await getCharacters();
  const powerOf = new Map(characters.map((c) => [c.id, c.gamePower]));
  const seatOf = new Map(snap.players.map((p) => [p.id, p.seat]));

  // Whether to pair at all, and what to pair with, are both decided by a pure
  // function that tests can execute — see `pairingInputFor`.
  const question = pairingInputFor(
    snap.match,
    (playerId) => seatOf.get(playerId) ?? 0,
    (characterId) => powerOf.get(characterId),
  );
  if (!question) return;

  const pairings = pairRound(question);
  if (pairings.length === 0) return;

  await rpcOrThrow("dw_pair_round", {
    p_room_id: roomId,
    p_pairings: pairings.map((p) => ({
      playerA: p.playerA,
      playerB: p.playerB,
      kind: p.kind,
      ratingA: p.ratingA,
      ratingB: p.ratingB,
      reason: p.reason,
    })),
  });
}

/**
 * Pairs the final combat (FINAL_COMBAT phase).
 *
 * Delegates entirely to `dw_pair_final_round`, which handles three survivor
 * counts without a pairings argument:
 *   1  → sets champion_player_id directly; no matchup inserted.
 *   2  → inserts a FINAL matchup; the fight decides the champion.
 *   3+ → highest HP (then round_wins, then player_id) is champion; no fight.
 *
 * Idempotent: dw_pair_final_round is a noop when champion_player_id is already
 * set or a FINAL matchup already exists. Safe to call from the tick retry path.
 */
export async function pairFinalRound(roomId: string): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (!snap.match) return;
  if (snap.match.phase !== "FINAL_COMBAT") return;
  await rpcOrThrow("dw_pair_final_round", { p_room_id: roomId });
}

/**
 * Fights every unresolved matchup of the round the match is on.
 *
 * The engine is the existing `simulateBattle` — seeded, pure and already
 * replayed frame-aligned across phones. Everything around it comes from
 * `combat.ts`, which has its own tests, so this function is plumbing: read the
 * boards the auction produced, hand them over, write the answer down.
 *
 * Each matchup is resolved by its own call, and `dw_resolve_matchup` locks the
 * matchup row rather than the match — two fights in one round do not wait on
 * each other, and neither can be fought twice.
 */
export async function resolveRoundCombat(roomId: string): Promise<void> {
  const snap = await getSnapshot(roomId);
  const match = snap.match;
  if (!match) return;

  const characters = await getCharacters();
  const charactersById = Object.fromEntries(characters.map((c) => [c.id, c]));
  const categories = match.categoryIds.length ? match.categoryIds : [LEGACY_CATEGORY_ID];
  const seatOf = new Map(snap.players.map((p) => [p.id, p]));
  const realPlayerIds = new Set(match.players.map((p) => p.playerId));

  // liveCount is fixed once at round start (before any fights resolve).
  // All fights in this round use the same multiplier regardless of whether
  // an earlier fight in the same round caused an elimination.
  const roundLiveCount = match.players.filter(
    (p) => p.eliminatedAt === null && p.hp > 0,
  ).length;

  // Which fights are owed, and their inputs, are decided by a pure function
  // with its own tests — see `combatPlanFor`.
  const plan = combatPlanFor(match, {
    charactersById,
    bands: computeAxisBands(characters),
    seatOf: (playerId) => ({
      nickname: seatOf.get(playerId)?.nickname ?? "\u2014",
      formation: seatOf.get(playerId)?.formation,
    }),
  });

  for (const fight of plan) {
    const { result, outcome } = fightOne(fight.input, match.roundNo, realPlayerIds, roundLiveCount);
    await rpcOrThrow("dw_resolve_matchup", {
      p_room_id: roomId,
      p_pairing_index: fight.pairingIndex,
      p_result: result,
      p_winner_player_id: outcome.winnerPlayerId,
      p_loser_player_id: outcome.loserPlayerId,
      p_damage: outcome.damage,
      p_ghost_player_id: fight.ghostPlayerId,
    });
  }
}

export async function abandonMatch(roomId: string, playerId: string): Promise<void> {
  await rpcOrThrow("dw_abandon_match", { p_room_id: roomId, p_player_id: playerId });
}

// ---------------------------------------------------------------------------
// Character pool
// ---------------------------------------------------------------------------

let characterCache: { at: number; rows: Character[] } | null = null;

interface CharacterRow {
  id: string;
  name: string;
  title: string;
  universe: string;
  rarity: string;
  category: string;
  version: string | null;
  description: string | null;
  actor: string | null;
  stats: Record<string, number> | null;
  game_power: number | null;
  abilities: string[] | null;
  tags: string[] | null;
  base_price: number;
  wiki_title: string | null;
  wiki_url: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  image_source: string | null;
  image_license: string | null;
  image_credit: string | null;
  palette: string[] | null;
  enabled: boolean;
  power: number;
  speed: number;
  defense: number;
  tactics: number;
  special: number;
}

function toCharacter(r: CharacterRow): Character {
  return {
    id: r.id,
    name: r.name,
    categoryId: r.category ?? LEGACY_CATEGORY_ID,
    universe: r.universe,
    version: r.version,
    title: r.title,
    description: r.description ?? "",
    actor: r.actor,
    rarity: (r.rarity as Character["rarity"]) ?? "RARE",
    // A V1 row that predates the stats column still renders through this
    // fallback rather than exploding.
    stats:
      r.stats && Object.keys(r.stats).length
        ? r.stats
        : {
            combat: r.power,
            speed: r.speed,
            weapons: r.special,
            tactics: r.tactics,
            durability: r.defense,
            special: r.special,
          },
    gamePower:
      r.game_power ||
      Math.round((r.power + r.speed + r.defense + r.tactics + r.special) / 5),
    abilities: r.abilities ?? [],
    tags: r.tags ?? [],
    basePrice: r.base_price,
    wikiTitle: r.wiki_title,
    wikiUrl: r.wiki_url,
    imageUrl: r.image_url,
    thumbnailUrl: r.thumbnail_url,
    imageSource: r.image_source,
    imageLicense: r.image_license,
    imageCredit: r.image_credit,
    palette: (r.palette ?? ["#7c3aed", "#22d3ee"]) as [string, string],
  };
}

/**
 * Every character, enabled or not. Retired V1 rows still need to resolve so a
 * finished game's roster keeps rendering; drafting filters separately.
 */
export async function getCharacters(): Promise<Character[]> {
  if (characterCache && Date.now() - characterCache.at < 60_000) {
    return characterCache.rows;
  }
  const { data, error } = await supabaseAdmin()
    .from("characters")
    .select("*")
    .order("id");
  if (error) throw new EngineError("DB_ERROR", error.message, 500);

  const rows = ((data ?? []) as CharacterRow[]).map(toCharacter);
  if (rows.length === 0) {
    throw new EngineError(
      "NO_CHARACTERS",
      "The character pool is empty. Run the 0004 seed migration.",
      500,
    );
  }
  characterCache = { at: Date.now(), rows };
  return rows;
}

/** Only characters that may be drafted. */
export async function getDraftableCharacters(): Promise<Character[]> {
  const { data, error } = await supabaseAdmin()
    .from("characters")
    .select("*")
    .eq("enabled", true)
    .order("id");
  if (error) throw new EngineError("DB_ERROR", error.message, 500);
  return ((data ?? []) as CharacterRow[]).map(toCharacter);
}

export function invalidateCharacterCache(): void {
  characterCache = null;
}

export async function charactersById(): Promise<Record<string, Character>> {
  const rows = await getCharacters();
  return Object.fromEntries(rows.map((c) => [c.id, c]));
}

export async function categoryCounts(): Promise<Record<string, number>> {
  const result = (await rpc("dw_category_counts", {})) as unknown;
  return (result ?? {}) as Record<string, number>;
}

// ---------------------------------------------------------------------------
// Category selection
// ---------------------------------------------------------------------------

const ALL_CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** Most categories a single game may mix. */
const MAX_MIXED_CATEGORIES = 4;

/**
 * Keeps only real category ids, in order, without duplicates.
 *
 * Deliberately does NOT cap the length. An earlier version capped at four here
 * and the cap silently leaked onto the vote ballot: the ballot was trimmed to
 * the first four categories, so votes for anything after them were discarded
 * and a minority could win. Capping is a property of a *selection*, not of a
 * list of valid ids.
 */
function sanitizeCategories(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !ALL_CATEGORY_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A selection of categories to actually play, capped for crossovers. */
function limitSelection(ids: string[]): string[] {
  return ids.slice(0, MAX_MIXED_CATEGORIES);
}

/**
 * Host pressed START. If the room is already pinned to categories and the host
 * is choosing, we go straight to the auction; otherwise the CATEGORY phase
 * opens for a pick, a vote or a dramatic random reveal.
 */
export async function beginCategorySelection(
  roomId: string,
  playerId: string,
  mode: "HOST" | "VOTE" | "RANDOM",
  seconds: number,
): Promise<void> {
  await rpcOrThrow("dw_begin_category", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_mode: mode,
    p_candidates: ALL_CATEGORY_IDS,
    p_seconds: mode === "HOST" ? null : seconds,
  });
}

/**
 * Resolves whatever the CATEGORY phase was waiting for and starts the game.
 * Idempotent through `dw_lock_category`: a host click racing the vote deadline
 * cannot produce two different categories.
 */
export async function lockCategory(
  roomId: string,
  explicit?: string[],
): Promise<string[]> {
  const snap = await getSnapshot(roomId);
  if (snap.room.phase !== "CATEGORY") return [];

  let chosen = limitSelection(sanitizeCategories(snap.room.categoryIds));

  if (chosen.length === 0) {
    const candidates = sanitizeCategories(snap.room.categoryCandidates);
    const ballot = candidates.length ? candidates : ALL_CATEGORY_IDS;
    const rng = createRng(`category:${roomId}:${snap.room.stateVersion}`);

    if (explicit && explicit.length) {
      chosen = limitSelection(sanitizeCategories(explicit));
    } else if (snap.room.categoryMode === "RANDOM") {
      chosen = [rng.pick(ballot)];
    } else if (snap.room.categoryMode === "VOTE") {
      chosen = [
        resolveCategoryVote(ballot, snap.categoryVotes, (options) => rng.pick(options)),
      ];
    } else {
      // HOST mode with no pick — fall back rather than stall the room.
      chosen = [rng.pick(ballot)];
    }

    const locked = await rpcOrThrow("dw_lock_category", {
      p_room_id: roomId,
      p_category_ids: chosen,
    });
    const confirmed = limitSelection(sanitizeCategories(locked.categoryIds));
    if (confirmed.length) chosen = confirmed;
  }

  return chosen;
}

/**
 * Starts the game for a room whose category is already locked. Separate from
 * locking so the "CATEGORY SELECTED" reveal has time to play on every phone
 * before the first character drops.
 */
export async function startFromLockedCategory(
  roomId: string,
  playerId: string | null,
): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (snap.room.phase !== "CATEGORY") return;
  const chosen = limitSelection(sanitizeCategories(snap.room.categoryIds));
  if (chosen.length === 0) return;
  await startGame(roomId, playerId, chosen);
}

/** Host shortcut: lock now and start immediately, skipping the reveal wait. */
export async function resolveCategoryAndStart(
  roomId: string,
  playerId: string | null,
  explicit?: string[],
): Promise<void> {
  const chosen = await lockCategory(roomId, explicit);
  if (chosen.length === 0) return;
  await startGame(roomId, playerId, chosen);
}

/** Builds the auction queue for the chosen categories and opens the auction. */
export async function startGame(
  roomId: string,
  playerId: string | null,
  categoryIds: string[],
): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (snap.room.phase === "AUCTION") return;

  const categories = categoryIds.length ? categoryIds : [LEGACY_CATEGORY_ID];
  const all = await getDraftableCharacters();
  const pool = all.filter((c) => categories.includes(c.categoryId));

  const playerCount = Math.max(1, snap.players.length);
  const perPlayer = rosterSize(snap.room.config);
  const wanted = draftSize(playerCount, snap.room.config);

  if (pool.length < wanted) {
    throw new EngineError(
      "POOL_TOO_SMALL",
      `That category has ${pool.length} characters but this game needs ${wanted}.`,
      409,
    );
  }

  // The game pool is drawn ONCE, here, before the first character opens, and
  // is persisted with the game. The client never sees the wider category pool
  // and cannot influence which characters were drawn.
  const seed = randomSeed();
  // Required allocations plus a reserve, so passing is a legal move and an
  // unsold character can be replaced instead of shrinking the draft.
  const queue = buildAuctionQueue(
    pool,
    snap.room.config,
    seed,
    queueSize(playerCount, snap.room.config, pool.length),
  );

  await rpcOrThrow("dw_start_game", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_seed: seed,
    p_queue: queue,
    p_per_player: perPlayer,
    p_category_ids: categories,
  });
}

// ---------------------------------------------------------------------------
// Map, event, battle
// ---------------------------------------------------------------------------

/** Three map candidates for the vote, drawn from the game seed. */
export function pickMapCandidates(seed: string): string[] {
  return createRng(`maps:${seed}`)
    .shuffle(MAPS.map((m) => m.id))
    .slice(0, 3);
}

export async function beginMapSelection(
  roomId: string,
  playerId: string | null,
): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (snap.room.phase !== "TEAM_REVIEW" || !snap.game) return;
  await rpcOrThrow("dw_advance_phase", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_from: "TEAM_REVIEW",
    p_to: "MAP_SELECTION",
    p_deadline_seconds: snap.room.config.mapVoteSeconds ?? 20,
    p_map_candidates: pickMapCandidates(snap.game.seed),
  });
}

/** Tallies the map vote (ties broken by the seed) and draws the event card. */
export async function lockBattlefield(roomId: string): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (!snap.game || snap.game.mapId) return;

  const candidates =
    snap.game.mapCandidates?.filter((id) => MAPS_BY_ID[id]) ?? [];
  const ballot = candidates.length ? candidates : MAPS.map((m) => m.id);

  const tally = new Map<string, number>();
  for (const mapId of Object.values(snap.mapVotes)) {
    if (ballot.includes(mapId)) tally.set(mapId, (tally.get(mapId) ?? 0) + 1);
  }

  const rng = createRng(`lock:${snap.game.seed}`);
  const best = Math.max(0, ...ballot.map((id) => tally.get(id) ?? 0));
  const leaders = ballot.filter((id) => (tally.get(id) ?? 0) === best);
  const mapId = leaders.length === 1 ? leaders[0] : rng.pick(leaders);
  const eventId = rng.pick(EVENT_CARDS).id;

  await rpcOrThrow("dw_lock_battlefield", {
    p_game_id: snap.game.id,
    p_map_id: mapId,
    p_event_id: eventId,
  });
}

/** Runs the simulation and stores it. `dw_store_battle` makes this idempotent. */
export async function runBattle(roomId: string): Promise<void> {
  const snap = await getSnapshot(roomId);
  if (!snap.game || snap.game.battleResult) return;
  if (!snap.game.mapId || !snap.game.eventId) return;

  const all = await getCharacters();
  const byId = Object.fromEntries(all.map((c) => [c.id, c]));

  const teams = snap.players
    .filter((p) => p.roster.length > 0)
    .map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      characters: p.roster,
      formation: p.formation,
    }));

  if (teams.length < 2) {
    throw new EngineError(
      "NOT_ENOUGH_TEAMS",
      "At least two teams are needed for a battle.",
      409,
    );
  }

  const categoryIds = snap.game.categoryIds?.length
    ? snap.game.categoryIds
    : [LEGACY_CATEGORY_ID];

  const result = simulateBattle({
    teams,
    map: MAPS_BY_ID[snap.game.mapId],
    event: EVENTS_BY_ID[snap.game.eventId],
    charactersById: byId,
    seed: `${snap.game.seed}:${snap.game.gameNo}`,
    categoryIds,
    // Bands come from the FULL pool of each category, not the drafted twenty,
    // so the crossover scale does not move with the luck of a draft.
    bands: computeAxisBands(all),
  });

  const stored = await rpcOrThrow("dw_store_battle", {
    p_game_id: snap.game.id,
    p_result: result,
  });

  // Progression is paid out from the stored result, server-side. A repeated
  // tick lands on `noop` here and on the ledger's unique index there, so a
  // match can never pay twice.
  if (!stored.noop) {
    const { awardMatchRewards } = await import("./profile");
    try {
      await awardMatchRewards(
        roomId,
        snap.game.id,
        snap.room.code,
        result,
        Boolean(snap.room.config.ranked),
      );
    } catch (err) {
      // A reward failure must never cost anybody the battle they just played.
      console.error("[DRAFT WAR] match rewards failed", err);
    }
  }
}

/**
 * Applies whatever the clock owes the room, then returns a fresh snapshot.
 * Every connected client calls this; concurrent calls converge on the same
 * state because each individual step is guarded in SQL.
 */
export async function tickRoom(roomId: string): Promise<Snapshot> {
  // Two clocks, both idempotent, both callable by any client. The match clock
  // is a separate function rather than a branch inside `dw_tick` so the legacy
  // path is byte-for-byte the one that has been running in production.
  const [tick, matchTick] = await Promise.all([
    rpc("dw_tick", { p_room_id: roomId }),
    rpcOptional("dw_match_tick", { p_room_id: roomId }),
  ]);

  const actions = [
    ...((tick.actions as string[] | undefined) ?? []),
    ...((matchTick?.actions as string[] | undefined) ?? []),
  ];

  for (const action of actions) {
    try {
      if (action === "NEEDS_CATEGORY_LOCK") await lockCategory(roomId);
      else if (action === "NEEDS_GAME_START") await startFromLockedCategory(roomId, null);
      else if (action === "NEEDS_MAP_SELECTION") await beginMapSelection(roomId, null);
      else if (action === "NEEDS_MAP_LOCK") await lockBattlefield(roomId);
      else if (action === "NEEDS_BATTLE") await runBattle(roomId);
      else if (action === "MATCH_PHASE_EXPIRED") await advanceMatchPhase(roomId, null);
      else if (action === "NEEDS_ROUND_AUCTION") await startRoundAuction(roomId);
      // The draft closed itself. The phase move belongs here rather than in
      // SQL so the deadline table stays in one file.
      else if (action === "ROUND_AUCTION_COMPLETE") await advanceMatchPhase(roomId, null);
      else if (action === "NEEDS_ROUND_PAIRING") await pairMatchRound(roomId);
      else if (action === "NEEDS_COMBAT") {
        // For FINAL_COMBAT, pair first (idempotent noop for regular COMBAT).
        await pairFinalRound(roomId);
        await resolveRoundCombat(roomId);
      }
      // The final fight (or direct champion crown for 1/3+ survivors) is done.
      // dw_match_tick fires this; dw_advance_match_phase handles the guard.
      else if (action === "FINAL_COMBAT_DONE") await advanceMatchPhase(roomId, null);
    } catch (err) {
      // A losing race is expected here (another client got there first).
      if (!(err instanceof EngineError)) throw err;
    }
  }

  return getSnapshot(roomId);
}
