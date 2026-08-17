import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { visualArchetypeFor } from "../src/lib/render/archetypes";
import { disambiguate, identityFor, shapeKey } from "../src/lib/render/identity";
import { interactionsFor } from "../src/lib/render/interactions";
import { ARENA, MAX_CAMERA_OFFSET, sceneAt, type Scene } from "../src/lib/render/scene";
import { fingerprint, pixelDifference, rasterise } from "./support/raster";

/**
 * ---------------------------------------------------------------------------
 * Visual regression, on a real battle
 * ---------------------------------------------------------------------------
 * Every state a viewer has to be able to read — idle, attack, block, crit,
 * special, elimination, turning point, upset, victory, MVP — pinned against a
 * real 5v5, plus the stress case where they all arrive at once.
 *
 * The scene is the thing under test, because it is the whole picture in data
 * form: if two runs produce the same scene they produce the same frame. Pixel
 * output is checked separately, through the software rasteriser, where the
 * question is whether characters are actually distinguishable.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

/** Deliberately near-identical bodies: the hard case for identity. */
const ROSTER_A = [
  "animals-lion", "animals-tiger", "animals-wolf",
  "animals-leopard", "animals-spotted-hyena",
];
const ROSTER_B = [
  "animals-jaguar", "animals-cheetah", "animals-grizzly-bear",
  "animals-polar-bear", "animals-wild-boar",
];

