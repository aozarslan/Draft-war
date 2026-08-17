/**
 * ---------------------------------------------------------------------------
 * SPRITE GENERATOR (offline)
 * ---------------------------------------------------------------------------
 *   npm run sprites
 *
 * Draws the `quadruped_medium` sheet and writes it to `public/sprites/`.
 *
 * Three decisions worth defending:
 *
 * **The artwork is code.** A pixel sprite is a small grid of numbers, so
 * authoring it as a program costs little and buys a lot: it diffs, it reviews,
 * a pose can be retimed without redrawing 29 frames, and every frame is
 * guaranteed to sit exactly where the manifest says it does. It also makes the
 * art unambiguously original — nothing is traced, sampled or scraped.
 *
 * **It runs offline and commits its output.** Nothing generates artwork during
 * a match. The PNG is a build artefact checked into the repository, so the game
 * loads a static file and a reviewer can look at what shipped.
 *
 * **No dependencies.** A PNG is a header, a zlib stream and a checksum, all of
 * which Node already has. Adding an image library to draw 200×224 pixels would
 * cost more than writing the encoder.
 *
 * The silhouette is a generic four-legged animal, not any particular one. One
 * sheet serves every quadruped in the catalogue; the renderer tints it with the
 * character's own palette, so a lion and a wolf are the same body in different
 * colours. That is the trade V5 accepts to have any animation at all before
 * there is a budget for 268 hand-drawn characters.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  FRAME_SIZE,
  SHEET_CLIPS,
  SHEET_COLUMNS,
  SHEET_GROUND_RATIO,
  SHEET_ROWS,
} from "../src/lib/render/archetypes";
import type { AnimationHint } from "../src/lib/game/replay";

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
// Canvas
// ---------------------------------------------------------------------------

/**
 * Greyscale tones.
 *
 * The sheet is drawn without colour on purpose: the renderer multiplies the
 * character's palette over it, so one sheet becomes every animal. Values are
 * chosen so the outline stays dark after multiplying and the highlight still
 * reads once it is tinted.
 */
const OUTLINE = 46;
const SHADE = 122;
const BASE = 178;
const LIGHT = 224;

