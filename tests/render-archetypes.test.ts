import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTERS, CHARACTER_VISUALS } from "../src/lib/game/characters";
import {
  ARCHETYPE_OVERRIDES,
  DRAWN_ARCHETYPES,
  FRAME_SIZE,
  SHEET_CLIPS,
  SHEET_COLUMNS,
  SHEET_GROUND_RATIO,
  SHEET_ROWS,
  VISUAL_ARCHETYPES,
  artFor,
  sheetFor,
  visualArchetypeFor,
  type VisualArchetypeId,
} from "../src/lib/render/archetypes";
import type { AnimationHint } from "../src/lib/game/replay";

const HINTS: AnimationHint[] = [
  "IDLE", "ATTACK", "CAST", "GUARD", "IMPACT", "DEATH", "CHEER", "NONE",
];

describe("every character can be drawn", () => {
  it("resolves an archetype for all of them", () => {
    for (const c of CHARACTERS) {
      expect(Object.keys(VISUAL_ARCHETYPES)).toContain(visualArchetypeFor(c));
    }
    expect(CHARACTERS.length).toBeGreaterThan(200);
  });

  it("resolves the same one every time", () => {
    for (const c of CHARACTERS.slice(0, 40)) {
      expect(visualArchetypeFor(c)).toBe(visualArchetypeFor(c));
    }
  });

  it("gives non-animal characters without an authored body plan a human body", () => {
    for (const c of CHARACTERS.filter((c) => c.categoryId !== "animals")) {
      if (CHARACTER_VISUALS[c.id]?.va) continue; // explicit override wins
      expect(visualArchetypeFor(c)).toMatch(/^humanoid_/);
    }
  });

  it("gives animals an animal body unless they are hand-corrected", () => {
    const animals = CHARACTERS.filter((c) => c.categoryId === "animals");
    const quadrupeds = animals.filter((c) => visualArchetypeFor(c).startsWith("quadruped"));
    expect(quadrupeds.length).toBeGreaterThan(animals.length / 2);
  });
});

describe("hand corrections", () => {
  const of = (id: string) => {
    const c = CHARACTERS.find((c) => c.id === id);
    expect(c, `${id} is missing from the catalogue`).toBeTruthy();
    return visualArchetypeFor(c!);
  };

  it("does not put legs on a snake", () => {
    expect(of("animals-green-anaconda")).toBe("serpentine");
    expect(of("animals-black-mamba")).toBe("serpentine");
  });

  it("does not put legs on a shark or an orca", () => {
    expect(of("animals-great-white-shark")).toBe("aquatic");
    expect(of("animals-orca")).toBe("aquatic");
  });

  it("stands the two-legged birds up and lets the eagle fly", () => {
    expect(of("animals-common-ostrich")).toBe("humanoid_medium");
    expect(of("animals-southern-cassowary")).toBe("humanoid_medium");
    expect(of("animals-golden-eagle")).toBe("winged");
  });

  it("overrides beat the rule", () => {
    // A gorilla is heavy enough that the mass rule would call it a large
    // quadruped; the override is what makes it stand up.
    expect(of("animals-western-gorilla")).toBe("humanoid_large");
  });

  it("names only characters that exist", () => {
    // A rename would strand an override silently: the character would quietly
    // fall back to the rule and be drawn with the wrong number of legs.
    const ids = new Set(CHARACTERS.map((c) => c.id));
    for (const id of Object.keys(ARCHETYPE_OVERRIDES)) {
      expect(ids.has(id), `override for "${id}" names no character`).toBe(true);
    }
    expect(Object.keys(ARCHETYPE_OVERRIDES).length).toBeGreaterThan(5);
  });
});

