/**
 * ---------------------------------------------------------------------------
 * SPRITE GENERATOR (offline)
 * ---------------------------------------------------------------------------
 *   npm run sprites
 *
 * Draws every body plan in `scripts/sprite-bodies.ts` and writes one sheet per
 * archetype into `public/sprites/`.
 *
 * Three decisions worth defending:
 *
 * **The artwork is code.** A pixel sprite is a small grid of numbers, so
 * authoring it as a program costs little and buys a lot: it diffs, it reviews,
 * a pose can be retimed across all six bodies at once, and every frame is
 * guaranteed to sit exactly where the manifest says it does. It also makes the
 * art unambiguously original — nothing is traced, sampled or scraped.
 *
 * **It runs offline and commits its output.** Nothing generates artwork during
 * a match. The PNGs are build artefacts checked into the repository, so the
 * game loads static files and a reviewer can look at what shipped.
 *
 * **No dependencies.** A PNG is a header, a zlib stream and a checksum, all of
 * which Node already has. Adding an image library to draw 192×224 pixels would
 * cost more than writing the encoder.
 *
 * The clips below are written once and every body interprets them through its
 * own anatomy, which is what keeps six archetypes moving in step.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DRAWN_ARCHETYPES,
  FRAME_SIZE,
  SHEET_CLIPS,
  SHEET_COLUMNS,
  SHEET_GROUND_RATIO,
  SHEET_ROWS,
} from "../src/lib/render/archetypes";
import type { AnimationHint } from "../src/lib/game/replay";
import {
  BODIES,
  IDENTITY_TILES,
  Pixels,
  REST,
  TILE,
  type BodyAnchors,
  type BodyId,
  type Pose,
} from "./sprite-bodies";

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  // Filter byte 0 (none) per scanline: the images are tiny and mostly
  // transparent, so a smarter filter would save bytes nobody would notice.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Eased 0..1 across a beat, so poses can be written as keyframes. */
const wave = (t: number) => Math.sin(t * Math.PI);

