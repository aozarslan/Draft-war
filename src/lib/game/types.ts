/**
 * Core domain types for DRAFT WAR.
 *
 * Everything in `lib/game` is framework-free and side-effect-free so that the
 * auction engine, the battle simulator and the scoring rules can be unit tested
 * without React, Next.js or Supabase.
 */

export type Phase =
  | "LOBBY"
  | "AUCTION"
  | "TEAM_REVIEW"
  | "MAP_SELECTION"
  | "EVENT"
  | "BATTLE"
  | "RESULTS"
  | "FINISHED";

export const PHASE_ORDER: Phase[] = [
  "LOBBY",
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
 * Gameplay-only statistics. These are invented numbers for balance purposes and
 * do not describe anything about real people or real-world capability.
 */
export interface CharacterStats {
  power: number;
  speed: number;
  defense: number;
  tactics: number;
  special: number;
}

export interface Character extends CharacterStats {
  id: string;
  name: string;
  /** Free-form grouping, e.g. "ACTION", "MARVEL", "ANIMALS". Never switched on. */
  universe: string;
  /** Short flavour line shown on the auction card. */
  title: string;
  rarity: Rarity;
  /** Signature move name; drives the "SPECIAL ABILITY" battle log entries. */
  specialAbility: string;
  /** Drives map + event modifiers. Unknown tags are simply ignored. */
  tags: string[];
  /** Suggested opening price. The room config may override the floor. */
  basePrice: number;
  /** Optional remote artwork. When absent the UI renders procedural art. */
  imageUrl?: string | null;
  /** Two-stop gradient used by the procedural artwork. */
  palette: [string, string];
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

export interface RoomConfig {
  maxPlayers: number;
  minPlayers: number;
  startingCredits: number;
  /** Number of characters put into the auction queue. */
  poolSize: number;
  /** null => derived from player count at game start. */
  charactersPerPlayer: number | null;
  minBid: number;
  auctionSeconds: number;
  /** A bid inside this window extends the clock. */
  antiSnipeWindowSeconds: number;
  antiSnipeExtendSeconds: number;
  auctionOrder: "RANDOM" | "POWER" | "MANUAL";
  mapVoteSeconds: number;
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
  auctionSeconds: 20,
  antiSnipeWindowSeconds: 5,
  antiSnipeExtendSeconds: 5,
  auctionOrder: "RANDOM",
  mapVoteSeconds: 20,
};

export interface PlayerView {
  id: string;
  nickname: string;
  colorIndex: number;
  seat: number;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  credits: number;
  wins: number;
  losses: number;
  points: number;
  gamesPlayed: number;
  roster: RosterEntry[];
}

export interface RosterEntry {
  characterId: string;
  price: number;
}

export interface AuctionView {
  id: string;
  characterId: string;
  orderIndex: number;
  status: "ACTIVE" | "SOLD" | "UNSOLD";
  currentBid: number;
  highBidderId: string | null;
  endsAt: string | null;
  passedPlayerIds: string[];
  winnerId: string | null;
  finalPrice: number | null;
  /** Newest first, capped for payload size. */
  history: { playerId: string; amount: number; at: string }[];
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
}

export interface BattleResult {
  seed: string;
  mapId: string;
  eventId: string;
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
