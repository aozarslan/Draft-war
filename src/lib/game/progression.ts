/**
 * ---------------------------------------------------------------------------
 * PROGRESSION (pure)
 * ---------------------------------------------------------------------------
 * Levels, XP and competitive rank. Framework-free and side-effect free so the
 * curves can be unit tested and so the client can render a projected reward
 * before the server confirms it — the server still recomputes everything and
 * its answer is the one that counts.
 *
 * Nothing in here touches auction credits. Credits live and die inside a single
 * match; XP, levels, rank points and (later) coins are the persistent layer.
 * The two are never converted into one another.
 */

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/**
 * Total XP needed to reach a level.
 *
 *   1 -> 0, 2 -> 500, 3 -> 1100, 4 -> 1800, 5 -> 2600 ...
 *
 * Each level costs 100 XP more than the last, so early levels arrive inside a
 * session or two and later ones still feel like progress rather than a wall.
 */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  let total = 0;
  for (let i = 2; i <= n; i++) total += 400 + 100 * (i - 1);
  return total;
}

export interface LevelProgress {
  level: number;
  xp: number;
  /** XP accumulated inside the current level. */
  intoLevel: number;
  /** XP the current level costs in total. */
  levelSpan: number;
  /** XP still needed for the next level. */
  toNext: number;
  /** 0..1 through the current level. */
  progress: number;
}

export function levelFromXp(xp: number): LevelProgress {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (xpForLevel(level + 1) <= total && level < 200) level++;

  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const span = ceiling - floor;
  const into = total - floor;

  return {
    level,
    xp: total,
    intoLevel: into,
    levelSpan: span,
    toNext: Math.max(0, ceiling - total),
    progress: span > 0 ? into / span : 0,
  };
}

// ---------------------------------------------------------------------------
// XP awards
// ---------------------------------------------------------------------------

export const XP_AWARDS = {
  MATCH_COMPLETED: 100,
  WIN: 250,
  TOP_THREE: 60,
  MVP: 150,
  CHARACTER_DRAFTED: 8,
} as const;

export interface MatchOutcome {
  /** 1-based finishing position. */
  rank: number;
  playerCount: number;
  isMvp: boolean;
  charactersDrafted: number;
  /** Casual matches award XP but never move rank points. */
  ranked: boolean;
}

export interface XpBreakdown {
  reason: string;
  amount: number;
}

/** Itemised so the results screen can show where the XP came from. */
export function xpForMatch(outcome: MatchOutcome): XpBreakdown[] {
  const lines: XpBreakdown[] = [
    { reason: "Match completed", amount: XP_AWARDS.MATCH_COMPLETED },
  ];
  if (outcome.rank === 1) lines.push({ reason: "Victory", amount: XP_AWARDS.WIN });
  else if (outcome.rank <= 3) lines.push({ reason: "Top three", amount: XP_AWARDS.TOP_THREE });
  if (outcome.isMvp) lines.push({ reason: "MVP", amount: XP_AWARDS.MVP });
  if (outcome.charactersDrafted > 0) {
    lines.push({
      reason: `${outcome.charactersDrafted} characters drafted`,
      amount: outcome.charactersDrafted * XP_AWARDS.CHARACTER_DRAFTED,
    });
  }
  return lines;
}

export function totalXp(lines: XpBreakdown[]): number {
  return lines.reduce((sum, l) => sum + l.amount, 0);
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

export const RANK_TIERS = [
  { id: "BRONZE", name: "Bronze", colour: "#b45309", icon: "🥉" },
  { id: "SILVER", name: "Silver", colour: "#94a3b8", icon: "🥈" },
  { id: "GOLD", name: "Gold", colour: "#fbbf24", icon: "🥇" },
  { id: "PLATINUM", name: "Platinum", colour: "#22d3ee", icon: "💠" },
  { id: "DIAMOND", name: "Diamond", colour: "#a78bfa", icon: "💎" },
  { id: "MASTER", name: "Master", colour: "#f43f5e", icon: "🔥" },
  { id: "CHAMPION", name: "Champion", colour: "#f0abfc", icon: "👑" },
] as const;

export type RankTierId = (typeof RANK_TIERS)[number]["id"];

/** Points per division, and three divisions per tier below Champion. */
const DIVISION_POINTS = 100;
const DIVISIONS_PER_TIER = 3;
const CHAMPION_FLOOR = (RANK_TIERS.length - 1) * DIVISIONS_PER_TIER * DIVISION_POINTS;

export interface RankBadge {
  tier: (typeof RANK_TIERS)[number];
  /** 3, 2 or 1 — counting down as you climb. Null for Champion. */
  division: number | null;
  label: string;
  points: number;
  /** Points at which the current division started. */
  floor: number;
  /** Points needed for the next division, null once at Champion. */
  next: number | null;
}

export function rankFromPoints(points: number): RankBadge {
  const p = Math.max(0, Math.floor(points));

  if (p >= CHAMPION_FLOOR) {
    const tier = RANK_TIERS[RANK_TIERS.length - 1];
    return {
      tier,
      division: null,
      label: tier.name,
      points: p,
      floor: CHAMPION_FLOOR,
      next: null,
    };
  }

  const index = Math.floor(p / DIVISION_POINTS);
  const tier = RANK_TIERS[Math.floor(index / DIVISIONS_PER_TIER)];
  const withinTier = index % DIVISIONS_PER_TIER;
  const division = DIVISIONS_PER_TIER - withinTier; // III -> II -> I
  const floor = index * DIVISION_POINTS;

  return {
    tier,
    division,
    label: `${tier.name} ${"I".repeat(division)}`,
    points: p,
    floor,
    next: floor + DIVISION_POINTS,
  };
}

/**
 * Rank points for a finishing position.
 *
 * The five-player table from the brief, scaled for smaller lobbies so a
 * two-player game cannot farm the same swing as a full one. Losses are
 * deliberately gentler than wins: climbing should be the default experience
 * for someone who keeps playing.
 */
export function rankDelta(rank: number, playerCount: number): number {
  const FIVE = [30, 18, 8, -5, -15];
  const clamped = Math.min(Math.max(1, rank), Math.max(2, playerCount));

  if (playerCount >= 5) return FIVE[clamped - 1] ?? -15;

  // Map the position onto the five-player curve, then soften it for the
  // smaller field.
  const scale = playerCount <= 2 ? 0.6 : playerCount === 3 ? 0.75 : 0.9;
  const slot = Math.round(((clamped - 1) / (playerCount - 1)) * (FIVE.length - 1));
  return Math.round((FIVE[slot] ?? 0) * scale);
}

/** Rank points never go below zero — nobody gets demoted out of the game. */
export function applyRankDelta(current: number, delta: number): number {
  return Math.max(0, Math.floor(current) + delta);
}
