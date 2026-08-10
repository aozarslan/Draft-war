/**
 * Core domain types for DRAFT WAR.
 *
 * Everything in `lib/game` is framework-free and side-effect-free so that the
 * auction engine, the battle simulator and the scoring rules can be unit tested
 * without React, Next.js or Supabase.
 */

export type Phase =
  | "LOBBY"
  | "CATEGORY"
  | "AUCTION"
  | "TEAM_REVIEW"
  | "MAP_SELECTION"
  | "EVENT"
  | "BATTLE"
  | "RESULTS"
  | "FINISHED";

export const PHASE_ORDER: Phase[] = [
  "LOBBY",
  "CATEGORY",
  "AUCTION",
  "TEAM_REVIEW",
  "MAP_SELECTION",
  "EVENT",
  "BATTLE",
  "RESULTS",
  "FINISHED",
];

export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

/**
 * A character in any category.
 *
 * `stats` is deliberately an open record: the keys come from the character's
 * category (Marvel rates Durability, Animals rate Bite), and only the category
 * knows how to project them onto the axes the battle engine fights with. That
 * is what allows thousands of characters across unrelated universes to live in
 * one table and one renderer.
 *
 * Every number here is a GAME RATING invented for DRAFT WAR. For real people
 * and real animals in particular, it is not a factual measurement of anything.
 */
export interface Character {
  id: string;
  name: string;
  categoryId: string;
  /** Source universe, e.g. "Marvel Comics", "Wild", "The Lord of the Rings". */
  universe: string;
  /** Incarnation, e.g. "MCU", "Comics", "Animated". Null when not relevant. */
  version: string | null;
  /** Short flavour line written for the card. */
  title: string;
  /** Longer blurb, normally the Wikipedia short description. */
  description: string;
  /** For film characters: who plays them. Null elsewhere. */
  actor: string | null;
  rarity: Rarity;
  /** Category-specific ratings, 0-100. */
  stats: Record<string, number>;
  /** Headline 0-100 rating, the mean of the five canonical axes. */
  gamePower: number;
  abilities: string[];
  /** Drives synergy, map modifiers and event modifiers. */
  tags: string[];
  /** Suggested market value shown on the card. The auction floor is config. */
  basePrice: number;

  // ---- Wikipedia / Wikimedia provenance -----------------------------------
  wikiTitle: string | null;
  wikiUrl: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  /** Where the image came from, e.g. "Wikimedia Commons". */
  imageSource: string | null;
  /** License short name as reported by Wikimedia, when available. */
  imageLicense: string | null;
  /** Author/credit string as reported by Wikimedia, when available. */
  imageCredit: string | null;

  /** Two-stop gradient used by the generated placeholder artwork. */
  palette: [string, string];
}

/**
 * The compact shape pool files are authored in. Everything derivable — game
 * power, rarity, price, palette — is computed, so a new character is one line.
 */
export interface PoolEntry {
  /** Display name. */
  n: string;
  /** Wikipedia page title to look up. Defaults to the name. */
  w?: string | null;
  /** Universe label. */
  u: string;
  /** Incarnation / version. */
  v?: string | null;
  /** Flavour line for the card. */
  t: string;
  /** Synergy and modifier tags. */
  g: string[];
  /** Ratings in the order of the category's stat list. */
  s: [number, number, number, number, number, number];
  /** Signature abilities. */
  ab?: string[];
  /** Actor, for film characters. */
  a?: string | null;
}

export interface MapModifier {
  /** Characters carrying this tag get the bonus. */
  tag: string;
  /** Multiplicative bonus, e.g. 0.05 = +5%. */
  bonus: number;
}

export interface BattleMap {
  id: string;
  name: string;
  description: string;
  modifiers: MapModifier[];
  palette: [string, string];
  icon: string;
}

export type EventEffectKind =
  | "TAG_BONUS"
  | "FIRST_STRIKE_FASTEST"
  | "DOUBLE_MAP_MODIFIERS"
  | "RANDOM_STAT_DRAIN";

export interface EventCard {
  id: string;
  name: string;
  description: string;
  kind: EventEffectKind;
  tag?: string;
  /** For TAG_BONUS: signed multiplier, e.g. +0.10 or -0.10. */
  amount?: number;
  icon: string;
}

/** How the category for a game gets decided. */
export type CategoryMode = "HOST" | "VOTE" | "RANDOM";

export interface RoomConfig {
  maxPlayers: number;
  minPlayers: number;
  startingCredits: number;
  /** Number of characters put into the auction queue. */
  poolSize: number;
  /** null => derived from player count at game start. */
  charactersPerPlayer: number | null;
  minBid: number;
  /**
   * Seconds on the clock when a character opens, and — since V2 — the clock a
   * bid resets to. Every accepted bid puts the full time back, so an auction
   * only ends when nobody answers for that long.
   */
  auctionSeconds: number;
  auctionOrder: "RANDOM" | "POWER" | "MANUAL";
  mapVoteSeconds: number;
  /** Category ids in play. More than one produces a crossover game. */
  categories: string[];
  categoryMode: CategoryMode;
  categoryVoteSeconds: number;
  /** Character ids, only used when auctionOrder === "MANUAL". */
  manualOrder?: string[];
}

export const DEFAULT_CONFIG: RoomConfig = {
  maxPlayers: 4,
  minPlayers: 2,
  startingCredits: 40,
  poolSize: 20,
  charactersPerPlayer: null,
  minBid: 1,
  auctionSeconds: 30,
  auctionOrder: "RANDOM",
  mapVoteSeconds: 20,
  categories: [],
  categoryMode: "HOST",
  categoryVoteSeconds: 25,
};

export interface RosterEntry {
  characterId: string;
  price: number;
}

export interface BattleLogEntry {
  round: number;
  /** Playback offset from the start of the cinematic, in milliseconds. */
  atMs: number;
  kind:
    | "ROUND_START"
    | "ATTACK"
    | "CRIT"
    | "SPECIAL"
    | "BLOCK"
    | "ELIMINATION"
    | "END";
  text: string;
  actorId?: string;
  actorTeamId?: string;
  targetId?: string;
  targetTeamId?: string;
  damage?: number;
}

export interface CombatantResult {
  characterId: string;
  playerId: string;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  specials: number;
  survived: boolean;
  /** 0..100 remaining hp percentage. */
  survivalPct: number;
  /** Composite performance score, 0..100+. */
  performance: number;
  price: number;
  /** performance / max(price, 1), rounded to 2 decimals. */
  valueScore: number;
}

export interface TeamResult {
  playerId: string;
  rank: number;
  points: number;
  survivors: number;
  totalDamage: number;
  remainingHpPct: number;
  winProbability: number;
  teamRating: number;
  /** Named synergies the squad triggered, for the results screen. */
  synergies: { label: string; bonus: number }[];
}

export interface BattleResult {
  seed: string;
  mapId: string;
  eventId: string;
  /** Categories that were in play. */
  categoryIds: string[];
  log: BattleLogEntry[];
  durationMs: number;
  teams: TeamResult[];
  combatants: CombatantResult[];
  winnerPlayerId: string;
  mvp: { playerId: string; characterId: string } | null;
  awards: {
    bestPerformer: CombatantResult | null;
    biggestSurprise: CombatantResult | null;
    bestValue: CombatantResult | null;
    worstValue: CombatantResult | null;
  };
}
