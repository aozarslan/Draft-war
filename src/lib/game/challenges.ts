/**
 * ---------------------------------------------------------------------------
 * CHALLENGES AND THE DAILY LADDER (pure)
 * ---------------------------------------------------------------------------
 * A challenge is the same shape as an achievement — one metric, one target —
 * with one difference that matters: it is measured as a *delta*. When a
 * challenge is assigned, the profile's current value for that metric is
 * snapshotted as a baseline, and progress is whatever has happened since.
 *
 * That is what lets "play two matches" mean two matches today rather than two
 * matches ever, without a single new counter to keep in step. The metrics come
 * from `dw_profile_metrics`, exactly as the achievements do.
 *
 * Rewards are coins and XP. Challenges never award cosmetics — those belong to
 * the shop and the medal cabinet, and a rotating task should not be the only
 * chance to get one.
 */

export type ChallengeScope = "DAILY" | "WEEKLY";

/** Only cumulative metrics work as challenges: a delta has to mean something. */
export type ChallengeMetric =
  | "matches"
  | "wins"
  | "top_three"
  | "mvps"
  | "characters_drafted"
  | "credits_spent"
  | "coins_earned";

export interface ChallengeTemplate {
  id: string;
  scope: ChallengeScope;
  name: string;
  /** Written to read as an instruction, since that is what it is. */
  description: string;
  metric: ChallengeMetric;
  target: number;
  coins: number;
  xp: number;
}

/** How many of each are live at once. */
export const CHALLENGE_SLOTS: Record<ChallengeScope, number> = {
  DAILY: 3,
  WEEKLY: 2,
};

export const DAILY_TEMPLATES: ChallengeTemplate[] = [
  {
    id: "d-play-2",
    scope: "DAILY",
    name: "Turn up",
    description: "Finish 2 matches.",
    metric: "matches",
    target: 2,
    coins: 150,
    xp: 100,
  },
  {
    id: "d-play-3",
    scope: "DAILY",
    name: "Session",
    description: "Finish 3 matches.",
    metric: "matches",
    target: 3,
    coins: 250,
    xp: 150,
  },
  {
    id: "d-win-1",
    scope: "DAILY",
    name: "Take one",
    description: "Win a match.",
    metric: "wins",
    target: 1,
    coins: 200,
    xp: 120,
  },
  {
    id: "d-win-2",
    scope: "DAILY",
    name: "Double up",
    description: "Win 2 matches.",
    metric: "wins",
    target: 2,
    coins: 400,
    xp: 250,
  },
  {
    id: "d-podium-2",
    scope: "DAILY",
    name: "Consistent",
    description: "Finish in the top three twice.",
    metric: "top_three",
    target: 2,
    coins: 200,
    xp: 120,
  },
  {
    id: "d-mvp-1",
    scope: "DAILY",
    name: "Stand out",
    description: "Be the MVP of a match.",
    metric: "mvps",
    target: 1,
    coins: 250,
    xp: 150,
  },
  {
    id: "d-draft-10",
    scope: "DAILY",
    name: "Shopping list",
    description: "Draft 10 characters.",
    metric: "characters_drafted",
    target: 10,
    coins: 150,
    xp: 100,
  },
  {
    id: "d-spend-60",
    scope: "DAILY",
    name: "Open wallet",
    description: "Spend 60 credits across your drafts.",
    metric: "credits_spent",
    target: 60,
    coins: 150,
    xp: 100,
  },
  {
    id: "d-earn-300",
    scope: "DAILY",
    name: "Payday",
    description: "Earn 300 coins.",
    metric: "coins_earned",
    target: 300,
    coins: 200,
    xp: 100,
  },
];

export const WEEKLY_TEMPLATES: ChallengeTemplate[] = [
  {
    id: "w-play-10",
    scope: "WEEKLY",
    name: "Fixture list",
    description: "Finish 10 matches this week.",
    metric: "matches",
    target: 10,
    coins: 800,
    xp: 500,
  },
  {
    id: "w-win-5",
    scope: "WEEKLY",
    name: "Good week",
    description: "Win 5 matches this week.",
    metric: "wins",
    target: 5,
    coins: 1200,
    xp: 700,
  },
  {
    id: "w-mvp-3",
    scope: "WEEKLY",
    name: "The difference",
    description: "Be the MVP 3 times this week.",
    metric: "mvps",
    target: 3,
    coins: 1000,
    xp: 600,
  },
  {
    id: "w-draft-50",
    scope: "WEEKLY",
    name: "Deep bench",
    description: "Draft 50 characters this week.",
    metric: "characters_drafted",
    target: 50,
    coins: 700,
    xp: 400,
  },
  {
    id: "w-podium-8",
    scope: "WEEKLY",
    name: "Always there",
    description: "Finish in the top three 8 times this week.",
    metric: "top_three",
    target: 8,
    coins: 900,
    xp: 550,
  },
  {
    id: "w-spend-300",
    scope: "WEEKLY",
    name: "Big week at the block",
    description: "Spend 300 credits this week.",
    metric: "credits_spent",
    target: 300,
    coins: 700,
    xp: 400,
  },
];

export const CHALLENGES: ChallengeTemplate[] = [...DAILY_TEMPLATES, ...WEEKLY_TEMPLATES];

const BY_ID = new Map(CHALLENGES.map((c) => [c.id, c]));

export function getChallenge(id: string): ChallengeTemplate | null {
  return BY_ID.get(id) ?? null;
}

// ---------------------------------------------------------------------------
// The daily ladder
// ---------------------------------------------------------------------------

/**
 * Seven days of showing up, then it starts again.
 *
 * The curve climbs so that day seven is worth more than the first three
 * together — that is the whole point of a streak — and resets to day one after
 * a missed day. The lifetime streak keeps counting for the achievements even
 * though the reward cycles.
 */
export const DAILY_LADDER = [100, 125, 150, 200, 250, 325, 600] as const;

export const LADDER_LENGTH = DAILY_LADDER.length;

/** What the nth consecutive day is worth. `streak` is 1-based. */
export function dailyReward(streak: number): number {
  const day = Math.max(1, Math.floor(streak));
  return DAILY_LADDER[(day - 1) % LADDER_LENGTH];
}

/** Position in the current seven-day cycle, 1..7. */
export function ladderDay(streak: number): number {
  const day = Math.max(1, Math.floor(streak));
  return ((day - 1) % LADDER_LENGTH) + 1;
}

/**
 * The whole cycle, for drawing the row of days.
 *
 * Whether today has already been claimed changes what the row means — the same
 * streak of 3 is "day 3, done" before midnight and "day 4, waiting" after it —
 * so it is an argument rather than something guessed from the streak.
 */
export function ladderView(
  streak: number,
  claimedToday: boolean,
): { day: number; coins: number; claimed: boolean; today: boolean }[] {
  const current = claimedToday ? ladderDay(Math.max(1, streak)) : ladderDay(streak + 1);
  const claimedCount = claimedToday ? current : current - 1;

  return DAILY_LADDER.map((coins, index) => ({
    day: index + 1,
    coins,
    claimed: index + 1 <= claimedCount,
    today: index + 1 === current,
  }));
}