describe("falling back", () => {
  it("draws a large quadruped with its own sheet, not its family's", () => {
    // Until S3 this borrowed `quadruped_medium`. That was never only cosmetic:
    // a borrowed sheet has no anchor grid of its own, so every large animal
    // lost its horns, mane, markings and prop as well as its bulk.
    expect(sheetFor("quadruped_large")).not.toBe(sheetFor("quadruped_medium"));
    expect(sheetFor("quadruped_large")?.src).toBe("/sprites/quadruped_large.png");
  });

  it("gives a shark, a snake and a bird their own bodies rather than borrowing", () => {
    // These fell back to a portrait in M4 because drawing them with four legs
    // would have been worse than not drawing them. Now they have their own.
    for (const id of ["aquatic", "serpentine", "winged"] as VisualArchetypeId[]) {
      expect(sheetFor(id)).not.toBeNull();
      expect(sheetFor(id)).not.toBe(sheetFor("quadruped_medium"));
    }
  });

  it("draws a large humanoid with its own sheet", () => {
    expect(sheetFor("humanoid_large")).not.toBe(sheetFor("humanoid_medium"));
    expect(sheetFor("humanoid_large")?.src).toBe("/sprites/humanoid_large.png");
  });

  it("gives every archetype a sheet from its own family or none", () => {
    for (const id of Object.keys(VISUAL_ARCHETYPES) as VisualArchetypeId[]) {
      const resolved = sheetFor(id);
      if (!resolved) continue;
      const family = id.split("_")[0];
      expect(resolved.src, `${id} borrowed a sheet from another family`).toContain(
        family === "quadruped" || family === "humanoid" ? family : id,
      );
    }
  });

  it("can now draw every character in the catalogue", () => {
    // The point of M5: six body plans cover 268 characters with no gaps.
    for (const c of CHARACTERS) {
      expect(sheetFor(visualArchetypeFor(c)), `${c.id} has no sheet`).not.toBeNull();
    }
  });

  it("will not load unapproved artwork", () => {
    const medium = VISUAL_ARCHETYPES.quadruped_medium;
    const large = VISUAL_ARCHETYPES.quadruped_large;
    const mediumProv = medium.provenance!;
    const largeProv = large.provenance!;

    try {
      // Both unapproved: nothing to draw and nothing to borrow.
      medium.provenance = { ...mediumProv, approved: false };
      large.provenance = { ...largeProv, approved: false };
      expect(sheetFor("quadruped_medium")).toBeNull();
      expect(sheetFor("quadruped_large")).toBeNull();
    } finally {
      medium.provenance = mediumProv;
      large.provenance = largeProv;
    }

    try {
      // Only the large one unapproved: the family net catches it. Every plan
      // has its own artwork now, so this is the only path that still reaches
      // the fallback — and it is why the fallback was kept.
      large.provenance = { ...largeProv, approved: false };
      expect(sheetFor("quadruped_large")).toBe(sheetFor("quadruped_medium"));
    } finally {
      large.provenance = largeProv;
    }

    expect(sheetFor("quadruped_large")?.src).toBe("/sprites/quadruped_large.png");
  });
});

describe("provenance", () => {
  it("exists for every archetype that ships artwork", () => {
    for (const archetype of Object.values(VISUAL_ARCHETYPES)) {
      if (!archetype.sheet) continue;
      expect(archetype.provenance, `${archetype.id} ships art with no provenance`).toBeTruthy();
      expect(archetype.provenance!.creator).toBeTruthy();
      expect(archetype.provenance!.license).toBeTruthy();
    }
  });

  it("records public-domain work against a specific edition", () => {
    for (const archetype of Object.values(VISUAL_ARCHETYPES)) {
      if (archetype.provenance?.sourceType !== "PUBLIC_DOMAIN") continue;
      expect(archetype.provenance.sourceReference).toBeTruthy();
    }
  });

  it("claims the quadruped sheet as original work", () => {
    expect(VISUAL_ARCHETYPES.quadruped_medium.provenance?.sourceType).toBe("ORIGINAL");
  });
});

