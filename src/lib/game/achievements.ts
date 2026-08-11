/**
 * ---------------------------------------------------------------------------
 * ACHIEVEMENTS (pure)
 * ---------------------------------------------------------------------------
 * Every achievement is one metric compared against one threshold. That is a
 * deliberate constraint rather than a simplification: it means the database can
 * evaluate all of them with a single computed metrics object and a join, with
 * no per-achievement logic to keep in step between here and there.
 *
 * The rewards are coins, XP and — for the ones worth showing off — a cosmetic
 * from `items.ts` that cannot be bought at any price. Nothing awards a stat, a
 * credit or a bidding advantage, for the same reason nothing in the shop does.
 *
 * This file is the source of truth. `0013_seed_achievements.sql` is generated
 * from it (`npm run seed:achievements`).
 */

import { getItem } from "./items";

export type AchievementCategory =
  | "AUCTION"
  | "BATTLE"
  | "COLLECTION"
  | "PROGRESS"
  | "DEDICATION";

export type AchievementTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

/**
 * The metrics a profile can be measured on. Each one is computed by
 * `dw_profile_metrics` from data the server already owns — there is no metric
 * here a client reports about itself.
 */
export type AchievementMetric =
  | "matches"
  | "wins"
  | "top_three"
  | "mvps"
  | "characters_drafted"
  | "credits_spent"
  | "most_expensive_price"
  | "best_rank_points"
  | "level"
  | "items_owned"
  | "coins_earned"
  | "categories_played"
  | "daily_streak"
  | "win_streak";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  metric: AchievementMetric;
  threshold: number;
  coins: number;
  xp: number;
  /** A cosmetic that cannot be bought. Must exist in items.ts. */
  item?: string;
  /** Hidden ones are not listed until unlocked. Used sparingly. */
  hidden?: boolean;
}

export const CATEGORY_LABEL: Record<AchievementCategory, { label: string; icon: string }> = {
  AUCTION: { label: "The auction", icon: "🔨" },
  BATTLE: { label: "The battle", icon: "⚔️" },
  COLLECTION: { label: "Collection", icon: "🎒" },
  PROGRESS: { label: "Progress", icon: "📈" },
  DEDICATION: { label: "Dedication", icon: "🔥" },
};

export const TIER_STYLE: Record<AchievementTier, { label: string; colour: string }> = {
  BRONZE: { label: "Bronze", colour: "#b45309" },
  SILVER: { label: "Silver", colour: "#94a3b8" },
  GOLD: { label: "Gold", colour: "#fbbf24" },
  PLATINUM: { label: "Platinum", colour: "#22d3ee" },
};

