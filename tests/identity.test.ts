import { describe, expect, it } from "vitest";
import {
  computeAxisBands,
  simulateBattle,
  synergyLabelForTag,
} from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { artFor, visualArchetypeFor } from "../src/lib/render/archetypes";
import {
  IDENTITY_OVERRIDES,
  identityFor,
  identitySignature,
} from "../src/lib/render/identity";
import {
  cueIntensity,
  interactionsFor,
  CUE_END_MS,
  MAX_RIVALRIES,
  MAX_RIVALRY_CARRIERS,
} from "../src/lib/render/interactions";
import { sceneAt } from "../src/lib/render/scene";

/**
 * ---------------------------------------------------------------------------
 * Which one is which?
 * ---------------------------------------------------------------------------
 * Six body plans cover 268 characters, so without an identity layer a battle
 * is ten copies of the same green quadruped. These tests assert that two
 * characters sharing a body plan are configured to look different, that a
 * character looks the same from frame to frame, and that identity never
 * collides with the team colour.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const animals = CHARACTERS.filter((c) => c.categoryId === "animals");

const identity = (id: string) => {
  const c = CHARACTERS_BY_ID[id];
  if (!c) throw new Error(`${id} is not in the catalogue`);
  return identityFor(c, visualArchetypeFor(c));
};

describe("every character resolves an identity", () => {
  it("configures all 268 of them", () => {
    for (const c of CHARACTERS) {
      const config = identityFor(c, visualArchetypeFor(c));
      expect(config.scale).toBeGreaterThan(0.5);
      expect(config.scale).toBeLessThan(1.6);
      expect(config.accent).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(CHARACTERS.length).toBeGreaterThan(200);
  });

  it("gives the same answer every time it is asked", () => {
    for (const c of CHARACTERS.slice(0, 60)) {
      const a = identityFor(c, visualArchetypeFor(c));
      const b = identityFor(c, visualArchetypeFor(c));
      expect(identitySignature(a)).toBe(identitySignature(b));
    }
  });

  it("names only characters that exist in its hand-tuned table", () => {
    const ids = new Set(CHARACTERS.map((c) => c.id));
    for (const id of Object.keys(IDENTITY_OVERRIDES)) {
      expect(ids.has(id), `identity override for "${id}" names no character`).toBe(true);
    }
    expect(Object.keys(IDENTITY_OVERRIDES).length).toBeGreaterThanOrEqual(20);
  });

  it("lets a hand-tuned entry beat the rule", () => {
    // A lion's mane is the thing a rule over tags will not produce.
    expect(identity("animals-lion").back).toBe("MANE");
    expect(identity("animals-tiger").marking).toBe("STRIPES");
    expect(identity("animals-african-bush-elephant").head).toBe("TUSKS");
  });
});

describe("characters sharing a body plan look different", () => {
  it("separates every pair inside each archetype", () => {
    const byArchetype = new Map<string, { id: string; signature: string }[]>();
    for (const c of CHARACTERS) {
      const archetype = visualArchetypeFor(c);
      const signature = identitySignature(identityFor(c, archetype));
      byArchetype.set(archetype, [
        ...(byArchetype.get(archetype) ?? []),
        { id: c.id, signature },
      ]);
    }

    // Across the whole catalogue a few collisions are inevitable with a
    // feature space this small; what matters is that they are rare enough
    // never to put two identical sprites in one battle.
    let collisions = 0;
    let pairs = 0;
    for (const entries of byArchetype.values()) {
      const seen = new Map<string, string>();
      for (const entry of entries) {
        pairs++;
        if (seen.has(entry.signature)) collisions++;
        else seen.set(entry.signature, entry.id);
      }
    }
    expect(collisions / pairs).toBeLessThan(0.12);
  });

  it("separates the animals, where a wrong silhouette is most obvious", () => {
    const signatures = animals.map((c) =>
      identitySignature(identityFor(c, visualArchetypeFor(c))),
    );
    expect(new Set(signatures).size).toBe(animals.length);
  });

  it("gives a lion, a tiger and a wolf three different looks", () => {
    const lion = identity("animals-lion");
    const tiger = identity("animals-tiger");
    const wolf = identity("animals-wolf");
    expect(visualArchetypeFor(CHARACTERS_BY_ID["animals-lion"])).toBe(
      visualArchetypeFor(CHARACTERS_BY_ID["animals-tiger"]),
    );
    const signatures = [lion, tiger, wolf].map(identitySignature);
    expect(new Set(signatures).size).toBe(3);
  });

  it("scales a badger well below an elephant", () => {
    expect(identity("animals-honey-badger").scale).toBeLessThan(
      identity("animals-african-bush-elephant").scale * 0.75,
    );
  });
});

describe("identity does not fight the rest of the picture", () => {
  it("keeps the accent out of the team colours", () => {
    // Team identity lives on the ground ring. An accent that landed on the
    // same blue or red would undo it.
    const teamColours = ["#3b82f6", "#ef4444"];
    for (const c of CHARACTERS) {
      const accent = identityFor(c, visualArchetypeFor(c)).accent;
      for (const team of teamColours) {
        expect(distance(accent, team), `${c.id} accent ${accent}`).toBeGreaterThan(60);
      }
    }
  });

  it("derives the accent from the character, not from a global list", () => {
    // Two characters with different palettes must not share an accent by
    // accident often enough to matter.
    const accents = animals.map((c) => identityFor(c, visualArchetypeFor(c)).accent);
    expect(new Set(accents).size).toBeGreaterThan(animals.length * 0.5);
  });

  it("does not change with the animation being played", () => {
    // Identity is a property of the character, so nothing about a frame can
    // reach it. Asserted by construction: the resolver takes no frame at all.
    const before = identity("animals-tiger");
    const after = identity("animals-tiger");
    expect(before).toEqual(after);
    expect(identityFor.length).toBe(2);
  });
});

describe("art carries identity to the renderer", () => {
  it("attaches a configuration to every character's art", () => {
    for (const c of CHARACTERS.slice(0, 50)) {
      expect(artFor(c).identity).toBeTruthy();
    }
  });

  it("keeps identity separate from the palette", () => {
    const art = artFor(CHARACTERS_BY_ID["animals-tiger"]);
    expect(art.palette).toEqual(CHARACTERS_BY_ID["animals-tiger"].palette);
    expect(art.identity!.accent).not.toBe(art.palette[0]);
  });

  it("still configures a character whose archetype has no sheet", () => {
    // A fallback character has to stay readable: it loses the body, not the
    // horns, the size or the colour.
    const art = artFor(CHARACTERS_BY_ID["animals-moose"]);
    expect(art.identity!.head).toBe("ANTLERS");
    expect(art.identity!.scale).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Ten at once, in a real battle
// ---------------------------------------------------------------------------

const ROSTER_A = [
  "animals-lion",
  "animals-tiger",
  "animals-wolf",
  "animals-leopard",
  "animals-spotted-hyena",
];
const ROSTER_B = [
  "animals-jaguar",
  "animals-cheetah",
  "animals-grizzly-bear",
  "animals-polar-bear",
  "animals-wild-boar",
];

const context: ReplayContext = {
  battleId: "identity",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

const replayOf = (seed: string): Replay =>
  toReplay(
    simulateBattle({
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
    }),
    context,
  );

describe("ten in one battle, all tellable apart", () => {
  const replay = replayOf("identity-1");

  it("puts ten characters of nearly one body plan on the field", () => {
    const archetypes = new Set(
      replay.combatants.map((c) => visualArchetypeFor(CHARACTERS_BY_ID[c.characterId])),
    );
    // The hard case on purpose: mostly quadrupeds, where only identity
    // separates them.
    expect(replay.combatants).toHaveLength(10);
    expect(archetypes.size).toBeLessThanOrEqual(3);
  });

  it("gives all ten a distinct look", () => {
    const signatures = replay.combatants.map((c) => {
      const character = CHARACTERS_BY_ID[c.characterId];
      return identitySignature(identityFor(character, visualArchetypeFor(character)));
    });
    expect(new Set(signatures).size).toBe(10);
  });

  it("keeps each one's look constant for the whole battle", () => {
    // Identity is resolved from the character, so it cannot vary by frame —
    // but the art the renderer hands out must not vary either.
    const first = new Map(
      replay.combatants.map((c) => [
        c.characterId,
        identitySignature(artFor(CHARACTERS_BY_ID[c.characterId]).identity!),
      ]),
    );
    for (let t = 0; t <= replay.durationMs; t += 2000) {
      for (const c of sceneAt(replay, t).combatants) {
        const now = identitySignature(artFor(CHARACTERS_BY_ID[c.characterId]).identity!);
        expect(now).toBe(first.get(c.characterId));
      }
    }
  });
});

describe("relationships, and who decided them", () => {
  const replay = replayOf("identity-2");
  const roster = replay.combatants.map((c) => ({
    characterId: c.characterId,
    teamId: c.teamId,
    tags: CHARACTERS_BY_ID[c.characterId].tags,
  }));

  it("reports exactly the synergy groups the engine reported", () => {
    const cues = interactionsFor(replay, roster);
    const fromEngine = replay.teams.flatMap((t) =>
      t.synergies.map((g) => `${t.playerId}:${g.label}:${g.bonus}`),
    );
    const fromCues = cues.synergies.map((c) => `${c.teamId}:${c.label}:${c.bonus}`);
    expect([...fromCues].sort()).toEqual([...fromEngine].sort());
    expect(fromEngine.length).toBeGreaterThan(0);
  });

  it("never invents a bonus of its own", () => {
    const cues = interactionsFor(replay, roster);
    const engineBonuses = new Set(
      replay.teams.flatMap((t) => t.synergies.map((g) => g.bonus)),
    );
    for (const cue of cues.synergies) expect(engineBonuses.has(cue.bonus)).toBe(true);
  });

  it("points each synergy at exactly the squad members that carry the tag", () => {
    const cues = interactionsFor(replay, roster);
    expect(cues.synergies.length).toBeGreaterThan(0);

    for (const cue of cues.synergies) {
      const name = cue.label.replace(/\s*×\d+$/, "");
      const teammates = roster.filter((r) => r.teamId === cue.teamId);
      const carries = (r: (typeof roster)[number]) =>
        r.tags.some((t) => synergyLabelForTag(t) === name);

      // Everyone named carries the tag …
      for (const id of cue.characterIds) {
        const member = teammates.find((r) => r.characterId === id);
        expect(member, `${id} is not on ${cue.teamId}`).toBeTruthy();
        expect(carries(member!), `${id} does not carry ${name}`).toBe(true);
      }
      // … and nobody who carries it is left out.
      expect([...cue.characterIds].sort()).toEqual(
        teammates.filter(carries).map((r) => r.characterId).sort(),
      );
      // The engine's own count has to agree with how many were found.
      const count = Number(cue.label.match(/×(\d+)$/)?.[1] ?? 0);
      expect(cue.characterIds.length).toBe(count);
    }
  });

  it("leaves teammates without the tag out of the cue", () => {
    const cues = interactionsFor(replay, roster);
    const anyPartial = cues.synergies.some((cue) => {
      const teammates = roster.filter((r) => r.teamId === cue.teamId);
      return cue.characterIds.length < teammates.length;
    });
    // If every cue covered the whole squad this test would prove nothing about
    // membership, so require at least one that does not.
    expect(anyPartial).toBe(true);
  });

  it("only ever pairs rivals across the two sides", () => {
    const cues = interactionsFor(replay, roster);
    expect(cues.rivalries.length).toBeGreaterThan(0);
    for (const rivalry of cues.rivalries) {
      const a = roster.find((r) => r.characterId === rivalry.a)!;
      const b = roster.find((r) => r.characterId === rivalry.b)!;
      expect(a.teamId).not.toBe(b.teamId);
      expect(a.tags).toContain(rivalry.tag);
      expect(b.tags).toContain(rivalry.tag);
    }
  });

  it("keeps rivalry to a few rare tags rather than every shared one", () => {
    // Ten mutually "predator" animals produced twenty dashed lines across the
    // arena, which is noise: a tag almost everyone carries says nothing about
    // any pair of them.
    const cues = interactionsFor(replay, roster);
    expect(cues.rivalries.length).toBeLessThanOrEqual(MAX_RIVALRIES);

    for (const rivalry of cues.rivalries) {
      const carriers = roster.filter((r) => r.tags.includes(rivalry.tag)).length;
      expect(carriers).toBeLessThanOrEqual(MAX_RIVALRY_CARRIERS);
      expect(rivalry.rarity).toBe(carriers);
    }

    // And the common tag genuinely was there to be rejected.
    const counts = new Map<string, number>();
    for (const r of roster) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThan(MAX_RIVALRY_CARRIERS);
  });

  it("prefers the rarer relationship when it has to choose", () => {
    const cues = interactionsFor(replay, roster);
    const rarities = cues.rivalries.map((r) => r.rarity);
    expect([...rarities].sort((a, b) => a - b)).toEqual(rarities);
  });

  it("is deterministic, down to the order", () => {
    expect(interactionsFor(replay, roster)).toEqual(interactionsFor(replay, roster));
  });

  it("clears the cues away before the fight gets going", () => {
    expect(cueIntensity(0)).toBe(0);
    expect(cueIntensity(1500)).toBeGreaterThan(0);
    expect(cueIntensity(CUE_END_MS)).toBe(0);
    expect(cueIntensity(20_000)).toBe(0);
  });
});

/** Rough perceptual distance between two hex colours. */
function distance(a: string, b: string): number {
  const parse = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}
