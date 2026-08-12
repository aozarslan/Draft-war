import { describe, expect, it } from "vitest";
import {
  computeAxisBands,
  computeSynergy,
  environmentMultiplier,
  projectAxes,
  simulateBattle,
  teamRating,
  winProbabilities,
  type BattleTeamInput,
} from "../src/lib/game/battle";
import { CHARACTERS, CHARACTERS_BY_ID, charactersInCategories } from "../src/lib/game/characters";
import { AXIS_KEYS, CATEGORIES, MAX_SYNERGY, allAxes, getCategory } from "../src/lib/game/categories";
import { MAPS, MAPS_BY_ID } from "../src/lib/game/maps";
import { EVENT_CARDS, EVENTS_BY_ID } from "../src/lib/game/events";
import { createRng } from "../src/lib/game/rng";

const map = MAPS_BY_ID.city;
const neutralEvent = EVENTS_BY_ID["close-quarters"];
const BANDS = computeAxisBands(CHARACTERS);

/** Mirror of the engine's combat value, for asserting normalisation. */
function combatValueOf(axes: Record<string, number>): number {
  const attack = axes.power * 0.6 + axes.special * 0.2 + axes.strategy * 0.2;
  const hp = 70 + axes.defense * 1.55 + axes.power * 0.45;
  return (attack * hp) / 230;
}

function team(playerId: string, ids: string[], price = 8): BattleTeamInput {
  return {
    playerId,
    nickname: playerId.toUpperCase(),
    characters: ids.map((characterId) => ({ characterId, price })),
  };
}

const teamA = team("a", [
  "marvel-thor",
  "marvel-iron-man",
  "marvel-spider-man",
  "marvel-hulk",
  "marvel-doctor-strange",
]);
const teamB = team("b", [
  "marvel-thanos",
  "marvel-magneto",
  "marvel-venom",
  "marvel-loki",
  "marvel-ultron",
]);

describe("pool balance", () => {
  it("gives every category a usable spread rather than one obvious pick", () => {
    for (const category of CATEGORIES) {
      const pool = charactersInCategories([category.id]);
      if (pool.length === 0) continue;
      const powers = pool.map((c) => c.gamePower);
      const spread = Math.max(...powers) - Math.min(...powers);
      expect(spread, `${category.id} spread`).toBeGreaterThanOrEqual(10);
    }
  });

  it("has no character that leads its category on every stat", () => {
    for (const category of CATEGORIES) {
      const pool = charactersInCategories([category.id]);
      const keys = category.stats.map((s) => s.key);
      for (const c of pool) {
        const dominatesAll = pool.every(
          (o) => o.id === c.id || keys.every((k) => (c.stats[k] ?? 0) >= (o.stats[k] ?? 0)),
        );
        expect(dominatesAll, `${c.name} dominates ${category.id}`).toBe(false);
      }
    }
  });

  it("keeps Hollywood out of superhero territory", () => {
    // Real people must not be rated like Kryptonians.
    const hollywood = charactersInCategories(["hollywood"]);
    const dc = charactersInCategories(["dc"]);
    expect(Math.max(...hollywood.map((c) => c.gamePower))).toBeLessThan(
      Math.max(...dc.map((c) => c.gamePower)),
    );
  });

  it("gives every character a full set of category stats", () => {
    for (const c of CHARACTERS) {
      const category = getCategory(c.categoryId);
      for (const stat of category.stats) {
        expect(typeof c.stats[stat.key], `${c.name}.${stat.key}`).toBe("number");
      }
    }
  });
});

