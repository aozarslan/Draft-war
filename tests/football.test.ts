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
import { identityFor, visualSignature } from "../src/lib/render/identity";
import {
  IDENTITY_TILE_SLOTS,
  SPRITE_ANCHORS,
} from "../src/lib/render/anchors.generated";
import { FOOTBALL } from "../src/lib/game/pools/football";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * Ten invented footballers, added beside a game nobody stopped playing.
 * ---------------------------------------------------------------------------
 * Football is the first category built for a launch that cannot depend on
 * licences, so its constraints are unusual: every character has to *read* as a
 * recognisable archetype while containing no real person at all. That makes
 * two kinds of failure worth testing for. The obvious one is a real name
 * slipping into the data. The quieter one is ten characters who share a body
 * and are told apart only by colour — which would mean the archetypes exist in
 * the description and nowhere a player can see.
 *
 * And the standing promise from S1 still applies: none of it may reach the
 * simulation, and the catalogue people are playing right now must not move.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const FOOTBALLERS = CHARACTERS.filter((c) => c.categoryId === "football");

interface Target {
  nick: string;
  name: string;
  archetype: string;
  build: string;
  prop: string;
}

/** The roster, as a table the code fails against. */
const ROSTER: Record<string, Target> = {
  "football-the-argentine-maestro":     { nick: "THE MAESTRO",    name: "The Argentine Maestro",     archetype: "humanoid_medium", build: "SLIGHT",   prop: "BALL" },
  "football-the-portuguese-machine":    { nick: "THE MACHINE",    name: "The Portuguese Machine",    archetype: "humanoid_large",  build: "TOWERING", prop: "BALL" },
  "football-the-brazilian-showman":     { nick: "THE SHOWMAN",    name: "The Brazilian Showman",     archetype: "humanoid_medium", build: "NORMAL",   prop: "BALL" },
  "football-the-french-phenom":         { nick: "THE PHENOM",     name: "The French Phenom",         archetype: "humanoid_medium", build: "SLIGHT",   prop: "BALL" },
  "football-the-northern-viking":       { nick: "THE VIKING",     name: "The Northern Viking",       archetype: "humanoid_large",  build: "TOWERING", prop: "BALL" },
  "football-the-spanish-conductor":     { nick: "THE CONDUCTOR",  name: "The Spanish Conductor",     archetype: "humanoid_medium", build: "SQUAT",    prop: "BALL" },
  "football-the-german-engine":         { nick: "THE ENGINE",     name: "The German Engine",         archetype: "humanoid_medium", build: "NORMAL",   prop: "BALL" },
  "football-the-italian-wall":          { nick: "THE WALL",       name: "The Italian Wall",          archetype: "humanoid_large",  build: "HEAVY",    prop: "SHIELD" },
  "football-the-south-american-keeper": { nick: "THE KEEPER",     name: "The South American Keeper", archetype: "humanoid_large",  build: "HEAVY",    prop: "SHIELD" },
  "football-the-continental-architect": { nick: "THE ARCHITECT",  name: "The Continental Architect", archetype: "humanoid_medium", build: "NORMAL",   prop: "BALL" },
  "football-the-atlantic-winger":            { nick: "THE WINGER",    name: "The Atlantic Winger",            archetype: "humanoid_medium", build: "SLIGHT",   prop: "BALL" },
  "football-the-anchor":                     { nick: "THE ANCHOR",    name: "The Anchor",                     archetype: "humanoid_medium", build: "HEAVY",    prop: "BALL" },
  "football-the-overlapping-fullback":       { nick: "THE OVERLAP",   name: "The Overlapping Fullback",       archetype: "humanoid_medium", build: "NORMAL",   prop: "BALL" },
  "football-the-target-man":                 { nick: "THE TARGET",    name: "The Target Man",                 archetype: "humanoid_large",  build: "HEAVY",    prop: "BALL" },
  "football-the-sweeper-keeper":             { nick: "THE SWEEPER",   name: "The Sweeper Keeper",             archetype: "humanoid_large",  build: "TOWERING", prop: "SHIELD" },
  "football-the-six-yard-poacher":           { nick: "THE POACHER",   name: "The Six Yard Poacher",           archetype: "humanoid_medium", build: "SQUAT",    prop: "BALL" },
  "football-the-ball-playing-centre-back":   { nick: "THE LIBERO",    name: "The Ball Playing Centre Back",   archetype: "humanoid_large",  build: "HEAVY",    prop: "BALL" },
  "football-the-second-striker":             { nick: "THE SHADOW",    name: "The Second Striker",             archetype: "humanoid_medium", build: "SLIGHT",   prop: "BALL" },
  "football-the-set-piece-specialist":       { nick: "THE DEAD BALL", name: "The Set Piece Specialist",       archetype: "humanoid_medium", build: "NORMAL",   prop: "BALL" },
  "football-the-veteran-captain":            { nick: "THE CAPTAIN",   name: "The Veteran Captain",            archetype: "humanoid_large",  build: "NORMAL",   prop: "SHIELD" },
};

