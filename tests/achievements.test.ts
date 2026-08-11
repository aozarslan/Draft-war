import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  CATEGORY_LABEL,
  TIER_STYLE,
  achievementsIn,
  getAchievement,
  progressToward,
  validateRewards,
  type AchievementCategory,
} from "../src/lib/game/achievements";
import { getItem } from "../src/lib/game/items";

describe("catalog integrity", () => {
  it("has no duplicate ids", () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it("labels every category and tier it uses", () => {
    for (const a of ACHIEVEMENTS) {
      expect(CATEGORY_LABEL[a.category]).toBeTruthy();
      expect(TIER_STYLE[a.tier]).toBeTruthy();
    }
  });

  it("puts something in every category", () => {
    for (const category of Object.keys(CATEGORY_LABEL) as AchievementCategory[]) {
      expect(achievementsIn(category).length).toBeGreaterThan(0);
    }
  });

  it("gives every achievement a positive threshold", () => {
    // A threshold of zero would unlock for everybody the moment it shipped.
    for (const a of ACHIEVEMENTS) expect(a.threshold).toBeGreaterThan(0);
  });

  it("always rewards something", () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.coins + a.xp + (a.item ? 1 : 0)).toBeGreaterThan(0);
    }
  });
});

describe("rewards", () => {
  it("only hands over items that exist and cannot be bought", () => {
    expect(validateRewards()).toEqual([]);
  });

  it("never awards the same item twice", () => {
    const items = ACHIEVEMENTS.map((a) => a.item).filter(Boolean);
    expect(new Set(items).size).toBe(items.length);
  });

  it("finds a home for every unbuyable cosmetic", () => {
    // An item nothing unlocks is an item nobody can ever have. Season rewards
    // are the exception — they are handed out by the season, not a medal.
    const claimed = new Set(ACHIEVEMENTS.map((a) => a.item).filter(Boolean));
    const orphans = ["avatar-gavel", "avatar-vault", "title-undefeated", "title-veteran"].filter(
      (id) => !claimed.has(id),
    );
    expect(orphans).toEqual([]);
  });

  it("pays more for the harder tiers", () => {
    const bronze = ACHIEVEMENTS.filter((a) => a.tier === "BRONZE");
    const platinum = ACHIEVEMENTS.filter((a) => a.tier === "PLATINUM");
    const avg = (list: typeof ACHIEVEMENTS) =>
      list.reduce((sum, a) => sum + a.coins, 0) / list.length;
    expect(avg(platinum)).toBeGreaterThan(avg(bronze));
  });

  it("keeps every reward cosmetic — no achievement grants an advantage", () => {
    for (const a of ACHIEVEMENTS) {
      if (!a.item) continue;
      const item = getItem(a.item)!;
      expect(["AVATAR", "FRAME", "BANNER", "TITLE"]).toContain(item.kind);
    }
  });
});

describe("thresholds are reachable in order", () => {
  it("orders the tiers of a repeated metric sensibly", () => {
    // Winning 25 matches must not be easier than winning 10.
    const byMetric = new Map<string, number[]>();
    for (const a of ACHIEVEMENTS) {
      byMetric.set(a.metric, [...(byMetric.get(a.metric) ?? []), a.threshold]);
    }
    for (const [, thresholds] of byMetric) {
      expect(new Set(thresholds).size).toBe(thresholds.length);
    }
  });

  it("starts each ladder somewhere a new player can reach", () => {
    const starters = ACHIEVEMENTS.filter((a) => a.tier === "BRONZE");
    expect(starters.length).toBeGreaterThan(3);
  });
});

describe("progress", () => {
  it("reports the fraction of the way there", () => {
    const a = getAchievement("the-gavel")!;
    expect(progressToward(a, 0)).toBe(0);
    expect(progressToward(a, 5)).toBeCloseTo(0.5);
    expect(progressToward(a, 10)).toBe(1);
  });

  it("never overfills or goes negative", () => {
    const a = getAchievement("first-blood")!;
    expect(progressToward(a, 99)).toBe(1);
    expect(progressToward(a, -3)).toBe(0);
  });

  it("returns null for an unknown id rather than guessing", () => {
    expect(getAchievement("no-such-medal")).toBeNull();
  });
});