describe("axis projection", () => {
  it("leaves a single-category game on the authored numbers", () => {
    const c = CHARACTERS_BY_ID["marvel-thor"];
    expect(projectAxes(c, { mixed: false })).toEqual(
      allAxes(getCategory(c.categoryId), c.stats),
    );
  });

  it("normalises a crossover so every category reaches the same ceiling", () => {
    // The best Hollywood actor and the best Kryptonian arrive at the same
    // effective strength; that is what makes a crossover a fight rather than
    // a formality.
    const bestOf = (categoryId: string) =>
      Math.max(
        ...charactersInCategories([categoryId]).map((c) =>
          combatValueOf(projectAxes(c, { mixed: true, bands: BANDS })),
        ),
      );
    for (const id of ["hollywood", "animals", "marvel", "fantasy"]) {
      expect(bestOf(id), id).toBeCloseTo(bestOf("dc"), 1);
    }
  });

  it("preserves strength ordering inside a category when normalising", () => {
    for (const id of ["animals", "hollywood", "marvel"]) {
      const pool = charactersInCategories([id]);
      const raw = [...pool].sort(
        (a, b) =>
          combatValueOf(allAxes(getCategory(b.categoryId), b.stats)) -
          combatValueOf(allAxes(getCategory(a.categoryId), a.stats)),
      );
      const norm = [...pool].sort(
        (a, b) =>
          combatValueOf(projectAxes(b, { mixed: true, bands: BANDS })) -
          combatValueOf(projectAxes(a, { mixed: true, bands: BANDS })),
      );
      expect(norm.map((c) => c.id), id).toEqual(raw.map((c) => c.id));
    }
  });
});

describe("environment modifiers", () => {
  it("applies the map bonus only to matching tags", () => {
    const tactician = CHARACTERS_BY_ID["dc-batman"]; // tactical
    const brawler = CHARACTERS_BY_ID["marvel-hulk"]; // brawler/survival, no tech
    expect(environmentMultiplier(tactician, map, neutralEvent)).toBeGreaterThan(1);
    expect(
      environmentMultiplier(brawler, MAPS_BY_ID.desert, EVENTS_BY_ID["power-outage"]),
    ).toBe(1);
  });

  it("doubles map modifiers under NO RULES", () => {
    const c = CHARACTERS_BY_ID["dc-batman"];
    const normal = environmentMultiplier(c, map, neutralEvent) - 1;
    const doubled = environmentMultiplier(c, map, EVENTS_BY_ID["no-rules"]) - 1;
    expect(doubled).toBeCloseTo(normal * 2, 5);
  });

  it("applies a negative event to the tagged characters", () => {
    const techie = CHARACTERS_BY_ID["marvel-iron-man"]; // tech
    expect(
      environmentMultiplier(techie, MAPS_BY_ID.forest, EVENTS_BY_ID["power-outage"]),
    ).toBeLessThan(1);
  });
});