class Pixels {
  readonly data: Uint8Array;

  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, tone: number, alpha = 255): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const i = (py * this.width + px) * 4;
    this.data[i] = tone;
    this.data[i + 1] = tone;
    this.data[i + 2] = tone;
    this.data[i + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, tone: number, alpha = 255): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, tone, alpha);
    }
  }

  /** Filled ellipse, the workhorse: a body, a head and a haunch are all ovals. */
  ellipse(cx: number, cy: number, rx: number, ry: number, tone: number, alpha = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, tone, alpha);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, tone: number, thickness = 1, alpha = 255): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (thickness <= 1) this.set(x, y, tone, alpha);
      else this.rect(x - (thickness - 1) / 2, y - (thickness - 1) / 2, thickness, thickness, tone, alpha);
    }
  }

  /** Traces a one-pixel dark edge around everything opaque. */
  outline(tone = OUTLINE): void {
    const alpha = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height
        ? 0
        : this.data[(y * this.width + x) * 4 + 3];

    const edges: [number, number][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (alpha(x, y) !== 0) continue;
        if (alpha(x - 1, y) || alpha(x + 1, y) || alpha(x, y - 1) || alpha(x, y + 1)) {
          edges.push([x, y]);
        }
      }
    }
    for (const [x, y] of edges) this.set(x, y, tone);
  }

  blit(target: Pixels, atX: number, atY: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        if (this.data[i + 3] === 0) continue;
        const j = ((atY + y) * target.width + atX + x) * 4;
        target.data[j] = this.data[i];
        target.data[j + 1] = this.data[i + 1];
        target.data[j + 2] = this.data[i + 2];
        target.data[j + 3] = this.data[i + 3];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The animal
// ---------------------------------------------------------------------------

/**
 * A pose is the whole vocabulary of this body.
 *
 * Animation is a function from frame to pose, which is why retiming a clip is
 * an edit to a few numbers rather than a redraw. Distances are in pixels within
 * a 32×32 frame; the animal faces right.
 */
interface Pose {
  /** Whole-body forward offset. A lunge moves the animal, not just its neck. */
  push: number;
  /** Whole-body vertical offset. Negative is up. */
  lift: number;
  /** Forward lean, in pixels of shear at the shoulder. */
  lean: number;
  /** Rear-up: how far the front of the body rises above the back. */
  rear: number;
  /** Head offset from its rest position. */
  headX: number;
  headY: number;
  /** Per-leg vertical lift: [front-far, front-near, back-far, back-near]. */
  legs: [number, number, number, number];
  tail: number;
  /** 0 = standing, 1 = flat on the ground. */
  collapse: number;
  /** Mouth opening, 0..1. */
  jaw: number;
}

const REST: Pose = {
  push: 0, lift: 0, lean: 0, rear: 0, headX: 0, headY: 0,
  legs: [0, 0, 0, 0], tail: 0, collapse: 0, jaw: 0,
};

/** The draw layer anchors sprites here, so the generator must stand on it. */
const GROUND = Math.round(SHEET_GROUND_RATIO * FRAME_SIZE);

function drawAnimal(pose: Pose): Pixels {
  const cell = new Pixels(FRAME_SIZE, FRAME_SIZE);
  const collapse = Math.min(1, Math.max(0, pose.collapse));

  // `push` shifts the whole animal, so every coordinate below is written in
  // rest space and moved once, here. Without it a lunge stretches the neck and
  // the animal reads as a giraffe rather than as something charging.
  const p = {
    set: (x: number, y: number, tone: number, alpha?: number) =>
      cell.set(x + pose.push, y, tone, alpha),
    rect: (x: number, y: number, w: number, h: number, tone: number, alpha?: number) =>
      cell.rect(x + pose.push, y, w, h, tone, alpha),
    ellipse: (cx: number, cy: number, rx: number, ry: number, tone: number, alpha?: number) =>
      cell.ellipse(cx + pose.push, cy, rx, ry, tone, alpha),
    line: (
      x0: number, y0: number, x1: number, y1: number,
      tone: number, thickness?: number, alpha?: number,
    ) => cell.line(x0 + pose.push, y0, x1 + pose.push, y1, tone, thickness, alpha),
  };

  // Collapsing rotates the animal onto its side: the body drops to the ground
  // and flattens, rather than being redrawn from scratch.
  const drop = collapse * 2.5;
  const squash = 1 - collapse * 0.45;

  const bodyCy = 18 + pose.lift + drop;
  const bodyRx = 7;
  const bodyRy = 4.2 * squash;

  // Shoulder height differs from hip height when leaning or rearing up.
  const frontY = bodyCy - pose.rear;
  const backY = bodyCy + pose.rear * 0.3;

  // Legs first, so the body overlaps them and reads as in front.
  const legTops: [number, number, number, number] = [20, 19, 12, 11];
  for (let i = 0; i < 4; i++) {
    const x = legTops[i];
    const isFront = i < 2;
    const top = (isFront ? frontY : backY) + 2;
    // Two rows up from the line, because the leg is drawn with a two-pixel
    // brush and then outlined. Standing the foot *on* the line puts the hooves
    // two rows under it, and the renderer anchors the sprite there — so the
    // whole animal ends up buried to the ankles.
    const foot = GROUND - 2 - pose.legs[i] - drop * 1.6;
    const tone = i % 2 === 0 ? SHADE : BASE;
    if (collapse > 0.6) {
      // Lying down: legs fold forward instead of standing.
      p.line(x, top, x + 4 + i, top - 1, tone, 2);
    } else {
      const knee = (top + foot) / 2;
      p.line(x, top, x + pose.lean * 0.4, knee, tone, 2);
      p.line(x + pose.lean * 0.4, knee, x + pose.lean * 0.6, foot, tone, 2);
      p.rect(x + pose.lean * 0.6 - 1, foot, 3, 1, tone);
    }
  }

  // Haunch, body, chest.
  p.ellipse(11, backY, 5, bodyRy + 0.4, SHADE);
  p.ellipse(16, bodyCy, bodyRx, bodyRy, BASE);
  p.ellipse(20, frontY, 4.6, bodyRy, BASE);
  // A lighter band along the spine gives the tint something to shade against.
  p.ellipse(16, bodyCy - 1.4, bodyRx - 1.5, bodyRy - 2.2, LIGHT);

  // Tail: a curve whose sweep is the pose's only free parameter.
  const tailBase = { x: 7, y: backY - 1 };
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    p.set(
      tailBase.x - t * 5,
      tailBase.y - Math.sin(t * 2.2 + pose.tail) * 3 - t * 1.5,
      i > 4 ? LIGHT : SHADE,
    );
  }

  // Neck and head.
  const headX = 24 + pose.headX;
  const headY = frontY - 5 + pose.headY + drop * 0.6;
  p.line(21, frontY - 2, headX - 1, headY + 1, BASE, 3);
  p.ellipse(headX, headY, 3.4, 3, BASE);
  p.ellipse(headX + 0.6, headY - 1, 2.4, 1.6, LIGHT);

  // Muzzle, jaw, ear, eye — the four marks that make it an animal and not a
  // bean. The jaw opens on bites and roars.
  // The jaw drops as a separate lower half rather than a dark rectangle over
  // the face — the rectangle read as an eye patch at this size.
  const jaw = pose.jaw * 2;
  p.ellipse(headX + 3.4, headY + 0.2, 2.2, 1.4, BASE);
  if (jaw > 0.5) {
    p.ellipse(headX + 3.2, headY + 1 + jaw, 2, 1.1, SHADE);
    p.line(headX + 1.6, headY + 1.2, headX + 4.4, headY + 0.8 + jaw * 0.6, OUTLINE);
  }
  p.line(headX - 2, headY - 3, headX - 3, headY - 5.5, BASE, 2);
  p.set(headX + 1.4, headY - 0.6, OUTLINE);

  cell.outline();
  return cell;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Eased 0..1 across a clip, so poses can be written as keyframes. */
const wave = (t: number) => Math.sin(t * Math.PI);

const CLIP_POSES: Record<AnimationHint, (t: number, frame: number) => Pose> = {
  // Breathing. The amplitude has to clear a whole pixel or rounding eats the
  // animation entirely and all four frames come out identical.
  IDLE: (t) => ({
    ...REST,
    lift: Math.sin(t * Math.PI * 2) * 1.1,
    tail: Math.sin(t * Math.PI * 2) * 1.2,
    headY: Math.sin(t * Math.PI * 2 + 1.2) * 1.1,
  }),

  // Crouch, spring, bite, land. The lean carries the whole read: without it a
  // lunge looks like a hop.
  ATTACK: (t) => {
    const wind = t < 0.3 ? t / 0.3 : 0;
    const strike = t >= 0.3 && t < 0.65 ? (t - 0.3) / 0.35 : t >= 0.65 ? 1 : 0;
    const recover = t >= 0.65 ? (t - 0.65) / 0.35 : 0;
    return {
      ...REST,
      // The body travels; the head only leads it by a pixel or two.
      push: -wind * 1.5 + strike * 4.5 - recover * 2,
      lift: -wind * 1 + wave(strike) * -2.4 + recover * 0.8,
      lean: wind * -1.5 + strike * 3 - recover * 1.5,
      headX: wind * -1 + strike * 1.5 - recover * 0.8,
      headY: wind * -1 + strike * 2 - recover * 1,
      legs: [wave(strike) * 3, wave(strike) * 3.6, wave(strike) * 1.4, wave(strike) * 1],
      tail: -0.8 + strike * 1.6,
      jaw: strike > 0.15 && recover < 0.6 ? 1 : 0,
    };
  },

  // Rearing up and roaring: the special. Front legs leave the ground entirely.
  CAST: (t) => {
    const rise = Math.min(1, t / 0.45);
    const hold = t > 0.45 ? 1 : 0;
    const fall = t > 0.8 ? (t - 0.8) / 0.2 : 0;
    const up = rise - fall;
    return {
      ...REST,
      rear: up * 5.5,
      lift: -up * 1.5,
      headY: -up * 3,
      headX: -up * 1,
      push: -up * 1.5,
      legs: [up * 6, up * 7, 0, 0],
      tail: up * 1.4,
      jaw: hold && !fall ? 1 : 0.3 * up,
    };
  },

  // Bracing: low, leaning back, head tucked behind the shoulder. The crouch is
  // shallow because the legs are only six pixels long — any deeper and the
  // animal loses them entirely and reads as a blob.
  GUARD: (t) => {
    const set = Math.min(1, t / 0.4);
    return {
      ...REST,
      push: -set * 1.5,
      lift: set * 1.2,
      lean: -set * 1.6,
      headX: -set * 2,
      headY: set * 1.5,
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
    legs: [0, 0, wave(t) * 1.5, wave(t) * 1.2],
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
      legs: [0, 0, 0, 0],
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
      legs: [hop * 2.5, hop * 3, hop * 2, hop * 2.5],
      tail: hop * 1.6,
      jaw: 0.6,
    };
  },

  NONE: () => REST,
};

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

function buildSheet(): Buffer {
  const sheet = new Pixels(SHEET_COLUMNS * FRAME_SIZE, SHEET_ROWS * FRAME_SIZE);

  for (const [hint, clip] of Object.entries(SHEET_CLIPS) as [AnimationHint, typeof SHEET_CLIPS[AnimationHint]][]) {
    // NONE shares IDLE's row; drawing it twice would only overwrite identically.
    if (hint === "NONE") continue;

    for (let frame = 0; frame < clip.frames; frame++) {
      // A looping clip samples across the full cycle without repeating the
      // first pose at the end; a one-shot runs all the way to its final pose.
      const t = clip.loop ? frame / clip.frames : frame / Math.max(1, clip.frames - 1);
      const cell = drawAnimal(CLIP_POSES[hint](t, frame));
      cell.blit(sheet, frame * FRAME_SIZE, clip.row * FRAME_SIZE);
    }
  }

  return encodePng(sheet.width, sheet.height, sheet.data);
}

const target = resolve(process.cwd(), "public/sprites/quadruped_medium.png");
mkdirSync(dirname(target), { recursive: true });
const png = buildSheet();
writeFileSync(target, png);

console.log(
  `quadruped_medium.png — ${SHEET_COLUMNS * FRAME_SIZE}×${SHEET_ROWS * FRAME_SIZE}, ` +
    `${SHEET_ROWS} clips, ${(png.length / 1024).toFixed(1)} kB`,
);
console.log(`written to ${target}`);
