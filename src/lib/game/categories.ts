/**
 * ---------------------------------------------------------------------------
 * CATEGORY SYSTEM (V2)
 * ---------------------------------------------------------------------------
 * A category owns three things: the stats its characters are rated on, how
 * those stats feed the five axes the battle engine actually fights with, and
 * the synergy groups that reward a coherent squad.
 *
 * The battle engine never reads a category-specific stat key. It asks the
 * category to project a character onto the canonical axes, which is what lets
 * a tiger, an actor and a Norse god share a battlefield in crossover mode
 * without anybody writing a special case.
 *
 * Adding a category = appending one object to CATEGORIES and a pool file under
 * `pools/`. Nothing else in the codebase needs to change.
 */

import type { Rarity } from "./types";

/** The five things the simulator understands, whatever the category calls them. */
export type AxisKey = "power" | "speed" | "defense" | "strategy" | "special";

export const AXIS_KEYS: AxisKey[] = [
  "power",
  "speed",
  "defense",
  "strategy",
  "special",
];

export const AXIS_LABELS: Record<AxisKey, string> = {
  power: "Power",
  speed: "Speed",
  defense: "Defense",
  strategy: "Strategy",
  special: "Special",
};

export interface StatDef {
  key: string;
  label: string;
  icon: string;
  /** Shown in the stat tooltip alongside the game-rating disclaimer. */
  hint: string;
}

export interface SynergyGroup {
  /** Tag carried by characters that belong to this group. */
  tag: string;
  label: string;
  /** Bonus per member beyond the first. Total synergy is capped separately. */
  perMember: number;
}

/** How much of each category stat flows into a canonical axis. */
export type AxisRecipe = Record<AxisKey, Array<[string, number]>>;

export interface Category {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  /** Two-stop gradient used for the category's branding. */
  palette: [string, string];
  accent: string;
  stats: StatDef[];
  axes: AxisRecipe;
  synergies: SynergyGroup[];
  /**
   * Extra wording shown under the ratings. Real people and real animals get a
   * stronger disclaimer than fictional characters.
   */
  disclaimer: string;
  /** True when entries are real people or real animals rather than fiction. */
  realWorld: boolean;
}

/** Total synergy can never exceed this, per the design brief. */
export const MAX_SYNERGY = 0.1;

const COMIC_STATS: StatDef[] = [
  { key: "power", label: "Power", icon: "💥", hint: "Raw destructive output." },
  { key: "speed", label: "Speed", icon: "⚡", hint: "Movement and reaction." },
  { key: "durability", label: "Durability", icon: "🛡", hint: "How much they absorb." },
  { key: "combat", label: "Combat", icon: "⚔", hint: "Fighting skill." },
  { key: "intelligence", label: "Intelligence", icon: "🧠", hint: "Planning and improvisation." },
  { key: "special", label: "Special", icon: "✨", hint: "Signature ability impact." },
];

const COMIC_AXES: AxisRecipe = {
  power: [["power", 0.7], ["combat", 0.3]],
  speed: [["speed", 1]],
  defense: [["durability", 1]],
  strategy: [["intelligence", 0.6], ["combat", 0.4]],
  special: [["special", 1]],
};