const context: ReplayContext = {
  battleId: "regression",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

function replayOf(seed: string, a = ROSTER_A, b = ROSTER_B): Replay {
  return toReplay(
    simulateBattle({
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
    }),
    context,
  );
}

/**
 * One replay carrying every state at once.
 *
 * Found by searching seeds for a battle that contains a turning point *and*
 * an upset alongside the ordinary blows, rather than by staging one — the
 * point of a regression suite is that it exercises what really happens.
 */
function findEverything(): Replay {
  const opponents = [
    "animals-lion", "animals-african-buffalo", "animals-leopard",
    "animals-common-ostrich", "animals-wolverine",
  ];
  for (let i = 0; i < 400; i++) {
    const replay = replayOf(`all-${i}`, [
      "animals-african-bush-elephant", "animals-green-anaconda",
      "animals-golden-eagle", "animals-honey-badger", "animals-western-gorilla",
    ], opponents);
    const kinds = new Set(replay.events.map((e) => e.kind));
    if (
      replay.upset &&
      replay.turningPoint &&
      (["ATTACK", "BLOCK", "CRIT", "SPECIAL", "ELIMINATION", "END"] as const).every(
        (k) => kinds.has(k),
      )
    ) {
      return replay;
    }
  }
  throw new Error("no battle in 400 seeds carried every state");
}

const EVERYTHING = findEverything();

const firstOf = (replay: Replay, kind: string) =>
  replay.events.find((e) => e.kind === kind);

describe("every state a viewer has to read", () => {
  const replay = EVERYTHING;

  const states: [string, () => Scene][] = [
    ["idle", () => sceneAt(replay, 200)],
    ["attack", () => sceneAt(replay, firstOf(replay, "ATTACK")!.atMs + 60)],
    ["block", () => sceneAt(replay, firstOf(replay, "BLOCK")!.atMs + 60)],
    ["crit", () => sceneAt(replay, firstOf(replay, "CRIT")!.atMs + 60)],
    ["special", () => sceneAt(replay, firstOf(replay, "SPECIAL")!.atMs + 60)],
    ["elimination", () => sceneAt(replay, firstOf(replay, "ELIMINATION")!.atMs + 60)],
    ["turning point", () => sceneAt(replay, firstOf(replay, "TURNING_POINT")!.atMs + 200)],
    ["victory", () => sceneAt(replay, replay.durationMs)],
  ];

  it("carries every one of them in the same battle", () => {
    for (const [name, at] of states) {
      expect(at(), `${name} produced no scene`).toBeTruthy();
    }
    expect(replay.upset).toBe(true);
    expect(replay.mvp).toBeTruthy();
  });

  it("shows the right thing in each", () => {
    const attack = sceneAt(replay, firstOf(replay, "ATTACK")!.atMs + 60);
    expect(attack.effects.some((e) => e.kind === "HIT")).toBe(true);

    const block = sceneAt(replay, firstOf(replay, "BLOCK")!.atMs + 60);
    expect(block.effects.some((e) => e.kind === "GUARD" && e.blocked)).toBe(true);

    const crit = sceneAt(replay, firstOf(replay, "CRIT")!.atMs + 60);
    expect(crit.effects.some((e) => e.kind === "CRIT")).toBe(true);
    expect(crit.camera.shake).toBeGreaterThan(0);

    const special = sceneAt(replay, firstOf(replay, "SPECIAL")!.atMs + 60);
    expect(special.effects.some((e) => e.kind === "SPECIAL")).toBe(true);
    expect(special.effects.some((e) => e.kind === "CAST")).toBe(true);

    const kill = sceneAt(replay, firstOf(replay, "ELIMINATION")!.atMs + 60);
    expect(kill.effects.some((e) => e.kind === "DEATH")).toBe(true);
    expect(kill.combatants.some((c) => !c.alive)).toBe(true);

    const turn = sceneAt(replay, firstOf(replay, "TURNING_POINT")!.atMs + 200);
    expect(turn.cinematic?.kind).toBe("TURNING_POINT");
    expect(turn.banner?.kind).toBe("TURNING_POINT");

    const end = sceneAt(replay, replay.durationMs);
    expect(end.banner?.kind).toBe("VICTORY");
    expect(end.cinematic?.kind).toBe("UPSET");
    expect(end.cinematic!.intensity).toBe(1);
    expect(end.mvpCharacterId).toBe(replay.mvp!.characterId);
    expect(end.outro).toBe(1);
  });

  it("reproduces every state exactly, however it is reached", () => {
    for (const [name, at] of states) {
      const first = at();
      // Walk the whole battle in between, forwards and back.
      for (let t = 0; t <= replay.durationMs; t += 2500) sceneAt(replay, t);
      for (let t = replay.durationMs; t >= 0; t -= 2500) sceneAt(replay, t);
      expect(at(), `${name} drifted`).toEqual(first);
    }
  });
});

describe("ten combatants, every event kind, all at once", () => {
  const replay = EVERYTHING;

  it("never lets two damage numbers share a row where they would overlap", () => {
    let checked = 0;
    for (let t = 0; t <= replay.durationMs; t += 25) {
      const numbers = sceneAt(replay, t).effects.filter((e) => typeof e.value === "number");
      if (numbers.length < 2) continue;
      checked++;
      for (let i = 0; i < numbers.length; i++) {
        for (let j = i + 1; j < numbers.length; j++) {
          const a = numbers[i];
          const b = numbers[j];
          const close = Math.abs(a.x - b.x) < 34 && Math.abs(a.y - b.y) < 30;
          if (close) expect(a.slot).not.toBe(b.slot);
        }
      }
    }
    expect(checked, "no frame ever had two numbers to separate").toBeGreaterThan(0);
  });

  it("keeps the camera inside the ground it draws", () => {
    for (let t = 0; t <= replay.durationMs; t += 20) {
      const { camera } = sceneAt(replay, t);
      const stray = Math.hypot(camera.x - ARENA.width / 2, camera.y - ARENA.height / 2);
      expect(stray).toBeLessThanOrEqual(MAX_CAMERA_OFFSET + 1e-6);
      expect(camera.zoom).toBeLessThanOrEqual(1.25);
    }
  });

  it("keeps ten sprites from stacking on one another", () => {
    for (let t = 0; t <= replay.durationMs; t += 200) {
      const alive = sceneAt(replay, t).combatants.filter((c) => c.alive);
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i];
          const b = alive[j];
          const gap = Math.hypot(
            a.x + a.lunge - (b.x + b.lunge),
            a.y + a.lungeY - (b.y + b.lungeY),
          );
          // A sprite is 22 units wide; anything under a third of that is an
          // overlap a viewer would read as one creature.
          expect(gap, `${a.characterId} and ${b.characterId} at ${t}ms`).toBeGreaterThan(7);
        }
      }
    }
  });

  it("bounds the sparks even at the busiest moment", () => {
    let peak = 0;
    for (let t = 0; t <= replay.durationMs; t += 20) {
      peak = Math.max(peak, sceneAt(replay, t).particles.length);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(150);
  });

  it("carries synergy and rivalry without either touching the result", () => {
    const roster = replay.combatants.map((c) => ({
      characterId: c.characterId,
      teamId: c.teamId,
      tags: CHARACTERS_BY_ID[c.characterId].tags,
    }));
    const cues = interactionsFor(replay, roster);

    expect(cues.synergies.length).toBeGreaterThan(0);
    const engineBonuses = new Set(
      replay.teams.flatMap((t) => t.synergies.map((g) => g.bonus)),
    );
    for (const cue of cues.synergies) expect(engineBonuses.has(cue.bonus)).toBe(true);

    // And the scene is untouched by any of it.
    const before = sceneAt(replay, 5000);
    interactionsFor(replay, roster);
    expect(sceneAt(replay, 5000)).toEqual(before);
  });
});