export const ACHIEVEMENTS: Achievement[] = [
  // --- Battle ------------------------------------------------------------
  {
    id: "first-blood",
    name: "First Blood",
    description: "Finish your first match.",
    category: "BATTLE",
    tier: "BRONZE",
    metric: "matches",
    threshold: 1,
    coins: 100,
    xp: 50,
  },
  {
    id: "regular",
    name: "Regular",
    description: "Play 10 matches.",
    category: "BATTLE",
    tier: "BRONZE",
    metric: "matches",
    threshold: 10,
    coins: 250,
    xp: 150,
  },
  {
    id: "veteran",
    name: "Veteran",
    description: "Play 50 matches.",
    category: "BATTLE",
    tier: "GOLD",
    metric: "matches",
    threshold: 50,
    coins: 1000,
    xp: 600,
    item: "title-veteran",
  },
  {
    id: "winner",
    name: "Winner",
    description: "Win a match.",
    category: "BATTLE",
    tier: "BRONZE",
    metric: "wins",
    threshold: 1,
    coins: 150,
    xp: 100,
  },
  {
    id: "the-gavel",
    name: "The Gavel",
    description: "Win 10 matches.",
    category: "BATTLE",
    tier: "GOLD",
    metric: "wins",
    threshold: 10,
    coins: 800,
    xp: 500,
    item: "avatar-gavel",
  },
  {
    id: "dynasty",
    name: "Dynasty",
    description: "Win 25 matches.",
    category: "BATTLE",
    tier: "PLATINUM",
    metric: "wins",
    threshold: 25,
    coins: 2000,
    xp: 1200,
  },
  {
    id: "undefeated",
    name: "Undefeated",
    description: "Win three matches in a row.",
    category: "BATTLE",
    tier: "PLATINUM",
    metric: "win_streak",
    threshold: 3,
    coins: 1200,
    xp: 700,
    item: "title-undefeated",
  },
  {
    id: "podium",
    name: "Podium",
    description: "Finish in the top three 10 times.",
    category: "BATTLE",
    tier: "SILVER",
    metric: "top_three",
    threshold: 10,
    coins: 400,
    xp: 250,
  },
  {
    id: "most-valuable",
    name: "Most Valuable",
    description: "Be the MVP of a match.",
    category: "BATTLE",
    tier: "SILVER",
    metric: "mvps",
    threshold: 1,
    coins: 200,
    xp: 150,
  },
  {
    id: "carried",
    name: "Carried",
    description: "Be the MVP 10 times.",
    category: "BATTLE",
    tier: "GOLD",
    metric: "mvps",
    threshold: 10,
    coins: 900,
    xp: 550,
  },

  // --- Auction -----------------------------------------------------------
  {
    id: "opening-bid",
    name: "Opening Bid",
    description: "Draft 5 characters.",
    category: "AUCTION",
    tier: "BRONZE",
    metric: "characters_drafted",
    threshold: 5,
    coins: 100,
    xp: 50,
  },
  {
    id: "collector-of-talent",
    name: "Talent Scout",
    description: "Draft 100 characters.",
    category: "AUCTION",
    tier: "SILVER",
    metric: "characters_drafted",
    threshold: 100,
    coins: 500,
    xp: 300,
  },
  {
    id: "big-spender",
    name: "Big Spender",
    description: "Spend 500 credits across your drafts.",
    category: "AUCTION",
    tier: "SILVER",
    metric: "credits_spent",
    threshold: 500,
    coins: 400,
    xp: 250,
  },
  {
    id: "blank-cheque",
    name: "Blank Cheque",
    description: "Win a single character for 30 credits or more.",
    category: "AUCTION",
    tier: "GOLD",
    metric: "most_expensive_price",
    threshold: 30,
    coins: 600,
    xp: 350,
  },
  {
    id: "one-of-each",
    name: "Well Travelled",
    description: "Play a match in five different categories.",
    category: "AUCTION",
    tier: "GOLD",
    metric: "categories_played",
    threshold: 5,
    coins: 700,
    xp: 400,
  },

  // --- Progress ----------------------------------------------------------
  {
    id: "level-5",
    name: "Getting Somewhere",
    description: "Reach level 5.",
    category: "PROGRESS",
    tier: "BRONZE",
    metric: "level",
    threshold: 5,
    coins: 300,
    xp: 0,
  },
  {
    id: "level-10",
    name: "The Vault",
    description: "Reach level 10.",
    category: "PROGRESS",
    tier: "GOLD",
    metric: "level",
    threshold: 10,
    coins: 800,
    xp: 0,
    item: "avatar-vault",
  },
  {
    id: "level-25",
    name: "Institution",
    description: "Reach level 25.",
    category: "PROGRESS",
    tier: "PLATINUM",
    metric: "level",
    threshold: 25,
    coins: 2500,
    xp: 0,
  },
  {
    id: "climbing",
    name: "Climbing",
    description: "Reach 300 rank points in a season.",
    category: "PROGRESS",
    tier: "SILVER",
    metric: "best_rank_points",
    threshold: 300,
    coins: 500,
    xp: 300,
  },
  {
    id: "champion",
    name: "Champion",
    description: "Reach Champion rank.",
    category: "PROGRESS",
    tier: "PLATINUM",
    metric: "best_rank_points",
    threshold: 1800,
    coins: 3000,
    xp: 1500,
    item: "frame-champion",
  },

  // --- Collection --------------------------------------------------------
  {
    id: "dressed-up",
    name: "Dressed Up",
    description: "Own 20 cosmetics.",
    category: "COLLECTION",
    tier: "BRONZE",
    metric: "items_owned",
    threshold: 20,
    coins: 200,
    xp: 100,
  },
  {
    id: "wardrobe",
    name: "Wardrobe",
    description: "Own 30 cosmetics.",
    category: "COLLECTION",
    tier: "SILVER",
    metric: "items_owned",
    threshold: 30,
    coins: 600,
    xp: 300,
  },
  {
    id: "earner",
    name: "Earner",
    description: "Earn 5,000 coins in total.",
    category: "COLLECTION",
    tier: "SILVER",
    metric: "coins_earned",
    threshold: 5000,
    coins: 500,
    xp: 250,
  },
  {
    id: "tycoon",
    name: "Tycoon",
    description: "Earn 25,000 coins in total.",
    category: "COLLECTION",
    tier: "PLATINUM",
    metric: "coins_earned",
    threshold: 25000,
    coins: 2500,
    xp: 1000,
  },

  // --- Dedication --------------------------------------------------------
  {
    id: "showing-up",
    name: "Showing Up",
    description: "Claim the daily reward three days in a row.",
    category: "DEDICATION",
    tier: "BRONZE",
    metric: "daily_streak",
    threshold: 3,
    coins: 200,
    xp: 100,
  },
  {
    id: "seven-days",
    name: "Seven Days",
    description: "Claim the daily reward seven days in a row.",
    category: "DEDICATION",
    tier: "GOLD",
    metric: "daily_streak",
    threshold: 7,
    coins: 750,
    xp: 400,
  },
  {
    id: "thirty-days",
    name: "Fixture",
    description: "Claim the daily reward thirty days in a row.",
    category: "DEDICATION",
    tier: "PLATINUM",
    metric: "daily_streak",
    threshold: 30,
    coins: 3000,
    xp: 1500,
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): Achievement | null {
  return BY_ID.get(id) ?? null;
}

export function achievementsIn(category: AchievementCategory): Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.category === category);
}

/** 0..1 towards an achievement, for the progress bar. */
export function progressToward(achievement: Achievement, value: number): number {
  if (achievement.threshold <= 0) return 1;
  return Math.max(0, Math.min(1, value / achievement.threshold));
}

/**
 * Every reward item must exist and must not be purchasable — an achievement
 * that hands over something already on sale is not a reward, and one that
 * points at nothing is a bug the seed would carry into the database.
 */
export function validateRewards(): string[] {
  const problems: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!a.item) continue;
    const item = getItem(a.item);
    if (!item) problems.push(`${a.id} rewards unknown item ${a.item}`);
    else if (item.source === "SHOP") problems.push(`${a.id} rewards a purchasable item`);
  }
  return problems;
}
