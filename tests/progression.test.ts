import { describe, expect, it } from "vitest";
import {
  COIN_AWARDS,
  RANK_TIERS,
  XP_AWARDS,
  applyRankDelta,
  levelFromXp,
  rankDelta,
  rankFromPoints,
  coinsForMatch,
  formatCoins,
  totalCoins,
  totalXp,
  xpForLevel,
  xpForMatch,
} from "../src/lib/game/progression";

describe("level curve", () => {
  it("matches the thresholds from the brief", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(500);
    expect(xpForLevel(3)).toBe(1100);
    expect(xpForLevel(4)).toBe(1800);
  });

  it("keeps climbing without ever plateauing", () => {
    for (let l = 2; l < 40; l++) {
      expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    }
  });

  it("reports where inside a level a player is", () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(499).level).toBe(1);
    expect(levelFromXp(500).level).toBe(2);
    expect(levelFromXp(1099).level).toBe(2);
    expect(levelFromXp(1100).level).toBe(3);

    const mid = levelFromXp(800);
    expect(mid.level).toBe(2);
    expect(mid.intoLevel).toBe(300);
    expect(mid.levelSpan).toBe(600);
    expect(mid.toNext).toBe(300);
    expect(mid.progress).toBeCloseTo(0.5, 5);
  });

  it("a player should feel progress after a session or two", () => {
    // A win with MVP and a full roster in a five-player game.
    const oneGreatMatch = totalXp(
      xpForMatch({ rank: 1, playerCount: 5, isMvp: true, charactersDrafted: 5, ranked: true }),
    );
    expect(oneGreatMatch).toBeGreaterThan(500);
    expect(levelFromXp(oneGreatMatch).level).toBeGreaterThanOrEqual(2);
  });
});

describe("match XP", () => {
  it("itemises where the XP came from", () => {
    const lines = xpForMatch({
      rank: 1, playerCount: 5, isMvp: true, charactersDrafted: 5, ranked: true,
    });
    const reasons = lines.map((l) => l.reason);
    expect(reasons).toContain("Match completed");
    expect(reasons).toContain("Victory");
    expect(reasons).toContain("MVP");
    expect(totalXp(lines)).toBe(
      XP_AWARDS.MATCH_COMPLETED + XP_AWARDS.WIN + XP_AWARDS.MVP + 5 * XP_AWARDS.CHARACTER_DRAFTED,
    );
  });

  it("pays a losing player enough to keep playing", () => {
    const last = totalXp(
      xpForMatch({ rank: 5, playerCount: 5, isMvp: false, charactersDrafted: 5, ranked: true }),
    );
    expect(last).toBeGreaterThan(0);
    // Losing should still be worth roughly a fifth of a great match.
    const best = totalXp(
      xpForMatch({ rank: 1, playerCount: 5, isMvp: true, charactersDrafted: 5, ranked: true }),
    );
    expect(last / best).toBeGreaterThan(0.2);
  });

  it("does not pay a victory bonus twice for a top-three finish", () => {
    const first = xpForMatch({ rank: 1, playerCount: 5, isMvp: false, charactersDrafted: 0, ranked: true });
    expect(first.filter((l) => l.reason === "Top three")).toHaveLength(0);
  });
});