describe("artFor", () => {
  const lion = CHARACTERS.find((c) => c.id === "animals-lion")!;
  const eagle = CHARACTERS.find((c) => c.id === "animals-golden-eagle")!;

  it("hands the renderer a sheet when there is one", () => {
    expect(artFor(lion).sheet).not.toBeUndefined();
    expect(artFor(lion).palette).toEqual(lion.palette);
  });

  it("gives the bird the winged sheet, not the quadruped one", () => {
    expect(artFor(eagle).sheet?.src).toContain("winged");
  });

  it("hands it nothing but a portrait when the artwork is withdrawn", () => {
    const archetype = VISUAL_ARCHETYPES.winged;
    const provenance = archetype.provenance!;
    try {
      archetype.provenance = { ...provenance, approved: false };
      expect(artFor(eagle).sheet).toBeUndefined();
      expect(artFor(eagle).portraitUrl !== undefined).toBe(true);
    } finally {
      archetype.provenance = provenance;
    }
  });

  it("prefers an explicitly supplied portrait over the catalogue's", () => {
    expect(artFor(lion, "https://example.test/lion.png").portraitUrl).toBe(
      "https://example.test/lion.png",
    );
    expect(artFor(lion, null).portraitUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The shipped sheet has to match the manifest that indexes it.
// ---------------------------------------------------------------------------

/** Decodes the generator's own PNG: 8-bit RGBA, filter 0 on every scanline. */
function decodePng(path: string): { width: number; height: number; data: Buffer } {
  const file = readFileSync(path);
  let offset = 8; // signature
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
      expect(body[8], "bit depth").toBe(8);
      expect(body[9], "colour type").toBe(6);
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)], `scanline ${y} filter`).toBe(0);
    raw.copy(data, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, data };
}

describe.each(DRAWN_ARCHETYPES)("%s sheet agrees with the manifest", (archetype) => {
  const png = decodePng(resolve(process.cwd(), `public/sprites/${archetype}.png`));

  const opaquePixels = (col: number, row: number) => {
    let count = 0;
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        const px = col * FRAME_SIZE + x;
        const py = row * FRAME_SIZE + y;
        if (png.data[(py * png.width + px) * 4 + 3] > 0) count++;
      }
    }
    return count;
  };

  const lowestRow = (col: number, row: number) => {
    let lowest = -1;
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        const px = col * FRAME_SIZE + x;
        const py = row * FRAME_SIZE + y;
        if (png.data[(py * png.width + px) * 4 + 3] > 0) lowest = Math.max(lowest, y);
      }
    }
    return lowest;
  };

  it("is exactly the size the manifest implies", () => {
    expect(png.width).toBe(SHEET_COLUMNS * FRAME_SIZE);
    expect(png.height).toBe(SHEET_ROWS * FRAME_SIZE);
  });

  it("has a drawn frame everywhere a clip says there is one", () => {
    for (const hint of HINTS) {
      const clip = SHEET_CLIPS[hint];
      for (let frame = 0; frame < clip.frames; frame++) {
        expect(
          opaquePixels(frame, clip.row),
          `${hint} frame ${frame} (row ${clip.row}) is empty`,
        ).toBeGreaterThan(40);
      }
    }
  });

  it("leaves nothing drawn past the end of a clip", () => {
    const claimed = new Set<string>();
    for (const clip of Object.values(SHEET_CLIPS)) {
      for (let frame = 0; frame < clip.frames; frame++) claimed.add(`${clip.row}:${frame}`);
    }
    for (let row = 0; row < SHEET_ROWS; row++) {
      for (let col = 0; col < SHEET_COLUMNS; col++) {
        if (claimed.has(`${row}:${col}`)) continue;
        expect(opaquePixels(col, row), `row ${row} frame ${col} is orphaned art`).toBe(0);
      }
    }
  });

  it("is drawn in greyscale, so tinting is what gives it colour", () => {
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 0) continue;
      expect(png.data[i]).toBe(png.data[i + 1]);
      expect(png.data[i + 1]).toBe(png.data[i + 2]);
    }
  });

  it("never lets a pose sink below the ground line the renderer anchors to", () => {
    const ground = Math.round(SHEET_GROUND_RATIO * FRAME_SIZE);
    for (const hint of HINTS) {
      const clip = SHEET_CLIPS[hint];
      for (let frame = 0; frame < clip.frames; frame++) {
        // Floating is legitimate — a bird hovers, a hop leaves the ground.
        // Sinking never is: the renderer anchors the sprite by this line, so
        // anything below it is buried in the floor.
        expect(
          lowestRow(frame, clip.row),
          `${hint} frame ${frame} sinks below the ground line`,
        ).toBeLessThanOrEqual(ground + 1);
      }
    }
  });

  it("keeps the body inside its frame, so neighbours do not clip", () => {
    for (const hint of HINTS) {
      const clip = SHEET_CLIPS[hint];
      for (let frame = 0; frame < clip.frames; frame++) {
        // The right-hand column must be clear, or a lunge bleeds into the next
        // frame of the sheet and the sprite grows a second head.
        for (let y = 0; y < FRAME_SIZE; y++) {
          const px = frame * FRAME_SIZE + FRAME_SIZE - 1;
          const py = clip.row * FRAME_SIZE + y;
          expect(
            png.data[(py * png.width + px) * 4 + 3],
            `${hint} frame ${frame} touches its right edge at y=${y}`,
          ).toBe(0);
        }
      }
    }
  });
});

describe("clip layout", () => {
  it("gives every animation hint a clip, so nothing falls through", () => {
    for (const hint of HINTS) expect(SHEET_CLIPS[hint]).toBeTruthy();
  });

  it("stands the idle body on the ground line in every archetype", () => {
    const ground = Math.round(SHEET_GROUND_RATIO * FRAME_SIZE);
    // A flier and a swimmer hover on purpose; everything with feet stands.
    for (const archetype of ["humanoid_medium", "quadruped_small", "quadruped_medium"]) {
      const png = decodePng(resolve(process.cwd(), `public/sprites/${archetype}.png`));
      for (let frame = 0; frame < SHEET_CLIPS.IDLE.frames; frame++) {
        let lowest = 0;
        for (let y = 0; y < FRAME_SIZE; y++) {
          for (let x = 0; x < FRAME_SIZE; x++) {
            const px = frame * FRAME_SIZE + x;
            const py = SHEET_CLIPS.IDLE.row * FRAME_SIZE + y;
            if (png.data[(py * png.width + px) * 4 + 3] > 0) lowest = Math.max(lowest, y);
          }
        }
        expect(Math.abs(lowest - ground), `${archetype} idle frame ${frame}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
