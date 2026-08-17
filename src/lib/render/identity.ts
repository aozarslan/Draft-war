/**
 * ---------------------------------------------------------------------------
 * CHARACTER IDENTITY
 * ---------------------------------------------------------------------------
 * Six body plans cover 268 characters, which is what made animation affordable
 * — and also what made a lion and a wolf the same green quadruped. This layer
 * puts the difference back without going back to 268 sprite sheets.
 *
 * A character resolves to an **identity configuration**: a size, a head
 * feature, a back feature, a marking pattern and an accent colour. The draw
 * layer composites those over the archetype's sheet, so the pipeline is
 *
 *     character → visual archetype → identity configuration → rendered sprite
 *
 * Two rules hold the whole thing together:
 *
 * **Nothing branches on a character id in code.** The rules read the same tags,
 * stats and category the game already stores. A hand-tuned registry exists for
 * characters a rule cannot get right, but it is data — one table, no control
 * flow — exactly like the archetype overrides.
 *
 * **It is a pure function.** Same character, same configuration, on every
 * device and every frame. Identity that flickered between frames would be
 * worse than no identity at all.
 *
 * The features are deliberately coarse. At twenty-two arena units a sprite is
 * about thirty screen pixels; horns, a mane and a stripe pattern are as much
 * as reads at that size, and reading is the entire point.
 */

import type { ArchetypeInput, VisualArchetypeId } from "./archetypes";

export type HeadFeature =
  | "PLAIN"
  | "HORNS"      // curved, outward — bovines, rhinos, demons
  | "ANTLERS"    // branched, upward — deer, elk
  | "EARS"       // upright, pointed — canines, felines
  | "CREST"      // a fan or comb — birds, reptiles
  | "TUSKS"      // downward, forward — boars, elephants
  | "HELM";      // a hard brow line — armoured humanoids

export type BackFeature =
  | "NONE"
  | "MANE"       // a ruff around the shoulders
  | "SPINES"     // a row of ridges along the spine
  | "FIN"        // a tall dorsal
  | "CAPE"       // a trailing sheet
  | "SHELL";     // a hard dome

export type Marking =
  | "PLAIN"
  | "STRIPES"
  | "SPOTS"
  | "PATCH"      // a single contrasting mass
  | "BANDS";     // rings across the body, for serpents

export interface IdentityConfig {
  /** Multiplies the drawn sprite. 1 is the archetype's own size. */
  scale: number;
  head: HeadFeature;
  back: BackFeature;
  marking: Marking;
  /**
   * A second colour for features and markings.
   *
   * Deliberately derived from the character's own palette rather than from the
   * team's: the team colour is on the ground ring, and letting it into the body
   * would make two characters on one side look like the same creature again.
   */
  accent: string;
}

/**
 * How pale every accent is forced to be.
 *
 * Both numbers exist to keep identity and team colour in separate registers:
 * team colours are saturated mid-tones on the ground ring, accents are pale
 * marks on the body.
 */
const ACCENT_MIN_BRIGHTNESS = 232;
const ACCENT_MIN_FLOOR = 120;

/**
 * A stable hash of the character id.
 *
 * Used only to break ties between characters the rules cannot distinguish, so
 * that two wolves with identical tags still differ. It is not randomness: the
 * same id always yields the same number, on every device, forever.
 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Picks from a list by hash. Deterministic, and spread evenly across ids. */
function pick<T>(id: string, salt: number, options: readonly T[]): T {
  return options[(hash(id + ":" + salt)) % options.length];
}

/**
 * Hand-tuned identities.
 *
 * The rules below get most of the catalogue right and a handful memorably
 * wrong — a lion without a mane is not a lion. Rather than bending the rules
 * until they encode every animal's anatomy, the notable ones are listed. This
 * is the representative set M7 proves the system on; adding the rest is
 * filling in a table, not writing code.
 */
