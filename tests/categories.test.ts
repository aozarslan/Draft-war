import { describe, expect, it } from "vitest";
import {
  AXIS_KEYS,
  CATEGORIES,
  CATEGORIES_BY_ID,
  allAxes,
  axisValue,
  computeGamePower,
  getCategory,
  resolveCategoryVote,
} from "../src/lib/game/categories";
import { CHARACTERS, categoryCounts } from "../src/lib/game/characters";

const ALL = CATEGORIES.map((c) => c.id);

describe("category registry", () => {
  it("gives every category six stats and a full axis recipe", () => {
    for (const c of CATEGORIES) {
      expect(c.stats.length, c.id).toBe(6);
      for (const axis of AXIS_KEYS) {
        expect(c.axes[axis]?.length, `${c.id}.${axis}`).toBeGreaterThan(0);
        // Every recipe ingredient must be a stat the category actually has.
        for (const [key] of c.axes[axis]) {
          expect(c.stats.some((s) => s.key === key), `${c.id}.${axis}.${key}`).toBe(true);
        }
      }
    }
  });

  it("uses every stat it declares in at least one axis", () => {
    for (const c of CATEGORIES) {
      const used = new Set(AXIS_KEYS.flatMap((a) => c.axes[a].map(([k]) => k)));
      for (const stat of c.stats) {
        expect(used.has(stat.key), `${c.id}.${stat.key} is never used`).toBe(true);
      }
    }
  });

  it("labels the real-world categories with a stronger disclaimer", () => {
    for (const c of CATEGORIES) {
      expect(c.disclaimer.length).toBeGreaterThan(20);
      if (c.realWorld) expect(c.disclaimer).toMatch(/real|not a (real-world )?measurement|scientific/i);
    }
    expect(CATEGORIES_BY_ID.hollywood.realWorld).toBe(true);
    expect(CATEGORIES_BY_ID.animals.realWorld).toBe(true);
    expect(CATEGORIES_BY_ID.apex.realWorld).toBe(false);
  });

  it("falls back to the legacy category for an unknown or missing id", () => {
    expect(getCategory(null).id).toBe("action-movies");
    expect(getCategory("nope").id).toBe("action-movies");
  });

  it("records how many players each category can actually seat", () => {
    // The draft consumes `players x 5` characters exactly, so a pool's size
    // *is* its table size. Stating that as a number per category rather than
    // as one threshold keeps a half-finished pool visible instead of letting
    // it fail at `beginAuction` with POOL_TOO_SMALL — which is the worst
    // possible moment, since the room has already picked and locked.
    const counts = categoryCounts();
    const seats = Object.fromEntries(
      CATEGORIES.map((c) => [c.id, Math.min(6, Math.floor((counts[c.id] ?? 0) / 5))]),
    );

    expect(seats).toEqual({
      apex: 6, vigil: 6, hollywood: 6, "action-movies": 6,
      animals: 6, fantasy: 4, "video-games": 4, anime: 4,
      // Football now seats six — sixty characters, five per player.
      football: 6,
      // Twenty-five: a full five-player table but short of six.
      basketball: 5,
    });

    expect(CHARACTERS.length).toBeGreaterThan(250);
  });
});

describe("axis projection", () => {
  it("ignores missing stats rather than producing NaN", () => {
    const category = CATEGORIES_BY_ID.apex;
    const value = axisValue(category, { power: 80 }, "power");
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBe(80);
  });

  it("returns a neutral value when a recipe finds nothing at all", () => {
    expect(axisValue(CATEGORIES_BY_ID.apex, {}, "power")).toBe(50);
  });

  it("keeps game power inside 0-100 for every shipped character", () => {
    for (const c of CHARACTERS) {
      const power = computeGamePower(getCategory(c.categoryId), c.stats);
      expect(power, c.name).toBeGreaterThan(0);
      expect(power, c.name).toBeLessThanOrEqual(100);
      expect(power).toBe(c.gamePower);
    }
  });

  it("projects every character onto five finite axes", () => {
    for (const c of CHARACTERS) {
      const axes = allAxes(getCategory(c.categoryId), c.stats);
      for (const key of AXIS_KEYS) {
        expect(Number.isFinite(axes[key]), `${c.name}.${key}`).toBe(true);
      }
    }
  });
});

describe("category vote", () => {
  const never = () => {
    throw new Error("tiebreak should not have been needed");
  };

  it("gives the win to the majority", () => {
    const votes = { a: "animals", b: "animals", c: "vigil" };
    expect(resolveCategoryVote(ALL, votes, never)).toBe("animals");
  });

  /**
   * Regression: the ballot was being trimmed to four entries by a helper meant
   * to cap crossover *selections*, so votes for the fifth category onwards were
   * thrown away and a single vote for an early category beat two votes for a
   * late one. Animals is fifth in the list, which is exactly how it slipped
   * through in a real game.
   */
  it("counts votes for categories late in the ballot", () => {
    expect(ALL.indexOf("animals")).toBeGreaterThanOrEqual(4);
    const votes = { a: "anime", b: "anime", c: "apex" };
    expect(resolveCategoryVote(ALL, votes, never)).toBe("anime");
  });

  it("ignores votes for something not on the ballot", () => {
    const ballot = ["apex", "vigil"];
    const votes = { a: "animals", b: "animals", c: "vigil" };
    expect(resolveCategoryVote(ballot, votes, never)).toBe("vigil");
  });

  it("breaks a tie with the supplied picker", () => {
    const votes = { a: "apex", b: "vigil" };
    expect(resolveCategoryVote(ALL, votes, (o) => o[o.length - 1])).toBe("vigil");
    expect(resolveCategoryVote(ALL, votes, (o) => o[0])).toBe("apex");
  });

  it("falls back to the whole ballot when nobody voted", () => {
    const picked = resolveCategoryVote(ALL, {}, (o) => o[0]);
    expect(ALL).toContain(picked);
  });
});