describe("rank", () => {
  it("uses the five-player table from the brief", () => {
    expect(rankDelta(1, 5)).toBe(30);
    expect(rankDelta(2, 5)).toBe(18);
    expect(rankDelta(3, 5)).toBe(8);
    expect(rankDelta(4, 5)).toBe(-5);
    expect(rankDelta(5, 5)).toBe(-15);
  });

  it("softens the swing in a smaller lobby", () => {
    expect(rankDelta(1, 2)).toBeLessThan(rankDelta(1, 5));
    expect(rankDelta(1, 2)).toBeGreaterThan(0);
    expect(rankDelta(2, 2)).toBeLessThan(0);
  });

  it("rewards winning more than it punishes losing", () => {
    const gains = [1, 2, 3].reduce((s, r) => s + rankDelta(r, 5), 0);
    const losses = [4, 5].reduce((s, r) => s + rankDelta(r, 5), 0);
    expect(gains + losses).toBeGreaterThan(0);
  });

  it("never drops a player below zero points", () => {
    expect(applyRankDelta(5, -15)).toBe(0);
    expect(applyRankDelta(0, -30)).toBe(0);
  });

  it("names the tier and division correctly", () => {
    expect(rankFromPoints(0).label).toBe("Bronze III");
    expect(rankFromPoints(150).label).toBe("Bronze II");
    expect(rankFromPoints(250).label).toBe("Bronze I");
    expect(rankFromPoints(300).label).toBe("Silver III");
    expect(rankFromPoints(600).label).toBe("Gold III");
  });

  it("tops out at Champion with no divisions", () => {
    const top = rankFromPoints(99_999);
    expect(top.tier.id).toBe("CHAMPION");
    expect(top.division).toBeNull();
    expect(top.next).toBeNull();
    expect(top.label).toBe("Champion");
  });

  it("moves monotonically up the ladder as points rise", () => {
    let lastTier = -1;
    for (let p = 0; p <= 2000; p += 50) {
      const tier = RANK_TIERS.findIndex((t) => t.id === rankFromPoints(p).tier.id);
      expect(tier).toBeGreaterThanOrEqual(lastTier);
      lastTier = tier;
    }
  });
});

describe("coin awards", () => {
  it("pays the flat rate for finishing a match", () => {
    const lines = coinsForMatch({ rank: 4, playerCount: 5, isMvp: false, charactersDrafted: 5, ranked: true });
    expect(totalCoins(lines)).toBe(COIN_AWARDS.MATCH_COMPLETED);
  });

  it("stacks the win and MVP bonuses", () => {
    const lines = coinsForMatch({ rank: 1, playerCount: 5, isMvp: true, charactersDrafted: 5, ranked: true });
    expect(totalCoins(lines)).toBe(
      COIN_AWARDS.MATCH_COMPLETED + COIN_AWARDS.WIN + COIN_AWARDS.MVP,
    );
  });

  it("never pays both the win and the top-three bonus", () => {
    const winner = coinsForMatch({ rank: 1, playerCount: 5, isMvp: false, charactersDrafted: 5, ranked: true });
    expect(winner.some((l) => l.reason === "Top three")).toBe(false);
    const third = coinsForMatch({ rank: 3, playerCount: 5, isMvp: false, charactersDrafted: 5, ranked: true });
    expect(totalCoins(third)).toBe(COIN_AWARDS.MATCH_COMPLETED + COIN_AWARDS.TOP_THREE);
  });

  it("pays casual matches too — coins are for playing, rank is for winning", () => {
    const casual = coinsForMatch({ rank: 1, playerCount: 3, isMvp: false, charactersDrafted: 5, ranked: false });
    const ranked = coinsForMatch({ rank: 1, playerCount: 3, isMvp: false, charactersDrafted: 5, ranked: true });
    expect(totalCoins(casual)).toBe(totalCoins(ranked));
  });

  it("does not scale with how much a player spent in the auction", () => {
    // Coins and credits must stay unconnected in both directions.
    const few = coinsForMatch({ rank: 2, playerCount: 5, isMvp: false, charactersDrafted: 1, ranked: true });
    const many = coinsForMatch({ rank: 2, playerCount: 5, isMvp: false, charactersDrafted: 5, ranked: true });
    expect(totalCoins(few)).toBe(totalCoins(many));
  });

  it("keeps a match worth less than a shop cosmetic will be", () => {
    const best = coinsForMatch({ rank: 1, playerCount: 5, isMvp: true, charactersDrafted: 5, ranked: true });
    expect(totalCoins(best)).toBeLessThan(300);
  });

  it("formats a balance for humans", () => {
    expect(formatCoins(0)).toBe("0");
    expect(formatCoins(12400)).toBe("12,400");
    expect(formatCoins(-5)).toBe("0");
  });
});
