import { describe, expect, it } from "vitest";
import {
  categoryMasteryForLevel,
  categoryMasteryFromPoints,
  collectionLabel,
  collectionPercent,
  masteryBadge,
  masteryForDraft,
  masteryForLevel,
  masteryFromPoints,
} from "../src/lib/game/mastery";

describe("mastery points", () => {
  it("rewards the draft itself, first of all", () => {
    expect(masteryForDraft({ placement: 4, playerCount: 5, wasMvp: false })).toBe(1);
  });

  it("counts a win double and an MVP win triple", () => {
    expect(masteryForDraft({ placement: 1, playerCount: 5, wasMvp: false })).toBe(2);
    expect(masteryForDraft({ placement: 1, playerCount: 5, wasMvp: true })).toBe(3);
  });

  it("still pays a losing MVP", () => {
    // Carrying a doomed team is worth remembering.
    expect(masteryForDraft({ placement: 5, playerCount: 5, wasMvp: true })).toBe(2);
  });
});

describe("mastery levels", () => {
  it("starts at zero and climbs by a widening step", () => {
    expect(masteryForLevel(1)).toBe(0);
    expect(masteryForLevel(2)).toBe(3);
    expect(masteryForLevel(3)).toBe(8);
    expect(masteryForLevel(4)).toBe(15);
    expect(masteryForLevel(5)).toBe(24);
  });

  it("never plateaus", () => {
    for (let l = 1; l < 30; l++) {
      expect(masteryForLevel(l + 1)).toBeGreaterThan(masteryForLevel(l));
    }
  });

  it("reports where inside a level a player is", () => {
    const at = masteryFromPoints(10);
    expect(at.level).toBe(3);
    expect(at.intoLevel).toBe(2);
    expect(at.toNext).toBe(5);
    expect(at.progress).toBeGreaterThan(0);
    expect(at.progress).toBeLessThan(1);
  });

  it("puts an untouched character at level one, not level zero", () => {
    expect(masteryFromPoints(0).level).toBe(1);
    expect(masteryFromPoints(-5).level).toBe(1);
  });

  it("is reachable in an evening at the bottom and not at the top", () => {
    // Three drafts to level 2; over a hundred points for level 12.
    expect(masteryForLevel(2)).toBeLessThanOrEqual(3);
    expect(masteryForLevel(12)).toBeGreaterThan(100);
  });
});

describe("mastery badges are cosmetic and only cosmetic", () => {
  it("gives every level a label and a colour", () => {
    for (const level of [1, 2, 3, 5, 8, 12, 18, 40]) {
      const badge = masteryBadge(level);
      expect(badge.label).toBeTruthy();
      expect(badge.colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("never returns anything that could be a stat", () => {
    // The type has no room for one; this asserts the shape stays that way.
    expect(Object.keys(masteryBadge(12)).sort()).toEqual(["colour", "icon", "label"]);
  });

  it("climbs monotonically through the tiers", () => {
    const seen: string[] = [];
    for (let l = 1; l <= 20; l++) {
      const label = masteryBadge(l).label;
      if (seen[seen.length - 1] !== label) seen.push(label);
    }
    expect(seen[0]).toBe("Novice");
    expect(seen.at(-1)).toBe("Signature");
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("category mastery is a slower curve", () => {
  it("costs far more than a single character's", () => {
    expect(categoryMasteryForLevel(5)).toBeGreaterThan(masteryForLevel(5) * 5);
  });

  it("reports progress the same way", () => {
    const at = categoryMasteryFromPoints(25);
    expect(at.level).toBe(2);
    expect(at.toNext).toBeGreaterThan(0);
  });
});

describe("collection", () => {
  it("counts what was drafted, not what was seen", () => {
    // Seeing a character come up is luck; owning one is a decision.
    expect(collectionPercent({ total: 50, seen: 40, drafted: 10 })).toBe(20);
  });

  it("handles an empty category without dividing by zero", () => {
    expect(collectionPercent({ total: 0, seen: 0, drafted: 0 })).toBe(0);
    expect(collectionLabel({ total: 0, seen: 0, drafted: 0 })).toBe("Untouched");
  });

  it("describes the slice in words", () => {
    expect(collectionLabel({ total: 10, seen: 10, drafted: 10 })).toBe("Complete");
    expect(collectionLabel({ total: 10, seen: 8, drafted: 5 })).toBe("Halfway");
    expect(collectionLabel({ total: 10, seen: 3, drafted: 1 })).toBe("Started");
  });
});