export const IDENTITY_OVERRIDES: Record<string, Partial<IdentityConfig>> = {
  // Animals — the category where a wrong silhouette is most obvious.
  "animals-lion": { head: "EARS", back: "MANE", marking: "PLAIN", scale: 1.02 },
  "animals-tiger": { head: "EARS", back: "NONE", marking: "STRIPES", scale: 1.02 },
  "animals-leopard": { head: "EARS", back: "NONE", marking: "SPOTS", scale: 0.94 },
  "animals-jaguar": { head: "EARS", back: "NONE", marking: "SPOTS", scale: 0.98 },
  "animals-cheetah": { head: "EARS", back: "NONE", marking: "SPOTS", scale: 0.9 },
  "animals-spotted-hyena": { head: "EARS", back: "SPINES", marking: "SPOTS", scale: 0.92 },
  "animals-wolf": { head: "EARS", back: "NONE", marking: "PATCH", scale: 0.94 },
  "animals-grizzly-bear": { head: "EARS", back: "MANE", marking: "PLAIN", scale: 1.12 },
  "animals-polar-bear": { head: "EARS", back: "NONE", marking: "PLAIN", scale: 1.14 },
  "animals-african-bush-elephant": { head: "TUSKS", back: "NONE", marking: "PLAIN", scale: 1.25 },
  "animals-white-rhinoceros": { head: "HORNS", back: "NONE", marking: "PLAIN", scale: 1.18 },
  "animals-hippopotamus": { head: "TUSKS", back: "NONE", marking: "PLAIN", scale: 1.16 },
  "animals-african-buffalo": { head: "HORNS", back: "NONE", marking: "PLAIN", scale: 1.1 },
  "animals-american-bison": { head: "HORNS", back: "MANE", marking: "PLAIN", scale: 1.12 },
  "animals-muskox": { head: "HORNS", back: "MANE", marking: "PLAIN", scale: 1.04 },
  "animals-moose": { head: "ANTLERS", back: "NONE", marking: "PLAIN", scale: 1.12 },
  "animals-wild-boar": { head: "TUSKS", back: "SPINES", marking: "PLAIN", scale: 0.92 },
  "animals-saltwater-crocodile": { head: "CREST", back: "SPINES", marking: "BANDS", scale: 1.08 },
  "animals-komodo-dragon": { head: "CREST", back: "SPINES", marking: "PATCH", scale: 0.96 },
  "animals-honey-badger": { head: "EARS", back: "NONE", marking: "PATCH", scale: 0.8 },
  "animals-wolverine": { head: "EARS", back: "NONE", marking: "PATCH", scale: 0.82 },
  "animals-green-anaconda": { head: "PLAIN", back: "NONE", marking: "BANDS", scale: 1.1 },
  "animals-black-mamba": { head: "PLAIN", back: "NONE", marking: "PLAIN", scale: 0.9 },
  "animals-golden-eagle": { head: "CREST", back: "NONE", marking: "PATCH", scale: 0.94 },
  "animals-common-ostrich": { head: "CREST", back: "NONE", marking: "PATCH", scale: 1.08 },
  "animals-southern-cassowary": { head: "CREST", back: "NONE", marking: "PATCH", scale: 1.0 },
  "animals-orca": { head: "PLAIN", back: "FIN", marking: "PATCH", scale: 1.2 },
  "animals-great-white-shark": { head: "PLAIN", back: "FIN", marking: "PLAIN", scale: 1.14 },
  "animals-southern-elephant-seal": { head: "PLAIN", back: "NONE", marking: "PLAIN", scale: 1.2 },
  "animals-western-gorilla": { head: "PLAIN", back: "MANE", marking: "PLAIN", scale: 1.1 },
};

/**
 * How big a character is drawn.
 *
 * Animals report mass, which is the honest axis. Everything else falls back to
 * game power, which at least separates a street-level fighter from a titan.
 * The range is narrow on purpose: a sprite half the size of its neighbour is
 * unreadable long before it is distinctive.
 */
function scaleFor(character: ArchetypeInput): number {
  const mass = character.stats.mass;
  if (typeof mass === "number") {
    return Math.round((0.82 + (mass / 100) * 0.42) * 100) / 100;
  }
  const power = character.stats.strength ?? character.stats.power ?? 70;
  return Math.round((0.9 + (power / 100) * 0.22) * 100) / 100;
}

const HEADS_BY_ARCHETYPE: Record<VisualArchetypeId, readonly HeadFeature[]> = {
  humanoid_medium: ["PLAIN", "HELM", "CREST"],
  humanoid_large: ["PLAIN", "HELM", "HORNS"],
  quadruped_small: ["EARS", "PLAIN", "CREST"],
  quadruped_medium: ["EARS", "HORNS", "PLAIN"],
  quadruped_large: ["HORNS", "TUSKS", "EARS"],
  serpentine: ["PLAIN", "CREST"],
  winged: ["CREST", "PLAIN"],
  aquatic: ["PLAIN", "CREST"],
};

