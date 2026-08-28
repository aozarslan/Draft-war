import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { DRAWN_ARCHETYPES, FRAME_SIZE, SHEET_CLIPS } from "../src/lib/render/archetypes";
import {
  IDENTITY_TILE_ROWS,
  IDENTITY_TILE_SIZE,
  IDENTITY_TILE_SLOTS,
  SPRITE_ANCHORS,
} from "../src/lib/render/anchors.generated";
import { disambiguate, identityFor, identitySignature } from "../src/lib/render/identity";
import { visualArchetypeFor } from "../src/lib/render/archetypes";
import { sceneAt } from "../src/lib/render/scene";
import { fingerprint, rasterise } from "./support/raster";
import type { AnimationHint } from "../src/lib/game/replay";

/**
 * ---------------------------------------------------------------------------
 * Is the pixel art actually pixel art?
 * ---------------------------------------------------------------------------
 * M8 moved identity layers from canvas curves onto the same pixel grid as the
 * bodies. These assert the properties that make that true rather than merely
 * intended: one greyscale palette, one grid, anchors that come from the bodies
 * themselves, and a picture that is a pure function of the clock down to the
 * last spark.
 */

function decodePng(path: string): { width: number; height: number; data: Buffer } {
  const file = readFileSync(path);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString("ascii", offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw.copy(data, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, data };
}

const tiles = decodePng(resolve(process.cwd(), "public/sprites/identity.png"));

describe("the identity tiles are made of the same material as the bodies", () => {
  it("ships one tile per feature, on the same grid", () => {
    expect(tiles.width).toBe(IDENTITY_TILE_SIZE);
    expect(tiles.height).toBe(IDENTITY_TILE_ROWS.length * IDENTITY_TILE_SIZE);
    expect(IDENTITY_TILE_ROWS.length).toBeGreaterThanOrEqual(15);
  });

  it("is greyscale, so tinting is what gives it colour", () => {
    // The same provenance rule the bodies follow: colour comes from the
    // character, never from the asset.
    for (let i = 0; i < tiles.data.length; i += 4) {
      if (tiles.data[i + 3] === 0) continue;
      expect(tiles.data[i]).toBe(tiles.data[i + 1]);
      expect(tiles.data[i + 1]).toBe(tiles.data[i + 2]);
    }
  });

  it("draws something in every tile it claims", () => {
    IDENTITY_TILE_ROWS.forEach((id, row) => {
      let opaque = 0;
      for (let y = 0; y < IDENTITY_TILE_SIZE; y++) {
        for (let x = 0; x < IDENTITY_TILE_SIZE; x++) {
          const py = row * IDENTITY_TILE_SIZE + y;
          if (tiles.data[(py * tiles.width + x) * 4 + 3] > 0) opaque++;
        }
      }
      expect(opaque, `${id} is an empty tile`).toBeGreaterThan(6);
    });
  });

  it("keeps every tile inside its own cell, on all four sides", () => {
    // A tile touching its edge bleeds into the neighbouring cell the moment
    // the sheet is sampled at anything but exact integer coordinates — which
    // is how sprite sheets grow seams. Three tiles did before this test.
    IDENTITY_TILE_ROWS.forEach((id, row) => {
      const top = row * IDENTITY_TILE_SIZE;
      const alpha = (x: number, y: number) =>
        tiles.data[(y * tiles.width + x) * 4 + 3];

      for (let x = 0; x < IDENTITY_TILE_SIZE; x++) {
        expect(alpha(x, top), `${id} top edge`).toBe(0);
        expect(alpha(x, top + IDENTITY_TILE_SIZE - 1), `${id} bottom edge`).toBe(0);
      }
      for (let y = 0; y < IDENTITY_TILE_SIZE; y++) {
        expect(alpha(0, top + y), `${id} left edge`).toBe(0);
        expect(alpha(IDENTITY_TILE_SIZE - 1, top + y), `${id} right edge`).toBe(0);
      }
    });
  });

  it("names a slot and a pivot for every tile", () => {
    for (const id of IDENTITY_TILE_ROWS) {
      const meta = IDENTITY_TILE_SLOTS[id];
      expect(meta, `${id} has no slot`).toBeTruthy();
      expect(["head", "back", "body", "mark", "hand", "foot"]).toContain(meta.slot);
      expect(meta.pivot[0]).toBeGreaterThanOrEqual(0);
      expect(meta.pivot[0]).toBeLessThanOrEqual(IDENTITY_TILE_SIZE);
      expect(meta.pivot[1]).toBeGreaterThanOrEqual(0);
      expect(meta.pivot[1]).toBeLessThanOrEqual(IDENTITY_TILE_SIZE);
    }
  });
});

describe("anchors come from the bodies that were drawn", () => {
  it("reports one for every frame every clip claims", () => {
    for (const archetype of DRAWN_ARCHETYPES) {
      const grid = SPRITE_ANCHORS[archetype];
      expect(grid, `${archetype} has no anchors`).toBeTruthy();
      for (const clip of Object.values(SHEET_CLIPS)) {
        for (let frame = 0; frame < clip.frames; frame++) {
          expect(
            grid[clip.row]?.[frame],
            `${archetype} row ${clip.row} frame ${frame}`,
          ).toBeTruthy();
        }
      }
    }
  });

  it("keeps every anchor inside the frame it belongs to", () => {
    for (const archetype of DRAWN_ARCHETYPES) {
      for (const row of SPRITE_ANCHORS[archetype]) {
        for (const anchor of row) {
          if (!anchor) continue;
          for (const [x, y] of [anchor.head, anchor.back, anchor.body]) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(FRAME_SIZE);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(FRAME_SIZE);
          }
        }
      }
    }
  });

  it("moves the head between frames, because the body does", () => {
    // A static anchor table would mean the horns floated while the skull bobbed.
    for (const archetype of DRAWN_ARCHETYPES) {
      const idle = SPRITE_ANCHORS[archetype][SHEET_CLIPS.IDLE.row];
      const heads = idle.filter(Boolean).map((a) => `${a!.head[0]},${a!.head[1]}`);
      expect(new Set(heads).size, `${archetype} head never moves`).toBeGreaterThan(1);
    }
  });

  it("puts the head above the ground for anything that stands", () => {
    for (const archetype of ["quadruped_medium", "quadruped_small", "humanoid_medium"]) {
      const anchor = SPRITE_ANCHORS[archetype][SHEET_CLIPS.IDLE.row][0]!;
      expect(anchor.head[1]).toBeLessThan(anchor.body[1]);
    }
  });

  it("reports flank points for every body, inside the frame", () => {
    for (const archetype of DRAWN_ARCHETYPES) {
      for (const row of SPRITE_ANCHORS[archetype]) {
        for (const anchor of row) {
          if (!anchor) continue;
          expect(anchor.marks.length).toBeGreaterThanOrEqual(3);
          for (const [x, y] of anchor.marks) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(FRAME_SIZE);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(FRAME_SIZE);
          }
        }
      }
    }
  });

  it("turns the body when the pose does, so features turn with it", () => {
    // A rearing quadruped, a diving bird and a coiling snake all change the
    // direction their body faces; identity layers rotate by exactly that.
    for (const archetype of ["quadruped_medium", "winged", "serpentine"]) {
      const cast = SPRITE_ANCHORS[archetype][SHEET_CLIPS.CAST.row];
      const angles = cast.filter(Boolean).map((a) => a!.head[2]);
      const spread = Math.max(...angles) - Math.min(...angles);
      expect(spread, `${archetype} never turns`).toBeGreaterThan(0.05);
    }
  });

  it("keeps every reported angle a real number within a turn", () => {
    for (const archetype of DRAWN_ARCHETYPES) {
      for (const row of SPRITE_ANCHORS[archetype]) {
        for (const anchor of row) {
          if (!anchor) continue;
          for (const angle of [anchor.head[2], anchor.back[2], anchor.body[2]]) {
            expect(Number.isFinite(angle)).toBe(true);
            expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI * 2);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A real 5v5
// ---------------------------------------------------------------------------

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

const ROSTER_A = [
  "animals-lion", "animals-tiger", "animals-wolf",
  "animals-leopard", "animals-spotted-hyena",
];
const ROSTER_B = [
  "animals-jaguar", "animals-cheetah", "animals-grizzly-bear",
  "animals-polar-bear", "animals-wild-boar",
];

const context: ReplayContext = {
  battleId: "pixel",
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

describe("nobody in a battle looks like anybody else", () => {
  const replay = replayOf("pixel-1");
  const roster = replay.combatants.map((c) => {
    const character = CHARACTERS_BY_ID[c.characterId];
    const archetype = visualArchetypeFor(character);
    return {
      characterId: c.characterId,
      archetype,
      config: identityFor(character, archetype),
    };
  });

  it("separates any pair that collided, deterministically", () => {
    const separated = disambiguate(roster);
    const signatures = [...separated.values()].map((c) => identitySignature(c));
    expect(new Set(signatures).size).toBe(10);
    expect(disambiguate(roster)).toEqual(separated);
  });

  it("leaves an already-distinct roster untouched", () => {
    const separated = disambiguate(roster);
    for (const entry of roster) {
      const before = identitySignature(entry.config, entry.archetype);
      const others = roster
        .filter((r) => r !== entry)
        .map((r) => identitySignature(r.config, r.archetype));
      if (others.includes(before)) continue;
      expect(identitySignature(separated.get(entry.characterId)!, entry.archetype)).toBe(before);
    }
  });

  it("separates a roster that is deliberately all the same", () => {
    // Ten copies of one configuration is the worst case the nudges have to
    // handle, and the only way to know the ladder is deep enough.
    const clone = roster[0].config;
    const identical = Array.from({ length: 10 }, (_, i) => ({
      characterId: `clone-${i}`,
      config: { ...clone },
    }));
    const separated = disambiguate(identical);
    const signatures = [...separated.values()].map((c) => identitySignature(c));
    expect(new Set(signatures).size).toBe(10);
  });
});

describe("particles are a function of the clock, not of what was drawn", () => {
  const replay = replayOf("pixel-2");

  it("shows the same sparks after scrubbing away and back", () => {
    // The renderer used to own a pool and emit into it while drawing, so this
    // was the last thing about a frame that depended on how you got there.
    const at = (t: number) => sceneAt(replay, t).particles;
    const before = at(12_000);
    at(30_000);
    at(4_000);
    expect(at(12_000)).toEqual(before);
  });

  it("throws sparks on the loud events and on nothing else", () => {
    let sawSparks = 0;
    for (let t = 0; t <= replay.durationMs; t += 60) {
      if (sceneAt(replay, t).particles.length > 0) sawSparks++;
    }
    expect(sawSparks).toBeGreaterThan(0);

    // Quiet stretches exist: sparks are a punctuation mark, not a background.
    const frames = Math.floor(replay.durationMs / 60);
    expect(sawSparks).toBeLessThan(frames * 0.6);
  });

  it("clears them away rather than letting them pile up", () => {
    const counts: number[] = [];
    for (let t = 0; t <= replay.durationMs; t += 40) {
      counts.push(sceneAt(replay, t).particles.length);
    }
    // A pool that leaked would trend upward; a projection cannot.
    expect(Math.max(...counts)).toBeLessThan(120);
    expect(counts[counts.length - 1]).toBe(0);
  });

  it("fades every spark out instead of cutting it off", () => {
    for (let t = 0; t <= replay.durationMs; t += 90) {
      for (const p of sceneAt(replay, t).particles) {
        expect(p.alpha).toBeGreaterThan(0);
        expect(p.alpha).toBeLessThanOrEqual(1);
        expect(p.size).toBeGreaterThan(0);
      }
    }
  });
});

describe("the whole scene still rewinds exactly", () => {
  const replay = replayOf("pixel-3");

  it("is identical forwards and backwards, sparks included", () => {
    const times = [0, 3000, 9000, 18_000, 27_000, replay.durationMs];
    const forwards = times.map((t) => sceneAt(replay, t));
    const backwards = [...times].reverse().map((t) => sceneAt(replay, t)).reverse();
    expect(backwards).toEqual(forwards);
  });

  it("does not drift when the same moment is asked for repeatedly", () => {
    for (let i = 0; i < 20; i++) {
      expect(sceneAt(replay, 11_111)).toEqual(sceneAt(replay, 11_111));
    }
  });
});

describe("markings follow the body rather than sitting on top of it", () => {
  const tiger = CHARACTERS.find((c) => c.id === "animals-tiger")!;
  const anaconda = CHARACTERS.find((c) => c.id === "animals-green-anaconda")!;

  /** Where a marking's pixels are, relative to the body's own pixels. */
  const markPositions = (character: typeof tiger, animation: AnimationHint, frame: number) => {
    const archetype = visualArchetypeFor(character);
    return SPRITE_ANCHORS[archetype][SHEET_CLIPS[animation].row][frame]!.marks;
  };

  it("stamps a marking once per flank point, not once per character", () => {
    // A single pattern tile could never bend; several small marks can.
    expect(markPositions(tiger, "IDLE", 0).length).toBeGreaterThanOrEqual(3);
    expect(IDENTITY_TILE_SLOTS.STRIPES.slot).toBe("mark");
    expect(IDENTITY_TILE_SLOTS.BANDS.slot).toBe("mark");
  });

  it("moves the marks when the body moves", () => {
    const still = markPositions(tiger, "IDLE", 0);
    const rearing = markPositions(tiger, "CAST", 3);
    const moved = still.some(
      (m, i) => Math.abs(m[0] - rearing[i][0]) > 0.5 || Math.abs(m[1] - rearing[i][1]) > 0.5,
    );
    expect(moved, "marks stayed put while the body reared").toBe(true);
  });

  it("turns the marks when the body turns", () => {
    const rearing = markPositions(tiger, "CAST", 3);
    const still = markPositions(tiger, "IDLE", 0);
    expect(
      Math.abs(rearing[0][2] - still[0][2]),
      "marks kept the same angle through a rear",
    ).toBeGreaterThan(0.05);
  });

  it("follows a snake around its own curve", () => {
    // The serpent samples its marks from the curve it was drawn along, so the
    // angles differ *along the body* rather than all pointing one way.
    const marks = markPositions(anaconda, "CAST", 3);
    const angles = marks.map((m) => m[2]);
    const spread = Math.max(...angles) - Math.min(...angles);
    expect(spread, "a coiled snake's marks all pointed the same way").toBeGreaterThan(0.2);
  });

  it("changes the drawn pixels when the pose changes", () => {
    // End to end: the composed sprite differs, not just the anchor table.
    const a = fingerprint(rasterise(tiger, "IDLE", 0));
    const b = fingerprint(rasterise(tiger, "CAST", 3));
    expect(a).not.toBe(b);
  });
});
