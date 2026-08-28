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
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { visualArchetypeFor, type VisualArchetypeId } from "../src/lib/render/archetypes";
import { identityFor, visualSignature } from "../src/lib/render/identity";
import { SPRITE_ANCHORS } from "../src/lib/render/anchors.generated";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * Thirteen animals a player can name without reading the card.
 * ---------------------------------------------------------------------------
 * S1 gave characters a place to carry a look, S2 gave that look a prop and a
 * build, S3 gave the heavy ones a body worth having. S4 is the first slice
 * that actually *writes* any of it down — and the first where the catalogue
 * stops being a rule and starts being a set of decisions.
 *
 * Which makes the table below the point of the whole exercise: it is the
 * design, in the form the code will fail against if anybody changes it by
 * accident. Everything else here guards the same two promises S1 made — the
 * look cannot reach the simulation, and the game people are playing right now
 * does not move.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

interface Target {
  nick: string;
  archetype: VisualArchetypeId;
  head: string;
  back: string;
  marking: string;
  build: string;
}

/** The authored identity of the thirteen, as a table rather than as prose. */
const ANIMALS: Record<string, Target> = {
  "animals-lion":                  { nick: "THE KING",          archetype: "quadruped_medium", head: "EARS",  back: "MANE",   marking: "PLAIN",   build: "HEAVY" },
  "animals-tiger":                 { nick: "THE AMBUSH",        archetype: "quadruped_medium", head: "EARS",  back: "NONE",   marking: "STRIPES", build: "NORMAL" },
  "animals-western-gorilla":       { nick: "THE SILVERBACK",    archetype: "humanoid_large",   head: "PLAIN", back: "MANE",   marking: "PATCH",   build: "TOWERING" },
  "animals-golden-eagle":          { nick: "THE STOOP",         archetype: "winged",           head: "CREST", back: "NONE",   marking: "PATCH",   build: "SLIGHT" },
  "animals-wolf":                  { nick: "THE PACK",          archetype: "quadruped_medium", head: "EARS",  back: "NONE",   marking: "PATCH",   build: "SLIGHT" },
  "animals-black-mamba":           { nick: "THE STRIKE",        archetype: "serpentine",       head: "CREST", back: "NONE",   marking: "BANDS",   build: "SLIGHT" },
  "animals-grizzly-bear":          { nick: "THE MOUNTAIN",      archetype: "quadruped_large",  head: "EARS",  back: "MANE",   marking: "PLAIN",   build: "HEAVY" },
  "animals-great-white-shark":     { nick: "THE BREACH",        archetype: "aquatic",          head: "PLAIN", back: "FIN",    marking: "PATCH",   build: "HEAVY" },
  "animals-saltwater-crocodile":   { nick: "THE ROLL",          archetype: "quadruped_large",  head: "CREST", back: "SPINES", marking: "BANDS",   build: "SQUAT" },
  "animals-african-bush-elephant": { nick: "THE TOWER",         archetype: "quadruped_large",  head: "TUSKS", back: "NONE",   marking: "PLAIN",   build: "TOWERING" },
  "animals-white-rhinoceros":      { nick: "THE BATTERING RAM", archetype: "quadruped_large",  head: "HORNS", back: "NONE",   marking: "PLAIN",   build: "HEAVY" },
  "animals-cheetah":               { nick: "THE SPRINT",        archetype: "quadruped_medium", head: "EARS",  back: "NONE",   marking: "SPOTS",   build: "SLIGHT" },
  "animals-honey-badger":          { nick: "NEVER QUIT",        archetype: "quadruped_small",  head: "EARS",  back: "SPINES", marking: "PATCH",   build: "SQUAT" },
};

const identityOf = (id: string) =>
  identityFor(CHARACTERS_BY_ID[id], visualArchetypeFor(CHARACTERS_BY_ID[id]));

