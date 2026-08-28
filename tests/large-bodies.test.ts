import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DRAWN_ARCHETYPES,
  VISUAL_ARCHETYPES,
  sheetFor,
  type VisualArchetypeId,
} from "../src/lib/render/archetypes";
import { SPRITE_ANCHORS } from "../src/lib/render/anchors.generated";
import { BUILD_SCALE, visualSignature, type IdentityConfig } from "../src/lib/render/identity";
import { sheetRaster } from "./support/raster";

/**
 * ---------------------------------------------------------------------------
 * A large body is a different animal, not a bigger one.
 * ---------------------------------------------------------------------------
 * Before S3 the two large plans had no artwork and borrowed their family's
 * medium sheet. That looked like a cosmetic compromise and was not: a borrowed
 * sheet also meant no *anchor grid*, and `composeSprite` bails without one — so
 * the thirty-three characters resolving to a large plan were drawn with no
 * horns, no mane, no markings and no prop. They were blank.
 *
 * These tests pin the fix and, more importantly, pin the thing that is easy to
 * get wrong on the way to it: that "large" is re-authored proportions rather
 * than a scale factor. A scaled sprite grows equally in both directions; a
 * heavyweight does not.
 */

const FRAME = 32;

/** Ink, and the box it occupies, for one frame of a sheet. */
function silhouette(archetype: string, col = 0, row = 0) {
  const raster = sheetRaster(archetype);
  if (!raster) throw new Error(`${archetype} has no sheet`);
  let ink = 0, minX = FRAME, maxX = -1, minY = FRAME, maxY = -1;
  for (let y = 0; y < FRAME; y++) {
    for (let x = 0; x < FRAME; x++) {
      const px = col * FRAME + x;
      const py = row * FRAME + y;
      if (raster.data[(py * raster.width + px) * 4 + 3] === 0) continue;
      ink++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { ink, width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe("every body plan draws itself", () => {
  it("has its own sheet, with no family borrowing", () => {
    for (const id of DRAWN_ARCHETYPES) {
      const own = VISUAL_ARCHETYPES[id];
      expect(own.sheet, `${id} has no sheet`).toBeTruthy();
      expect(own.provenance?.approved, `${id} is unapproved`).toBe(true);
      // The resolved sheet is its own, not a relative's.
      expect(sheetFor(id)?.src).toBe(`/sprites/${id}.png`);
    }
  });

  it("gives the large plans the anchor grid they never had", () => {
    // This is the bug, stated plainly: without a grid, `composeSprite`
    // returns before drawing a single identity tile.
    for (const id of ["humanoid_large", "quadruped_large"] as VisualArchetypeId[]) {
      const grid = SPRITE_ANCHORS[id];
      expect(grid, `${id} has no anchors`).toBeTruthy();
      expect(grid.length).toBe(SPRITE_ANCHORS.humanoid_medium.length);
    }
  });

  it("reports head, back, body, hand and marks on every large frame", () => {
    for (const id of ["humanoid_large", "quadruped_large"]) {
      for (const row of SPRITE_ANCHORS[id]) {
        for (const frame of row) {
          if (!frame) continue;
          for (const slot of ["head", "back", "body", "hand"] as const) {
            expect(frame[slot], `${id} ${slot}`).toHaveLength(3);
            const [x, y] = frame[slot];
            expect(x, `${id} ${slot} x`).toBeGreaterThanOrEqual(0);
            expect(x, `${id} ${slot} x`).toBeLessThanOrEqual(FRAME);
            expect(y, `${id} ${slot} y`).toBeGreaterThanOrEqual(0);
            expect(y, `${id} ${slot} y`).toBeLessThanOrEqual(FRAME);
          }
          expect(frame.marks.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("moves the large hand with the pose", () => {
    // A prop pinned to one spot swims against the animation on exactly the
    // frames anyone is watching.
    for (const id of ["humanoid_large", "quadruped_large"]) {
      const xs = SPRITE_ANCHORS[id]
        .flat()
        .filter(Boolean)
        .map((f) => f!.hand[0]);
      expect(new Set(xs).size, `${id} hand never moves`).toBeGreaterThan(1);
    }
  });
});

describe("large is re-authored, not rescaled", () => {
  it("makes the large humanoid a heavyweight rather than a tall person", () => {
    const medium = silhouette("humanoid_medium");
    const large = silhouette("humanoid_large");

    // Substantially more mass...
    expect(large.ink / medium.ink).toBeGreaterThan(1.3);
    // ...almost all of it sideways. A uniform scale would grow both equally,
    // and a taller-but-equally-narrow figure is just a person on stilts.
    const widthRatio = large.width / medium.width;
    const heightRatio = large.height / medium.height;
    expect(widthRatio).toBeGreaterThan(1.4);
    expect(widthRatio - heightRatio).toBeGreaterThan(0.4);
  });

  it("makes the large quadruped low and heavy rather than long-legged", () => {
    const medium = silhouette("quadruped_medium");
    const large = silhouette("quadruped_large");

    expect(large.ink / medium.ink).toBeGreaterThan(1.2);
    // Enlarging the medium body lengthens the legs and produces a horse. The
    // large plan must not be taller than the medium one.
    expect(large.height / medium.height).toBeLessThanOrEqual(1.05);
  });

  it("is not the medium sheet under another name", () => {
    for (const [med, big] of [
      ["humanoid_medium", "humanoid_large"],
      ["quadruped_medium", "quadruped_large"],
    ]) {
      const a = readFileSync(resolve(process.cwd(), `public/sprites/${med}.png`));
      const b = readFileSync(resolve(process.cwd(), `public/sprites/${big}.png`));
      expect(createHash("sha256").update(a).digest("hex"))
        .not.toBe(createHash("sha256").update(b).digest("hex"));
    }
  });

  it("carries its own anchors rather than the medium plan's", () => {
    // If a large plan were generated from the medium body, its anchors would
    // land on the same pixels.
    const mediumHand = SPRITE_ANCHORS.humanoid_medium[0][0]!.hand;
    const largeHand = SPRITE_ANCHORS.humanoid_large[0][0]!.hand;
    expect(largeHand).not.toEqual(mediumHand);

    const mediumBack = SPRITE_ANCHORS.quadruped_medium[0][0]!.back;
    const largeBack = SPRITE_ANCHORS.quadruped_large[0][0]!.back;
    expect(largeBack).not.toEqual(mediumBack);
  });
});

describe("archetype and build stay separate concepts", () => {
  const base: IdentityConfig = {
    scale: 1, head: "PLAIN", back: "NONE", marking: "PLAIN",
    prop: "NONE", build: "NORMAL", accent: "#ffffff",
  };

  it("separates medium and large under the same build", () => {
    // "humanoid_medium + TOWERING" and "humanoid_large + TOWERING" must not
    // collapse to the same thing: the build is a proportion tweak on top of a
    // silhouette, not a replacement for one.
    for (const build of Object.keys(BUILD_SCALE) as (keyof typeof BUILD_SCALE)[]) {
      const id = { ...base, build };
      expect(visualSignature("humanoid_large", id))
        .not.toBe(visualSignature("humanoid_medium", id));
      expect(visualSignature("quadruped_large", id))
        .not.toBe(visualSignature("quadruped_medium", id));
    }
  });

  it("keeps build a pure multiplier, unaware of the body it scales", () => {
    // Build carries no archetype knowledge — the same pair of numbers applies
    // to every plan, which is what keeps the two ideas from merging.
    expect(BUILD_SCALE.NORMAL).toEqual([1, 1]);
    expect(Object.keys(BUILD_SCALE)).toHaveLength(5);
  });
});

describe("the legacy sheets did not move", () => {
  /**
   * Regenerating the sprite sheets rewrites every PNG. These hashes are the
   * proof that adding two body plans left the other six untouched — the sort
   * of claim that is worth a number rather than a sentence.
   */
  const LEGACY_HASHES: Record<string, string> = {
    humanoid_medium: "c5753f9dbe1700ea2c5f6b3839a87080",
    quadruped_small: "a2a59ee32b41bd9562f90f45f9f78d11",
    quadruped_medium: "234acbf950bc4ae78ecd7003e49b10ad",
    serpentine: "b7514c7f309293cc4ad211e8a3f806f0",
    winged: "ea18f1799ad2429cf556365f1bc1492d",
    aquatic: "bd4d5bb6ff3bc49863847cf9cf17abb7",
    // Grew a row in S7 for BALL_HELD. The eight body sheets are untouched:
    // adding a prop tile does not redraw a body.
    identity: "1154208f8aed0e2e5479f24d7a8fda98",
  };

  it("is byte-identical for every sheet that existed before S3", () => {
    for (const [name, expected] of Object.entries(LEGACY_HASHES)) {
      const bytes = readFileSync(resolve(process.cwd(), `public/sprites/${name}.png`));
      expect(createHash("md5").update(bytes).digest("hex"), `${name}.png changed`)
        .toBe(expected);
    }
  });
});