describe("synergy", () => {
  it("rewards a themed squad and names the groups", () => {
    const avengers = ["marvel-thor", "marvel-iron-man", "marvel-captain-america",
                      "marvel-hawkeye", "marvel-black-widow"].map((id) => CHARACTERS_BY_ID[id]);
    const scattered = ["marvel-thor", "marvel-magneto", "marvel-venom",
                       "marvel-galactus", "marvel-daredevil"].map((id) => CHARACTERS_BY_ID[id]);

    const themed = computeSynergy(avengers);
    expect(themed.total).toBeGreaterThan(computeSynergy(scattered).total);
    expect(themed.groups.some((g) => g.label.startsWith("Avengers"))).toBe(true);
  });

  it("never exceeds the +10% cap", () => {
    const stacked = charactersInCategories(["marvel"])
      .filter((c) => c.tags.includes("avengers"))
      .slice(0, 8);
    expect(computeSynergy(stacked).total).toBeLessThanOrEqual(MAX_SYNERGY);
  });

  it("is zero for a squad with nothing in common", () => {
    expect(computeSynergy([CHARACTERS_BY_ID["marvel-galactus"]]).total).toBe(0);
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
      categoryIds: ["marvel"],
      bands: BANDS,
    });

  it("is deterministic for a given seed", () => {
    const a = run("seed-1");
    const b = run("seed-1");
    expect(a.winnerPlayerId).toBe(b.winnerPlayerId);
    expect(a.log.map((e) => e.text)).toEqual(b.log.map((e) => e.text));
  });

  it("produces different battles for different seeds", () => {
    const seeds = Array.from({ length: 14 }, (_, i) => `seed-${i}`);
    const winners = new Set(seeds.map((s) => run(s).winnerPlayerId));
    expect(winners.size).toBe(2);
  });

  it("always names one winner and ranks every team", () => {
    const result = run("seed-x");
    expect(result.teams.map((t) => t.rank).sort()).toEqual([1, 2]);
    expect(result.teams[0].playerId).toBe(result.winnerPlayerId);
    expect(result.teams[0].points).toBe(3);
    expect(result.categoryIds).toEqual(["marvel"]);
  });

  it("runs a five-way battle with five complete teams", () => {
    const pool = charactersInCategories(["marvel"]);
    const ids = pool.slice(0, 25).map((c) => c.id);
    const teams = [0, 1, 2, 3, 4].map((i) =>
      team(`p${i}`, ids.slice(i * 5, i * 5 + 5)),
    );

    const result = simulateBattle({
      teams,
      map,
      event: neutralEvent,
      charactersById: CHARACTERS_BY_ID,
      seed: "five-way",
      categoryIds: ["marvel"],
      bands: BANDS,
    });

    // All five fight; it is not collapsed into a 1v1.
    expect(result.teams).toHaveLength(5);
    expect(result.combatants).toHaveLength(25);
    expect(result.teams.map((t) => t.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.teams.map((t) => t.points)).toEqual([3, 2, 1, 0, 0]);
    // A probability is quoted for every team and they add up.
    const total = result.teams.reduce((s, t) => s + t.winProbability, 0);
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
    expect(result.teams[0].playerId).toBe(result.winnerPlayerId);
  });

  it("does not let one team win every five-way battle", () => {
    const pool = charactersInCategories(["dc"]);
    const ids = pool.slice(0, 25).map((c) => c.id);
    const teams = [0, 1, 2, 3, 4].map((i) =>
      team(`p${i}`, ids.slice(i * 5, i * 5 + 5)),
    );
    const winners = new Set(
      Array.from({ length: 25 }, (_, i) =>
        simulateBattle({
          teams,
          map,
          event: neutralEvent,
          charactersById: CHARACTERS_BY_ID,
          seed: `five-${i}`,
          categoryIds: ["dc"],
          bands: BANDS,
        }).winnerPlayerId,
      ),
    );
    expect(winners.size).toBeGreaterThan(1);
  });

  it("awards points by the 3/2/1/0 table with four teams", () => {
    const result = simulateBattle({
      teams: [
        team("a", ["marvel-thor", "marvel-iron-man", "marvel-hulk"]),
        team("b", ["marvel-thanos", "marvel-loki", "marvel-ultron"]),
        team("c", ["marvel-storm", "marvel-wolverine", "marvel-cyclops"]),
        team("d", ["marvel-venom", "marvel-carnage", "marvel-deadpool"]),
      ],
      map,
      event: neutralEvent,
      charactersById: CHARACTERS_BY_ID,
      seed: "four-way",
      categoryIds: ["marvel"],
      bands: BANDS,
    });
    expect(result.teams.map((t) => t.points)).toEqual([3, 2, 1, 0]);
  });

  /**
   * Regression test for a forecast that lied.
   *
   * The team rating used to be the mean of the five axes, which could show two
   * squads as level while one of them won every single simulation. The number
   * on screen has to describe the fight, so we assert that the stated
   * probability actually predicts the outcome — for a single category and for
   * a crossover, where normalisation is also in play.
   */
  it.each([
    ["single category", ["marvel"], 0, 10],
    ["crossover", ["hollywood", "animals"], 10, 20],
  ] as const)("forecast matches reality: %s", (_label, categoryIds, from, to) => {
    const pool = charactersInCategories([...categoryIds]);
    const ids = pool.map((c) => c.id).slice(from, to);
    const teams = [team("a", ids.slice(0, 5)), team("b", ids.slice(5, 10))];

    const N = 60;
    let wins = 0;
    let forecast = 0;
    for (let i = 0; i < N; i++) {
      const result = simulateBattle({
        teams,
        map: MAPS_BY_ID.forest,
        event: neutralEvent,
        charactersById: CHARACTERS_BY_ID,
        seed: `forecast-${_label}-${i}`,
        categoryIds: [...categoryIds],
        bands: BANDS,
      });
      forecast = result.teams.find((t) => t.playerId === "a")!.winProbability;
      if (result.winnerPlayerId === "a") wins++;
    }

    const observed = (wins / N) * 100;
    expect(Math.abs(observed - forecast)).toBeLessThan(25);
  });

  /**
   * The property that actually matters for crossovers: with the auction pool
   * shuffled out of two categories — which is how a crossover game really
   * works — no category should be over-represented among the winners.
   */
  it("does not let one category dominate a mixed pool", () => {
    const pairs: [string, string][] = [
      ["hollywood", "marvel"],
      ["animals", "dc"],
      ["action-movies", "fantasy"],
      ["anime", "video-games"],
    ];

    const wins: Record<string, number> = {};
    let total = 0;

    for (const [x, y] of pairs) {
      const pool = charactersInCategories([x, y]);
      for (let s = 0; s < 30; s++) {
        const rng = createRng(`mix-${x}-${y}-${s}`);
        const queue = rng.shuffle(pool).slice(0, 20);
        const teams = [0, 1, 2, 3].map((i) =>
          team(`p${i}`, queue.slice(i * 5, i * 5 + 5).map((c) => c.id)),
        );
        const result = simulateBattle({
          teams,
          map: rng.pick(MAPS),
          event: rng.pick(EVENT_CARDS),
          charactersById: CHARACTERS_BY_ID,
          seed: `mix-${x}-${y}-${s}`,
          categoryIds: [x, y],
          bands: BANDS,
        });
        const winner = teams.find((t) => t.playerId === result.winnerPlayerId)!;
        for (const c of winner.characters) {
          const cat = CHARACTERS_BY_ID[c.characterId].categoryId;
          wins[cat] = (wins[cat] ?? 0) + 1;
          total++;
        }
      }
    }

    // Eight categories share the winners' rosters; a fair spread is ~12.5%
    // each. Allow generous variance but catch a category that is running away
    // with every crossover.
    for (const [cat, n] of Object.entries(wins)) {
      const share = (n / total) * 100;
      expect(share, `${cat} share of winning rosters`).toBeLessThan(22);
      expect(share, `${cat} share of winning rosters`).toBeGreaterThan(4);
    }
  });

  it("builds a playable cinematic with a monotonic timeline", () => {
    const result = run("seed-2");
    // Round markers are renamed to their phase once the battle's length is
    // known, so the first entry opens the fight rather than merely counting it.
    expect(result.log[0].kind).toBe("PHASE");
    expect(result.log[0].text).toContain("OPENING");
    expect(result.log.at(-1)?.kind).toBe("END");
    expect(result.durationMs).toBeGreaterThan(3000);
    expect(result.durationMs).toBeLessThan(60_000);
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
      categoryIds: ["marvel"],
      bands: BANDS,
    });

    expect(result.combatants).toHaveLength(10);
    for (const c of result.combatants) {
      expect(c.valueScore).toBeCloseTo(c.performance / c.price, 2);
      expect(c.survivalPct).toBeGreaterThanOrEqual(0);
      expect(c.survivalPct).toBeLessThanOrEqual(100);
    }
    expect(result.mvp!.playerId).toBe(result.winnerPlayerId);
    expect(result.awards.bestValue!.valueScore).toBeGreaterThanOrEqual(
      result.awards.worstValue!.valueScore,
    );
  });

  it("reports the synergies that were actually in play", () => {
    const result = run("seed-3");
    for (const t of result.teams) expect(Array.isArray(t.synergies)).toBe(true);
  });

  it("keeps team ratings in a sane range", () => {
    const rating = teamRating(teamA, CHARACTERS_BY_ID, map, neutralEvent, {
      mixed: false,
    });
    expect(rating).toBeGreaterThan(300);
    expect(rating).toBeLessThan(600);
  });
});