describe("the ten on the field are distinguishable, in pixels", () => {
  const replay = EVERYTHING;

  const configs = replay.combatants.map((c) => {
    const character = CHARACTERS_BY_ID[c.characterId];
    return {
      characterId: c.characterId,
      teamId: c.teamId,
      config: identityFor(character, visualArchetypeFor(character)),
    };
  });
  const separated = disambiguate(configs);

  it("draws every one of them differently", () => {
    const prints = replay.combatants.map((c) =>
      fingerprint(
        rasterise(CHARACTERS_BY_ID[c.characterId], "IDLE", 0, separated.get(c.characterId)),
      ),
    );
    expect(new Set(prints).size).toBe(10);
  });

  it("differs by more than a stray pixel", () => {
    const rasters = replay.combatants.map((c) =>
      rasterise(CHARACTERS_BY_ID[c.characterId], "IDLE", 0, separated.get(c.characterId)),
    );
    const drawn = (r: (typeof rasters)[number]) => {
      let n = 0;
      for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > 0) n++;
      return n;
    };

    let closest = 1;
    for (let i = 0; i < rasters.length; i++) {
      for (let j = i + 1; j < rasters.length; j++) {
        const share =
          pixelDifference(rasters[i], rasters[j]) /
          Math.max(drawn(rasters[i]), drawn(rasters[j]));
        closest = Math.min(closest, share);
      }
    }
    // Measured on rendered output rather than on a signature: two characters
    // can share a configuration and still be drawn differently.
    expect(closest).toBeGreaterThan(0.25);
  });

  it("separates teammates by shape, not merely by colour", () => {
    for (const team of ["player-a", "player-b"]) {
      const shapes = configs
        .filter((c) => c.teamId === team)
        .map((c) => shapeKey(separated.get(c.characterId)!));
      expect(new Set(shapes).size, `${team} has two identical silhouettes`).toBe(5);
    }
  });

  it("separates teammates whose only difference is colour", () => {
    // The case the team rule exists for: identical silhouettes that differ
    // only in accent. Their signatures already differ, so a plain uniqueness
    // check waves them through — but they share a team colour on the ground
    // ring, so on screen they are the same creature twice.
    const base = configs[0].config;
    const twins = ["#ffdd88", "#ddffaa", "#aaddff", "#ffbbdd", "#ccffee"].map(
      (accent, i) => ({
        characterId: `twin-${i}`,
        teamId: "player-a",
        config: { ...base, accent },
      }),
    );
    // Different signatures going in, identical shapes going in.
    expect(new Set(twins.map((t) => shapeKey(t.config))).size).toBe(1);

    const fixed = disambiguate(twins);
    const shapes = twins.map((t) => shapeKey(fixed.get(t.characterId)!));
    expect(new Set(shapes).size, "teammates left sharing a silhouette").toBe(5);
  });

  it("keeps a character's look identical across the frames of a clip", () => {
    const character = CHARACTERS_BY_ID[replay.combatants[0].characterId];
    const identity = separated.get(character.id);
    const prints = [0, 1, 2, 3].map((frame) =>
      fingerprint(rasterise(character, "IDLE", frame, identity)),
    );
    // The frames differ from each other — it is animating — but the identity
    // is the same in all of them, which is what the tinting must not disturb.
    expect(new Set(prints).size).toBeGreaterThan(1);
    for (const frame of [0, 1, 2, 3]) {
      expect(fingerprint(rasterise(character, "IDLE", frame, identity))).toBe(prints[frame]);
    }
  });
});

describe("catalogue-wide diversity, measured on pixels", () => {
  /**
   * The M8 report quoted a ~12% identity collision rate, which was measured on
   * `identitySignature` — the wrong instrument. Two characters can share a
   * configuration and still be drawn differently, because the body is tinted
   * with their own palettes; and two different configurations can land on the
   * same pixels. The only honest measure is what gets drawn.
   */
  const rendered = CHARACTERS.map((c) => ({
    id: c.id,
    archetype: visualArchetypeFor(c),
    raster: rasterise(c),
  }));

  const drawnPixels = (r: (typeof rendered)[number]["raster"]) => {
    let n = 0;
    for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > 0) n++;
    return n;
  };

  it("draws all 268 characters differently", () => {
    const prints = rendered.map((r) => fingerprint(r.raster));
    expect(new Set(prints).size).toBe(CHARACTERS.length);
  });

  it("keeps characters sharing a body plan far apart, not merely unequal", () => {
    const byArchetype = new Map<string, typeof rendered>();
    for (const entry of rendered) {
      byArchetype.set(entry.archetype, [...(byArchetype.get(entry.archetype) ?? []), entry]);
    }

    for (const [archetype, group] of byArchetype) {
      // The big groups are sampled: the comparison is quadratic and 218
      // humanoids is 23,000 pairs of full-frame diffs.
      const sample = group.slice(0, 45);
      if (sample.length < 2) continue;

      let closest = 1;
      for (let i = 0; i < sample.length; i++) {
        for (let j = i + 1; j < sample.length; j++) {
          const share =
            pixelDifference(sample[i].raster, sample[j].raster) /
            Math.max(drawnPixels(sample[i].raster), drawnPixels(sample[j].raster));
          closest = Math.min(closest, share);
        }
      }
      expect(closest, `${archetype}: closest pair differs by only`).toBeGreaterThan(0.25);
    }
  });

  it("is stable: the same character always renders the same pixels", () => {
    for (const c of CHARACTERS.slice(0, 40)) {
      expect(fingerprint(rasterise(c))).toBe(fingerprint(rasterise(c)));
    }
  });
});