export const CATEGORIES: Category[] = [
  {
    id: "marvel",
    name: "MARVEL",
    icon: "🦸",
    tagline: "Heroes, villains and cosmic powers.",
    description:
      "Street-level fighters, mutants, gods and world-enders from Marvel comics and films.",
    palette: ["#7f1d1d", "#ef4444"],
    accent: "#ef4444",
    stats: COMIC_STATS,
    axes: COMIC_AXES,
    synergies: [
      { tag: "avengers", label: "Avengers", perMember: 0.025 },
      { tag: "x-men", label: "X-Men", perMember: 0.025 },
      { tag: "villain", label: "Villains", perMember: 0.025 },
      { tag: "street", label: "Street Level", perMember: 0.02 },
      { tag: "cosmic", label: "Cosmic", perMember: 0.025 },
    ],
    disclaimer:
      "Game ratings created for DRAFT WAR. Not an official Marvel ranking.",
    realWorld: false,
  },
  {
    id: "dc",
    name: "DC",
    icon: "🦇",
    tagline: "Gods, detectives and the Justice League.",
    description:
      "Kryptonians, Amazons, speedsters and Gotham's finest from DC comics and films.",
    palette: ["#1e3a8a", "#fbbf24"],
    accent: "#fbbf24",
    stats: COMIC_STATS,
    axes: COMIC_AXES,
    synergies: [
      { tag: "justice-league", label: "Justice League", perMember: 0.025 },
      { tag: "bat-family", label: "Bat Family", perMember: 0.025 },
      { tag: "villain", label: "Villains", perMember: 0.025 },
      { tag: "titans", label: "Titans", perMember: 0.02 },
      { tag: "cosmic", label: "Cosmic", perMember: 0.025 },
    ],
    disclaimer: "Game ratings created for DRAFT WAR. Not an official DC ranking.",
    realWorld: false,
  },
  {
    id: "hollywood",
    name: "HOLLYWOOD",
    icon: "🎬",
    tagline: "Action stars, on screen.",
    description:
      "Real performers known for action cinema, rated on the kind of roles they are famous for.",
    palette: ["#78350f", "#fbbf24"],
    accent: "#f59e0b",
    stats: [
      { key: "strength", label: "Strength", icon: "💪", hint: "Physical presence on screen." },
      { key: "speed", label: "Speed", icon: "⚡", hint: "Pace of their action work." },
      { key: "combat", label: "Combat", icon: "🥋", hint: "Martial arts and fight training." },
      { key: "weapons", label: "Weapons", icon: "🔫", hint: "Gun and weapon choreography." },
      { key: "tactics", label: "Tactics", icon: "🧠", hint: "The thinking-hero register." },
      { key: "stamina", label: "Stamina", icon: "🔥", hint: "Sustained action output." },
    ],
    axes: {
      power: [["strength", 0.6], ["combat", 0.4]],
      speed: [["speed", 1]],
      defense: [["stamina", 0.6], ["strength", 0.4]],
      strategy: [["tactics", 1]],
      special: [["weapons", 0.6], ["combat", 0.4]],
    },
    synergies: [
      { tag: "martial-arts", label: "Martial Arts", perMember: 0.025 },
      { tag: "muscle", label: "Muscle", perMember: 0.025 },
      { tag: "gunplay", label: "Gunplay", perMember: 0.02 },
      { tag: "veteran", label: "Veterans", perMember: 0.02 },
      { tag: "wrestler", label: "Ring Crossovers", perMember: 0.025 },
    ],
    disclaimer:
      "These are real people. Ratings are a game score based on the action roles they are known for — not a judgement about them, and not a real-world measurement.",
    realWorld: true,
  },
  {
    id: "action-movies",
    name: "ACTION MOVIES",
    icon: "🔫",
    tagline: "One man against everyone.",
    description:
      "Assassins, spies and soldiers from action cinema. The character fights, not the actor.",
    palette: ["#0f172a", "#f43f5e"],
    accent: "#f43f5e",
    stats: [
      { key: "combat", label: "Combat", icon: "⚔", hint: "Close-quarters fighting." },
      { key: "speed", label: "Speed", icon: "⚡", hint: "Movement and reflexes." },
      { key: "weapons", label: "Weapons", icon: "🔫", hint: "Firearms and improvised tools." },
      { key: "tactics", label: "Tactics", icon: "🧠", hint: "Planning and tradecraft." },
      { key: "durability", label: "Durability", icon: "🛡", hint: "Punishment absorbed." },
      { key: "special", label: "Special", icon: "✨", hint: "Signature move impact." },
    ],
    axes: {
      power: [["combat", 0.6], ["weapons", 0.4]],
      speed: [["speed", 1]],
      defense: [["durability", 1]],
      strategy: [["tactics", 1]],
      special: [["special", 1]],
    },
    synergies: [
      { tag: "spy", label: "Spy Network", perMember: 0.025 },
      { tag: "assassin", label: "Assassins", perMember: 0.025 },
      { tag: "military", label: "Military", perMember: 0.025 },
      { tag: "martial-arts", label: "Martial Arts", perMember: 0.025 },
      { tag: "revenge", label: "Revenge Run", perMember: 0.02 },
    ],
    disclaimer:
      "Fictional characters. Game ratings created for DRAFT WAR, not an official ranking.",
    realWorld: false,
  },
  {
    id: "animals",
    name: "ANIMALS",
    icon: "🐅",
    tagline: "The animal kingdom, settled.",
    description:
      "Real animals rated for a game. Nothing here is a scientific prediction of a real encounter.",
    palette: ["#14532d", "#84cc16"],
    accent: "#4ade80",
    stats: [
      { key: "mass", label: "Mass", icon: "🏋", hint: "Size and weight class." },
      { key: "strength", label: "Strength", icon: "💪", hint: "Raw force." },
      { key: "speed", label: "Speed", icon: "⚡", hint: "Burst and agility." },
      { key: "bite", label: "Bite", icon: "🦷", hint: "Bite, claws and horns." },
      { key: "defense", label: "Defense", icon: "🛡", hint: "Hide, armour and bulk." },
      { key: "aggression", label: "Aggression", icon: "🔥", hint: "Willingness to commit." },
    ],
    axes: {
      power: [["strength", 0.5], ["bite", 0.3], ["mass", 0.2]],
      speed: [["speed", 1]],
      defense: [["defense", 0.7], ["mass", 0.3]],
      // Aggression stands in for "commits to the fight" rather than cunning,
      // and the finisher leans on strength so heavyweights are not punished
      // twice for being slow.
      strategy: [["aggression", 0.6], ["speed", 0.4]],
      special: [["bite", 0.5], ["strength", 0.3], ["aggression", 0.2]],
    },
    synergies: [
      { tag: "pack", label: "Pack Hunters", perMember: 0.025 },
      { tag: "predator", label: "Apex Predators", perMember: 0.025 },
      { tag: "herd", label: "Herd", perMember: 0.025 },
      { tag: "reptile", label: "Cold Blooded", perMember: 0.02 },
      { tag: "big-cat", label: "Big Cats", perMember: 0.02 },
    ],
    disclaimer:
      "Real animals, fictional ratings. These numbers are for a party game and are not a scientific claim about any real encounter.",
    realWorld: true,
  },
  {
    id: "fantasy",
    name: "FANTASY",
    icon: "🧙",
    tagline: "Steel, sorcery and dragons.",
    description: "Wizards, warriors and monsters from fantasy literature and film.",
    palette: ["#3730a3", "#a78bfa"],
    accent: "#a78bfa",
    stats: [
      { key: "power", label: "Power", icon: "💥", hint: "Destructive force." },
      { key: "speed", label: "Speed", icon: "⚡", hint: "Movement and reaction." },
      { key: "durability", label: "Durability", icon: "🛡", hint: "How much they absorb." },
      { key: "combat", label: "Combat", icon: "⚔", hint: "Weapon skill." },
      { key: "magic", label: "Magic", icon: "🔮", hint: "Command of the arcane." },
      { key: "special", label: "Special", icon: "✨", hint: "Signature ability impact." },
    ],
    axes: {
      power: [["power", 0.6], ["combat", 0.4]],
      speed: [["speed", 1]],
      defense: [["durability", 1]],
      strategy: [["magic", 0.5], ["combat", 0.5]],
      special: [["special", 0.6], ["magic", 0.4]],
    },
    synergies: [
      { tag: "fellowship", label: "Fellowship", perMember: 0.025 },
      { tag: "mage", label: "Arcane Circle", perMember: 0.025 },
      { tag: "monster", label: "Monsters", perMember: 0.025 },
      { tag: "royal", label: "Royalty", perMember: 0.02 },
      { tag: "dragon", label: "Dragonkin", perMember: 0.025 },
    ],
    disclaimer:
      "Fictional characters. Game ratings created for DRAFT WAR, not an official ranking.",
    realWorld: false,
  },
  {
    id: "video-games",
    name: "VIDEO GAMES",
    icon: "🎮",
    tagline: "Press start to fight.",
    description: "Icons from four decades of video games, from plumbers to demon hunters.",
    palette: ["#0c4a6e", "#22d3ee"],
    accent: "#22d3ee",
    stats: [
      { key: "power", label: "Power", icon: "💥", hint: "Damage output." },
      { key: "speed", label: "Speed", icon: "⚡", hint: "Movement and reaction." },
      { key: "durability", label: "Durability", icon: "🛡", hint: "How much they absorb." },
      { key: "combat", label: "Combat", icon: "⚔", hint: "Fighting skill." },
      { key: "skill", label: "Skill", icon: "🎯", hint: "Precision and technique." },
      { key: "special", label: "Special", icon: "✨", hint: "Signature ability impact." },
    ],
    axes: {
      power: [["power", 0.7], ["combat", 0.3]],
      speed: [["speed", 1]],
      defense: [["durability", 1]],
      strategy: [["skill", 0.6], ["combat", 0.4]],
      special: [["special", 1]],
    },
    synergies: [
      { tag: "nintendo", label: "Mushroom Kingdom", perMember: 0.025 },
      { tag: "shooter", label: "Shooters", perMember: 0.025 },
      { tag: "rpg", label: "Adventurers", perMember: 0.025 },
      { tag: "fighter", label: "Fighting Game", perMember: 0.025 },
      { tag: "stealth", label: "Stealth", perMember: 0.02 },
    ],
    disclaimer:
      "Fictional characters. Game ratings created for DRAFT WAR, not an official ranking.",
    realWorld: false,
  },
  {
    id: "anime",
    name: "ANIME",
    icon: "🍥",
    tagline: "Power levels, unbound.",
    description: "Shonen headliners and their rivals, from ninja villages to pirate crews.",
    palette: ["#831843", "#f472b6"],
    accent: "#f472b6",
    stats: COMIC_STATS,
    axes: COMIC_AXES,
    synergies: [
      { tag: "ninja", label: "Shinobi", perMember: 0.025 },
      { tag: "pirate", label: "Pirate Crew", perMember: 0.025 },
      { tag: "hunter", label: "Hunters", perMember: 0.025 },
      { tag: "villain", label: "Villains", perMember: 0.025 },
      { tag: "swordsman", label: "Swordsmen", perMember: 0.02 },
    ],
    disclaimer:
      "Fictional characters. Game ratings created for DRAFT WAR, not an official ranking.",
    realWorld: false,
  },
];

