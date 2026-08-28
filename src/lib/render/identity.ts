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
import { visualFor } from "@/lib/game/characters";

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

/**
 * A held object.
 *
 * Props are the cheapest way to separate two characters who share a body: at
 * arena scale a sword and a ball read from further away than any facial
 * feature, because they break the outline rather than decorate it. They are
 * drawn from the same reusable tile sheet as every other identity layer — one
 * tile per prop for the whole catalogue, never one per character.
 *
 * Visual only. A hammer does not hit harder than a staff.
 */
export type PropFeature =
  | "NONE"
  | "BLADE"
  | "STAFF"
  | "BOW"
  | "SHIELD"
  | "BALL"
  /**
   * A ball carried rather than dribbled along the ground.
   *
   * `BALL` hangs off the *foot* anchor, because a football sits on the grass.
   * A basketball is held, so it needs the hand — and a tile declares one slot,
   * not two. Rather than bend `BALL` to mean both and put a basketball in the
   * mud, the sheet gets one more row. Same tile system, same anchor the other
   * seven carried props use.
   */
  | "BALL_HELD"
  | "HAMMER"
  | "SPEAR"
  | "ORB";

/**
 * Body proportions.
 *
 * Not five sprite sheets: a non-uniform scale applied when the composed frame
 * is blitted, so the body, its markings, its horns and its prop stretch
 * together and cannot come apart. Feet stay on the ground line and the body
 * stays centred over its own shadow.
 *
 * Visual only. A towering character is not tougher.
 */
export type BuildFeature =
  | "NORMAL"
  | "SLIGHT"
  | "HEAVY"
  | "TOWERING"
  | "SQUAT";

/**
 * How each build stretches the drawn box, as (width, height) multipliers.
 *
 * Deliberately modest. These multiply a sprite that is already about thirty
 * screen pixels tall, and past roughly a quarter either way a pixel body stops
 * reading as the same creature and starts reading as a drawing mistake. The
 * pairs are chosen so silhouette *area* differs as much as the outline does —
 * SQUAT and TOWERING are near-inverses, which is what makes them tell apart at
 * a glance rather than on inspection.
 */
export const BUILD_SCALE: Record<BuildFeature, readonly [number, number]> = {
  NORMAL: [1, 1],
  SLIGHT: [0.86, 1.02],
  HEAVY: [1.22, 0.98],
  TOWERING: [1.04, 1.24],
  SQUAT: [1.2, 0.84],
};

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
   * A held object, or none.
   *
   * Defaults to NONE for every character in the catalogue: props are authored,
   * never derived. A rule that handed swords out by tag would put one in the
   * paw of every predator in the Animals pool.
   */
  prop: PropFeature;
  /**
   * Proportions.
   *
   * Defaults to NORMAL, which is exactly the geometry the renderer used before
   * builds existed — so a character that does not ask for a build is drawn the
   * way it always was, pixel for pixel.
   */
  build: BuildFeature;
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
  "animals-leopard": { head: "EARS", back: "NONE", marking: "SPOTS", scale: 0.94 },
  "animals-jaguar": { head: "EARS", back: "NONE", marking: "SPOTS", scale: 0.98 },
  "animals-spotted-hyena": { head: "EARS", back: "SPINES", marking: "SPOTS", scale: 0.92 },
  "animals-polar-bear": { head: "EARS", back: "NONE", marking: "PLAIN", scale: 1.14 },
  "animals-hippopotamus": { head: "TUSKS", back: "NONE", marking: "PLAIN", scale: 1.16 },
  "animals-african-buffalo": { head: "HORNS", back: "NONE", marking: "PLAIN", scale: 1.1 },
  "animals-american-bison": { head: "HORNS", back: "MANE", marking: "PLAIN", scale: 1.12 },
  "animals-muskox": { head: "HORNS", back: "MANE", marking: "PLAIN", scale: 1.04 },
  "animals-moose": { head: "ANTLERS", back: "NONE", marking: "PLAIN", scale: 1.12 },
  "animals-wild-boar": { head: "TUSKS", back: "SPINES", marking: "PLAIN", scale: 0.92 },
  "animals-komodo-dragon": { head: "CREST", back: "SPINES", marking: "PATCH", scale: 0.96 },
  "animals-wolverine": { head: "EARS", back: "NONE", marking: "PATCH", scale: 0.82 },
  "animals-green-anaconda": { head: "PLAIN", back: "NONE", marking: "BANDS", scale: 1.1 },
  "animals-common-ostrich": { head: "CREST", back: "NONE", marking: "PATCH", scale: 1.08 },
  "animals-southern-cassowary": { head: "CREST", back: "NONE", marking: "PATCH", scale: 1.0 },
  "animals-orca": { head: "PLAIN", back: "FIN", marking: "PATCH", scale: 1.2 },
  "animals-southern-elephant-seal": { head: "PLAIN", back: "NONE", marking: "PLAIN", scale: 1.2 },
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
    // Both authored rather than derived, so nothing in the legacy catalogue
    // silently grows a weapon or changes shape.
    prop: "NONE",
    build: "NORMAL",
    accent: accentFrom(character.palette, character.id),
  };

  // Precedence, weakest to strongest: derived rules, then the legacy override
  // table, then whatever the pool entry authored. The pool wins because it is
  // the new home for hand-authored looks; the override table stays until the
  // characters it covers are rewritten, and until then the two cannot fight
  // because only one of them will ever hold a given character.
  return {
    ...config,
    ...IDENTITY_OVERRIDES[character.id],
    ...visualFor(character.id)?.i,
  };
}

