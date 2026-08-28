import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import {
  CHARACTERS,
  CHARACTER_VISUALS,
  nicknameFor,
  visualFor,
} from "../src/lib/game/characters";
import { CATEGORIES, allAxes, getCategory } from "../src/lib/game/categories";
import { archetypeOf } from "../src/lib/game/archetypes";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { visualArchetypeFor } from "../src/lib/render/archetypes";
import { identityFor, visualSignature, identitySignature } from "../src/lib/render/identity";
import { IDENTITY_TILE_ROWS, IDENTITY_TILE_SLOTS, SPRITE_ANCHORS } from "../src/lib/render/anchors.generated";
import { BASKETBALL } from "../src/lib/game/pools/basketball";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * Twenty-five invented basketballers, on the architecture football proved.
 * ---------------------------------------------------------------------------
 * The interesting part of this category is not that it exists — S6 showed a
 * category is a stat recipe, a pool and some metadata — but the one place it
 * could not simply copy football. A football sits on the grass and hangs off
 * the `foot` anchor; a basketball is carried. A tile declares one slot, so the
 * sheet gets a second ball rather than one ball pretending to be both.
 *
 * Everything else is the standing bargain: the look cannot reach the
 * simulation, no real person is in here, and the catalogue people are playing
 * does not move.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const BALLERS = CHARACTERS.filter((c) => c.categoryId === "basketball");
const identityOf = (id: string) =>
  identityFor(CHARACTERS_BY_ID[id], visualArchetypeFor(CHARACTERS_BY_ID[id]));


// ---------------------------------------------------------------------------
// The roster, as a table the code fails against
// ---------------------------------------------------------------------------

/**
 * Every authored field of every basketballer.
 *
 * Football learned this the useful way: without a per-character table, a
 * mutation that quietly moved one player onto the wrong body plan passed every
 * uniqueness test, because the result was still unique — just wrong. Design
 * decisions have to be written down somewhere the code checks.
 */
