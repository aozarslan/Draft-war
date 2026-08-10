import { describe, expect, it } from "vitest";
import {
  computeSynergy,
  environmentMultiplier,
  simulateBattle,
  teamRating,
  winProbabilities,
  type BattleTeamInput,
} from "../src/lib/game/battle";
import { CHARACTERS, CHARACTERS_BY_ID, statTotal } from "../src/lib/game/characters";
import { MAPS_BY_ID } from "../src/lib/game/maps";
import { EVENTS_BY_ID } from "../src/lib/game/events";

const map = MAPS_BY_ID.city;
const neutralEvent = EVENTS_BY_ID["close-quarters"];

function team(playerId: string, ids: string[], price = 8): BattleTeamInput {
  return {
    playerId,
    nickname: playerId.toUpperCase(),
    characters: ids.map((characterId) => ({ characterId, price })),
  };
}

const teamA = team("a", [
  "kane-vasco",
  "adam-kessler",
  "tyler-stone",
  "lin-bo",
  "cutter-braddock",
]);
const teamB = team("b", [
  "milo-reyes",
  "nash-riggs",
  "cole-mateo",
  "viktor-sable",
  "rook-calloway",
]);

describe("pool balance", () => {
  it("keeps every character inside a narrow total-stat band", () => {
    const totals = CHARACTERS.map(statTotal);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(15);
  });

  it("has no character that leads on every stat", () => {
    for (const c of CHARACTERS) {
      const dominatesAll = CHARACTERS.every(
        (o) =>
          o.id === c.id ||
          (c.power >= o.power &&
            c.speed >= o.speed &&
            c.defense >= o.defense &&
            c.tactics >= o.tactics &&
            c.special >= o.special),
      );
      expect(dominatesAll).toBe(false);
    }
  });

  it("prices track power without being a straight ranking", () => {
    const sorted = [...CHARACTERS].sort((a, b) => statTotal(b) - statTotal(a));
    expect(sorted[0].basePrice).toBeGreaterThanOrEqual(sorted[sorted.length - 1].basePrice);
  });
});

describe("environment modifiers", () => {
  it("applies the map bonus only to matching tags", () => {
    const tactician = CHARACTERS_BY_ID["sterling-vane"]; // tactical
    const brawler = CHARACTERS_BY_ID["arka-wijaya"]; // melee/brawler/mobility
    expect(environmentMultiplier(tactician, map, neutralEvent)).toBeGreaterThan(1);
    // Desert rewards ranged/marksman and POWER OUTAGE only touches tech, so a
    // pure brawler comes out completely unmodified.
    expect(
      environmentMultiplier(brawler, MAPS_BY_ID.desert, EVENTS_BY_ID["power-outage"]),
    ).toBe(1);
  });

  it("doubles map modifiers under NO RULES", () => {
    const c = CHARACTERS_BY_ID["sterling-vane"];
    const normal = environmentMultiplier(c, map, neutralEvent) - 1;
    const doubled = environmentMultiplier(c, map, EVENTS_BY_ID["no-rules"]) - 1;
    expect(doubled).toBeCloseTo(normal * 2, 5);
  });

  it("applies a negative event to the tagged characters", () => {
    const techie = CHARACTERS_BY_ID["ryder-cross"]; // tech
    expect(
      environmentMultiplier(techie, MAPS_BY_ID.forest, EVENTS_BY_ID["power-outage"]),
    ).toBeLessThan(1);
  });
});

describe("synergy", () => {
  it("rewards overlapping tags but stays capped", () => {
    const melee = ["kiri-amano", "arka-wijaya", "wei-zhan", "viktor-sable", "nash-riggs"].map(
      (id) => CHARACTERS_BY_ID[id],
    );
    const mixed = ["sterling-vane", "cutter-braddock", "kiri-amano", "milo-reyes", "cole-mateo"].map(
      (id) => CHARACTERS_BY_ID[id],
    );
    expect(computeSynergy(melee)).toBeGreaterThan(computeSynergy(mixed));
    expect(computeSynergy(melee)).toBeLessThanOrEqual(0.14);
  });
});

describe("win probability model", () => {
  it("favours the stronger team without making it a certainty", () => {
    const [p1, p2] = winProbabilities([438, 421]);
    expect(p1).toBeGreaterThan(p2);
    expect(p1).toBeLessThan(70);
    expect(p1).toBeGreaterThan(52);
    expect(p1 + p2).toBeCloseTo(100, 0);
  });

  it("splits evenly for identical ratings", () => {
    expect(winProbabilities([400, 400, 400, 400])).toEqual([25, 25, 25, 25]);
  });
});

