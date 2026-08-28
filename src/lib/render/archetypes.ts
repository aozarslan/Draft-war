/**
 * ---------------------------------------------------------------------------
 * VISUAL ARCHETYPES
 * ---------------------------------------------------------------------------
 * Body plans, and which sprite sheet draws them.
 *
 * These are **not** the combat archetypes in `src/lib/game/archetypes.ts`.
 * That file answers "how does this character fight" (TANK, ASSASSIN, …) and
 * feeds nothing but labels. This one answers "how many legs does it have", and
 * feeds nothing but the renderer. A tank can be a rhino or a knight; keeping
 * the two apart is what stops artwork from leaking into balance, or a balance
 * change from silently redrawing the arena.
 *
 * The mapping is derived, not authored 268 times: category and tags decide it,
 * and a short override list fixes the ones a rule cannot get right. That way a
 * new character in a known category is drawn correctly the day it is added.
 *
 * Every body plan has its own sheet. Until S3 the two large plans had none and
 * borrowed their family's medium sheet — which also meant they had no *anchor*
 * grid, so the thirty-three characters resolving to them silently lost their
 * whole identity layer: no horns, no mane, no markings, no prop. A borrowed
 * sheet looked like a cosmetic compromise and was actually a blank character.
 */

import type { AnimationHint } from "@/lib/game/replay";
import type { CharacterArt, SpriteClip, SpriteSheet } from "./assets";
import { identityFor } from "./identity";
import { visualFor } from "@/lib/game/characters";

export type VisualArchetypeId =
  | "humanoid_medium"
  | "humanoid_large"
  | "quadruped_small"
  | "quadruped_medium"
  | "quadruped_large"
  | "serpentine"
  | "winged"
  | "aquatic";

/** The body plans that have their own artwork, in the order they were drawn. */
export const DRAWN_ARCHETYPES: VisualArchetypeId[] = [
  "humanoid_medium",
  "humanoid_large",
  "quadruped_small",
  "quadruped_medium",
  "quadruped_large",
  "serpentine",
  "winged",
  "aquatic",
];

/**
 * Where a sprite came from, recorded next to the sprite itself.
 *
 * This is deliberately in code rather than in a table: it ships in the same
 * commit as the artwork, so a sheet cannot arrive without its provenance, and
 * the loader can enforce `approved` without a round trip. A database table
 * becomes worth adding when assets are served from the database — not before.
 */
export interface AssetProvenance {
  sourceType: "ORIGINAL" | "PUBLIC_DOMAIN" | "LICENSED" | "USER_CREATED";
  /** For public-domain work, the exact edition. Null when authored here. */
  sourceReference: string | null;
  creator: string;
  license: string;
  version: number;
  /** The renderer loads approved sheets only. */
  approved: boolean;
}

export interface VisualArchetype {
  id: VisualArchetypeId;
  label: string;
  /** Null until this body plan has artwork. */
  sheet: SpriteSheet | null;
  provenance: AssetProvenance | null;
}

/**
 * The clip layout every generated sheet follows.
 *
 * Exported because `scripts/generate-sprites.ts` draws from this exact object.
 * One declaration, two consumers, so a sheet can never disagree with the
 * manifest that indexes it — the same tripwire the SQL seed generators use.
 */
export const SHEET_CLIPS: Record<AnimationHint, SpriteClip> = {
  IDLE: { row: 0, frames: 4, loop: true },
  ATTACK: { row: 1, frames: 6, loop: false },
  CAST: { row: 2, frames: 6, loop: false },
  GUARD: { row: 3, frames: 4, loop: false },
  IMPACT: { row: 4, frames: 3, loop: false },
  DEATH: { row: 5, frames: 6, loop: false },
  CHEER: { row: 6, frames: 4, loop: true },
  NONE: { row: 0, frames: 4, loop: true },
};

export const FRAME_SIZE = 32;

/**
 * Where the feet are, as a fraction of the frame height.
 *
 * Sprites are anchored by their ground line rather than their centre: a frame
 * is mostly empty air above the animal, so centring it makes the sprite hover
 * above its own shadow. Declared here because both the generator and the draw
 * layer have to agree, and a disagreement of two pixels is very visible.
 */
export const SHEET_GROUND_RATIO = 27 / 32;

/** Widest clip decides the sheet width; row count decides its height. */
export const SHEET_COLUMNS = Math.max(
  ...Object.values(SHEET_CLIPS).map((c) => c.frames),
);
export const SHEET_ROWS =
  Math.max(...Object.values(SHEET_CLIPS).map((c) => c.row)) + 1;

const sheet = (id: VisualArchetypeId): SpriteSheet => ({
  src: `/sprites/${id}.png`,
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  clips: SHEET_CLIPS,
});

/**
 * Every drawn body plan comes from the same generator, so they share one
 * provenance record rather than repeating it six times.
 */
const GENERATED: AssetProvenance = {
  sourceType: "ORIGINAL",
  sourceReference: null,
  creator: "DRAFT WAR — scripts/generate-sprites.ts",
  license: "Project-owned original artwork",
  version: 1,
  approved: true,
};

const drawn = (id: VisualArchetypeId, label: string): VisualArchetype => ({
  id,
  label,
  sheet: sheet(id),
  provenance: { ...GENERATED },
});

const undrawn = (id: VisualArchetypeId, label: string): VisualArchetype => ({
  id,
  label,
  sheet: null,
  provenance: null,
});

/**
 * The identity tile sheet's own provenance.
 *
 * It shipped in M8 without one, which broke the rule the bodies follow: no
 * artwork reaches the renderer without a record of where it came from. The
 * loader enforces `approved` on it exactly as it does on a body sheet.
 */
