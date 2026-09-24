import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import {
  CHARACTERS,
  CHARACTER_VISUALS,
  buildCharacter,
  nicknameFor,
  visualFor,
} from "../src/lib/game/characters";
import { CATEGORIES } from "../src/lib/game/categories";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { allAxes, getCategory } from "../src/lib/game/categories";
import { archetypeOf } from "../src/lib/game/archetypes";
import { BUILD_SCALE, identityFor, visualSignature } from "../src/lib/render/identity";
import { visualArchetypeFor } from "../src/lib/render/archetypes";
import {
  IDENTITY_TILE_ROWS,
  IDENTITY_TILE_SLOTS,
  SPRITE_ANCHORS,
} from "../src/lib/render/anchors.generated";
import type { BattleResult, PoolEntry } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * A look cannot move a number.
 * ---------------------------------------------------------------------------
 * S1 adds character-local presentation metadata: a nickname, a hand-authored
 * silhouette, a body-plan override. All three are the sort of thing that looks
 * harmless and is not — a catalogue where artwork can reach the simulation is
 * a catalogue where a redraw silently rebalances the game.
 *
 * The separation is structural rather than promised. Presentation lives in
 * `CHARACTER_VISUALS`, a client-side table; the auction reads its characters
 * from Postgres, which has no such columns; `simulateBattle` is handed axes and
 * tags and never sees this file. These tests hold that line, and they hold the
 * other half of the bargain too: **the legacy catalogue must not move.** The
 * game is being played by real people right now, and an additive milestone
 * that quietly drops a character is not additive.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

// ---------------------------------------------------------------------------
// The legacy catalogue is frozen
// ---------------------------------------------------------------------------

