import { supabaseAdmin } from "@/lib/supabase/admin";
import { createRng, randomSeed } from "@/lib/game/rng";
import { computeAxisBands, simulateBattle } from "@/lib/game/battle";
import { buildAuctionQueue, charactersPerPlayer } from "@/lib/game/auction";
import { MAPS, MAPS_BY_ID } from "@/lib/game/maps";
import { EVENT_CARDS, EVENTS_BY_ID } from "@/lib/game/events";
import { CATEGORIES, LEGACY_CATEGORY_ID } from "@/lib/game/categories";
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

export async function getSnapshot(roomId: string): Promise<Snapshot> {
  const snap = (await rpc("dw_snapshot", { p_room_id: roomId })) as unknown;
  const typed = snap as Snapshot & { ok: boolean; message?: string };
  if (!typed.ok) {
    throw new EngineError("ROOM_NOT_FOUND", typed.message ?? "Room not found.", 404);
  }
  return typed;
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

function sanitizeCategories(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((id): id is string => typeof id === "string")
    .filter((id) => ALL_CATEGORY_IDS.includes(id))
    .slice(0, 4);
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

  let chosen = sanitizeCategories(snap.room.categoryIds);

  if (chosen.length === 0) {
    const candidates = sanitizeCategories(snap.room.categoryCandidates);
    const ballot = candidates.length ? candidates : ALL_CATEGORY_IDS;
    const rng = createRng(`category:${roomId}:${snap.room.stateVersion}`);

    if (explicit && explicit.length) {
      chosen = sanitizeCategories(explicit);
    } else if (snap.room.categoryMode === "RANDOM") {
      chosen = [rng.pick(ballot)];
    } else if (snap.room.categoryMode === "VOTE") {
      const tally = new Map<string, number>();
      for (const id of Object.values(snap.categoryVotes)) {
        if (ballot.includes(id)) tally.set(id, (tally.get(id) ?? 0) + 1);
      }
      const best = Math.max(0, ...ballot.map((id) => tally.get(id) ?? 0));
      const leaders = ballot.filter((id) => (tally.get(id) ?? 0) === best);
      chosen = [leaders.length === 1 ? leaders[0] : rng.pick(leaders)];
    } else {
      // HOST mode with no pick — fall back rather than stall the room.
      chosen = [rng.pick(ballot)];
    }

    const locked = await rpcOrThrow("dw_lock_category", {
      p_room_id: roomId,
      p_category_ids: chosen,
    });
    const confirmed = sanitizeCategories(locked.categoryIds);
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
  const chosen = sanitizeCategories(snap.room.categoryIds);
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

  const perPlayer = charactersPerPlayer(
    Math.max(1, snap.players.length),
    Math.min(snap.room.config.poolSize, pool.length),
    snap.room.config.charactersPerPlayer,
  );

  if (pool.length < snap.players.length * perPlayer) {
    throw new EngineError(
      "POOL_TOO_SMALL",
      "That category does not have enough characters for this many players.",
      409,
    );
  }

  const seed = randomSeed();
  const queue = buildAuctionQueue(pool, snap.room.config, seed);

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

  await rpcOrThrow("dw_store_battle", {
    p_game_id: snap.game.id,
    p_result: result,
  });
}

/**
 * Applies whatever the clock owes the room, then returns a fresh snapshot.
 * Every connected client calls this; concurrent calls converge on the same
 * state because each individual step is guarded in SQL.
 */
export async function tickRoom(roomId: string): Promise<Snapshot> {
  const tick = await rpc("dw_tick", { p_room_id: roomId });
  const actions = (tick.actions as string[] | undefined) ?? [];

  for (const action of actions) {
    try {
      if (action === "NEEDS_CATEGORY_LOCK") await lockCategory(roomId);
      else if (action === "NEEDS_GAME_START") await startFromLockedCategory(roomId, null);
      else if (action === "NEEDS_MAP_SELECTION") await beginMapSelection(roomId, null);
      else if (action === "NEEDS_MAP_LOCK") await lockBattlefield(roomId);
      else if (action === "NEEDS_BATTLE") await runBattle(roomId);
    } catch (err) {
      // A losing race is expected here (another client got there first).
      if (!(err instanceof EngineError)) throw err;
    }
  }

  return getSnapshot(roomId);
}