const ROSTER: Record<string, {
  nick: string; archetype: string; head: string; back: string;
  marking: string; build: string; prop: string; scale: number;
}> = {
  "basketball-the-baseline-skyhook": { nick: "THE SKYHOOK", archetype: "humanoid_large", head: "PLAIN", back: "NONE", marking: "PLAIN", build: "TOWERING", prop: "BALL_HELD", scale: 1.08 },
  "basketball-the-floor-general": { nick: "THE FLOOR GENERAL", archetype: "humanoid_medium", head: "CREST", back: "NONE", marking: "PATCH", build: "SLIGHT", prop: "BALL_HELD", scale: 0.9 },
  "basketball-the-downhill-slasher": { nick: "THE SLASHER", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "STRIPES", build: "NORMAL", prop: "BALL_HELD", scale: 0.96 },
  "basketball-the-rim-guardian": { nick: "THE RIM GUARDIAN", archetype: "humanoid_large", head: "HELM", back: "NONE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.06 },
  "basketball-the-corner-sniper": { nick: "THE SNIPER", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "SPOTS", build: "SLIGHT", prop: "BALL_HELD", scale: 0.94 },
  "basketball-the-glass-cleaner": { nick: "THE GLASS CLEANER", archetype: "humanoid_large", head: "PLAIN", back: "MANE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.1 },
  "basketball-the-sixth-man": { nick: "THE SIXTH MAN", archetype: "humanoid_medium", head: "CREST", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "BALL_HELD", scale: 0.98 },
  "basketball-the-two-way-wing": { nick: "THE TWO-WAY", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "BANDS", build: "NORMAL", prop: "BALL_HELD", scale: 1 },
  "basketball-the-ankle-breaker": { nick: "THE ANKLE BREAKER", archetype: "humanoid_medium", head: "PLAIN", back: "MANE", marking: "SPOTS", build: "SLIGHT", prop: "BALL_HELD", scale: 0.92 },
  "basketball-the-stretch-big": { nick: "THE STRETCH BIG", archetype: "humanoid_large", head: "PLAIN", back: "NONE", marking: "STRIPES", build: "TOWERING", prop: "BALL_HELD", scale: 1.04 },
  "basketball-the-point-centre": { nick: "THE POINT CENTRE", archetype: "humanoid_large", head: "CREST", back: "NONE", marking: "PATCH", build: "HEAVY", prop: "BALL_HELD", scale: 1.06 },
  "basketball-the-lockdown": { nick: "THE LOCKDOWN", archetype: "humanoid_medium", head: "HELM", back: "NONE", marking: "PLAIN", build: "NORMAL", prop: "NONE", scale: 0.98 },
  "basketball-the-microwave": { nick: "THE MICROWAVE", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "PATCH", build: "SLIGHT", prop: "BALL_HELD", scale: 0.96 },
  "basketball-the-enforcer": { nick: "THE ENFORCER", archetype: "humanoid_large", head: "HELM", back: "NONE", marking: "BANDS", build: "HEAVY", prop: "NONE", scale: 1.12 },
  "basketball-the-motor": { nick: "THE MOTOR", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "SPOTS", build: "NORMAL", prop: "NONE", scale: 0.96 },
  "basketball-the-closer": { nick: "THE CLOSER", archetype: "humanoid_medium", head: "CREST", back: "NONE", marking: "BANDS", build: "NORMAL", prop: "BALL_HELD", scale: 1 },
  "basketball-the-roll-finisher": { nick: "THE ROLLER", archetype: "humanoid_large", head: "PLAIN", back: "NONE", marking: "PATCH", build: "HEAVY", prop: "BALL_HELD", scale: 1.06 },
  "basketball-the-spot-up-shooter": { nick: "THE SPOT UP", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "PLAIN", build: "SLIGHT", prop: "BALL_HELD", scale: 0.92 },
  "basketball-the-iron": { nick: "THE IRON", archetype: "humanoid_large", head: "PLAIN", back: "MANE", marking: "BANDS", build: "NORMAL", prop: "NONE", scale: 1.04 },
  "basketball-the-professor": { nick: "THE PROFESSOR", archetype: "humanoid_medium", head: "PLAIN", back: "MANE", marking: "PLAIN", build: "SQUAT", prop: "BALL_HELD", scale: 0.9 },
  "basketball-the-floater-artist": { nick: "THE FLOATER", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "BANDS", build: "SLIGHT", prop: "BALL_HELD", scale: 0.94 },
  "basketball-the-vertical-threat": { nick: "THE VERTICAL", archetype: "humanoid_medium", head: "PLAIN", back: "NONE", marking: "STRIPES", build: "TOWERING", prop: "BALL_HELD", scale: 1.02 },
  "basketball-the-pickpocket": { nick: "THE PICKPOCKET", archetype: "humanoid_medium", head: "CREST", back: "NONE", marking: "SPOTS", build: "SLIGHT", prop: "NONE", scale: 0.92 },
  "basketball-the-swingman": { nick: "THE SWINGMAN", archetype: "humanoid_medium", head: "PLAIN", back: "MANE", marking: "PATCH", build: "NORMAL", prop: "BALL_HELD", scale: 0.98 },
  "basketball-the-fortress": { nick: "THE FORTRESS", archetype: "humanoid_large", head: "HELM", back: "MANE", marking: "PLAIN", build: "HEAVY", prop: "NONE", scale: 1.14 },
};

describe("every basketballer is drawn the way it was designed", () => {
  it("covers the whole roster", () => {
    expect(Object.keys(ROSTER)).toHaveLength(25);
    expect(new Set(Object.keys(ROSTER))).toEqual(new Set(BALLERS.map((c) => c.id)));
  });

  for (const [id, want] of Object.entries(ROSTER)) {
    it(`${want.nick}`, () => {
      const c = CHARACTERS_BY_ID[id];
      expect(c, `${id} is missing`).toBeTruthy();
      expect(nicknameFor(id, c.name)).toBe(want.nick);
      expect(visualArchetypeFor(c), "body plan").toBe(want.archetype);
      const i = identityOf(id);
      expect(i.head).toBe(want.head);
      expect(i.back).toBe(want.back);
      expect(i.marking).toBe(want.marking);
      expect(i.build).toBe(want.build);
      expect(i.prop).toBe(want.prop);
      expect(i.scale).toBe(want.scale);
    });
  }
});

describe("the category is registered like every other one", () => {
  it("exists, with its own stats and no new engine anything", () => {
    const c = getCategory("basketball");
    expect(c.id).toBe("basketball");
    expect(c.realWorld).toBe(false);
    expect(c.stats.map((s) => s.key)).toEqual([
      "finishing", "vision", "pace", "physical", "technique", "composure",
    ]);
    expect(Object.keys(c.axes).sort()).toEqual([
      "defense", "power", "special", "speed", "strategy",
    ]);
  });

  it("registers its pool, and the pool is the size the file claims", () => {
    expect(BASKETBALL).toHaveLength(25);
    expect(BALLERS).toHaveLength(25);
  });

  it("projects every character onto finite axes", () => {
    const category = getCategory("basketball");
    for (const c of BALLERS) {
      for (const [axis, value] of Object.entries(allAxes(category, c.stats))) {
        expect(Number.isFinite(value), `${c.id} ${axis}`).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("seats a full five-player table", () => {
    // The draft consumes `players x 5` exactly. Twenty-five is the first pool
    // size that seats the standard game without a crossover.
    expect(Math.floor(BALLERS.length / 5)).toBe(5);
    expect(5 * 5).toBeLessThanOrEqual(BALLERS.length);
  });

  it("carries a disclaimer naming what it is not", () => {
    const text = getCategory("basketball").disclaimer;
    expect(text).toContain("Original fictional basketball archetypes");
    for (const word of ["athlete", "team", "league"]) {
      expect(text.toLowerCase()).toContain(word);
    }
  });
});

describe("twenty-five players, no two alike", () => {
  it("gives every one a unique id, name and nickname", () => {
    expect(new Set(BALLERS.map((c) => c.id)).size).toBe(25);
    expect(new Set(BALLERS.map((c) => c.name)).size).toBe(25);
    expect(new Set(BALLERS.map((c) => nicknameFor(c.id, c.name))).size).toBe(25);
  });

  it("does not reuse a nickname another category already took", () => {
    // Nicknames are shouted across a table; two characters answering to the
    // same one is worse than none of them having one.
    const seen = new Map<string, string[]>();
    for (const c of CHARACTERS) {
      const nick = nicknameFor(c.id, c.name);
      if (nick === c.name) continue;
      seen.set(nick, [...(seen.get(nick) ?? []), c.id]);
    }
    const clashes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
    expect(clashes, clashes.map(([n, ids]) => `${n}: ${ids.join(", ")}`).join("; "))
      .toHaveLength(0);
  });

  it("produces twenty-five distinct visual and identity signatures", () => {
    const visual = new Map<string, string[]>();
    const identity = new Set<string>();
    for (const c of BALLERS) {
      const plan = visualArchetypeFor(c);
      const look = identityOf(c.id);
      const sig = visualSignature(plan, look);
      visual.set(sig, [...(visual.get(sig) ?? []), nicknameFor(c.id, c.name)]);
      identity.add(identitySignature(look, plan));
    }
    const collisions = [...visual.values()].filter((v) => v.length > 1);
    expect(collisions, collisions.map((c) => c.join(" = ")).join("; ")).toHaveLength(0);
    expect(visual.size).toBe(25);
    expect(identity.size).toBe(25);
  });

  it("separates them with the palette taken away", () => {
    // Every one is a humanoid. If colour were doing the work of telling a
    // sniper from a rim protector, it would show here.
    const shapes = new Set(
      BALLERS.map((c) => {
        const i = identityOf(c.id);
        return [visualArchetypeFor(c), i.head, i.back, i.marking, i.build, i.prop, i.scale].join("|");
      }),
    );
    expect(shapes.size).toBe(25);
  });

  it("separates the pairs a player would most easily confuse", () => {
    const shapeOf = (id: string) => {
      const i = identityOf(id);
      return [visualArchetypeFor(CHARACTERS_BY_ID[id]), i.head, i.back, i.marking, i.build, i.prop].join("|");
    };
    const pairs: [string, string][] = [
      ["basketball-the-corner-sniper", "basketball-the-spot-up-shooter"],
      ["basketball-the-floor-general", "basketball-the-professor"],
      ["basketball-the-rim-guardian", "basketball-the-glass-cleaner"],
      ["basketball-the-downhill-slasher", "basketball-the-microwave"],
      ["basketball-the-lockdown", "basketball-the-two-way-wing"],
      ["basketball-the-enforcer", "basketball-the-fortress"],
      ["basketball-the-baseline-skyhook", "basketball-the-stretch-big"],
    ];
    for (const [a, b] of pairs) {
      expect(CHARACTERS_BY_ID[a], a).toBeTruthy();
      expect(CHARACTERS_BY_ID[b], b).toBeTruthy();
      expect(shapeOf(a), `${a} vs ${b}`).not.toBe(shapeOf(b));
    }
  });

  it("authors every look in the pool, leaving nothing to a hash", () => {
    for (const c of BALLERS) {
      const authored = visualFor(c.id);
      expect(authored?.va, `${c.id} has no body plan`).toBeTruthy();
      expect(authored?.nick, `${c.id} has no nickname`).toBeTruthy();
      for (const field of ["head", "back", "marking", "build", "prop", "scale"] as const) {
        expect(authored?.i?.[field], `${c.id} leaves ${field} to the rules`).toBeDefined();
      }
    }
  });

  it("adds nothing to the legacy override tables", () => {
    for (const file of ["src/lib/render/identity.ts", "src/lib/render/archetypes.ts"]) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8")).not.toContain("basketball-");
    }
  });
});

describe("the ball is carried, not dribbled through the floor", () => {
  it("gives basketball its own held-ball tile", () => {
    // `BALL` hangs off the foot because a football sits on the grass. A tile
    // declares one slot, so a carried ball is a second tile rather than the
    // first one bent to mean both.
    expect(IDENTITY_TILE_ROWS).toContain("BALL_HELD");
    expect(IDENTITY_TILE_SLOTS.BALL_HELD.slot).toBe("hand");
    expect(IDENTITY_TILE_SLOTS.BALL.slot).toBe("foot");
  });

  it("uses the held ball, never the football one", () => {
    for (const c of BALLERS) {
      expect(identityOf(c.id).prop, c.id).not.toBe("BALL");
    }
    const held = BALLERS.filter((c) => identityOf(c.id).prop === "BALL_HELD");
    expect(held.length).toBeGreaterThanOrEqual(15);
  });

  it("routes the hand slot in the draw layer", () => {
    // Declaring a slot is half of it; the renderer has to send it somewhere.
    // Asserted against the source because stamping a tile needs a real canvas
    // and Node has none.
    const canvas = readFileSync(resolve(process.cwd(), "src/lib/render/canvas.ts"), "utf8");
    expect(canvas).toContain('meta.slot === "hand" ? anchors.hand');
    expect(canvas).toContain('meta.slot === "foot" ? anchors.foot');
  });

  it("has a hand anchor on every frame of both humanoid plans", () => {
    for (const plan of ["humanoid_medium", "humanoid_large"]) {
      for (const row of SPRITE_ANCHORS[plan]) {
        for (const frame of row) {
          if (!frame) continue;
          expect(frame.hand, `${plan}`).toHaveLength(3);
          const [x, y] = frame.hand;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(32);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it("keeps the held ball up the body rather than at the boots", () => {
    // The ground line is 27. A hand anchor down at the feet would put a
    // basketball in the mud, which is the mistake this tile exists to avoid.
    for (const plan of ["humanoid_medium", "humanoid_large"]) {
      const idle = SPRITE_ANCHORS[plan][0].filter(Boolean);
      for (const frame of idle) {
        expect(frame!.hand[1], `${plan} hand too low`).toBeLessThan(24);
      }
    }
  });

  it("moves the hand with the pose, so the ball travels", () => {
    for (const plan of ["humanoid_medium", "humanoid_large"]) {
      const xs = SPRITE_ANCHORS[plan].flat().filter(Boolean).map((f) => f!.hand[0]);
      expect(new Set(xs).size, `${plan} hand never moves`).toBeGreaterThan(1);
    }
  });

  it("exercises the held ball on both body plans and several builds", () => {
    const combos = new Set(
      BALLERS.map((c) => {
        const i = identityOf(c.id);
        return `${visualArchetypeFor(c)}+${i.build}+${i.prop}`;
      }),
    );
    for (const combo of [
      "humanoid_medium+NORMAL+BALL_HELD",
      "humanoid_medium+SLIGHT+BALL_HELD",
      "humanoid_medium+SQUAT+BALL_HELD",
      "humanoid_large+TOWERING+BALL_HELD",
      "humanoid_large+HEAVY+BALL_HELD",
      "humanoid_large+HEAVY+NONE",
    ]) {
      expect([...combos], `nobody exercises ${combo}`).toContain(combo);
    }
  });
});

describe("the archetypes are derived, not declared", () => {
  const combatOf = (id: string) =>
    archetypeOf(allAxes(getCategory("basketball"), CHARACTERS_BY_ID[id].stats));

  it("covers the whole archetype vocabulary without any one dominating", () => {
    const counts = new Map<string, number>();
    for (const c of BALLERS) {
      const id = combatOf(c.id).primary.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // All nine, and nothing over a third of the roster.
    expect(counts.size).toBe(9);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(8);
  });

  it("reads each written role as the archetype it was written as", () => {
    expect(combatOf("basketball-the-rim-guardian").primary.id).toBe("TANK");
    expect(combatOf("basketball-the-fortress").primary.id).toBe("TANK");
    expect(combatOf("basketball-the-corner-sniper").primary.id).toBe("RANGED");
    expect(combatOf("basketball-the-professor").primary.id).toBe("STRATEGIST");
    expect(combatOf("basketball-the-pickpocket").primary.id).toBe("SPEEDSTER");
    expect(combatOf("basketball-the-floor-general").primary.id).toBe("SUPPORT");
  });

  it("puts no basketball branch in the engine", () => {
    for (const file of ["src/lib/game/battle.ts", "src/lib/game/archetypes.ts"]) {
      expect(readFileSync(resolve(process.cwd(), file), "utf8")).not.toContain("basketball");
    }
  });
});

describe("synergy runs on the existing tag engine", () => {
  it("gives every declared group at least three possible members", () => {
    for (const group of getCategory("basketball").synergies) {
      const members = BALLERS.filter((c) => c.tags.includes(group.tag));
      expect(members.length, group.tag).toBeGreaterThanOrEqual(3);
    }
  });

  it("changes no synergy mathematics", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/game/categories.ts"), "utf8");
    expect(source).toContain("export const MAX_SYNERGY = 0.1;");
  });

  it("actually fires in a real battle", () => {
    // Five shooters on one side: the engine must report the group, at the
    // bonus the category declared, without anything basketball-specific.
    const shooters = BALLERS.filter((c) => c.tags.includes("shooter")).slice(0, 5);
    expect(shooters.length).toBe(5);
    const rest = BALLERS.filter((c) => !shooters.includes(c)).slice(0, 5);

    const result = simulateBattle({
      teams: [
        { playerId: "a", nickname: "Ege", formation: "AGGRESSIVE",
          characters: shooters.map((c, i) => ({ characterId: c.id, price: 4 + i })) },
        { playerId: "b", nickname: "Mikail", formation: "DEFENSIVE",
          characters: rest.map((c, i) => ({ characterId: c.id, price: 4 + i })) },
      ],
      map: MAPS[0], event: EVENT_CARDS[0], charactersById: CHARACTERS_BY_ID,
      seed: "bb-synergy", categoryIds: ["basketball"], bands: BANDS,
    });

    const team = result.teams.find((t) => t.playerId === "a")!;
    // The engine labels a group with its size — "Sharpshooters ×5" — so the
    // assertion matches the group, not the exact string.
    const group = team.synergies.find((s) => s.label.startsWith("Sharpshooters"));
    expect(group, team.synergies.map((s) => s.label).join(", ")).toBeTruthy();
    expect(group!.bonus).toBeGreaterThan(0);
  });
});

describe("no real person is in here", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/game/pools/basketball.ts"), "utf8");

  /** A name only counts as used when it appears as a word, not inside one. */
  const mentions = (word: string) =>
    new RegExp(`\\b${word}\\b`, "i").test(source);

  it("names no real player", () => {
    for (const name of [
      "Jordan", "LeBron", "Kobe", "Curry", "Durant", "Shaq", "Kareem", "Magic",
      "Bird", "Duncan", "Olajuwon", "Iverson", "Doncic", "Jokic", "Giannis",
      "Antetokounmpo", "Embiid", "Harden", "Westbrook", "Pippen", "Wilt",
    ]) {
      expect(mentions(name), `${name} appears in the pool`).toBe(false);
    }
  });

  it("names no team, league or brand", () => {
    for (const brand of [
      "Lakers", "Bulls", "Celtics", "Warriors", "Knicks", "Heat", "Spurs",
      "NBA", "NCAA", "EuroLeague", "FIBA", "Nike", "Adidas", "Jordan Brand",
    ]) {
      expect(mentions(brand), `${brand} appears in the pool`).toBe(false);
    }
  });

  it("looks up no Wikipedia page, so no real portrait can arrive", () => {
    for (const entry of BASKETBALL) {
      expect(entry.w, `${entry.n} would be enriched`).toBeNull();
    }
    for (const c of BALLERS) {
      expect(c.wikiTitle, c.id).toBeNull();
      expect(c.imageUrl, c.id).toBeNull();
      expect(c.thumbnailUrl, c.id).toBeNull();
    }
  });

  it("uses archetypal names and marks itself original", () => {
    for (const c of BALLERS) {
      expect(c.name).toMatch(/^The /);
      expect(c.universe).toBe("Original");
    }
  });
});

describe("none of the look reaches the game", () => {
  const A = BALLERS.slice(0, 5).map((c) => c.id);
  const B = BALLERS.slice(5, 10).map((c) => c.id);

  const battle = (seed: string): BattleResult =>
    simulateBattle({
      teams: [
        { playerId: "a", nickname: "Ege", formation: "AGGRESSIVE",
          characters: A.map((id, i) => ({ characterId: id, price: 4 + i * 3 })) },
        { playerId: "b", nickname: "Mikail", formation: "DEFENSIVE",
          characters: B.map((id, i) => ({ characterId: id, price: 6 + i * 2 })) },
      ],
      map: MAPS[0], event: EVENT_CARDS[0], charactersById: CHARACTERS_BY_ID,
      seed, categoryIds: ["basketball"], bands: BANDS,
    });

  it("plays a real basketball battle", () => {
    const r = battle("bb-1");
    expect(r.combatants).toHaveLength(10);
    expect(r.winnerPlayerId).toBeTruthy();
  });

  it("produces a byte-identical battle when every look is rewritten", () => {
    const before = battle("bb-2");
    const saved = Object.fromEntries([...A, ...B].map((id) => [id, CHARACTER_VISUALS[id]]));
    try {
      for (const id of [...A, ...B]) {
        CHARACTER_VISUALS[id] = {
          nick: "SOMEBODY ELSE", va: "aquatic",
          i: { head: "TUSKS", back: "SHELL", marking: "BANDS", prop: "HAMMER", build: "SQUAT", scale: 1.8 },
        };
      }
      expect(identityOf(A[0]).prop).toBe("HAMMER");
      expect(battle("bb-2")).toEqual(before);
    } finally {
      for (const [id, v] of Object.entries(saved)) CHARACTER_VISUALS[id] = v!;
    }
  });

  it("produces the same battle with the visual table emptied entirely", () => {
    // The decisive version. Rewriting only the ten fighters leaves the rest of
    // the table intact, so a leak that asks a *global* question — "does anyone
    // anywhere carry a ball?" — answers the same either way and survives.
    // Emptying the table removes that hiding place: if the simulation reads
    // this file at all, the result has to move.
    const before = battle("bb-empty");
    const saved = { ...CHARACTER_VISUALS };
    try {
      for (const id of Object.keys(CHARACTER_VISUALS)) delete CHARACTER_VISUALS[id];
      expect(Object.keys(CHARACTER_VISUALS)).toHaveLength(0);
      expect(battle("bb-empty")).toEqual(before);
    } finally {
      Object.assign(CHARACTER_VISUALS, saved);
    }
    expect(Object.keys(CHARACTER_VISUALS).length).toBeGreaterThan(50);
  });

  it("keeps nicknames and body plans out of the stored record", () => {
    const json = JSON.stringify(battle("bb-3"));
    for (const leaked of ["THE SNIPER", "THE FORTRESS", "BALL_HELD", "humanoid_large", "TOWERING"]) {
      expect(json, `${leaked} reached battle_result`).not.toContain(leaked);
    }
  });

  it("keys the cached frame on the prop and the build", () => {
    const canvas = readFileSync(resolve(process.cwd(), "src/lib/render/canvas.ts"), "utf8");
    const key = canvas.slice(canvas.indexOf("function identityKeyOf"), canvas.indexOf("const TILE_SCALE"));
    for (const field of ["head", "back", "marking", "prop", "build", "accent"]) {
      expect(key, `cache key ignores ${field}`).toContain(`i.${field}`);
    }
    const c = CHARACTERS_BY_ID["basketball-the-corner-sniper"];
    const plan = visualArchetypeFor(c);
    const base = identityOf(c.id);
    const keys = [
      visualSignature(plan, base),
      visualSignature(plan, { ...base, prop: "NONE" }),
      visualSignature(plan, { ...base, build: "TOWERING" }),
    ];
    expect(new Set(keys).size).toBe(3);
    expect(visualSignature(plan, base)).toBe(visualSignature(plan, identityOf(c.id)));
  });
});

describe("the game people are playing did not move", () => {
  it("keeps the legacy fingerprint of all 268 characters", () => {
    const legacy = CHARACTERS.filter(
      (c) => c.categoryId !== "football" && c.categoryId !== "basketball",
    );
    const fingerprint = legacy
      .map((c) => [c.id, c.categoryId, c.gamePower, c.rarity, c.basePrice, JSON.stringify(c.stats), c.tags.join(",")].join("|"))
      .sort()
      .join("\n");
    expect(legacy).toHaveLength(268);
    expect(createHash("sha256").update(fingerprint).digest("hex")).toBe(
      "a2f9491df7423fef5a954fdf96be8341b484fae5162f2de0d4621c27a0ee0589",
    );
  });

  it("keeps all eight legacy categories and adds a tenth", () => {
    const ids = CATEGORIES.map((c) => c.id);
    for (const legacy of [
      "animals", "marvel", "dc", "hollywood",
      "action-movies", "fantasy", "video-games", "anime",
    ]) {
      expect(ids).toContain(legacy);
    }
    expect(ids).toContain("football");
    expect(ids).toContain("basketball");
    expect(CATEGORIES).toHaveLength(10);
  });

  it("leaves every body sprite byte-identical", () => {
    const hashes: Record<string, string> = {
      humanoid_medium: "c5753f9dbe1700ea2c5f6b3839a87080",
      humanoid_large: "6321dddcebf861d80c38fe9069cb716d",
      quadruped_small: "a2a59ee32b41bd9562f90f45f9f78d11",
      quadruped_medium: "234acbf950bc4ae78ecd7003e49b10ad",
      quadruped_large: "b13e117be79253062d6aac229976a96d",
      serpentine: "b7514c7f309293cc4ad211e8a3f806f0",
      winged: "ea18f1799ad2429cf556365f1bc1492d",
      aquatic: "bd4d5bb6ff3bc49863847cf9cf17abb7",
    };
    for (const [name, expected] of Object.entries(hashes)) {
      const bytes = readFileSync(resolve(process.cwd(), `public/sprites/${name}.png`));
      expect(createHash("md5").update(bytes).digest("hex"), `${name}.png`).toBe(expected);
    }
  });
});

describe("the seed carries basketball without disturbing anything", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/0004_seed_v2_characters.sql"),
    "utf8",
  );

  it("contains a row for every basketball character", () => {
    for (const c of BALLERS) {
      expect(sql, `${c.id} is not seeded`).toContain(`'${c.id}'`);
    }
  });

  it("still contains every legacy character", () => {
    for (const id of ["animals-lion", "marvel-iron-man", "dc-batman", "anime-goku"]) {
      expect(sql, `${id} vanished from the seed`).toContain(`'${id}'`);
    }
  });

  it("upserts rather than replacing, and deletes nothing", () => {
    expect(sql.toLowerCase()).toContain("on conflict");
    expect(sql.toLowerCase()).not.toContain("delete from characters");
    expect(sql.toLowerCase()).not.toContain("truncate");
  });

  it("leaves the Wikipedia columns null for invented people", () => {
    const row = sql.slice(sql.indexOf("'basketball-the-corner-sniper'"));
    const line = row.slice(0, row.indexOf("\n"));
    // wiki_title, wiki_url, image_url, thumbnail_url and the three credit
    // columns are all null for a character nobody photographed.
    expect(line).toContain("null, null, null, null, null, null, null");
  });
});
