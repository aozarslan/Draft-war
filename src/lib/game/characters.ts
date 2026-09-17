import {
  CATEGORIES,
  basePriceForPower,
  computeGamePower,
  getCategory,
  rarityForPower,
} from "./categories";
import type { Character, PoolEntry } from "./types";

import { APEX } from "./pools/apex";
import { VIGIL } from "./pools/vigil";
import { HOLLYWOOD } from "./pools/hollywood";
import { ACTION_MOVIES } from "./pools/action-movies";
import { ANIMALS } from "./pools/animals";
import { FANTASY } from "./pools/fantasy";
import { VIDEO_GAMES } from "./pools/video-games";
import { ANIME } from "./pools/anime";
import { FOOTBALL } from "./pools/football";
import { BASKETBALL } from "./pools/basketball";

/**
 * ---------------------------------------------------------------------------
 * CHARACTER POOLS
 * ---------------------------------------------------------------------------
 * Pool files under `pools/` are pure data in a deliberately terse shape. Game
 * power, rarity, price and artwork palette are all derived here, so adding a
 * character is one line and can never disagree with itself.
 *
 * Descriptions and images are filled in from Wikipedia by
 * `scripts/enrich-characters.ts`, which writes `data/wiki-cache.json`; the SQL
 * seed generator merges that in. Nothing here fetches at runtime.
 *
 * Every rating in these files is a GAME RATING invented for DRAFT WAR. For the
 * Hollywood and Animals categories in particular, they describe how something
 * plays in this game and nothing about the real world.
 */

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * Placeholder artwork palette: the category's colours, nudged per character so
 * a grid of cards has variety while still reading as one category.
 */
function paletteFor(categoryPalette: [string, string], seed: string): [string, string] {
  const h = hash(seed);
  const shift = (h % 40) - 20;
  const [h0, s0, l0] = hexToHsl(categoryPalette[0]);
  const [h1, s1, l1] = hexToHsl(categoryPalette[1]);
  return [
    hslToHex(h0 + shift, s0, Math.min(0.5, Math.max(0.12, l0 + ((h >> 8) % 9) / 100))),
    hslToHex(h1 + shift, s1, Math.min(0.72, Math.max(0.4, l1 + ((h >> 16) % 11) / 100))),
  ];
}

/** Turns a terse pool entry into a full character. */
export function buildCharacter(categoryId: string, entry: PoolEntry): Character {
  const category = getCategory(categoryId);

  const stats: Record<string, number> = {};
  category.stats.forEach((stat, i) => {
    stats[stat.key] = entry.s[i] ?? 50;
  });

  const gamePower = computeGamePower(category, stats);

  return {
    id: `${categoryId}-${slugify(entry.n)}`,
    name: entry.n,
    categoryId,
    universe: entry.u,
    version: entry.v ?? null,
    title: entry.t,
    description: "",
    actor: entry.a ?? null,
    rarity: rarityForPower(gamePower),
    stats,
    gamePower,
    abilities: entry.ab ?? [],
    tags: entry.g,
    basePrice: basePriceForPower(gamePower),
    wikiTitle: entry.w === null ? null : (entry.w ?? entry.n),
    wikiUrl: null,
    imageUrl: null,
    thumbnailUrl: null,
    imageSource: null,
    imageLicense: null,
    imageCredit: null,
    palette: paletteFor(category.palette, entry.n),
  };
}

export function buildPool(categoryId: string, entries: PoolEntry[]): Character[] {
  return entries.map((e) => buildCharacter(categoryId, e));
}

export const POOLS: Record<string, PoolEntry[]> = {
  apex: APEX,
  vigil: VIGIL,
  hollywood: HOLLYWOOD,
  "action-movies": ACTION_MOVIES,
  animals: ANIMALS,
  fantasy: FANTASY,
  "video-games": VIDEO_GAMES,
  anime: ANIME,
  football: FOOTBALL,
  basketball: BASKETBALL,
};

export const CHARACTERS: Character[] = CATEGORIES.flatMap((c) =>
  buildPool(c.id, POOLS[c.id] ?? []),
);

export const CHARACTERS_BY_ID: Record<string, Character> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, c]),
);

export function charactersInCategories(categoryIds: string[]): Character[] {
  const wanted = new Set(categoryIds);
  return CHARACTERS.filter((c) => wanted.has(c.categoryId));
}

export function categoryCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of CHARACTERS) counts[c.categoryId] = (counts[c.categoryId] ?? 0) + 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Presentation metadata
// ---------------------------------------------------------------------------

/**
 * How a character looks and is spoken about. Never how it fights.
 *
 * Deliberately a *separate* table rather than fields on `Character`, and the
 * reason is architectural rather than tidy. At runtime the auction reads its
 * characters from Postgres, not from these files — the database is the
 * gameplay authority. If nicknames and silhouettes were part of `Character`
 * they would need columns, a migration and a seed, and from that moment a
 * presentation change could fail a draft.
 *
 * Keeping them here makes the guarantee structural instead of promised:
 * visual metadata is compiled into the client bundle, never written to the
 * database, never carried in `battle_result`, and therefore *cannot* be read
 * by `simulateBattle` even by accident. Artwork cannot move a number because
 * artwork never reaches the machine that computes numbers.
 */
export interface CharacterVisual {
  /** The short name players say out loud. Absent until authored. */
  nick?: string;
  /** Hand-authored look, merged over whatever the identity rules derive. */
  i?: PoolEntry["i"];
  /** Body plan, when the rules would pick the wrong one. */
  va?: PoolEntry["va"];
}

/**
 * Every authored look in the catalogue, keyed by character id.
 *
 * Built from the same pool entries `CHARACTERS` is built from, so a character
 * and its appearance are written on one line and cannot drift apart. Entries
 * with nothing authored are omitted rather than stored empty, so the table
 * stays small and `visualFor` returning nothing means "the rules decide".
 */
export const CHARACTER_VISUALS: Record<string, CharacterVisual> = (() => {
  const out: Record<string, CharacterVisual> = {};
  for (const category of CATEGORIES) {
    for (const entry of POOLS[category.id] ?? []) {
      if (!entry.nick && !entry.i && !entry.va) continue;
      const visual: CharacterVisual = {};
      if (entry.nick) visual.nick = entry.nick;
      if (entry.i) visual.i = entry.i;
      if (entry.va) visual.va = entry.va;
      out[`${category.id}-${slugify(entry.n)}`] = visual;
    }
  }
  return out;
})();

/** The authored look for a character, or nothing when the rules decide. */
export function visualFor(characterId: string): CharacterVisual | undefined {
  return CHARACTER_VISUALS[characterId];
}

/**
 * The name to shout during an auction, falling back to the catalogue name.
 *
 * A nickname is a social object — "don't let him get THE KING" — so the
 * fallback matters: a character without one is still referable, just less
 * quotable.
 */
export function nicknameFor(characterId: string, fallback: string): string {
  return CHARACTER_VISUALS[characterId]?.nick ?? fallback;
}