const identityOf = (id: string) =>
  identityFor(CHARACTERS_BY_ID[id], visualArchetypeFor(CHARACTERS_BY_ID[id]));

describe("the category exists and behaves like every other one", () => {
  it("is registered with its own stats and axes", () => {
    const football = getCategory("football");
    expect(football.id).toBe("football");
    expect(football.realWorld).toBe(false);
    expect(football.stats.map((s) => s.key)).toEqual([
      "finishing", "vision", "pace", "physical", "technique", "composure",
    ]);
  });

  it("projects onto the same five axes as everything else", () => {
    // No new combat stat system: a footballer reaches the battle engine
    // through exactly the pipe an animal does.
    const football = getCategory("football");
    expect(Object.keys(football.axes).sort()).toEqual([
      "defense", "power", "special", "speed", "strategy",
    ]);
    for (const c of FOOTBALLERS) {
      const axes = allAxes(football, c.stats);
      for (const value of Object.values(axes)) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });

  it("carries a disclaimer that names what it is not", () => {
    const text = getCategory("football").disclaimer;
    expect(text).toContain("Original fictional football archetypes");
    for (const word of ["athlete", "club", "league", "federation"]) {
      expect(text.toLowerCase()).toContain(word);
    }
  });

  it("seats up to six players", () => {
    // Sixty characters, five per player → seats twelve in theory, six in
    // practice (the game-wide maximum). Every table size up to six must be
    // coverable without hitting POOL_TOO_SMALL.
    expect(FOOTBALLERS).toHaveLength(60);
    expect(Math.floor(FOOTBALLERS.length / 5)).toBeGreaterThanOrEqual(6);

    for (const players of [2, 3, 4, 5, 6]) {
      expect(players * 5, `${players} players`).toBeLessThanOrEqual(FOOTBALLERS.length);
    }
  });
});

describe("the roster is what was designed", () => {
  for (const [id, want] of Object.entries(ROSTER)) {
    it(`${want.nick} — ${want.name}`, () => {
      const c = CHARACTERS_BY_ID[id];
      expect(c, `${id} is missing`).toBeTruthy();
      expect(c.name).toBe(want.name);
      expect(nicknameFor(id, c.name)).toBe(want.nick);
      expect(visualArchetypeFor(c)).toBe(want.archetype);

      const identity = identityOf(id);
      expect(identity.build).toBe(want.build);
      expect(identity.prop).toBe(want.prop);
    });
  }

  it("authors every look in the pool, with nothing left to a hash", () => {
    for (const id of Object.keys(ROSTER)) {
      const authored = visualFor(id);
      expect(authored?.va, `${id} has no body plan`).toBeTruthy();
      expect(authored?.nick, `${id} has no nickname`).toBeTruthy();
      const i = authored?.i;
      for (const field of ["head", "back", "marking", "build", "prop", "scale"] as const) {
        expect(i?.[field], `${id} leaves ${field} to the rules`).toBeDefined();
      }
    }
  });

  it("adds nothing to the legacy override tables", () => {
    const identity = readFileSync(resolve(process.cwd(), "src/lib/render/identity.ts"), "utf8");
    const archetypes = readFileSync(resolve(process.cwd(), "src/lib/render/archetypes.ts"), "utf8");
    expect(identity).not.toContain("football-");
    expect(archetypes).not.toContain("football-");
  });

  it("gives every one of them a unique id and a unique nickname", () => {
    const ids = FOOTBALLERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nicks = FOOTBALLERS.map((c) => nicknameFor(c.id, c.name));
    expect(new Set(nicks).size).toBe(nicks.length);
  });
});

describe("sixty footballers who do not look like one footballer", () => {
  it("produces sixty distinct visual signatures", () => {
    const seen = new Map<string, string[]>();
    for (const c of FOOTBALLERS) {
      const sig = visualSignature(visualArchetypeFor(c), identityOf(c.id));
      seen.set(sig, [...(seen.get(sig) ?? []), nicknameFor(c.id, c.name)]);
    }
    const collisions = [...seen.values()].filter((v) => v.length > 1);
    expect(collisions, collisions.map((c) => c.join(" = ")).join("; ")).toHaveLength(0);
    expect(seen.size).toBe(60);
  });

  it("separates them on shape, with the palette taken away", () => {
    // Every one of the sixty is a humanoid. If colour were doing the work of
    // telling them apart, this is where it would show.
    const shapes = new Set(
      FOOTBALLERS.map((c) => {
        const i = identityOf(c.id);
        return [visualArchetypeFor(c), i.head, i.back, i.marking, i.build, i.prop, i.scale].join("|");
      }),
    );
    expect(shapes.size).toBe(60);
  });

  it("separates the pairs the design calls out by name", () => {
    const shapeOf = (id: string) => {
      const i = identityOf(id);
      return [visualArchetypeFor(CHARACTERS_BY_ID[id]), i.head, i.back, i.marking, i.build, i.prop].join("|");
    };
    const pairs: [string, string][] = [
      ["football-the-argentine-maestro", "football-the-spanish-conductor"],
      ["football-the-portuguese-machine", "football-the-northern-viking"],
      ["football-the-brazilian-showman", "football-the-french-phenom"],
      ["football-the-argentine-maestro", "football-the-portuguese-machine"],
      ["football-the-italian-wall", "football-the-south-american-keeper"],
      ["football-the-atlantic-winger", "football-the-overlapping-fullback"],
      ["football-the-continental-architect", "football-the-anchor"],
      ["football-the-target-man", "football-the-sweeper-keeper"],
      ["football-the-brazilian-showman", "football-the-second-striker"],
      ["football-the-six-yard-poacher", "football-the-french-phenom"],
    ];
    for (const [a, b] of pairs) {
      expect(shapeOf(a), `${ROSTER[a].nick} vs ${ROSTER[b].nick}`).not.toBe(shapeOf(b));
    }
  });

  it("gives the outfield players a ball and the two stoppers a shield", () => {
    for (const [id, want] of Object.entries(ROSTER)) {
      expect(identityOf(id).prop).toBe(want.prop);
    }
    const shields = Object.values(ROSTER).filter((r) => r.prop === "SHIELD");
    expect(shields.map((r) => r.nick).sort())
      .toEqual(["THE CAPTAIN", "THE KEEPER", "THE SWEEPER", "THE WALL"]);
  });
});

describe("the archetypes the engine derives match the roles they were written as", () => {
  const combatOf = (id: string) =>
    archetypeOf(allAxes(getCategory("football"), CHARACTERS_BY_ID[id].stats));

  it("reads the playmakers as playmakers", () => {
    for (const id of [
      "football-the-argentine-maestro",
      "football-the-spanish-conductor",
      "football-the-continental-architect",
    ]) {
      const read = combatOf(id);
      expect([read.primary.id, read.secondary?.id], ROSTER[id].nick)
        .toContain("CONTROL");
    }
  });

  it("reads the strikers as strikers", () => {
    expect(combatOf("football-the-portuguese-machine").primary.id).toBe("BRUISER");
    expect(combatOf("football-the-northern-viking").primary.id).toBe("BRUISER");
    expect(combatOf("football-the-french-phenom").primary.id).toBe("SPEEDSTER");
  });

  it("reads the back line as the back line", () => {
    expect(combatOf("football-the-italian-wall").primary.id).toBe("TANK");
    expect(combatOf("football-the-south-american-keeper").primary.id).toBe("TANK");
  });

  it("reads the box-to-box midfielder as a strategist", () => {
    expect(combatOf("football-the-german-engine").primary.id).toBe("STRATEGIST");
  });

  it("derives all of it, with no football branch in the engine", () => {
    const engine = readFileSync(resolve(process.cwd(), "src/lib/game/battle.ts"), "utf8");
    const archetypes = readFileSync(resolve(process.cwd(), "src/lib/game/archetypes.ts"), "utf8");
    for (const source of [engine, archetypes]) {
      expect(source).not.toContain("football");
    }
  });
});

describe("synergy runs through the existing tag system", () => {
  it("scores only tags the category declared", () => {
    const declared = new Set(getCategory("football").synergies.map((g) => g.tag));
    const used = new Set(FOOTBALLERS.flatMap((c) => c.tags));
    const scoring = [...used].filter((t) => declared.has(t));
    expect(scoring.length).toBeGreaterThan(3);
  });

  it("gives every synergy group at least two possible members", () => {
    // A group nobody can complete is decoration.
    for (const group of getCategory("football").synergies) {
      const members = FOOTBALLERS.filter((c) => c.tags.includes(group.tag));
      expect(members.length, `${group.tag}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("changes no synergy mathematics", () => {
    const categories = readFileSync(resolve(process.cwd(), "src/lib/game/categories.ts"), "utf8");
    expect(categories).toContain("export const MAX_SYNERGY = 0.1;");
  });
});

describe("no real person is in here", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/game/pools/football.ts"), "utf8");

  it("names no real athlete anywhere in the pool", () => {
    for (const name of [
      "Messi", "Ronaldo", "Neymar", "Mbappe", "Mbappé", "Haaland",
      "Xavi", "Iniesta", "Neuer", "Maldini", "Buffon", "Pele", "Pelé",
      "Maradona", "Zidane", "Cruyff",
    ]) {
      expect(source, `${name} appears in the pool`).not.toContain(name);
    }
  });

  it("names no club, league or federation", () => {
    for (const brand of [
      "Barcelona", "Real Madrid", "PSG", "Manchester", "Juventus", "Bayern",
      "FIFA", "UEFA", "Premier League", "La Liga", "Serie A", "Nike", "Adidas",
    ]) {
      expect(source, `${brand} appears in the pool`).not.toContain(brand);
    }
  });

  it("looks up no Wikipedia page, so no real portrait can arrive", () => {
    // `w: null` is what keeps the enricher away. Without it the generator
    // would try to resolve "The Argentine Maestro" and might land anywhere.
    for (const entry of FOOTBALL) {
      expect(entry.w, `${entry.n} would be enriched`).toBeNull();
    }
    for (const c of FOOTBALLERS) {
      expect(c.wikiTitle, `${c.name} has a wiki title`).toBeNull();
      expect(c.imageUrl).toBeNull();
    }
  });

  it("uses archetypal names rather than borrowed ones", () => {
    for (const c of FOOTBALLERS) {
      expect(c.name).toMatch(/^The /);
      expect(c.universe).toBe("Original");
    }
  });
});

describe("none of it reaches the game", () => {
  const A = [
    "football-the-argentine-maestro", "football-the-portuguese-machine",
    "football-the-brazilian-showman", "football-the-french-phenom",
    "football-the-northern-viking",
  ];
  const B = [
    "football-the-spanish-conductor", "football-the-german-engine",
    "football-the-italian-wall", "football-the-south-american-keeper",
    "football-the-continental-architect",
  ];

  const battle = (seed: string): BattleResult =>
    simulateBattle({
      teams: [
        { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE",
          characters: A.map((id, i) => ({ characterId: id, price: 4 + i * 3 })) },
        { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE",
          characters: B.map((id, i) => ({ characterId: id, price: 6 + i * 2 })) },
      ],
      map: MAPS[0], event: EVENT_CARDS[0], charactersById: CHARACTERS_BY_ID,
      seed, categoryIds: ["football"], bands: BANDS,
    });

  it("plays a real football battle", () => {
    const result = battle("fb-1");
    expect(result.combatants).toHaveLength(10);
    expect(result.winnerPlayerId).toBeTruthy();
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("produces a byte-identical battle when every look is rewritten", () => {
    const before = battle("fb-2");
    const saved = Object.fromEntries([...A, ...B].map((id) => [id, CHARACTER_VISUALS[id]]));
    try {
      for (const id of [...A, ...B]) {
        CHARACTER_VISUALS[id] = {
          nick: "SOMEBODY ELSE", va: "serpentine",
          i: { head: "TUSKS", back: "SHELL", marking: "BANDS", prop: "HAMMER", build: "SQUAT", scale: 1.8 },
        };
      }
      expect(identityOf(A[0]).prop).toBe("HAMMER");
      expect(battle("fb-2")).toEqual(before);
    } finally {
      for (const [id, v] of Object.entries(saved)) CHARACTER_VISUALS[id] = v!;
    }
  });

  it("keeps the nickname out of the stored record", () => {
    const json = JSON.stringify(battle("fb-3"));
    for (const nick of Object.values(ROSTER).map((r) => r.nick)) {
      expect(json, `${nick} reached battle_result`).not.toContain(nick);
    }
  });
});

describe("the game people are playing did not move", () => {
  it("keeps all eight legacy categories", () => {
    const ids = CATEGORIES.map((c) => c.id);
    for (const legacy of [
      "animals", "marvel", "dc", "hollywood",
      "action-movies", "fantasy", "video-games", "anime",
    ]) {
      expect(ids).toContain(legacy);
    }
    // Grows as new original categories land; the eight above must survive
    // every one of them.
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(9);
  });

  it("keeps every legacy pool at the size it was", () => {
    const counts: Record<string, number> = {};
    for (const c of CHARACTERS) counts[c.categoryId] = (counts[c.categoryId] ?? 0) + 1;
    expect(counts).toMatchObject({
      marvel: 60, dc: 60, hollywood: 42, "action-movies": 30,
      animals: 30, fantasy: 24, "video-games": 22, anime: 22,
      football: 60, basketball: 25,
    });
  });

  it("adds new categories without taking a character from anywhere else", () => {
    const legacy = CHARACTERS.filter((c) => c.categoryId !== "football" && c.categoryId !== "basketball");
    expect(legacy).toHaveLength(290);
  });
});

// ---------------------------------------------------------------------------
// The ball goes on the grass
// ---------------------------------------------------------------------------

describe("a football sits at the boots, on every body it is given", () => {
  it("hangs the ball off a foot anchor rather than a hand", () => {
    // The distinction is the whole fix. Seven props are carried and belong on
    // the hand; a ball is not carried, and hanging it there produced a
    // basketball glued to the chest — visibly worse on a large humanoid,
    // whose hand is held further out for reach.
    expect(IDENTITY_TILE_SLOTS.BALL.slot).toBe("foot");
    for (const carried of ["BLADE", "STAFF", "BOW", "SHIELD", "HAMMER", "SPEAR", "ORB"]) {
      expect(IDENTITY_TILE_SLOTS[carried].slot, carried).toBe("hand");
    }
  });

  it("routes that slot to the foot anchor in the draw layer", () => {
    // Declaring the tile's slot is half the fix; the renderer has to send it
    // somewhere. Deleting the routing line leaves every assertion about tiles
    // and anchors passing while the ball goes back on the chest — which is
    // exactly what happened when this mutation was first tried.
    //
    // Asserted against the source because stamping a tile needs a real canvas,
    // and there isn't one in Node. That gap is why the S2 cache bug survived
    // unit tests until the browser found it.
    const canvas = readFileSync(resolve(process.cwd(), "src/lib/render/canvas.ts"), "utf8");
    expect(canvas).toContain('meta.slot === "foot" ? anchors.foot');
    expect(canvas).toContain('meta.slot === "hand" ? anchors.hand');
    // And a ground prop is drawn smaller than a held one, or a football is as
    // wide as the player.
    const scales = canvas.slice(canvas.indexOf("const TILE_SCALE"), canvas.indexOf("/** How many frames"));
    expect(scales).toContain("foot:");
  });

  it("reports a foot anchor on every frame of every body plan", () => {
    for (const [plan, rows] of Object.entries(SPRITE_ANCHORS)) {
      for (const row of rows) {
        for (const frame of row) {
          if (!frame) continue;
          expect(frame.foot, `${plan} has no foot`).toHaveLength(3);
        }
      }
    }
  });

  it("puts that anchor on the ground, not up the body", () => {
    // The ground line is 27 of 32. A foot anchor above the knee would mean the
    // ball floated, which is the failure this anchor exists to prevent.
    for (const plan of ["humanoid_medium", "humanoid_large"]) {
      for (const row of SPRITE_ANCHORS[plan]) {
        for (const frame of row) {
          if (!frame) continue;
          const [x, y] = frame.foot;
          expect(y, `${plan} foot too high`).toBeGreaterThanOrEqual(18);
          expect(y, `${plan} foot below the frame`).toBeLessThanOrEqual(32);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it("keeps the ball near the body's centre on both humanoid plans", () => {
    // The bug was lateral, not vertical: on `humanoid_large` the ball drifted
    // clear of the player. The body is centred on x=16, so the anchor has to
    // stay close to it however wide the stance.
    for (const plan of ["humanoid_medium", "humanoid_large"]) {
      for (const row of SPRITE_ANCHORS[plan]) {
        for (const frame of row) {
          if (!frame) continue;
          const drift = Math.abs(frame.foot[0] - 16);
          expect(drift, `${plan} ball drifts ${drift}px from centre`).toBeLessThanOrEqual(9);
        }
      }
    }
  });

  it("moves the anchor with the pose, so the ball travels on a lunge", () => {
    for (const plan of ["humanoid_medium", "humanoid_large"]) {
      const xs = SPRITE_ANCHORS[plan].flat().filter(Boolean).map((f) => f!.foot[0]);
      expect(new Set(xs).size, `${plan} foot never moves`).toBeGreaterThan(1);
    }
  });

  it("covers every build the roster actually asks for", () => {
    // The combinations the design named, each one held by a real character.
    const combos = FOOTBALLERS.map((c) => {
      const i = identityOf(c.id);
      return `${visualArchetypeFor(c)}+${i.build}+${i.prop}`;
    });
    for (const combo of [
      "humanoid_medium+NORMAL+BALL",
      "humanoid_medium+SLIGHT+BALL",
      "humanoid_medium+SQUAT+BALL",
      "humanoid_medium+HEAVY+BALL",
      "humanoid_large+HEAVY+BALL",
      "humanoid_large+TOWERING+BALL",
      "humanoid_large+HEAVY+SHIELD",
      "humanoid_large+TOWERING+SHIELD",
    ]) {
      expect(combos, `nobody exercises ${combo}`).toContain(combo);
    }
  });
});

describe("two looks never share one cached picture", () => {
  it("keys the composed frame on the whole identity", () => {
    const canvas = readFileSync(resolve(process.cwd(), "src/lib/render/canvas.ts"), "utf8");
    const keyFn = canvas.slice(
      canvas.indexOf("function identityKeyOf"),
      canvas.indexOf("const TILE_SCALE"),
    );
    for (const field of ["head", "back", "marking", "prop", "build", "accent"]) {
      expect(keyFn, `the cache key ignores ${field}`).toContain(`i.${field}`);
    }
  });

  it("gives one character two different keys for two different looks", () => {
    // Same characterId, same frame, same size — the cache must still not
    // confuse them.
    const c = CHARACTERS_BY_ID["football-the-portuguese-machine"];
    const plan = visualArchetypeFor(c);
    const base = identityOf(c.id);
    const looks = [
      base,
      { ...base, prop: "SHIELD" as const },
      { ...base, build: "SQUAT" as const },
      { ...base, marking: "BANDS" as const },
    ];
    const keys = looks.map((i) => visualSignature(plan, i));
    expect(new Set(keys).size).toBe(looks.length);
  });

  it("gives the same look the same key, every time", () => {
    const c = CHARACTERS_BY_ID["football-the-argentine-maestro"];
    const plan = visualArchetypeFor(c);
    const a = visualSignature(plan, identityOf(c.id));
    const b = visualSignature(plan, identityOf(c.id));
    expect(a).toBe(b);
  });
});