export const IDENTITY_TILES_ASSET: { src: string; provenance: AssetProvenance } = {
  src: "/sprites/identity.png",
  provenance: { ...GENERATED },
};

/** Whether the identity tiles may be drawn at all. */
export function identityTilesApproved(): boolean {
  return IDENTITY_TILES_ASSET.provenance.approved;
}

export const VISUAL_ARCHETYPES: Record<VisualArchetypeId, VisualArchetype> = {
  humanoid_medium: drawn("humanoid_medium", "Humanoid"),
  humanoid_large: drawn("humanoid_large", "Large humanoid"),
  quadruped_small: drawn("quadruped_small", "Small quadruped"),
  quadruped_medium: drawn("quadruped_medium", "Quadruped"),
  quadruped_large: drawn("quadruped_large", "Large quadruped"),
  serpentine: drawn("serpentine", "Serpentine"),
  winged: drawn("winged", "Winged"),
  aquatic: drawn("aquatic", "Aquatic"),
};

/**
 * Hand corrections.
 *
 * A rule over tags gets most animals right and a handful badly wrong: an
 * ostrich is a bird that does not fly, an anaconda is a reptile with no legs,
 * an orca is a predator with no legs either. Rather than bend the rule until it
 * covers every exception — which makes it unreadable and still misses one —
 * the exceptions are listed.
 */
export const ARCHETYPE_OVERRIDES: Record<string, VisualArchetypeId> = {
  "animals-green-anaconda": "serpentine",
  "animals-common-ostrich": "humanoid_medium",
  "animals-southern-cassowary": "humanoid_medium",
  "animals-orca": "aquatic",
  "animals-southern-elephant-seal": "aquatic",
  "animals-komodo-dragon": "quadruped_medium",
};

/** The minimum a character has to expose to be drawn. */
export interface ArchetypeInput {
  id: string;
  categoryId: string;
  tags: string[];
  stats: Record<string, number>;
}

/**
 * Everything the renderer needs for one character, in one place.
 *
 * This is the only function that knows both halves — the catalogue on one side,
 * the render layer on the other — which is what keeps `assets.ts` free of any
 * notion of categories and `characters.ts` free of any notion of sprites.
 */
export function artFor(
  character: ArchetypeInput & {
    name: string;
    palette: [string, string];
    thumbnailUrl?: string | null;
  },
  portraitOverride?: string | null,
): CharacterArt {
  const archetype = visualArchetypeFor(character);
  const sheet = sheetFor(archetype);
  return {
    characterId: character.id,
    name: character.name,
    palette: character.palette,
    portraitUrl: portraitOverride ?? character.thumbnailUrl ?? null,
    identity: identityFor(character, archetype),
    archetype,
    ...(sheet ? { sheet } : {}),
  };
}

/**
 * Which body plan draws this character.
 *
 * Deterministic and total: every character resolves to something, and the same
 * character always resolves to the same thing, so a battle cannot look
 * different on two devices.
 */
export function visualArchetypeFor(character: ArchetypeInput): VisualArchetypeId {
  // Authored next to the character wins, because that is where a body plan is
  // easiest to keep honest — you can see it on the same line as the tags that
  // would otherwise have decided it.
  const authored = visualFor(character.id)?.va;
  if (authored) return authored;

  const override = ARCHETYPE_OVERRIDES[character.id];
  if (override) return override;

  if (character.categoryId !== "animals") {
    // Every other category is people-shaped. Mass is the only axis that
    // reliably separates a brawler from a giant, and only animals report it.
    const power = character.stats.strength ?? character.stats.power ?? 0;
    return power >= 95 ? "humanoid_large" : "humanoid_medium";
  }

  const tags = new Set(character.tags);
  if (tags.has("reptile")) return "quadruped_medium";

  // Mass is the only axis that says anything about size, and the two
  // thresholds are where the catalogue actually separates: a badger is not a
  // small wolf, it is a different silhouette.
  const mass = character.stats.mass ?? 0;
  if (mass >= 70) return "quadruped_large";
  return mass >= 35 ? "quadruped_medium" : "quadruped_small";
}

/**
 * The sheet to draw with, or null.
 *
 * Falls back along the body-plan family before giving up, so a large quadruped
 * with no artwork borrows the medium one rather than dropping to a portrait —
 * a rhino drawn slightly wrong still reads as a rhino, a disc does not.
 */
export function sheetFor(archetype: VisualArchetypeId): SpriteSheet | null {
  const own = VISUAL_ARCHETYPES[archetype];
  if (own?.sheet && own.provenance?.approved) return own.sheet;

  const fallback = FAMILY_FALLBACK[archetype];
  if (!fallback) return null;
  const parent = VISUAL_ARCHETYPES[fallback];
  return parent?.sheet && parent.provenance?.approved ? parent.sheet : null;
}

/**
 * Only within a family. An orca is not a quadruped drawn slightly wrong, it is
 * a different silhouette, and a shark on four legs reads as a bug — so aquatic,
 * serpentine and winged have no fallback and wait for their own artwork.
 *
 * Every body plan has its own sheet now, so nothing reaches this in practice.
 * It is kept because `sheetFor` also refuses *unapproved* artwork: pull the
 * approval on a large sheet and its family still draws rather than dropping
 * thirty-three characters to a palette disc.
 */
const FAMILY_FALLBACK: Partial<Record<VisualArchetypeId, VisualArchetypeId>> = {
  quadruped_large: "quadruped_medium",
  humanoid_large: "humanoid_medium",
};
