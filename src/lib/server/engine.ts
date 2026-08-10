import { supabaseAdmin } from "@/lib/supabase/admin";
import { createRng } from "@/lib/game/rng";
import { simulateBattle } from "@/lib/game/battle";
import { MAPS, MAPS_BY_ID } from "@/lib/game/maps";
import { EVENT_CARDS, EVENTS_BY_ID } from "@/lib/game/events";
import type { Character, RoomConfig } from "@/lib/game/types";

/**
 * Server-side orchestration that sits between the HTTP layer and the database
 * functions. Anything that is too complex for plpgsql (the battle simulation)
 * lives here, but every write still lands through a guarded SQL function, so
 * running this twice concurrently is safe.
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
    mapId: string | null;
    eventId: string | null;
    mapCandidates: string[] | null;
    phaseDeadline: string | null;
    battleStartedAt: string | null;
    battleResult: ReturnType<typeof simulateBattle> | null;
  } | null;
  auction: {
    id: string;
    characterId: string;
    orderIndex: number;
    status: "ACTIVE" | "SOLD" | "UNSOLD";
    currentBid: number;
    highBidderId: string | null;
    endsAt: string;
    passedPlayerIds: string[];
    winnerId: string | null;
    finalPrice: number | null;
    history: { playerId: string; amount: number; at: string }[];
  } | null;
  mapVotes: Record<string, string>;
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
  const result = (data ?? { ok: true }) as RpcResult;
  return result;
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

let characterCache: { at: number; rows: Character[] } | null = null;

export async function getCharacters(): Promise<Character[]> {
  if (characterCache && Date.now() - characterCache.at < 60_000) {
    return characterCache.rows;
  }
  const { data, error } = await supabaseAdmin()
    .from("characters")
    .select("*")
    .eq("enabled", true)
    .order("id");
  if (error) throw new EngineError("DB_ERROR", error.message, 500);

  const rows: Character[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    title: r.title,
    universe: r.universe,
    rarity: r.rarity,
    power: r.power,
    speed: r.speed,
    defense: r.defense,
    tactics: r.tactics,
    special: r.special,
    specialAbility: r.special_ability,
    tags: r.tags ?? [],
    basePrice: r.base_price,
    imageUrl: r.image_url,
    palette: (r.palette ?? ["#7c3aed", "#22d3ee"]) as [string, string],
  }));

  if (rows.length === 0) {
    throw new EngineError(
      "NO_CHARACTERS",
      "The character pool is empty. Run the 0002 seed migration.",
      500,
    );
  }
  characterCache = { at: Date.now(), rows };
  return rows;
}

export async function charactersById(): Promise<Record<string, Character>> {
  const rows = await getCharacters();
  return Object.fromEntries(rows.map((c) => [c.id, c]));
}

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

  const byId = await charactersById();
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

  const result = simulateBattle({
    teams,
    map: MAPS_BY_ID[snap.game.mapId],
    event: EVENTS_BY_ID[snap.game.eventId],
    charactersById: byId,
    seed: `${snap.game.seed}:${snap.game.gameNo}`,
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
      if (action === "NEEDS_MAP_SELECTION") await beginMapSelection(roomId, null);
      else if (action === "NEEDS_MAP_LOCK") await lockBattlefield(roomId);
      else if (action === "NEEDS_BATTLE") await runBattle(roomId);
    } catch (err) {
      // A losing race is expected here (another client got there first).
      if (!(err instanceof EngineError)) throw err;
    }
  }

  return getSnapshot(roomId);
}
