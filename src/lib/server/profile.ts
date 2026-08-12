import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EngineError, rpc, rpcOrThrow } from "@/lib/server/engine";
import { errorResponse } from "@/lib/server/session";
import {
  coinsForMatch,
  levelFromXp,
  rankDelta,
  rankFromPoints,
  totalCoins,
  totalXp,
  xpForMatch,
  type CoinLine,
  type XpBreakdown,
} from "@/lib/game/progression";
import type { BattleResult } from "@/lib/game/types";

/**
 * Accounts without accounts.
 *
 * A profile is a `(profileId, token)` pair minted when somebody picks a
 * username, stored in the browser and presented as headers — the same shape as
 * the per-room player session, but persistent and room-independent. No email,
 * no password, no OAuth round trip, and the game stays playable with no
 * profile at all.
 *
 * The trade-off is honest and worth stating: the account lives in one browser.
 * Signing in on a second device is a future feature, and the token table is
 * ready for it.
 */

export const PROFILE_ID_HEADER = "x-dw-profile";
export const PROFILE_TOKEN_HEADER = "x-dw-profile-token";

export interface AuthedProfile {
  profileId: string;
}

/** Resolves the caller's profile, or null when they are playing as a guest. */
export async function optionalProfile(
  request: Request,
): Promise<AuthedProfile | null> {
  const profileId = request.headers.get(PROFILE_ID_HEADER);
  const token = request.headers.get(PROFILE_TOKEN_HEADER);
  if (!profileId || !token) return null;

  const { data, error } = await supabaseAdmin()
    .from("profile_secrets")
    .select("token")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) throw new EngineError("DB_ERROR", error.message, 500);
  if (!data || (data as { token: string }).token !== token) return null;
  return { profileId };
}

/** Same, but refuses the request when there is no valid profile. */
export async function requireProfile(
  request: Request,
): Promise<AuthedProfile | NextResponse> {
  const profile = await optionalProfile(request);
  if (!profile) {
    return errorResponse("NO_PROFILE", "Create a DRAFT WAR profile first.", 401);
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Match rewards
// ---------------------------------------------------------------------------

export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
  tier: string;
  category: string;
  coins: number;
  xp: number;
  item: string | null;
}

export interface RewardLine {
  profileId: string;
  username: string;
  placement: number;
  xp: number;
  breakdown: XpBreakdown[];
  coins: number;
  coinBreakdown: CoinLine[];
  coinBalance: number;
  unlocked: UnlockedAchievement[];
  rankDelta: number;
  levelBefore: number;
  levelAfter: number;
  rankBefore: string;
  rankAfter: string;
  levelledUp: boolean;
}

interface SeatRow {
  id: string;
  nickname: string;
  profile_id: string | null;
  credits: number;
}

/**
 * Pays out a finished battle.
 *
 * Server-authoritative and idempotent: the amounts are computed here from the
 * stored result, and `dw_award_match` refuses a second payout for the same
 * (profile, match) pair. A client can neither claim a win nor claim it twice.
 *
 * Guests are skipped silently — they played, they just have nowhere to bank it.
 */
export async function awardMatchRewards(
  roomId: string,
  gameId: string,
  roomCode: string,
  result: BattleResult,
  ranked: boolean,
): Promise<RewardLine[]> {
  const { data, error } = await supabaseAdmin()
    .from("players")
    .select("id, nickname, profile_id, credits")
    .eq("room_id", roomId);
  if (error) throw new EngineError("DB_ERROR", error.message, 500);

  const seats = (data ?? []) as SeatRow[];
  const withProfile = seats.filter((s) => s.profile_id);
  if (withProfile.length === 0) return [];

  const playerCount = result.teams.length;

  // One call per player, and the players in parallel. Each call is one
  // transaction on the database side, so a five-player settlement is one round
  // trip deep rather than twenty — the players are waiting on this.
  const settled = await Promise.all(
    withProfile.map(async (seat): Promise<RewardLine | null> => {
      const team = result.teams.find((t) => t.playerId === seat.id);
      if (!team) return null;

      const mine = result.combatants.filter((c) => c.playerId === seat.id);
      const isMvp = result.mvp?.playerId === seat.id;
      const creditsSpent = mine.reduce((sum, c) => sum + c.price, 0);
      const priciest = [...mine].sort((a, b) => b.price - a.price)[0];

      const breakdown = xpForMatch({
        rank: team.rank,
        playerCount,
        isMvp,
        charactersDrafted: mine.length,
        ranked,
      });
      const xp = totalXp(breakdown);
      const coinLines = coinsForMatch({
        rank: team.rank,
        playerCount,
        isMvp,
        charactersDrafted: mine.length,
        ranked,
      });
      const coins = totalCoins(coinLines);
      const delta = ranked ? rankDelta(team.rank, playerCount) : 0;

      const summary = {
        roomCode,
        placement: team.rank,
        playerCount,
        isMvp,
        mvpCharacter: isMvp ? result.mvp?.characterId : null,
        charactersDrafted: mine.length,
        creditsSpent,
        mostExpensivePrice: priciest?.price ?? 0,
        mostExpensiveName: priciest?.characterId ?? null,
        teamRating: team.teamRating,
        categoryIds: result.categoryIds,
        mapId: result.mapId,
        eventId: result.eventId,
        roster: mine.map((c) => ({ characterId: c.characterId, price: c.price })),
      };

      // dw_settle_match runs the same four steps in the same order — sync
      // challenges, award the match, pay the coins, evaluate achievements —
      // inside one transaction. Each remains independently idempotent, so a
      // battle stored twice still pays once.
      const settlement = await rpcOrThrow("dw_settle_match", {
        p_game_id: gameId,
        p_profile_id: seat.profile_id,
        p_xp: xp,
        p_rank_delta: delta,
        p_ranked: ranked,
        p_summary: summary,
        p_coins: coins,
        p_coin_detail: {
          roomCode,
          placement: team.rank,
          playerCount,
          isMvp,
          lines: coinLines,
        },
      });

      const awarded = (settlement.match ?? {}) as Record<string, unknown>;
      const paid = (settlement.coins ?? {}) as Record<string, unknown>;

      // A repeat call returns early; report the line without pretending it paid.
      const alreadyAwarded = Boolean(awarded.alreadyAwarded);
      const coinsPaid = Number(paid.amount ?? 0);
      const totalAfter = Number(awarded.totalXp ?? 0);
      const levelAfter = Number(awarded.level ?? 1);
      const levelBefore = levelFromXp(Math.max(0, totalAfter - xp)).level;
      const rpBefore = Number(awarded.rankPointsBefore ?? 0);
      const rpAfter = Number(awarded.rankPointsAfter ?? rpBefore);

      return {
        profileId: seat.profile_id!,
        username: seat.nickname,
        placement: team.rank,
        xp: alreadyAwarded ? 0 : xp,
        breakdown: alreadyAwarded ? [] : breakdown,
        coins: coinsPaid,
        coinBreakdown: coinsPaid > 0 ? coinLines : [],
        coinBalance: Number(paid.balance ?? 0),
        unlocked: (settlement.unlocked ?? []) as UnlockedAchievement[],
        rankDelta: alreadyAwarded ? 0 : delta,
        levelBefore,
        levelAfter,
        rankBefore: rankFromPoints(rpBefore).label,
        rankAfter: rankFromPoints(rpAfter).label,
        levelledUp: !alreadyAwarded && levelAfter > levelBefore,
      };
    }),
  );

  return settled.filter((line): line is RewardLine => line !== null);
}

/** Every league this profile belongs to. */
export async function getMyLeagues(profileId: string) {
  const data = await rpc("dw_my_leagues", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "LEAGUES_ERROR"), String(data.message), 500);
  }
  return data;
}