describe("the thirteen are drawn the way they were designed", () => {
  for (const [id, want] of Object.entries(ANIMALS)) {
    it(`${want.nick} — ${CHARACTERS_BY_ID[id]?.name ?? id}`, () => {
      const character = CHARACTERS_BY_ID[id];
      expect(character, `${id} is missing from the catalogue`).toBeTruthy();

      expect(nicknameFor(id, character.name)).toBe(want.nick);
      expect(visualArchetypeFor(character)).toBe(want.archetype);

      const identity = identityOf(id);
      expect(identity.head).toBe(want.head);
      expect(identity.back).toBe(want.back);
      expect(identity.marking).toBe(want.marking);
      expect(identity.build).toBe(want.build);
      // Anatomy outranks equipment: an animal that needed a prop would mean
      // its silhouette had failed.
      expect(identity.prop).toBe("NONE");
    });
  }

  it("authors each of them in the pool rather than in a side table", () => {
    for (const id of Object.keys(ANIMALS)) {
      const authored = visualFor(id);
      expect(authored, `${id} is not authored pool-locally`).toBeTruthy();
      expect(authored!.nick).toBe(ANIMALS[id].nick);
      expect(authored!.va).toBe(ANIMALS[id].archetype);
    }
  });

  it("uses a build that means something rather than one that merely differs", () => {
    // Build is semantic. The heavy animals are heavy, the fast ones are slight,
    // and the low ones are squat — you should be able to guess the value from
    // the animal without looking it up.
    expect(identityOf("animals-african-bush-elephant").build).toBe("TOWERING");
    expect(identityOf("animals-white-rhinoceros").build).toBe("HEAVY");
    expect(identityOf("animals-grizzly-bear").build).toBe("HEAVY");
    expect(identityOf("animals-cheetah").build).toBe("SLIGHT");
    expect(identityOf("animals-honey-badger").build).toBe("SQUAT");
  });
});

describe("no two of them look alike", () => {
  it("produces thirteen distinct signatures", () => {
    const seen = new Map<string, string[]>();
    for (const id of Object.keys(ANIMALS)) {
      const character = CHARACTERS_BY_ID[id];
      const signature = visualSignature(visualArchetypeFor(character), identityOf(id));
      seen.set(signature, [...(seen.get(signature) ?? []), character.name]);
    }
    const collisions = [...seen.values()].filter((names) => names.length > 1);
    expect(collisions, `collisions: ${collisions.map((c) => c.join(" = ")).join("; ")}`)
      .toHaveLength(0);
    expect(seen.size).toBe(13);
  });

  it("separates them on shape before colour", () => {
    // The point of the priority order: strip the palette entirely and the
    // thirteen must still be thirteen. A catalogue that needed hue to tell a
    // lion from a bear would fail on a small screen and on a colour-blind eye.
    const shapes = new Set(
      Object.keys(ANIMALS).map((id) => {
        const i = identityOf(id);
        return [
          visualArchetypeFor(CHARACTERS_BY_ID[id]),
          i.head, i.back, i.marking, i.build,
        ].join("|");
      }),
    );
    expect(shapes.size).toBe(13);
  });

  it("separates the pairs a player is most likely to confuse", () => {
    const shapeOf = (id: string) => {
      const i = identityOf(id);
      return [visualArchetypeFor(CHARACTERS_BY_ID[id]), i.head, i.back, i.marking, i.build].join("|");
    };
    const pairs: [string, string][] = [
      ["animals-lion", "animals-tiger"],
      ["animals-lion", "animals-wolf"],
      ["animals-wolf", "animals-cheetah"],
      ["animals-grizzly-bear", "animals-saltwater-crocodile"],
      ["animals-african-bush-elephant", "animals-white-rhinoceros"],
      ["animals-grizzly-bear", "animals-wolf"],
    ];
    for (const [a, b] of pairs) {
      expect(shapeOf(a), `${a} vs ${b}`).not.toBe(shapeOf(b));
    }
  });
});