const CLIP_POSES: Record<AnimationHint, (t: number) => Pose> = {
  // Breathing. The amplitude has to clear a whole pixel or rounding eats the
  // animation entirely and every frame comes out identical.
  IDLE: (t) => ({
    ...REST,
    lift: Math.sin(t * Math.PI * 2) * 1.1,
    tail: Math.sin(t * Math.PI * 2) * 1.2,
    headY: Math.sin(t * Math.PI * 2 + 1.2) * 1.1,
    limbs: [Math.sin(t * Math.PI * 2) * 0.6, 0, 0, 0],
  }),

  // Wind up, spring, strike, land. The body travels; the head only leads it.
  ATTACK: (t) => {
    const wind = t < 0.3 ? t / 0.3 : 0;
    const strike = t >= 0.3 && t < 0.65 ? (t - 0.3) / 0.35 : t >= 0.65 ? 1 : 0;
    const recover = t >= 0.65 ? (t - 0.65) / 0.35 : 0;
    return {
      ...REST,
      // Small on purpose. The renderer already translates the whole sprite on
      // an attack (`lunge` in scene.ts); baking the travel in as well applied
      // it twice and shoved the head out through the edge of its own frame.
      // The sheet supplies the wind-up and the weight shift, not the distance.
      push: -wind * 1.5 + strike * 1.2 - recover * 0.6,
      lift: -wind * 1 + wave(strike) * -2.4 + recover * 0.8,
      lean: wind * -1.5 + strike * 3 - recover * 1.5,
      rear: wind * 2 - strike * 2,
      headX: wind * -1 + strike * 1.5 - recover * 0.8,
      headY: wind * -1 + strike * 2 - recover * 1,
      limbs: [
        wave(strike) * 3, wave(strike) * 3.6,
        wave(strike) * 1.4, wave(strike) * 1,
      ],
      tail: -0.8 + strike * 1.6,
      jaw: strike > 0.15 && recover < 0.6 ? 1 : 0,
    };
  },

  // Rearing up and roaring: the special. Reads as a coil on a snake, a
  // wing-spread on a bird and a breach on a swimmer.
  CAST: (t) => {
    const rise = Math.min(1, t / 0.45);
    const hold = t > 0.45;
    const fall = t > 0.8 ? (t - 0.8) / 0.2 : 0;
    const up = rise - fall;
    return {
      ...REST,
      rear: up * 5.5,
      lift: -up * 1.5,
      headY: -up * 3,
      headX: -up * 1,
      push: -up * 1.5,
      limbs: [up * 6, up * 7, 0, 0],
      tail: up * 1.4,
      jaw: hold && fall === 0 ? 1 : 0.3 * up,
    };
  },

  // Bracing: low, leaning back, head tucked behind the shoulder. The crouch is
  // shallow because a leg is only six pixels long.
  GUARD: (t) => {
    const set = Math.min(1, t / 0.4);
    return {
      ...REST,
      push: -set * 1.5,
      lift: set * 1.2,
      lean: -set * 1.6,
      rear: -set * 1.2,
      headX: -set * 2,
      headY: set * 1.5,
      limbs: [set * 2, set * 1.5, 0, 0],
      tail: -set * 1.2,
    };
  },

  // Taking a hit: thrown back, head up, then a half recovery.
  IMPACT: (t) => ({
    ...REST,
    push: -3 * (1 - t),
    lift: -wave(t) * 1.2,
    lean: -3 * (1 - t),
    headX: -1 * (1 - t),
    headY: -1.5 * (1 - t),
    limbs: [0, 0, wave(t) * 1.5, wave(t) * 1.2],
    tail: -1.5,
    jaw: 1 - t,
  }),

  // Buckling, then down. Split so the fall reads as a fall and not a fade.
  DEATH: (t) => {
    const buckle = Math.min(1, t / 0.35);
    const fall = t > 0.35 ? (t - 0.35) / 0.65 : 0;
    return {
      ...REST,
      lift: buckle * 2 + fall * 1.5,
      lean: -buckle * 2,
      // The head comes to rest *on* the ground, not through it.
      headY: buckle * 2 + fall * 1.5,
      headX: -buckle * 1 - fall * 2,
      tail: -0.6 - fall,
      collapse: fall,
      jaw: 0.4 * (1 - fall),
    };
  },

  // A victory bounce.
  CHEER: (t) => {
    const hop = Math.abs(Math.sin(t * Math.PI * 2));
    return {
      ...REST,
      lift: -hop * 2.5,
      headY: -hop * 1.5 - 0.5,
      rear: hop * 1.5,
      limbs: [hop * 2.5, hop * 3, hop * 2, hop * 2.5],
      tail: hop * 1.6,
      jaw: 0.6,
    };
  },

  NONE: () => REST,
};

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

/** Anchors for one archetype, indexed [clip row][frame]. */
type AnchorGrid = (BodyAnchors | null)[][];

function buildSheet(body: BodyId): { png: Buffer; anchors: AnchorGrid } {
  const draw = BODIES[body];
  const sheet = new Pixels(SHEET_COLUMNS * FRAME_SIZE, SHEET_ROWS * FRAME_SIZE);
  const anchors: AnchorGrid = Array.from({ length: SHEET_ROWS }, () =>
    Array.from({ length: SHEET_COLUMNS }, () => null),
  );

  for (const [hint, clip] of Object.entries(SHEET_CLIPS) as [AnimationHint, typeof SHEET_CLIPS[AnimationHint]][]) {
    // NONE shares IDLE's row; drawing it twice would only overwrite identically.
    if (hint === "NONE") continue;

    for (let frame = 0; frame < clip.frames; frame++) {
      // A looping clip samples across the full cycle without repeating the
      // first pose at the end; a one-shot runs all the way to its final pose.
      const t = clip.loop ? frame / clip.frames : frame / Math.max(1, clip.frames - 1);
      const cell = new Pixels(FRAME_SIZE, FRAME_SIZE);
      anchors[clip.row][frame] = draw(cell, CLIP_POSES[hint](t));
      cell.outline();
      cell.blit(sheet, frame * FRAME_SIZE, clip.row * FRAME_SIZE);
    }
  }

  return { png: encodePng(sheet.width, sheet.height, sheet.data), anchors };
}

/**
 * The identity tiles, one per row of a single narrow sheet.
 *
 * One sheet for every body plan rather than one per plan per feature: a tile
 * is stamped at an anchor the body reports, so it does not need to know which
 * body it is sitting on.
 */
