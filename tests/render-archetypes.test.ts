import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTERS } from "../src/lib/game/characters";
import {
  ARCHETYPE_OVERRIDES,
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

  it("gives everything outside the animals category a human body", () => {
    for (const c of CHARACTERS.filter((c) => c.categoryId !== "animals")) {
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
  it("draws a large quadruped with the medium sheet rather than a disc", () => {
    expect(sheetFor("quadruped_large")).toBe(sheetFor("quadruped_medium"));
    expect(sheetFor("quadruped_medium")).not.toBeNull();
  });

  it("refuses to draw a shark or a snake as a four-legged animal", () => {
    for (const id of ["aquatic", "serpentine", "winged"] as VisualArchetypeId[]) {
      expect(sheetFor(id)).toBeNull();
    }
  });

  it("gives an archetype with no artwork no sheet at all", () => {
    expect(sheetFor("humanoid_medium")).toBeNull();
    expect(sheetFor("humanoid_large")).toBeNull();
  });

  it("will not load unapproved artwork", () => {
    const archetype = VISUAL_ARCHETYPES.quadruped_medium;
    const provenance = archetype.provenance!;
    try {
      archetype.provenance = { ...provenance, approved: false };
      expect(sheetFor("quadruped_medium")).toBeNull();
      // And the family fallback must not smuggle it in either.
      expect(sheetFor("quadruped_large")).toBeNull();
    } finally {
      archetype.provenance = provenance;
    }
    expect(sheetFor("quadruped_medium")).not.toBeNull();
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

  it("hands it nothing but a portrait when there is not", () => {
    expect(artFor(eagle).sheet).toBeUndefined();
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

describe("the shipped sheet agrees with the manifest", () => {
  const path = resolve(process.cwd(), "public/sprites/quadruped_medium.png");
  const png = decodePng(path);

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
        ).toBeGreaterThan(80);
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

  it("stands the idle animal on the ground line exactly", () => {
    const ground = Math.round(SHEET_GROUND_RATIO * FRAME_SIZE);
    for (let frame = 0; frame < SHEET_CLIPS.IDLE.frames; frame++) {
      let lowest = 0;
      for (let y = 0; y < FRAME_SIZE; y++) {
        for (let x = 0; x < FRAME_SIZE; x++) {
          const px = frame * FRAME_SIZE + x;
          const py = SHEET_CLIPS.IDLE.row * FRAME_SIZE + y;
          if (png.data[(py * png.width + px) * 4 + 3] > 0) lowest = Math.max(lowest, y);
        }
      }
      expect(Math.abs(lowest - ground)).toBeLessThanOrEqual(1);
    }
  });

  it("gives every animation hint a clip, so nothing falls through", () => {
    for (const hint of HINTS) expect(SHEET_CLIPS[hint]).toBeTruthy();
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
        let lowest = 0;
        for (let y = 0; y < FRAME_SIZE; y++) {
          for (let x = 0; x < FRAME_SIZE; x++) {
            const px = frame * FRAME_SIZE + x;
            const py = clip.row * FRAME_SIZE + y;
            if (png.data[(py * png.width + px) * 4 + 3] > 0) lowest = Math.max(lowest, y);
          }
        }
        // Floating is legitimate — a hop leaves the ground, a rear lifts the
        // front legs. Sinking never is: the renderer anchors the sprite by
        // this line, so anything below it is buried in the floor.
        expect(
          lowest,
          `${hint} frame ${frame} sinks to ${lowest}, ground is ${ground}`,
        ).toBeLessThanOrEqual(ground + 1);
      }
    }
  });
});
