import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import {
  FRAME_SIZE,
  SHEET_CLIPS,
  visualArchetypeFor,
  type VisualArchetypeId,
} from "../../src/lib/render/archetypes";
import {
  IDENTITY_TILE_ROWS,
  IDENTITY_TILE_SIZE,
  IDENTITY_TILE_SLOTS,
  SPRITE_ANCHORS,
} from "../../src/lib/render/anchors.generated";
import { identityFor, type IdentityConfig } from "../../src/lib/render/identity";
import type { AnimationHint } from "../../src/lib/game/replay";
import type { Character } from "../../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * A software rasteriser, for measuring what actually gets drawn.
 * ---------------------------------------------------------------------------
 * Identity used to be measured by comparing `identitySignature` strings, which
 * answers a different question: two characters can share a signature and still
 * be drawn differently — different palettes, different archetypes — and two
 * distinct signatures can land on the same pixels. The only honest measure of
 * "can you tell these apart" is the pixels.
 *
 * There is no canvas in a Node test, so this composes the same layers the
 * renderer does — the tinted body frame, then the identity tiles at the
 * anchors the generator emitted — into a small buffer. It is not a second
 * renderer: it reads the same sheets, the same anchors and the same
 * configuration, and it exists to be hashed rather than looked at. Where it
 * deliberately simplifies (no sub-pixel rotation, no camera) it is noted.
 */

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8Array;
}

function decodePng(path: string): Raster {
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
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const from = y * (stride + 1) + 1;
    data.set(raw.subarray(from, from + stride), y * stride);
  }
  return { width, height, data };
}

const sheets = new Map<string, Raster>();
function sheet(archetype: string): Raster | null {
  if (!sheets.has(archetype)) {
    try {
      sheets.set(archetype, decodePng(resolve(process.cwd(), `public/sprites/${archetype}.png`)));
    } catch {
      return null;
    }
  }
  return sheets.get(archetype) ?? null;
}

const tiles = decodePng(resolve(process.cwd(), "public/sprites/identity.png"));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Multiply, the same blend the renderer's tint uses. */
const multiply = (a: number, b: number) => Math.round((a * b) / 255);

/**
 * Composes one character, in one frame, exactly as the renderer layers it.
 *
 * The archetype sheet is tinted by the palette top-to-bottom, then each
 * identity tile is stamped at its anchor, flat-tinted by the accent. Rotation
 * is applied by rounding to the nearest pixel rather than sampling — the point
 * is to know whether two characters differ, and a rotated tile that lands on
 * different pixels differs whichever way it was sampled.
 */
export function rasterise(
  character: Character,
  animation: AnimationHint = "IDLE",
  frame = 0,
  overrideIdentity?: IdentityConfig,
): Raster {
  const archetype: VisualArchetypeId = visualArchetypeFor(character);
  const identity = overrideIdentity ?? identityFor(character, archetype);
  const clip = SHEET_CLIPS[animation];

  const out: Raster = {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    data: new Uint8Array(FRAME_SIZE * FRAME_SIZE * 4),
  };

  // The body, tinted by the character's palette exactly as `tintSheet` does:
  // a vertical gradient across one frame, multiplied through the greyscale.
  const source = sheet(archetype) ?? sheet(archetype.replace(/_(large)$/, "_medium"));
  if (source) {
    const [r1, g1, b1] = hexToRgb(identityPalette(character)[1]);
    const [r0, g0, b0] = hexToRgb(identityPalette(character)[0]);
    for (let y = 0; y < FRAME_SIZE; y++) {
      const t = y / (FRAME_SIZE - 1);
      const tr = Math.round(r1 + (r0 - r1) * t);
      const tg = Math.round(g1 + (g0 - g1) * t);
      const tb = Math.round(b1 + (b0 - b1) * t);

      for (let x = 0; x < FRAME_SIZE; x++) {
        const sx = frame * FRAME_SIZE + x;
        const sy = clip.row * FRAME_SIZE + y;
        if (sx >= source.width || sy >= source.height) continue;
        const si = (sy * source.width + sx) * 4;
        const alpha = source.data[si + 3];
        if (alpha === 0) continue;

        const di = (y * FRAME_SIZE + x) * 4;
        out.data[di] = multiply(source.data[si], tr);
        out.data[di + 1] = multiply(source.data[si + 1], tg);
        out.data[di + 2] = multiply(source.data[si + 2], tb);
        out.data[di + 3] = alpha;
      }
    }
  }

  // Identity tiles, flat-tinted by the accent, at the anchors the body gave.
  const anchors = SPRITE_ANCHORS[archetype]?.[clip.row]?.[frame];
  if (anchors) {
    const [ar, ag, ab] = hexToRgb(identity.accent);
    const stamp = (feature: string, anchor: readonly number[], scale: number) => {
      const meta = IDENTITY_TILE_SLOTS[feature];
      const rowIndex = IDENTITY_TILE_ROWS.indexOf(feature);
      if (!meta || rowIndex < 0) return;

      const angle = anchor[2] ?? 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      for (let ty = 0; ty < IDENTITY_TILE_SIZE; ty++) {
        for (let tx = 0; tx < IDENTITY_TILE_SIZE; tx++) {
          const si = ((rowIndex * IDENTITY_TILE_SIZE + ty) * tiles.width + tx) * 4;
          const alpha = tiles.data[si + 3];
          if (alpha === 0) continue;

          const localX = (tx - meta.pivot[0]) * scale;
          const localY = (ty - meta.pivot[1]) * scale;
          const x = Math.round(anchor[0] + localX * cos - localY * sin);
          const y = Math.round(anchor[1] + localX * sin + localY * cos);
          if (x < 0 || y < 0 || x >= FRAME_SIZE || y >= FRAME_SIZE) continue;

          const di = (y * FRAME_SIZE + x) * 4;
          out.data[di] = multiply(tiles.data[si], ar);
          out.data[di + 1] = multiply(tiles.data[si + 1], ag);
          out.data[di + 2] = multiply(tiles.data[si + 2], ab);
          out.data[di + 3] = alpha;
        }
      }
    };

    if (identity.marking !== "PLAIN") {
      const points = anchors.marks ?? [];
      const chosen =
        identity.marking === "PATCH"
          ? [points[Math.floor(points.length / 2)]].filter(Boolean)
          : points;
      for (const point of chosen) stamp(identity.marking, point, 0.5);
    }
    if (identity.back !== "NONE") stamp(identity.back, anchors.back, 0.72);
    if (identity.head !== "PLAIN") stamp(identity.head, anchors.head, 1.1);
  }

  return out;
}

/** The palette the renderer would tint with. */
function identityPalette(character: Character): [string, string] {
  return character.palette;
}

/** A stable hash of what was drawn. Two equal hashes are the same picture. */
export function fingerprint(raster: Raster): string {
  let h = 2166136261;
  for (let i = 0; i < raster.data.length; i++) {
    h ^= raster.data[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** How many of a raster's pixels differ from another's. */
export function pixelDifference(a: Raster, b: Raster): number {
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    ) {
      differing++;
    }
  }
  return differing;
}
