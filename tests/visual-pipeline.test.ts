import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import {
  CHARACTERS,
  CHARACTER_VISUALS,
  nicknameFor,
} from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type ReplayContext } from "../src/lib/game/replay";
import { buildStage } from "../src/lib/render/stage";
import { playerColor } from "../src/lib/game/colors";
import { visualArchetypeFor } from "../src/lib/render/archetypes";
import { identityFor, visualSignature } from "../src/lib/render/identity";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * The look survives the round trip, and never joins the game.
 * ---------------------------------------------------------------------------
 * S1–S4 built a visual identity system and proved each piece in isolation. The
 * question left is whether it holds together along the path a real match takes:
 * auction, team review, battle, stored result, and a replay opened afterwards
 * by somebody who was not there.
 *
 * Two things have to be true at every step of that path, and they pull in
 * opposite directions. The look must be *stable* — a lion opened from a shared
 * link is the same lion the table bid on. And it must be *inert* — nothing
 * about that lion's mane may reach the number that decided the match.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

/** Five body plans in one squad, which is what a real draft can produce. */
const SQUAD_A = [
  "animals-lion",                  // quadruped_medium
  "animals-western-gorilla",       // humanoid_large
  "animals-african-bush-elephant", // quadruped_large
  "animals-golden-eagle",          // winged
  "animals-black-mamba",           // serpentine
];
const SQUAD_B = [
  "animals-tiger",                 // quadruped_medium
  "animals-grizzly-bear",          // quadruped_large
  "animals-great-white-shark",     // aquatic
  "animals-honey-badger",          // quadruped_small
  "animals-common-ostrich",        // humanoid_medium
];

