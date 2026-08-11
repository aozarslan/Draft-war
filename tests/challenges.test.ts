import { describe, expect, it } from "vitest";
import {
  CHALLENGES,
  CHALLENGE_SLOTS,
  DAILY_LADDER,
  DAILY_TEMPLATES,
  LADDER_LENGTH,
  WEEKLY_TEMPLATES,
  dailyReward,
  getChallenge,
  ladderDay,
  ladderView,
} from "../src/lib/game/challenges";

describe("challenge catalog", () => {
  it("has no duplicate ids", () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
  });

  it("offers more templates than slots, so the rotation means something", () => {
    expect(DAILY_TEMPLATES.length).toBeGreaterThan(CHALLENGE_SLOTS.DAILY);
    expect(WEEKLY_TEMPLATES.length).toBeGreaterThan(CHALLENGE_SLOTS.WEEKLY);
  });

  it("gives every challenge a positive target and a reward", () => {
    for (const c of CHALLENGES) {
      expect(c.target).toBeGreaterThan(0);
      expect(c.coins + c.xp).toBeGreaterThan(0);
    }
  });

  it("only uses metrics that accumulate", () => {
    // A delta is meaningless on a metric that can go down or reset, so the
    // catalog is restricted to counters that only ever climb.
    const CUMULATIVE = [
      "matches",
      "wins",
      "top_three",
      "mvps",
      "characters_drafted",
      "credits_spent",
      "coins_earned",
    ];
    for (const c of CHALLENGES) expect(CUMULATIVE).toContain(c.metric);
  });

  it("asks more of a week than of a day", () => {
    const dailyAvg =
      DAILY_TEMPLATES.reduce((sum, c) => sum + c.coins, 0) / DAILY_TEMPLATES.length;
    const weeklyAvg =
      WEEKLY_TEMPLATES.reduce((sum, c) => sum + c.coins, 0) / WEEKLY_TEMPLATES.length;
    expect(weeklyAvg).toBeGreaterThan(dailyAvg * 2);
  });

  it("keeps a full day of challenges worth less than a good match plus the daily", () => {
    // Challenges should reward playing, not replace it.
    const best = [...DAILY_TEMPLATES].sort((a, b) => b.coins - a.coins).slice(0, 3);
    expect(best.reduce((sum, c) => sum + c.coins, 0)).toBeLessThan(1200);
  });

  it("returns null for an unknown id", () => {
    expect(getChallenge("nope")).toBeNull();
    expect(getChallenge("d-win-1")?.target).toBe(1);
  });
});

describe("the daily ladder", () => {
  it("climbs across the week", () => {
    for (let i = 1; i < DAILY_LADDER.length; i++) {
      expect(DAILY_LADDER[i]).toBeGreaterThan(DAILY_LADDER[i - 1]);
    }
  });

  it("makes the seventh day worth more than the first three together", () => {
    const firstThree = DAILY_LADDER[0] + DAILY_LADDER[1] + DAILY_LADDER[2];
    expect(DAILY_LADDER[6]).toBeGreaterThan(firstThree);
  });

  it("pays by position in the cycle, then starts again", () => {
    expect(dailyReward(1)).toBe(DAILY_LADDER[0]);
    expect(dailyReward(7)).toBe(DAILY_LADDER[6]);
    expect(dailyReward(8)).toBe(DAILY_LADDER[0]);
    expect(dailyReward(15)).toBe(DAILY_LADDER[0]);
    expect(ladderDay(8)).toBe(1);
    expect(ladderDay(14)).toBe(7);
  });

  it("treats a streak of zero as day one", () => {
    expect(dailyReward(0)).toBe(DAILY_LADDER[0]);
    expect(ladderDay(0)).toBe(1);
  });

  it("draws today as the next day when today is unclaimed", () => {
    const view = ladderView(3, false);
    expect(view.filter((d) => d.claimed).map((d) => d.day)).toEqual([1, 2, 3]);
    expect(view.find((d) => d.today)?.day).toBe(4);
  });

  it("draws today as the current day once it is claimed", () => {
    const view = ladderView(3, true);
    expect(view.filter((d) => d.claimed).map((d) => d.day)).toEqual([1, 2, 3]);
    expect(view.find((d) => d.today)?.day).toBe(3);
  });

  it("starts a clean row the day after a full week", () => {
    const finished = ladderView(7, true);
    expect(finished.every((d) => d.claimed)).toBe(true);

    const nextDay = ladderView(7, false);
    expect(nextDay.some((d) => d.claimed)).toBe(false);
    expect(nextDay.find((d) => d.today)?.day).toBe(1);
  });

  it("shows an empty row to somebody who has never claimed", () => {
    const view = ladderView(0, false);
    expect(view.some((d) => d.claimed)).toBe(false);
    expect(view.find((d) => d.today)?.day).toBe(1);
    expect(view).toHaveLength(LADDER_LENGTH);
  });
});
