import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMATION,
  FORMATIONS,
  FORMATION_IDS,
  applyFormation,
  formationSwing,
  getFormation,
} from "../src/lib/game/formations";
import { AXIS_KEYS, type AxisKey } from "../src/lib/game/categories";
import { simulateBattle, computeAxisBands } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { createRng } from "../src/lib/game/rng";
import type { FormationId } from "../src/lib/game/formations";

const axes: Record<AxisKey, number> = {
  power: 80,
  speed: 75,
  defense: 70,
  strategy: 65,
  special: 72,
};

// The same shape the round loop fights with.
const combatValue = (a: Record<AxisKey, number>) => {
  const attack = a.power * 0.6 + a.special * 0.2 + a.strategy * 0.2;
  const hp = 70 + a.defense * 1.55 + a.power * 0.45;
  return (attack * hp) / 230;
};

describe("formations are a trade, never a free gain", () => {
  it("gives every formation both an up and a down, except balanced", () => {
    for (const id of FORMATION_IDS) {
      const mods = Object.values(FORMATIONS[id].modifiers);
      if (id === DEFAULT_FORMATION) {
        expect(mods).toHaveLength(0);
        continue;
      }
      expect(mods.some((m) => m > 1), `${id} has no upside`).toBe(true);
      expect(mods.some((m) => m < 1), `${id} has no cost`).toBe(true);
    }
  });

  it("keeps the net swing small enough not to decide a match", () => {
    // V4: formations must not dominate. Anything past a couple of percent
    // starts to outweigh a good bid.
    for (const id of FORMATION_IDS) {
      const swing = Math.abs(formationSwing(axes, FORMATIONS[id], combatValue));
      expect(swing, `${id} swings ${(swing * 100).toFixed(1)}%`).toBeLessThan(0.05);
    }
  });

  it("makes aggressive hit harder than defensive", () => {
    const aggressive = applyFormation(axes, FORMATIONS.AGGRESSIVE);
    const defensive = applyFormation(axes, FORMATIONS.DEFENSIVE);
    expect(aggressive.power).toBeGreaterThan(defensive.power);
    expect(defensive.defense).toBeGreaterThan(aggressive.defense);
  });

  it("leaves a balanced squad exactly as drafted", () => {
    expect(applyFormation(axes, FORMATIONS.BALANCED)).toEqual(axes);
  });

  it("never drops an axis below one", () => {
    const tiny = { power: 1, speed: 1, defense: 1, strategy: 1, special: 1 };
    for (const id of FORMATION_IDS) {
      const out = applyFormation(tiny, FORMATIONS[id]);
      for (const key of AXIS_KEYS) expect(out[key]).toBeGreaterThanOrEqual(1);
    }
  });

  it("falls back to balanced for anything unrecognised", () => {
    expect(getFormation(null).id).toBe(DEFAULT_FORMATION);
    expect(getFormation("NONSENSE").id).toBe(DEFAULT_FORMATION);
    expect(getFormation("AGGRESSIVE").id).toBe("AGGRESSIVE");
  });

  it("describes every formation for the player", () => {
    for (const id of FORMATION_IDS) {
      expect(FORMATIONS[id].name).toBeTruthy();
      expect(FORMATIONS[id].blurb.length).toBeGreaterThan(10);
      expect(FORMATIONS[id].colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("no formation beats doing nothing", () => {
  // The balance promise, held by measurement rather than by assertion.
  //
  // Mirrored, fixed matchups: every formation plays the same pairings from
  // both sides, so squad strength cancels out. Balanced-vs-balanced must come
  // out at 50%, which is the control that says the harness itself is sound —
  // an earlier version reshuffled matchups per formation and reported the same
  // no-op formation at 44% and then 72%.
  const byId = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
  const marvel = CHARACTERS.filter((c) => c.categoryId === "marvel");
  const bands = computeAxisBands(CHARACTERS);
  const map = MAPS[0];
  const event = EVENT_CARDS[0];

  const rng = createRng("formation-matchups");
  const matchups = Array.from({ length: 12 }, () => {
    const pool = [...marvel];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return { A: pool.slice(0, 5), B: pool.slice(5, 10) };
  });

  const team = (id: string, chars: typeof marvel, formation: FormationId) => ({
    playerId: id,
    nickname: id,
    characters: chars.map((c) => ({ characterId: c.id, price: 10 })),
    formation,
  });

  function winRate(formation: FormationId): number {
    let wins = 0;
    let games = 0;
    matchups.forEach((m, mi) => {
      for (let i = 0; i < 8; i++) {
        const seed = `f-${mi}-${i}`;
        for (const [x, y] of [[m.A, m.B], [m.B, m.A]] as const) {
          const r = simulateBattle({
            teams: [team("A", x, formation), team("B", y, "BALANCED")],
            map,
            event,
            charactersById: byId,
            seed,
            categoryIds: ["marvel"],
            bands,
          });
          if (r.winnerPlayerId === "A") wins++;
          games++;
        }
      }
    });
    return (wins / games) * 100;
  }

  it("has a sound harness — balanced against balanced is a coin flip", () => {
    // Not exactly 50: the two mirrored runs share a seed but consume the RNG
    // in a different order, so a couple of points of drift is the harness
    // working, not failing. Anything outside this band means the measurement
    // is unsound and the numbers below cannot be trusted.
    const rate = winRate("BALANCED");
    expect(rate, `control run came out at ${rate.toFixed(1)}%`).toBeGreaterThan(47);
    expect(rate, `control run came out at ${rate.toFixed(1)}%`).toBeLessThan(53);
  });

  it("keeps every formation within a few points of even", () => {
    for (const id of FORMATION_IDS) {
      if (id === "BALANCED") continue;
      const rate = winRate(id);
      expect(rate, `${id} wins ${rate.toFixed(1)}% against a balanced squad`).toBeGreaterThan(45);
      expect(rate, `${id} wins ${rate.toFixed(1)}% against a balanced squad`).toBeLessThan(55);
    }
  });
});