/**
 * Everything about a character's look, as one comparable string.
 *
 * Exists so "are these two distinguishable?" is a question with an exact
 * answer rather than an opinion. It deliberately omits `accent`: two
 * characters that differ only in the shade of their markings are *not*
 * distinguishable at arena scale, and a signature that claimed otherwise
 * would let a catalogue full of near-identical creatures pass a test.
 *
 * Scale is rounded to the same two decimals the identity layer authors it at.
 */
export function visualSignature(
  // A plain string, matching `shapeKey` and `identitySignature`. The art the
  // renderer carries types its body plan as a string, and a signature that
  // could not accept it would have to be cast at every call site.
  archetype: string,
  identity: IdentityConfig,
): string {
  return [
    archetype,
    identity.head,
    identity.back,
    identity.marking,
    identity.build,
    identity.prop,
    identity.scale.toFixed(2),
  ].join("|");
}

/**
 * Separates any two characters in one battle that resolved to the same look.
 *
 * Catalogue-wide collisions are tolerable — nobody sees 268 sprites at once —
 * but two identical creatures standing next to each other is exactly the
 * problem this layer exists to solve. The nudge is applied in roster order and
 * depends on nothing but the roster, so every viewer separates the same pair
 * the same way.
 *
 * Only the *second* of a colliding pair moves, and only along one axis at a
 * time, so a character's look stays as close to what its own data implies as
 * the collision allows.
 */
export function disambiguate(
  roster: {
    characterId: string;
    teamId?: string;
    /** The body plan. Two plans are never the same look, whatever else matches. */
    archetype?: string;
    config: IdentityConfig;
  }[],
): Map<string, IdentityConfig> {
  const out = new Map<string, IdentityConfig>();
  const takenOverall = new Set<string>();
  const takenPerTeam = new Map<string, Set<string>>();

  for (const entry of roster) {
    const team = entry.teamId ?? "";
    if (!takenPerTeam.has(team)) takenPerTeam.set(team, new Set());
    const teammates = takenPerTeam.get(team)!;

    let config = entry.config;
    let attempt = 0;

    // Two conditions, and the team one is stricter. Across the field a colour
    // difference is enough to separate two creatures; between teammates it is
    // not, because they already share a team colour on the ground ring — so
    // within a squad the *shape* has to differ, not just the accent.
    const clashes = (c: IdentityConfig) =>
      takenOverall.has(identitySignature(c, entry.archetype)) ||
      teammates.has(shapeKey(c, entry.archetype));

    while (clashes(config) && attempt < DISAMBIGUATION_STEPS.length) {
      config = DISAMBIGUATION_STEPS[attempt](config, entry.characterId);
      attempt++;
    }

    takenOverall.add(identitySignature(config, entry.archetype));
    teammates.add(shapeKey(config, entry.archetype));
    out.set(entry.characterId, config);
  }

  return out;
}

/**
 * What a character looks like with the colour taken away.
 *
 * Silhouette, markings and features — everything the eye reads before it reads
 * hue. Two teammates are required to differ on this, not merely on their
 * accent.
 */
export function shapeKey(config: IdentityConfig, archetype?: string): string {
  // Body plan first, because it outranks everything else on this list: a
  // large quadruped and a medium one are not the same creature drawn at two
  // sizes, and treating them as a collision made the disambiguator "fix" a
  // pair that was never confusable — silently overwriting a hand-authored
  // scale to do it.
  //
  // `build` and `prop` are here for the same reason. They arrived in S2 and
  // were not added to this key, so two characters differing only by build read
  // as identical and one of them got nudged for nothing.
  return [
    archetype ?? "",
    config.scale,
    config.head,
    config.back,
    config.marking,
    config.build,
    config.prop,
  ].join("|");
}

/**
 * The order in which a colliding look is nudged.
 *
 * It follows how the eye reads a sprite: silhouette first, then markings, then
 * the head and back features, and colour only as a last resort. Changing the
 * accent to separate two characters is the weakest possible fix — it is the
 * one thing a colour-blind viewer, a small screen or a dark room all take
 * away first.
 */
const DISAMBIGUATION_STEPS: ((c: IdentityConfig, id: string) => IdentityConfig)[] = [
  // 1. Silhouette.
  (c) => ({ ...c, scale: Math.round(c.scale * 0.86 * 100) / 100 }),
  (c) => ({ ...c, scale: Math.round(c.scale * 1.32 * 100) / 100 }),
  // 2. Markings.
  (c, id) => ({ ...c, marking: pick(id, 91, MARKINGS.filter((m) => m !== c.marking)) }),
  (c, id) => ({ ...c, marking: pick(id, 94, MARKINGS.filter((m) => m !== c.marking)) }),
  // 3. Back and head features.
  (c, id) => ({
    ...c,
    back: pick(id, 92, (["NONE", "MANE", "SPINES", "CAPE"] as BackFeature[]).filter((b) => b !== c.back)),
  }),
  (c, id) => ({
    ...c,
    head: pick(id, 93, (["PLAIN", "HORNS", "EARS", "CREST"] as HeadFeature[]).filter((h) => h !== c.head)),
  }),
  // 4. Colour, and only now.
  (c, id) => ({ ...c, accent: accentFrom([c.accent, c.accent], id + ":again") }),
];

/**
 * A compact, comparable summary of what a character looks like.
 *
 * Two characters with the same signature are drawn identically — which is what
 * the readability tests assert must not happen inside one battle.
 */
export function identitySignature(config: IdentityConfig, archetype?: string): string {
  return [
    archetype ?? "",
    config.scale,
    config.head,
    config.back,
    config.marking,
    config.build,
    config.prop,
    config.accent,
  ].join("|");
}