const BACKS_BY_ARCHETYPE: Record<VisualArchetypeId, readonly BackFeature[]> = {
  humanoid_medium: ["NONE", "CAPE", "MANE"],
  humanoid_large: ["MANE", "CAPE", "NONE"],
  quadruped_small: ["NONE", "SPINES"],
  quadruped_medium: ["NONE", "MANE", "SPINES"],
  quadruped_large: ["NONE", "MANE", "SHELL"],
  serpentine: ["NONE"],
  winged: ["NONE", "CAPE"],
  aquatic: ["FIN"],
};

const MARKINGS: readonly Marking[] = ["PLAIN", "STRIPES", "SPOTS", "PATCH"];

/**
 * Nudges the character's own palette into a contrasting accent.
 *
 * Rotating the hue rather than picking from a fixed list keeps the accent
 * related to the character — a red character gets a warm accent — while still
 * separating it from the body it is drawn on.
 */
function accentFrom(palette: [string, string], id: string): string {
  const base = palette[1] ?? palette[0] ?? "#e2e8f0";
  const n = parseInt(base.slice(1), 16);
  if (Number.isNaN(n)) return "#e2e8f0";

  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Swing toward the opposite side of the wheel by a fixed amount per
  // character, so two similar palettes still separate.
  const swing = (hash(id + ":accent") % 3) - 1;
  const mix = (v: number, towards: number) => Math.round(v + (towards - v) * 0.55);
  let out = [
    mix(r, swing >= 0 ? 245 : 90),
    mix(g, swing === 0 ? 245 : 160),
    mix(b, swing <= 0 ? 245 : 90),
  ];

  // Then forced bright. Team identity lives in mid-saturation blues and reds on
  // the ground ring; an accent that landed near one of those would undo it, and
  // a dark accent would vanish against a dark body anyway. Lifting every accent
  // into the pale range keeps markings legible and keeps them out of the team
  // palette's territory by construction rather than by a lookup table.
  const brightest = Math.max(...out);
  if (brightest < ACCENT_MIN_BRIGHTNESS) {
    const lift = ACCENT_MIN_BRIGHTNESS - brightest;
    out = out.map((v) => v + lift);
  }
  const dimmest = Math.min(...out);
  if (dimmest < ACCENT_MIN_FLOOR) {
    out = out.map((v) => v + (ACCENT_MIN_FLOOR - dimmest) * 0.75);
  }

  return `#${out
    .map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export interface IdentityInput extends ArchetypeInput {
  palette: [string, string];
}

/**
 * The identity of one character.
 *
 * Total and deterministic: every character resolves, and always to the same
 * thing. Rules first, hand corrections on top, hash only to separate what the
 * rules leave identical.
 */
export function identityFor(
  character: IdentityInput,
  archetype: VisualArchetypeId,
): IdentityConfig {
  const tags = new Set(character.tags);

  // Rules, in order of how strongly the data implies the feature.
  let head: HeadFeature = pick(character.id, 1, HEADS_BY_ARCHETYPE[archetype]);
  if (tags.has("reptile")) head = "CREST";
  else if (tags.has("big-cat") || tags.has("pack")) head = "EARS";
  else if (tags.has("herd")) head = "HORNS";

  let back: BackFeature = pick(character.id, 2, BACKS_BY_ARCHETYPE[archetype]);
  if (archetype === "aquatic") back = "FIN";
  else if (tags.has("brawler") && archetype.startsWith("quadruped")) back = "MANE";

  let marking: Marking = pick(character.id, 3, MARKINGS);
  if (archetype === "serpentine") marking = pick(character.id, 4, ["BANDS", "PATCH"]);
  else if (tags.has("stealth")) marking = "SPOTS";

  const config: IdentityConfig = {
    scale: scaleFor(character),
    head,
    back,
    marking,
    accent: accentFrom(character.palette, character.id),
  };

  return { ...config, ...IDENTITY_OVERRIDES[character.id] };
}

/**
 * A compact, comparable summary of what a character looks like.
 *
 * Two characters with the same signature are drawn identically — which is what
 * the readability tests assert must not happen inside one battle.
 */
export function identitySignature(config: IdentityConfig): string {
  return [config.scale, config.head, config.back, config.marking, config.accent].join("|");
}