function buildTiles(): Buffer {
  const sheet = new Pixels(TILE, IDENTITY_TILES.length * TILE);
  IDENTITY_TILES.forEach((tile, row) => {
    const cell = new Pixels(TILE, TILE);
    tile.draw(cell);
    cell.outline();
    cell.blit(sheet, 0, row * TILE);
  });
  return encodePng(sheet.width, sheet.height, sheet.data);
}

let total = 0;
const allAnchors: Record<string, AnchorGrid> = {};

for (const archetype of DRAWN_ARCHETYPES) {
  const { png, anchors } = buildSheet(archetype as BodyId);
  const target = resolve(process.cwd(), `public/sprites/${archetype}.png`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, png);
  allAnchors[archetype] = anchors;
  total += png.length;
  console.log(`${archetype.padEnd(18)} ${(png.length / 1024).toFixed(1)} kB`);
}

const tiles = buildTiles();
writeFileSync(resolve(process.cwd(), "public/sprites/identity.png"), tiles);
total += tiles.length;
console.log(`${"identity tiles".padEnd(18)} ${(tiles.length / 1024).toFixed(1)} kB`);

// Anchors travel as code rather than as a fetched JSON: they are needed on the
// very first frame, and a sprite whose horns arrive a moment after its head is
// worse than one with no horns at all.
const round = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const anchorSource = `/**
 * GENERATED by scripts/generate-sprites.ts — do not edit.
 *
 * Where each identity layer attaches, per archetype, per clip row, per frame,
 * in frame pixels. Emitted by the same pass that draws the bodies, from the
 * values those bodies actually used, so a horn cannot drift from its skull.
 */

/** A point on the body and the direction the body faces there, in radians. */
export type Anchor = [x: number, y: number, angle: number];

export interface FrameAnchors {
  head: Anchor;
  back: Anchor;
  body: Anchor;
  /** Where a held prop sits, reported per frame so it follows the pose. */
  hand: Anchor;
  /** Where a prop resting on the ground sits — a football, not a sword. */
  foot: Anchor;
  /** Flank points, tail to shoulder, for markings that follow the body. */
  marks: Anchor[];
}

export const SPRITE_ANCHORS: Record<string, (FrameAnchors | null)[][]> = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(allAnchors).map(([id, grid]) => [
      id,
      grid.map((row) =>
        row.map((a) =>
          a
            ? {
                head: [round(a.head.x), round(a.head.y), round3(a.head.angle)],
                back: [round(a.back.x), round(a.back.y), round3(a.back.angle)],
                body: [round(a.body.x), round(a.body.y), round3(a.body.angle)],
                hand: [round(a.hand.x), round(a.hand.y), round3(a.hand.angle)],
                foot: [round(a.foot.x), round(a.foot.y), round3(a.foot.angle)],
                marks: a.marks.map(
                  (m) => [round(m.x), round(m.y), round3(m.angle)] as [number, number, number],
                ),
              }
            : null,
        ),
      ),
    ]),
  ),
  null,
  2,
)};

/** The identity tiles, in the order they appear down the tile sheet. */
export const IDENTITY_TILE_ROWS: string[] = ${JSON.stringify(
  IDENTITY_TILES.map((t) => t.id),
)};

/** Which anchor each tile attaches to, and where its own pivot sits. */
export const IDENTITY_TILE_SLOTS: Record<string, { slot: string; pivot: [number, number] }> = ${JSON.stringify(
  Object.fromEntries(
    IDENTITY_TILES.map((t) => [t.id, { slot: t.slot, pivot: [t.pivot.x, t.pivot.y] }]),
  ),
  null,
  2,
)};

export const IDENTITY_TILE_SIZE = ${TILE};
`;
writeFileSync(resolve(process.cwd(), "src/lib/render/anchors.generated.ts"), anchorSource);
console.log("anchors            src/lib/render/anchors.generated.ts");

console.log(
  `\n${DRAWN_ARCHETYPES.length} sheets, ${SHEET_COLUMNS * FRAME_SIZE}×${SHEET_ROWS * FRAME_SIZE} each, ` +
    `${SHEET_ROWS} clips, ${(total / 1024).toFixed(1)} kB total ` +
    `(ground line at ${Math.round(SHEET_GROUND_RATIO * FRAME_SIZE)})`,
);