describe("V4 battle: phases, turning point, MVP performance, upset", () => {
  const run = (seed: string) =>
    simulateBattle({
      teams: [teamA, teamB],
      map,
      event: neutralEvent,
      charactersById: CHARACTERS_BY_ID,
      seed,
      categoryIds: ["marvel"],
      bands: BANDS,
    });

  it("names every round marker after a phase of the fight", () => {
    const result = run("phase-seed");
    const markers = result.log.filter((e) => e.kind === "PHASE");
    expect(markers.length).toBeGreaterThan(0);
    // First marker opens the battle, last one closes it.
    expect(markers[0].text).toContain("OPENING");
    const labels = markers.map((m) => m.text.split(" ·")[0]);
    expect(new Set(labels).size).toBeGreaterThan(1);
  });

  it("reports the MVP as a share of expectation, not raw damage", () => {
    const result = run("mvp-seed");
    expect(result.mvp).not.toBeNull();
    const mvp = result.mvp!;
    expect(mvp.expected).toBeGreaterThan(0);
    expect(mvp.actual).toBeGreaterThanOrEqual(0);
    // The percentage really is the ratio of the two.
    expect(mvp.performance).toBe(Math.round((mvp.actual / mvp.expected) * 100));
  });

  it("only calls it an upset when the least-fancied team wins", () => {
    // Sweep seeds and check the flag never contradicts the forecast.
    for (let i = 0; i < 40; i++) {
      const result = run(`upset-${i}`);
      const winner = result.teams.find((t) => t.playerId === result.winnerPlayerId)!;
      const lowest = Math.min(...result.teams.map((t) => t.winProbability));
      const highest = Math.max(...result.teams.map((t) => t.winProbability));
      if (result.upset) {
        expect(winner.winProbability).toBe(lowest);
        expect(winner.winProbability).toBeLessThan(highest);
      }
    }
  });

  it("puts the turning point inside the battle it describes", () => {
    let found = 0;
    for (let i = 0; i < 40; i++) {
      const result = run(`turn-${i}`);
      if (!result.turningPoint) continue;
      found++;
      const rounds = result.log.map((e) => e.round);
      expect(result.turningPoint.round).toBeGreaterThan(0);
      expect(result.turningPoint.round).toBeLessThanOrEqual(Math.max(...rounds));
      // It swung towards the winner, and the marker is in the log.
      expect(result.turningPoint.to).toBeGreaterThan(result.turningPoint.from);
      expect(result.log.some((e) => e.kind === "TURNING_POINT")).toBe(true);
    }
    // Not every battle swings, but across forty some must.
    expect(found).toBeGreaterThan(0);
  });

  it("makes an upset rare enough to mean something and common enough to see", () => {
    // NB: winProbability is a percentage, not a fraction. An earlier cut of
    // this feature used 0.15 as the threshold on a 0-100 scale, which made
    // every close battle an "upset" and every battle have a "turning point".
    // Varied matchups, not the fixed pairing above: whether an underdog exists
    // at all depends on the squads, and one pairing cannot answer "how often".
    const pool = CHARACTERS.filter((c) => c.categoryId === "marvel");
    const rng = createRng("upset-matchups");
    let upsets = 0;
    let turns = 0;
    let n = 0;
    for (let m = 0; m < 30; m++) {
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const squads = [shuffled.slice(0, 5), shuffled.slice(5, 10)];
      for (let i = 0; i < 10; i++) {
        const r = simulateBattle({
          teams: squads.map((chars, k) => ({
            playerId: `P${k}`,
            nickname: `P${k}`,
            characters: chars.map((c) => ({ characterId: c.id, price: 10 })),
          })),
          map,
          event: neutralEvent,
          charactersById: CHARACTERS_BY_ID,
          seed: `rate-${m}-${i}`,
          categoryIds: ["marvel"],
          bands: BANDS,
        });
        if (r.upset) upsets++;
        if (r.turningPoint) turns++;
        n++;
      }
    }
    expect(upsets / n).toBeGreaterThan(0.02);
    expect(upsets / n).toBeLessThan(0.4);
    // A comeback that happens in every battle is not a comeback.
    expect(turns / n).toBeLessThan(0.6);
  });

  it("keeps the timeline monotonic after phases and markers are inserted", () => {
    for (const seed of ["a", "b", "c"]) {
      const times = run(`mono-${seed}`).log.map((e) => e.atMs);
      expect([...times].sort((x, y) => x - y)).toEqual(times);
    }
  });
});