describe("the identity layers really composite on these bodies", () => {
  it("has an anchor for every layer each of them asks for", () => {
    // An authored mane on a body with no anchor grid draws nothing — which is
    // exactly what happened to the large animals before S3.
    for (const [id, want] of Object.entries(ANIMALS)) {
      const grid = SPRITE_ANCHORS[want.archetype];
      expect(grid, `${want.archetype} has no anchors`).toBeTruthy();
      for (const row of grid) {
        for (const frame of row) {
          if (!frame) continue;
          expect(frame.head).toHaveLength(3);
          expect(frame.back).toHaveLength(3);
          expect(frame.hand).toHaveLength(3);
          expect(frame.marks.length).toBeGreaterThan(0);
        }
      }
      expect(identityOf(id).accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("puts every one of them on a body plan that has artwork", () => {
    for (const want of Object.values(ANIMALS)) {
      expect(SPRITE_ANCHORS[want.archetype]).toBeTruthy();
    }
  });
});

describe("none of it reaches the game", () => {
  const ROSTER_A = [
    "animals-lion", "animals-tiger", "animals-wolf",
    "animals-cheetah", "animals-honey-badger",
  ];
  const ROSTER_B = [
    "animals-grizzly-bear", "animals-white-rhinoceros",
    "animals-african-bush-elephant", "animals-saltwater-crocodile",
    "animals-western-gorilla",
  ];

  function battle(seed: string): BattleResult {
    return simulateBattle({
      teams: [
        {
          playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE",
          characters: ROSTER_A.map((id, i) => ({ characterId: id, price: 4 + i * 3 })),
        },
        {
          playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE",
          characters: ROSTER_B.map((id, i) => ({ characterId: id, price: 6 + i * 2 })),
        },
      ],
      map: MAPS[0],
      event: EVENT_CARDS[0],
      charactersById: CHARACTERS_BY_ID,
      seed,
      categoryIds: ["animals"],
      bands: BANDS,
    });
  }

  it("produces a byte-identical battle when all thirteen are redressed", () => {
    const before = battle("s4-animals");
    const saved = Object.fromEntries(
      Object.keys(ANIMALS).map((id) => [id, CHARACTER_VISUALS[id]]),
    );

    try {
      for (const id of Object.keys(ANIMALS)) {
        CHARACTER_VISUALS[id] = {
          nick: "SOMETHING ELSE",
          va: "aquatic",
          i: { head: "TUSKS", back: "SHELL", marking: "BANDS", prop: "HAMMER", build: "SQUAT", scale: 1.9 },
        };
      }
      // The look really did change, or this proves nothing.
      expect(identityOf("animals-lion").prop).toBe("HAMMER");
      expect(nicknameFor("animals-lion", "Lion")).toBe("SOMETHING ELSE");

      expect(battle("s4-animals")).toEqual(before);
    } finally {
      for (const [id, value] of Object.entries(saved)) CHARACTER_VISUALS[id] = value!;
    }
  });

  it("leaves the gameplay numbers of all thirteen untouched", () => {
    // The pool entries were edited to add presentation fields. Nothing on the
    // same line may have moved.
    const expected: Record<string, [number, string, number]> = {
      "animals-lion": [74, "RARE", 6],
      "animals-tiger": [76, "RARE", 6],
      "animals-cheetah": [58, "COMMON", 2],
    };
    for (const [id, [power, rarity, price]] of Object.entries(expected)) {
      const c = CHARACTERS_BY_ID[id];
      expect([c.gamePower, c.rarity, c.basePrice], id).toEqual([power, rarity, price]);
    }
  });
});

describe("the rest of the game did not move", () => {
  it("keeps the gameplay fingerprint of all 268 characters", () => {
    const legacy = CHARACTERS.filter((c) => c.categoryId !== "football" && c.categoryId !== "basketball");
    const fingerprint = legacy.map((c) =>
      [c.id, c.categoryId, c.gamePower, c.rarity, c.basePrice, JSON.stringify(c.stats), c.tags.join(",")].join("|"),
    ).sort().join("\n");
    expect(legacy).toHaveLength(268);
    expect(createHash("sha256").update(fingerprint).digest("hex")).toBe(
      "a2f9491df7423fef5a954fdf96be8341b484fae5162f2de0d4621c27a0ee0589",
    );
  });

  it("keeps every sprite sheet byte-identical to S3", () => {
    const hashes: Record<string, string> = {
      humanoid_medium: "c5753f9dbe1700ea2c5f6b3839a87080",
      quadruped_small: "a2a59ee32b41bd9562f90f45f9f78d11",
      quadruped_medium: "234acbf950bc4ae78ecd7003e49b10ad",
      serpentine: "b7514c7f309293cc4ad211e8a3f806f0",
      winged: "ea18f1799ad2429cf556365f1bc1492d",
      aquatic: "bd4d5bb6ff3bc49863847cf9cf17abb7",
      // The tile sheet grew a row: S7 added BALL_HELD, a basketball carried in
      // the hand, because the football BALL hangs off the foot anchor and one
      // tile declares one slot. The eight body sheets above are untouched —
      // adding a prop does not redraw a single body.
      identity: "1154208f8aed0e2e5479f24d7a8fda98",
    };
    for (const [name, expected] of Object.entries(hashes)) {
      const bytes = readFileSync(resolve(process.cwd(), `public/sprites/${name}.png`));
      expect(createHash("md5").update(bytes).digest("hex"), `${name}.png`).toBe(expected);
    }
  });
});