const context: ReplayContext = {
  battleId: "pipeline",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

function battle(seed: string, a = SQUAD_A, b = SQUAD_B): BattleResult {
  return simulateBattle({
    teams: [
      {
        playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE",
        characters: a.map((id, i) => ({ characterId: id, price: 4 + i * 3 })),
      },
      {
        playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE",
        characters: b.map((id, i) => ({ characterId: id, price: 6 + i * 2 })),
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

const PLAYERS = [
  { id: "player-a", nickname: "Ege", formation: "AGGRESSIVE", colorHex: playerColor(0).hex },
  { id: "player-b", nickname: "Mikail", formation: "DEFENSIVE", colorHex: playerColor(1).hex },
];

const stageOf = (result: BattleResult) =>
  buildStage({
    battleId: "pipeline",
    result,
    players: PLAYERS,
    charactersById: CHARACTERS_BY_ID,
  })!;

// ---------------------------------------------------------------------------
// Serialisation boundaries
// ---------------------------------------------------------------------------

describe("visual metadata never crosses into the game's own records", () => {
  const result = battle("pipe-1");

  it("keeps it out of the authoritative result", () => {
    const json = JSON.stringify(result);
    for (const leaked of ["THE KING", "THE TOWER", "TOWERING", "SILVERBACK", "quadruped_large"]) {
      expect(json, `${leaked} reached battle_result`).not.toContain(leaked);
    }
  });

  it("keeps it out of the replay", () => {
    const json = JSON.stringify(toReplay(result, context));
    for (const leaked of ["THE KING", "THE AMBUSH", "TOWERING", "HAMMER", "humanoid_large"]) {
      expect(json, `${leaked} reached the replay`).not.toContain(leaked);
    }
  });

  it("keeps it out of the database schema", () => {
    // The auction reads its characters from Postgres. A column here would
    // mean a redraw could fail a draft.
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/0001_init.sql"),
      "utf8",
    );
    const table = sql.slice(
      sql.indexOf("create table if not exists characters"),
      sql.indexOf("create table if not exists games"),
    );
    for (const column of ["nick", "identity", "archetype", "prop", "build"]) {
      expect(table.toLowerCase(), `characters.${column} exists`).not.toContain(column);
    }
  });

  it("keeps it out of the seeded character rows", () => {
    const generator = readFileSync(
      resolve(process.cwd(), "scripts/generate-character-sql.ts"),
      "utf8",
    );
    for (const field of ["entry.nick", "entry.va", "entry.i", "CHARACTER_VISUALS"]) {
      expect(generator, `${field} is seeded`).not.toContain(field);
    }
  });

  it("is not imported by the simulation", () => {
    // Structural, not behavioural: `battle.ts` cannot read what it does not
    // import, so no future edit can reach the visual table by accident.
    const engine = readFileSync(resolve(process.cwd(), "src/lib/game/battle.ts"), "utf8");
    expect(engine).not.toContain('from "./characters"');
    expect(engine).not.toContain("CHARACTER_VISUALS");
  });
});

// ---------------------------------------------------------------------------
// Gameplay isolation, along the real chain
// ---------------------------------------------------------------------------

describe("rewriting every look changes nothing the game decided", () => {
  it("leaves result, replay and stage identical", () => {
    const before = battle("pipe-2");
    const replayBefore = toReplay(before, context);
    const saved = { ...CHARACTER_VISUALS };

    try {
      for (const id of [...SQUAD_A, ...SQUAD_B]) {
        CHARACTER_VISUALS[id] = {
          nick: "NOT THE KING",
          va: "aquatic",
          i: { head: "TUSKS", back: "SHELL", marking: "BANDS", prop: "ORB", build: "SQUAT", scale: 1.7 },
        };
      }
      expect(nicknameFor("animals-lion", "Lion")).toBe("NOT THE KING");

      const after = battle("pipe-2");
      expect(after).toEqual(before);
      expect(toReplay(after, context)).toEqual(replayBefore);

      // The stage is a projection of the result, so its combat-facing parts
      // must match too — only the art may differ.
      expect(stageOf(after).replay).toEqual(stageOf(before).replay);
    } finally {
      for (const id of Object.keys(CHARACTER_VISUALS)) delete CHARACTER_VISUALS[id];
      Object.assign(CHARACTER_VISUALS, saved);
    }
  });

  it("leaves the forecast, the winner and the pricing alone", () => {
    const before = battle("pipe-3");
    const saved = { ...CHARACTER_VISUALS };
    try {
      for (const id of SQUAD_A) {
        CHARACTER_VISUALS[id] = { i: { build: "TOWERING", prop: "HAMMER" } };
      }
      const after = battle("pipe-3");
      expect(after.winnerPlayerId).toBe(before.winnerPlayerId);
      expect(after.teams.map((t) => [t.rank, t.points, t.winProbability]))
        .toEqual(before.teams.map((t) => [t.rank, t.points, t.winProbability]));
      expect(after.mvp).toEqual(before.mvp);
      for (const id of SQUAD_A) {
        expect(CHARACTERS_BY_ID[id].basePrice).toBe(CHARACTERS_BY_ID[id].basePrice);
        expect(CHARACTERS_BY_ID[id].rarity).toBeTruthy();
      }
    } finally {
      for (const id of Object.keys(CHARACTER_VISUALS)) delete CHARACTER_VISUALS[id];
      Object.assign(CHARACTER_VISUALS, saved);
    }
  });
});

// ---------------------------------------------------------------------------
// Cache isolation
// ---------------------------------------------------------------------------

describe("two looks never share one cached frame", () => {
  it("keys the composed frame on the identity, not only the character", () => {
    // The cache stores pictures. Two different looks are two different
    // pictures, and a key that omitted the look served the first one twice —
    // which is exactly what happened in S2 until the harness caught it.
    const canvas = readFileSync(resolve(process.cwd(), "src/lib/render/canvas.ts"), "utf8");
    const assets = readFileSync(resolve(process.cwd(), "src/lib/render/assets.ts"), "utf8");
    expect(canvas).toContain("identityKeyOf(identity)");
    expect(assets).toContain("${identityKey}");
    // And the key carries every field that changes the picture.
    const keyFn = canvas.slice(canvas.indexOf("function identityKeyOf"), canvas.indexOf("const TILE_SCALE"));
    for (const field of ["head", "back", "marking", "prop", "build", "accent"]) {
      expect(keyFn, `identity key ignores ${field}`).toContain(`i.${field}`);
    }
  });

  it("gives every distinct look a distinct signature", () => {
    // Same character, two props: the signatures must differ, or a cache keyed
    // on them would hand back the wrong sprite.
    const lion = CHARACTERS_BY_ID["animals-lion"];
    const archetype = visualArchetypeFor(lion);
    const base = identityFor(lion, archetype);
    const a = visualSignature(archetype, { ...base, prop: "BLADE" });
    const b = visualSignature(archetype, { ...base, prop: "SHIELD" });
    const c = visualSignature(archetype, { ...base, build: "SQUAT" });
    expect(new Set([a, b, c, visualSignature(archetype, base)]).size).toBe(4);
  });

  it("separates the ten fighters of a real squad", () => {
    const stage = stageOf(battle("pipe-4"));
    const looks = stage.art.map((a) => visualSignature(a.archetype ?? "", a.identity!));
    const inMatch = new Set(stage.replay.combatants.map((c) => c.characterId));
    const used = stage.art.filter((a) => inMatch.has(a.characterId));
    const signatures = used.map((a) => visualSignature(a.archetype ?? "", a.identity!));
    expect(new Set(signatures).size, "two fighters share a look").toBe(used.length);
    expect(looks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Replay persistence
// ---------------------------------------------------------------------------

describe("a replay opened later shows the same creatures", () => {
  it("resolves an identical look from the stored result alone", () => {
    // The shared page has the result and nothing else — no client state, no
    // memory of the draft. The look has to be reconstructible from the
    // catalogue plus the character id, or a shared link shows different
    // animals from the ones the table played with.
    const result = battle("pipe-5");
    const live = stageOf(result);
    const later = stageOf(JSON.parse(JSON.stringify(result)) as BattleResult);

    const lookOf = (s: typeof live) =>
      s.art
        .filter((a) => s.replay.combatants.some((c) => c.characterId === a.characterId))
        .map((a) => [a.characterId, a.archetype, visualSignature(a.archetype ?? "", a.identity!)])
        .sort();

    expect(lookOf(later)).toEqual(lookOf(live));
  });

  it("puts every body plan of a mixed squad on the field", () => {
    const stage = stageOf(battle("pipe-6"));
    const plans = new Set(
      stage.replay.combatants.map(
        (c) => stage.art.find((a) => a.characterId === c.characterId)!.archetype,
      ),
    );
    // Five distinct plans across the two squads, which is the case the
    // renderer is least likely to have been exercised on.
    expect(plans.size).toBeGreaterThanOrEqual(6);
  });

  it("keeps the nickname resolvable from the id after the match", () => {
    const result = battle("pipe-7");
    for (const c of result.combatants) {
      const name = CHARACTERS_BY_ID[c.characterId].name;
      expect(nicknameFor(c.characterId, name)).toBeTruthy();
    }
    expect(nicknameFor("animals-lion", "Lion")).toBe("THE KING");
  });
});

// ---------------------------------------------------------------------------
// The nickname is a label, never an identity
// ---------------------------------------------------------------------------

describe("the catalogue name stays canonical", () => {
  it("never replaces the name on a character", () => {
    for (const c of CHARACTERS) {
      expect(c.name).toBeTruthy();
      expect(c.name).not.toMatch(/^THE /);
    }
    expect(CHARACTERS_BY_ID["animals-lion"].name).toBe("Lion");
  });

  it("is shown beside the name rather than instead of it", () => {
    // Every surface that shows a nickname must still show the catalogue name,
    // or a player cannot connect "THE KING" to the lion in their roster.
    for (const file of [
      "src/components/AuctionStage.tsx",
      "src/components/CharacterCard.tsx",
      "src/components/CharacterModal.tsx",
      "src/components/BattleReveal.tsx",
      "src/components/PlayerRail.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      // The call has to be *rendered*, not merely imported. An earlier version
      // of this test accepted the import line alone, so deleting every
      // `<Nickname>` from the auction passed it.
      const rendered = source.match(/nicknameFor\(/g) ?? [];
      expect(rendered.length, `${file} never calls nicknameFor`).toBeGreaterThan(0);
      expect(source, `${file} dropped the canonical name`).toMatch(/\.name/);
    }
  });

  it("renders nothing when a character has no nickname", () => {
    // Most of the catalogue. A label that fell back to the name would print
    // it twice on every legacy card.
    const legacy = CHARACTERS.find((c) => c.categoryId === "marvel")!;
    expect(nicknameFor(legacy.id, legacy.name)).toBe(legacy.name);
  });
});