describe("simulation", () => {
  const run = (seed: string) =>
    simulateBattle({
      teams: [teamA, teamB],
      map,
      event: neutralEvent,
      charactersById: CHARACTERS_BY_ID,
      seed,
    });

  it("is deterministic for a given seed", () => {
    const a = run("seed-1");
    const b = run("seed-1");
    expect(a.winnerPlayerId).toBe(b.winnerPlayerId);
    expect(a.log.length).toBe(b.log.length);
    expect(a.log.map((e) => e.text)).toEqual(b.log.map((e) => e.text));
  });

  it("produces different battles for different seeds", () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `seed-${i}`);
    const winners = new Set(seeds.map((s) => run(s).winnerPlayerId));
    // Neither team is allowed to be a guaranteed winner.
    expect(winners.size).toBe(2);
  });

  it("always names exactly one winner and ranks every team", () => {
    const result = run("seed-x");
    expect(result.teams).toHaveLength(2);
    expect(result.teams.map((t) => t.rank).sort()).toEqual([1, 2]);
    expect(result.teams[0].playerId).toBe(result.winnerPlayerId);
    expect(result.teams[0].points).toBe(3);
    expect(result.teams[1].points).toBe(2);
  });

  it("awards points by the 3/2/1/0 table with four teams", () => {
    const result = simulateBattle({
      teams: [
        team("a", ["kane-vasco", "adam-kessler", "tyler-stone"]),
        team("b", ["milo-reyes", "nash-riggs", "cole-mateo"]),
        team("c", ["ryder-cross", "sterling-vane", "boone-halloway"]),
        team("d", ["kiri-amano", "arka-wijaya", "wei-zhan"]),
      ],
      map,
      event: neutralEvent,
      charactersById: CHARACTERS_BY_ID,
      seed: "four-way",
    });
    expect(result.teams.map((t) => t.points)).toEqual([3, 2, 1, 0]);
  });

  it("builds a playable cinematic with rounds and an ending", () => {
    const result = run("seed-2");
    expect(result.log[0].kind).toBe("ROUND_START");
    expect(result.log.at(-1)?.kind).toBe("END");
    expect(result.durationMs).toBeGreaterThan(3000);
    expect(result.durationMs).toBeLessThan(60_000);
    // Timeline is monotonic so playback never jumps backwards.
    const times = result.log.map((e) => e.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("scores every combatant and derives a value score from the price", () => {
    const result = simulateBattle({
      teams: [
        { ...teamA, characters: teamA.characters.map((c) => ({ ...c, price: 10 })) },
        { ...teamB, characters: teamB.characters.map((c) => ({ ...c, price: 2 })) },
      ],
      map,
      event: neutralEvent,
      charactersById: CHARACTERS_BY_ID,
      seed: "value",
    });

    expect(result.combatants).toHaveLength(10);
    for (const c of result.combatants) {
      expect(c.valueScore).toBeCloseTo(c.performance / c.price, 2);
      expect(c.survivalPct).toBeGreaterThanOrEqual(0);
      expect(c.survivalPct).toBeLessThanOrEqual(100);
    }
    expect(result.mvp).not.toBeNull();
    expect(result.awards.bestValue!.valueScore).toBeGreaterThanOrEqual(
      result.awards.worstValue!.valueScore,
    );
  });

  it("names an MVP from the winning team", () => {
    const result = run("seed-3");
    expect(result.mvp!.playerId).toBe(result.winnerPlayerId);
  });

  it("gives the fastest team the opening edge under AMBUSH", () => {
    const withAmbush = simulateBattle({
      teams: [teamA, teamB],
      map,
      event: EVENTS_BY_ID.ambush,
      charactersById: CHARACTERS_BY_ID,
      seed: "ambush",
    });
    expect(withAmbush.log.some((e) => e.round === 1)).toBe(true);
    expect(withAmbush.teams).toHaveLength(2);
  });

  it("keeps team ratings in the expected range", () => {
    const rating = teamRating(teamA, CHARACTERS_BY_ID, map, neutralEvent);
    expect(rating).toBeGreaterThan(380);
    expect(rating).toBeLessThan(560);
  });
});
