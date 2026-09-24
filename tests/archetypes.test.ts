import { describe, expect, it } from "vitest";
import {
  ARCHETYPES,
  archetypeOf,
  archetypeSynergy,
  draftEfficiency,
  efficiencyLabel,
  powerBand,
  revealedBand,
  type Axes,
} from "../src/lib/game/archetypes";
import { MAX_SYNERGY } from "../src/lib/game/categories";

const axes = (power: number, speed: number, defense: number, strategy: number, special: number): Axes => ({
  power,
  speed,
  defense,
  strategy,
  special,
});

describe("archetypes are read from the axes", () => {
  it("calls a wall a tank", () => {
    expect(archetypeOf(axes(60, 45, 95, 55, 50)).primary.id).toBe("TANK");
  });

  it("calls a glass cannon an assassin", () => {
    expect(archetypeOf(axes(92, 88, 40, 55, 60)).primary.id).toBe("ASSASSIN");
  });

  it("calls a blur a speedster", () => {
    expect(archetypeOf(axes(55, 96, 50, 55, 52)).primary.id).toBe("SPEEDSTER");
  });

  it("calls a planner a strategist", () => {
    expect(archetypeOf(axes(55, 52, 58, 95, 55)).primary.id).toBe("STRATEGIST");
  });

  it("calls a flat, powerful profile a boss", () => {
    expect(archetypeOf(axes(88, 86, 87, 85, 88)).primary.id).toBe("BOSS");
  });

  it("calls a flat, ordinary profile a wild card", () => {
    // Nothing about this character tells you how it fights.
    expect(archetypeOf(axes(58, 60, 59, 57, 61)).primary.id).toBe("WILD_CARD");
  });

  it("judges a profile against itself, not against other characters", () => {
    // Same shape, different overall level: both are tanks.
    const strong = archetypeOf(axes(70, 55, 95, 60, 60));
    const weak = archetypeOf(axes(35, 20, 60, 25, 25));
    expect(strong.primary.id).toBe("TANK");
    expect(weak.primary.id).toBe("TANK");
  });

  it("only gives a secondary when the runner-up is genuinely close", () => {
    const specialist = archetypeOf(axes(50, 50, 99, 45, 45));
    const hybrid = archetypeOf(axes(85, 55, 84, 55, 55));
    expect(specialist.secondary === null || specialist.secondary.id !== specialist.primary.id).toBe(true);
    expect(hybrid.secondary).not.toBeNull();
  });

  it("names and colours every archetype it can return", () => {
    for (const id of Object.keys(ARCHETYPES) as (keyof typeof ARCHETYPES)[]) {
      expect(ARCHETYPES[id].name).toBeTruthy();
      expect(ARCHETYPES[id].colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("archetype synergy stays a flavour, not a decision", () => {
  const read = (a: Axes) => archetypeOf(a);

  it("rewards a squad with several roles", () => {
    const squad = [
      read(axes(60, 45, 95, 55, 50)),   // tank
      read(axes(92, 88, 40, 55, 60)),   // assassin
      read(axes(55, 96, 50, 55, 52)),   // speedster
      read(axes(55, 52, 58, 95, 55)),   // strategist
      read(axes(50, 55, 52, 60, 92)),   // ranged / support
    ];
    const { bonus, label } = archetypeSynergy(squad);
    expect(bonus).toBeGreaterThan(0);
    expect(label).toBeTruthy();
  });

  it("still rewards committing to one role, but less", () => {
    const tanks = Array.from({ length: 5 }, () => read(axes(60, 45, 95, 55, 50)));
    const mixed = [
      read(axes(60, 45, 95, 55, 50)),
      read(axes(92, 88, 40, 55, 60)),
      read(axes(55, 96, 50, 55, 52)),
      read(axes(55, 52, 58, 95, 55)),
      read(axes(50, 55, 52, 60, 92)),
    ];
    expect(archetypeSynergy(tanks).bonus).toBeGreaterThan(0);
    expect(archetypeSynergy(tanks).bonus).toBeLessThan(archetypeSynergy(mixed).bonus);
  });

  it("never spends the whole synergy budget on its own", () => {
    // Universe synergy needs room inside the 10% cap too.
    const any = [
      read(axes(60, 45, 95, 55, 50)),
      read(axes(92, 88, 40, 55, 60)),
      read(axes(55, 96, 50, 55, 52)),
      read(axes(55, 52, 58, 95, 55)),
      read(axes(50, 55, 52, 60, 92)),
    ];
    expect(archetypeSynergy(any).bonus).toBeLessThanOrEqual(MAX_SYNERGY / 2);
  });

  it("gives nothing to a pair", () => {
    expect(archetypeSynergy([read(axes(60, 45, 95, 55, 50))]).bonus).toBe(0);
  });
});

describe("hidden power", () => {
  it("shows the same band to everybody in the same game", () => {
    const a = powerBand("apex-the-thunder-sovereign", 88, "seed-abc");
    const b = powerBand("apex-the-thunder-sovereign", 88, "seed-abc");
    expect(a.label).toBe(b.label);
  });

  it("shows a different band in a different game", () => {
    const bands = new Set(
      ["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => powerBand("apex-the-thunder-sovereign", 88, s).label),
    );
    // Not all identical — otherwise the seed is doing nothing.
    expect(bands.size).toBeGreaterThan(1);
  });

  it("always contains the true value", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      for (const power of [12, 40, 61, 88, 99]) {
        const band = powerBand("x", power, seed);
        expect(band.low).toBeLessThanOrEqual(power);
        expect(band.high).toBeGreaterThanOrEqual(power);
      }
    }
  });

  it("hides more in ranked than in casual", () => {
    const casual = powerBand("apex-the-thunder-sovereign", 70, "s");
    const ranked = powerBand("apex-the-thunder-sovereign", 70, "s", "RANKED");
    expect(ranked.high - ranked.low).toBeGreaterThan(casual.high - casual.low);
  });

  it("does not let the midpoint be the answer every time", () => {
    // If the true value were always centred, the band would hide nothing.
    const offsets = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => {
      const band = powerBand("apex-the-thunder-sovereign", 70, s);
      return 70 - band.low;
    });
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  it("stays inside 1..100", () => {
    expect(powerBand("x", 1, "s").low).toBeGreaterThanOrEqual(1);
    expect(powerBand("x", 100, "s").high).toBeLessThanOrEqual(100);
  });

  it("replaces the band with the number once revealed", () => {
    expect(revealedBand(84)).toEqual({ low: 84, high: 84, exact: 84, label: "84" });
  });
});

describe("draft efficiency", () => {
  it("matches the worked example in the brief", () => {
    // 465 power for 47 credits.
    expect(draftEfficiency(465, 47, 5)).toBeCloseTo(9.89, 2);
  });

  it("rewards spending less for the same team", () => {
    expect(draftEfficiency(400, 30, 5)).toBeGreaterThan(draftEfficiency(400, 45, 5));
  });

  it("does not treat a free roster as infinitely efficient", () => {
    const free = draftEfficiency(400, 0, 5);
    expect(Number.isFinite(free)).toBe(true);
    expect(free).toBe(draftEfficiency(400, 5, 5));
  });

  it("describes the number in words", () => {
    expect(efficiencyLabel(12.5)).toBe("Daylight robbery");
    expect(efficiencyLabel(9.89)).toBe("Solid drafting");
    expect(efficiencyLabel(4)).toBe("Overpaid");
  });
});