describe("the catalogue people are playing right now", () => {
  /**
   * Every gameplay-relevant field of every character, hashed.
   *
   * A single number that fails the moment any character's stats, tags, power,
   * rarity, price or id changes — including a character disappearing. Written
   * down deliberately: this milestone adds a universe beside the existing one
   * and must not touch it, and "must not touch it" is worth a tripwire rather
   * than a promise.
   *
   * If a later slice legitimately changes the catalogue, this value changes in
   * the same commit and a reviewer sees it.
   */
  const GAMEPLAY_FINGERPRINT =
    "6658f0e245ef838e5cb93486e1c0759a493e2f08ce63ce7d359b19959f9236f9";

  it("still has every character it had, with every number unchanged", () => {
    const legacy = CHARACTERS.filter((c) => c.categoryId !== "football" && c.categoryId !== "basketball");
    const fingerprint = legacy.map((c) =>
      [
        c.id,
        c.categoryId,
        c.gamePower,
        c.rarity,
        c.basePrice,
        JSON.stringify(c.stats),
        c.tags.join(","),
      ].join("|"),
    )
      .sort()
      .join("\n");

    expect(legacy).toHaveLength(290);
    expect(createHash("sha256").update(fingerprint).digest("hex")).toBe(
      GAMEPLAY_FINGERPRINT,
    );
  });

  it("keeps all eight legacy categories selectable", () => {
    const ids = CATEGORIES.map((c) => c.id);
    for (const legacy of [
      "animals", "apex", "vigil", "hollywood",
      "action-movies", "fantasy", "video-games", "anime",
    ]) {
      expect(ids).toContain(legacy);
    }
  });

  it("keeps every legacy pool at the size it was", () => {
    const counts: Record<string, number> = {};
    for (const c of CHARACTERS) counts[c.categoryId] = (counts[c.categoryId] ?? 0) + 1;
    expect(counts).toMatchObject({
      apex: 60, vigil: 60, hollywood: 42, "action-movies": 30,
      animals: 30, fantasy: 24, "video-games": 22, anime: 22,
    });
  });

  it("keeps character ids stable", () => {
    // Ids are the join key for rosters, replays and stored results. A renamed
    // id orphans every finished match that referenced it.
    for (const id of [
      "animals-lion", "animals-tiger", "apex-the-iron-tycoon",
      "vigil-the-midnight-sentinel", "fantasy-the-wandering-sage", "anime-the-boundless-paragon",
    ]) {
      expect(CHARACTERS_BY_ID[id], `${id} is missing`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Presentation metadata is inert
// ---------------------------------------------------------------------------

/** The same character, authored twice: once bare, once fully dressed. */
const BARE: PoolEntry = {
  n: "Test Subject",
  u: "Wild",
  t: "A control case",
  g: ["predator", "big-cat"],
  s: [60, 70, 80, 75, 65, 70],
  ab: ["Test Strike"],
};

const DRESSED: PoolEntry = {
  ...BARE,
  nick: "THE CONTROL",
  i: { head: "TUSKS", back: "SHELL", marking: "BANDS", scale: 1.4 },
  va: "aquatic",
};

describe("presentation metadata never reaches the character", () => {
  const bare = buildCharacter("animals", BARE);
  const dressed = buildCharacter("animals", DRESSED);

  it("produces an identical character either way", () => {
    // Not "the stats match" — the whole object. If a presentation field ever
    // leaks into the built character, this fails without needing to know
    // which field it was.
    expect(dressed).toEqual(bare);
  });

  it("does not put a nickname, look or body plan on the character", () => {
    const keys = Object.keys(dressed);
    for (const presentation of ["nick", "nickname", "i", "va", "identity", "visual"]) {
      expect(keys).not.toContain(presentation);
    }
  });
});

describe("the visual table carries only what was authored", () => {
  it("holds the authored characters and nobody else", () => {
    // S4 authored thirteen animals. Everything else still resolves through the
    // rules, and a table that quietly grew past what was written would mean a
    // look had been derived where it should have been chosen.
    // Thirteen animals (S4), sixty footballers (S6+), twenty-five
    // basketballers (S7). Everything else still resolves through the rules.
    expect(Object.keys(CHARACTER_VISUALS)).toHaveLength(358);
    for (const id of Object.keys(CHARACTER_VISUALS)) {
      expect(CHARACTERS_BY_ID[id], `${id} names no character`).toBeTruthy();
    }
    expect(visualFor("animals-polar-bear")).toBeUndefined();
    expect(visualFor("animals-giraffe")).toBeUndefined();
  });

  it("falls back to the catalogue name when there is no nickname", () => {
    expect(nicknameFor("animals-polar-bear", "Polar Bear")).toBe("Polar Bear");
    expect(nicknameFor("animals-lion", "Lion")).toBe("THE KING");
  });
});

// ---------------------------------------------------------------------------
// The regression that matters
// ---------------------------------------------------------------------------

/** One real 5v5, shared by every regression below. */
const ROSTER_A = [
  "animals-lion", "animals-tiger", "animals-wolf",
  "animals-leopard", "animals-spotted-hyena",
];
const ROSTER_B = [
  "animals-jaguar", "animals-cheetah", "animals-grizzly-bear",
  "animals-polar-bear", "animals-wild-boar",
];

function battleFor(seed: string): BattleResult {
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

describe("adding a visual identity override does not change the battle", () => {
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

  it("produces a byte-identical result with the whole roster redressed", () => {
    // The strongest statement available: run a real 5v5, then rewrite every
    // combatant's silhouette, body plan and nickname *while the process is
    // running*, and require the simulation to be unmoved. This mutates the
    // live table rather than a copy, so it fails if any read path exists at
    // all — not merely if the one we thought of exists.
    const before = battle("vis-1");

    const dressed = [...ROSTER_A, ...ROSTER_B].map((id, n) => {
      CHARACTER_VISUALS[id] = {
        nick: `THE ${n}`,
        i: { head: "TUSKS", back: "SHELL", marking: "BANDS", scale: 1.6 },
        va: n % 2 === 0 ? "aquatic" : "serpentine",
      };
      return id;
    });

    try {
      // The look really did change — otherwise this test proves nothing.
      const lion = CHARACTERS_BY_ID["animals-lion"];
      expect(visualArchetypeFor(lion)).toBe("aquatic");
      expect(identityFor(lion, visualArchetypeFor(lion)).head).toBe("TUSKS");
      expect(nicknameFor("animals-lion", "Lion")).toBe("THE 0");

      const after = battle("vis-1");
      expect(after).toEqual(before);
    } finally {
      for (const id of dressed) delete CHARACTER_VISUALS[id];
    }
  });

  it("leaves the derived combat reading alone", () => {
    // Gameplay archetype comes from the axes. Redressing a character must not
    // touch it, or the auction card would start describing the artwork.
    const lion = CHARACTERS_BY_ID["animals-lion"];
    const before = { ...lion.stats, power: lion.gamePower };

    CHARACTER_VISUALS["animals-lion"] = { va: "winged", i: { scale: 2 } };
    try {
      const after = CHARACTERS_BY_ID["animals-lion"];
      expect({ ...after.stats, power: after.gamePower }).toEqual(before);
    } finally {
      delete CHARACTER_VISUALS["animals-lion"];
    }
  });
});

describe("authored metadata is what the renderer actually uses", () => {
  const lion = CHARACTERS_BY_ID["animals-lion"];

  it("lets a pool entry override the body plan the rules would pick", () => {
    expect(visualArchetypeFor(lion)).toBe("quadruped_medium");
    CHARACTER_VISUALS[lion.id] = { va: "winged" };
    try {
      expect(visualArchetypeFor(lion)).toBe("winged");
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });

  it("lets a pool entry override the legacy override table", () => {
    // Both exist during the transition. The pool is the newer authoring home
    // and has to win, or migrating a character would silently do nothing.
    const gorilla = CHARACTERS_BY_ID["animals-western-gorilla"];
    expect(visualArchetypeFor(gorilla)).toBe("humanoid_large");

    CHARACTER_VISUALS[gorilla.id] = { va: "serpentine" };
    try {
      expect(visualArchetypeFor(gorilla)).toBe("serpentine");
    } finally {
      delete CHARACTER_VISUALS[gorilla.id];
    }
  });

  it("merges an authored look over the derived one, field by field", () => {
    const derived = identityFor(lion, "quadruped_medium");
    CHARACTER_VISUALS[lion.id] = { i: { marking: "BANDS" } };
    try {
      const authored = identityFor(lion, "quadruped_medium");
      expect(authored.marking).toBe("BANDS");
      // Everything not authored still comes from the rules.
      expect(authored.head).toBe(derived.head);
      expect(authored.back).toBe(derived.back);
      expect(authored.scale).toBe(derived.scale);
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });

  it("stays deterministic: the same authored look resolves the same way", () => {
    CHARACTER_VISUALS[lion.id] = { i: { head: "HELM" }, va: "humanoid_large" };
    try {
      const a = identityFor(lion, visualArchetypeFor(lion));
      const b = identityFor(lion, visualArchetypeFor(lion));
      expect(a).toEqual(b);
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });
});

// ---------------------------------------------------------------------------
// S2 — prop and build
// ---------------------------------------------------------------------------

describe("props and builds are inert by default", () => {
  it("leaves every unauthored character at NONE and NORMAL", () => {
    // Authored, never derived. A rule that handed props out by tag would put a
    // sword in the paw of every predator in the Animals pool — so a character
    // nobody has written a look for must still come back plain.
    for (const c of CHARACTERS) {
      if (visualFor(c.id)) continue;
      const identity = identityFor(c, visualArchetypeFor(c));
      expect(identity.prop, `${c.id} grew a prop`).toBe("NONE");
      expect(identity.build, `${c.id} changed shape`).toBe("NORMAL");
    }
  });

  it("gives no animal a prop, because anatomy outranks equipment", () => {
    // Props exist to separate humanoids. An animal that needed one would mean
    // its silhouette had failed.
    for (const c of CHARACTERS.filter((x) => x.categoryId === "animals")) {
      expect(identityFor(c, visualArchetypeFor(c)).prop, `${c.id}`).toBe("NONE");
    }
  });

  it("makes NORMAL exactly the geometry the renderer used before builds", () => {
    // The blit multiplies by these two numbers. At [1, 1] the arithmetic
    // cannot move a legacy sprite by even a subpixel.
    expect(BUILD_SCALE.NORMAL).toEqual([1, 1]);
  });

  it("keeps every build within a range a pixel body survives", () => {
    // Past roughly a quarter either way a stretched pixel creature stops
    // reading as itself and starts reading as a drawing mistake.
    for (const [name, [w, h]] of Object.entries(BUILD_SCALE)) {
      expect(w, `${name} width`).toBeGreaterThanOrEqual(0.8);
      expect(w, `${name} width`).toBeLessThanOrEqual(1.25);
      expect(h, `${name} height`).toBeGreaterThanOrEqual(0.8);
      expect(h, `${name} height`).toBeLessThanOrEqual(1.25);
    }
  });
});

describe("partial identity still inherits everything else", () => {
  const lion = CHARACTERS_BY_ID["animals-lion"];

  it("takes a prop without disturbing head, back, marking or scale", () => {
    const derived = identityFor(lion, "quadruped_medium");
    CHARACTER_VISUALS[lion.id] = { i: { prop: "BALL" } };
    try {
      const authored = identityFor(lion, "quadruped_medium");
      expect(authored.prop).toBe("BALL");
      expect(authored.build).toBe("NORMAL");
      expect(authored.head).toBe(derived.head);
      expect(authored.back).toBe(derived.back);
      expect(authored.marking).toBe(derived.marking);
      expect(authored.scale).toBe(derived.scale);
      expect(authored.accent).toBe(derived.accent);
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });

  it("takes a build without disturbing anything else", () => {
    const derived = identityFor(lion, "quadruped_medium");
    CHARACTER_VISUALS[lion.id] = { i: { build: "TOWERING" } };
    try {
      const authored = identityFor(lion, "quadruped_medium");
      expect(authored.build).toBe("TOWERING");
      expect(authored.prop).toBe("NONE");
      expect({ ...authored, build: "NORMAL" }).toEqual(derived);
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });
});

describe("prop and build cannot reach gameplay", () => {
  const lion = CHARACTERS_BY_ID["animals-lion"];

  it("leaves power, rarity, price, stats and tags alone", () => {
    const before = {
      gamePower: lion.gamePower, rarity: lion.rarity, basePrice: lion.basePrice,
      stats: { ...lion.stats }, tags: [...lion.tags],
    };
    CHARACTER_VISUALS[lion.id] = { i: { prop: "HAMMER", build: "TOWERING" } };
    try {
      const after = CHARACTERS_BY_ID["animals-lion"];
      expect({
        gamePower: after.gamePower, rarity: after.rarity, basePrice: after.basePrice,
        stats: { ...after.stats }, tags: [...after.tags],
      }).toEqual(before);
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });

  it("leaves the derived combat reading and the body plan alone", () => {
    // Combat style is keyed off the body plan, so an unchanged archetype is
    // an unchanged attack language.
    const archetypeBefore = visualArchetypeFor(lion);
    const combatBefore = archetypeOf(allAxes(getCategory(lion.categoryId), lion.stats));

    CHARACTER_VISUALS[lion.id] = { i: { prop: "BLADE", build: "SQUAT" } };
    try {
      expect(visualArchetypeFor(lion)).toBe(archetypeBefore);
      const combatAfter = archetypeOf(allAxes(getCategory(lion.categoryId), lion.stats));
      expect(combatAfter.primary.id).toBe(combatBefore.primary.id);
    } finally {
      delete CHARACTER_VISUALS[lion.id];
    }
  });

  it("produces a byte-identical battle with every fighter re-equipped", () => {
    // The S2 form of the S1 regression: arm and reshape all ten combatants
    // mid-process, then require the authoritative result to be unmoved.
    const before = battleFor("s2-props");

    const props = ["BLADE", "STAFF", "BOW", "SHIELD", "BALL", "HAMMER", "SPEAR", "ORB"] as const;
    const builds = ["SLIGHT", "HEAVY", "TOWERING", "SQUAT"] as const;
    const touched = [...ROSTER_A, ...ROSTER_B];

    touched.forEach((id, n) => {
      CHARACTER_VISUALS[id] = {
        i: { prop: props[n % props.length], build: builds[n % builds.length] },
      };
    });

    try {
      // The equipment really did change, or this proves nothing.
      const armed = identityFor(lion, visualArchetypeFor(lion));
      expect(armed.prop).not.toBe("NONE");
      expect(armed.build).not.toBe("NORMAL");

      expect(battleFor("s2-props")).toEqual(before);
    } finally {
      for (const id of touched) delete CHARACTER_VISUALS[id];
    }
  });
});

describe("the visual signature separates what the eye separates", () => {
  const lion = CHARACTERS_BY_ID["animals-lion"];
  const base = identityFor(lion, "quadruped_medium");

  it("changes when the prop changes, with everything else held equal", () => {
    const unarmed = visualSignature("quadruped_medium", base);
    for (const prop of ["BLADE", "BALL", "SPEAR", "ORB"] as const) {
      expect(visualSignature("quadruped_medium", { ...base, prop })).not.toBe(unarmed);
    }
    // And every prop is distinct from every other, not merely from NONE.
    const all = (["NONE", "BLADE", "STAFF", "BOW", "SHIELD", "BALL", "HAMMER", "SPEAR", "ORB"] as const)
      .map((prop) => visualSignature("quadruped_medium", { ...base, prop }));
    expect(new Set(all).size).toBe(all.length);
  });

  it("changes when the build changes, with everything else held equal", () => {
    const all = (["NORMAL", "SLIGHT", "HEAVY", "TOWERING", "SQUAT"] as const)
      .map((build) => visualSignature("quadruped_medium", { ...base, build }));
    expect(new Set(all).size).toBe(all.length);
  });

  it("ignores accent, which does not separate anything at arena scale", () => {
    // Two creatures differing only in the shade of their markings are not
    // distinguishable in a battle. A signature that claimed otherwise would
    // let a catalogue of near-identical animals pass S4.
    expect(visualSignature("quadruped_medium", { ...base, accent: "#ff0000" }))
      .toBe(visualSignature("quadruped_medium", base));
  });

  it("separates the same identity on two different body plans", () => {
    expect(visualSignature("winged", base)).not.toBe(visualSignature("aquatic", base));
  });
});

describe("the prop layer is one reusable sheet, not a renderer per character", () => {
  it("registers all eight props as tiles on the shared sheet", () => {
    for (const prop of ["BLADE", "STAFF", "BOW", "SHIELD", "BALL", "HAMMER", "SPEAR", "ORB"]) {
      expect(IDENTITY_TILE_ROWS, `${prop} has no tile`).toContain(prop);
    }
    // Seven are carried and hang off the hand. A football rests on the grass,
    // so it hangs off the foot instead — the same tile system, a different
    // anchor, rather than a special case in the draw layer.
    for (const carried of ["BLADE", "STAFF", "BOW", "SHIELD", "HAMMER", "SPEAR", "ORB"]) {
      expect(IDENTITY_TILE_SLOTS[carried].slot, carried).toBe("hand");
    }
    expect(IDENTITY_TILE_SLOTS.BALL.slot).toBe("foot");
  });

  it("reports a hand anchor on every frame of every body plan", () => {
    // A prop with no anchor would fall to the frame origin — detached, which
    // is the one failure mode a held object cannot survive.
    for (const [archetype, rows] of Object.entries(SPRITE_ANCHORS)) {
      for (const row of rows) {
        for (const frame of row) {
          if (!frame) continue;
          expect(frame.hand, `${archetype} frame has no hand`).toBeTruthy();
          expect(frame.hand).toHaveLength(3);
        }
      }
    }
  });

  it("keeps the hand inside the frame, so a prop never hangs off the sprite", () => {
    for (const [archetype, rows] of Object.entries(SPRITE_ANCHORS)) {
      for (const row of rows) {
        for (const frame of row) {
          if (!frame) continue;
          const [x, y] = frame.hand;
          expect(x, `${archetype} hand x`).toBeGreaterThanOrEqual(0);
          expect(x, `${archetype} hand x`).toBeLessThanOrEqual(32);
          expect(y, `${archetype} hand y`).toBeGreaterThanOrEqual(0);
          expect(y, `${archetype} hand y`).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it("moves the hand with the pose rather than pinning it to one spot", () => {
    // Attack row versus idle row: if the hand never moved, a sword would swim
    // against the animation on exactly the frames anyone is watching.
    const humanoid = SPRITE_ANCHORS["humanoid_medium"];
    const idle = humanoid[0].filter(Boolean).map((f) => f!.hand[0]);
    const attack = humanoid[1].filter(Boolean).map((f) => f!.hand[0]);
    expect(new Set([...idle, ...attack]).size).toBeGreaterThan(1);
  });
});