/** One league's table, derived from the matches its members actually played. */
export async function getLeagueStandings(leagueId: string) {
  const data = await rpc("dw_league_standings", { p_league_id: leagueId });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "NO_SUCH_LEAGUE"), String(data.message), 404);
  }
  return data;
}

/** Mastery per character, and the collection per category. */
export async function getCollection(profileId: string) {
  const [mastery, collection] = await Promise.all([
    rpc("dw_character_mastery", { p_profile_id: profileId, p_limit: 200 }),
    rpc("dw_collection", { p_profile_id: profileId }),
  ]);
  if (mastery.ok === false || collection.ok === false) {
    throw new EngineError("COLLECTION_ERROR", "Could not read the collection.", 500);
  }
  return { ...collection, ok: true, characters: mastery.characters };
}

/** A rivalry record between two profiles, derived from match history. */
export async function getHeadToHead(profileId: string, rivalId: string) {
  const data = await rpc("dw_head_to_head", {
    p_profile_id: profileId,
    p_rival_id: rivalId,
  });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "H2H_ERROR"), String(data.message), 404);
  }
  return data;
}

/** Friends, plus requests in both directions. */
export async function getFriends(profileId: string) {
  const data = await rpc("dw_friends", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "FRIENDS_ERROR"), String(data.message), 404);
  }
  return data;
}

/** The inbox, newest first, with the unread count. */
export async function getNotifications(profileId: string, limit = 30) {
  const data = await rpc("dw_notifications", { p_profile_id: profileId, p_limit: limit });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "NOTIFICATIONS_ERROR"), String(data.message), 404);
  }
  return data;
}

/**
 * The live challenges with the caller's progress.
 *
 * This both reads and assigns: a profile that has not seen today's tasks gets
 * them here, with its current metrics snapshotted as the baseline they will be
 * measured from.
 */
export async function getChallenges(profileId: string) {
  const data = await rpc("dw_sync_challenges", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "CHALLENGES_ERROR"), String(data.message), 500);
  }
  return data;
}

/** Every achievement with the caller's progress against it. */
export async function getAchievements(profileId: string | null) {
  const data = await rpc("dw_achievements", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "ACHIEVEMENTS_ERROR"), String(data.message), 500);
  }
  return data;
}

/**
 * The shop front. Works for a guest too — they can browse, they just have no
 * balance and nothing to buy with.
 */
export async function getShop(profileId: string | null) {
  const data = await rpc("dw_shop", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(String(data.code ?? "SHOP_ERROR"), String(data.message), 500);
  }
  return data;
}

/** What a profile owns and what it is wearing. */
export async function getInventory(profileId: string) {
  const data = await rpc("dw_inventory", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(
      String(data.code ?? "PROFILE_NOT_FOUND"),
      String(data.message ?? "Profile not found."),
      404,
    );
  }
  return data;
}

/** Wallet balance plus the recent ledger — the receipt for every coin held. */
export async function getCoinLedger(profileId: string, limit = 25) {
  const data = await rpc("dw_coin_ledger", { p_profile_id: profileId, p_limit: limit });
  if (data.ok === false) {
    throw new EngineError(
      String(data.code ?? "PROFILE_NOT_FOUND"),
      String(data.message ?? "Profile not found."),
      404,
    );
  }
  return data;
}

export async function getProfile(profileId: string) {
  const data = await rpc("dw_profile", { p_profile_id: profileId });
  if (data.ok === false) {
    throw new EngineError(
      String(data.code ?? "PROFILE_NOT_FOUND"),
      String(data.message ?? "Profile not found."),
      404,
    );
  }
  return data;
}