export const CATEGORIES_BY_ID: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

/** V1 rooms have no category; they are treated as legacy action movies. */
export const LEGACY_CATEGORY_ID = "action-movies";

export function getCategory(id: string | null | undefined): Category {
  return CATEGORIES_BY_ID[id ?? ""] ?? CATEGORIES_BY_ID[LEGACY_CATEGORY_ID];
}

/**
 * Projects a character's category-specific stats onto one canonical axis.
 * Missing stats simply contribute nothing, so a half-filled character still
 * produces a usable number instead of NaN.
 */
export function axisValue(
  category: Category,
  stats: Record<string, number>,
  axis: AxisKey,
): number {
  const recipe = category.axes[axis] ?? [];
  let total = 0;
  let weight = 0;
  for (const [key, w] of recipe) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      total += value * w;
      weight += w;
    }
  }
  if (weight === 0) return 50;
  return total / weight;
}

export function allAxes(
  category: Category,
  stats: Record<string, number>,
): Record<AxisKey, number> {
  return {
    power: axisValue(category, stats, "power"),
    speed: axisValue(category, stats, "speed"),
    defense: axisValue(category, stats, "defense"),
    strategy: axisValue(category, stats, "strategy"),
    special: axisValue(category, stats, "special"),
  };
}

/**
 * Headline 0-100 number shown on every card.
 *
 * It is derived from the same quantity the battle engine fights with — damage
 * output multiplied by survivability — rather than from the mean of the five
 * axes. The mean version was actively misleading at the auction: a character
 * with a huge Strategy score looked strong on the card and contributed little
 * in the fight, so players were bidding against a number that did not predict
 * anything. Within a category, a higher game power now really does mean a
 * better fighter.
 *
 * Across categories the scale is deliberately absolute, so Hollywood tops out
 * lower than Marvel — that is true of the underlying ratings. Crossover games
 * normalise it away; single-category games never need to.
 */
export function computeGamePower(
  category: Category,
  stats: Record<string, number>,
): number {
  const axes = allAxes(category, stats);
  const attack = axes.power * 0.6 + axes.special * 0.2 + axes.strategy * 0.2;
  const hp = 70 + axes.defense * 1.55 + axes.power * 0.45;
  const combat = (attack * hp) / 230;
  return Math.max(1, Math.min(100, Math.round(38 + combat * 0.5)));
}

/** Rarity follows game power so the two never disagree on a card. */
export function rarityForPower(power: number): Rarity {
  if (power >= 90) return "LEGENDARY";
  if (power >= 82) return "EPIC";
  if (power >= 72) return "RARE";
  return "COMMON";
}

/** Suggested opening value, used as the card's "market value" hint. */
export function basePriceForPower(power: number): number {
  // 60 -> 4 credits, 100 -> 12 credits.
  return Math.max(2, Math.min(14, Math.round((power - 52) / 4)));
}
