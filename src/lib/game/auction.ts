import type { Character, RoomConfig } from "./types";
import { createRng } from "./rng";

/**
 * ---------------------------------------------------------------------------
 * AUCTION ENGINE (pure)
 * ---------------------------------------------------------------------------
 * These functions are the written specification of the auction rules. The
 * authoritative copy runs inside Postgres (`supabase/migrations/0001_init.sql`,
 * functions `place_bid` / `pass_auction`), because only the database can settle
 * two simultaneous bids atomically.
 *
 * The TypeScript copy exists so that
 *   a) the UI can grey out impossible buttons before the round-trip, and
 *   b) the rules can be unit tested without a database.
 *
 * If you change a rule here, change it in the SQL too — `tests/auction.test.ts`
 * documents the expected behaviour of both.
 */

export const AUCTION_ERRORS = {
  NOT_IN_ROOM: "You are not part of this room.",
  WRONG_PHASE: "That action is not available right now.",
  NO_ACTIVE_AUCTION: "There is no auction running.",
  AUCTION_CLOSED: "This auction has already ended.",
  ALREADY_PASSED: "You already passed on this character.",
  ROSTER_FULL: "Your roster is full.",
  ALREADY_HIGH_BIDDER: "You are already the highest bidder.",
  BID_TOO_LOW: "Someone else placed a higher bid.",
  NOT_ENOUGH_CREDITS: "Not enough credits.",
  RESERVE_REQUIRED: "You must keep credits to fill your remaining slots.",
  MUST_BID: "Too few characters left — you cannot pass on this one.",
} as const;

export type AuctionErrorCode = keyof typeof AUCTION_ERRORS;

export interface RuleResult {
  ok: boolean;
  code?: AuctionErrorCode;
  message?: string;
}

const fail = (code: AuctionErrorCode): RuleResult => ({
  ok: false,
  code,
  message: AUCTION_ERRORS[code],
});

const OK: RuleResult = { ok: true };

/** Roster size every player has to fill. Five, unless the host changed it. */
export function rosterSize(
  config: Pick<RoomConfig, "charactersPerPlayer">,
): number {
  const n = Math.round(config.charactersPerPlayer);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * How many characters go into the auction.
 *
 * Always exactly `players x roster`, so the draft consumes the pool precisely:
 * five players drafting five each auction 25 characters and finish 25/25 with
 * nothing unsold. That equality is also what makes passing impossible in a
 * full game — every character has to find an owner.
 */
export function draftSize(
  playerCount: number,
  config: Pick<RoomConfig, "charactersPerPlayer">,
): number {
  return Math.max(1, playerCount) * rosterSize(config);
}

/**
 * The most a player may legally bid: they have to keep `minBid` in reserve for
 * every slot they still need to fill *after* this one.
 *
 * 10 credits, 2 slots left, min bid 1 -> 9
 */
export function maxAllowedBid(
  credits: number,
  slotsRemaining: number,
  minBid: number,
): number {
  if (slotsRemaining <= 0) return 0;
  const reserve = (slotsRemaining - 1) * minBid;
  return Math.max(0, credits - reserve);
}

/** The smallest bid that would currently take the lead. */
export function minAllowedBid(
  currentBid: number,
  hasBids: boolean,
  minBid: number,
): number {
  return hasBids ? currentBid + 1 : minBid;
}

export interface BidderState {
  playerId: string;
  credits: number;
  slotsRemaining: number;
  hasPassed: boolean;
}

export interface AuctionState {
  status: "ACTIVE" | "SOLD" | "UNSOLD";
  currentBid: number;
  highBidderId: string | null;
  /** epoch ms */
  endsAt: number;
}

export interface BidContext {
  auction: AuctionState;
  bidder: BidderState;
  amount: number;
  /** epoch ms, always the *server* clock */
  now: number;
  minBid: number;
}

/** Rules 1–8 of section 47, in order. */
export function validateBid(ctx: BidContext): RuleResult {
  const { auction, bidder, amount, now, minBid } = ctx;

  if (auction.status !== "ACTIVE") return fail("AUCTION_CLOSED");
  if (now >= auction.endsAt) return fail("AUCTION_CLOSED");
  if (bidder.slotsRemaining <= 0) return fail("ROSTER_FULL");
  if (bidder.hasPassed) return fail("ALREADY_PASSED");
  if (auction.highBidderId === bidder.playerId)
    return fail("ALREADY_HIGH_BIDDER");

  const min = minAllowedBid(
    auction.currentBid,
    auction.highBidderId !== null,
    minBid,
  );
  if (!Number.isInteger(amount) || amount < min) return fail("BID_TOO_LOW");
  if (amount > bidder.credits) return fail("NOT_ENOUGH_CREDITS");

  const max = maxAllowedBid(bidder.credits, bidder.slotsRemaining, minBid);
  if (amount > max) return fail("RESERVE_REQUIRED");

  return OK;
}

export interface PassContext {
  auction: AuctionState;
  bidder: BidderState;
  /** Characters still to be auctioned AFTER the current one. */
  supplyAfterCurrent: number;
  /** Sum of every player's unfilled slots, including this player's. */
  totalRemainingDemand: number;
}

/**
 * Passing is normally free, but it must never make the draft unsolvable: if the
 * remaining supply exactly matches remaining demand, every character has to
 * find an owner, so passing is blocked for everyone. With the default
 * 4 players x 5 characters = 20 character pool this means no character can ever
 * go unsold, which is the intended behaviour.
 */
export function validatePass(ctx: PassContext): RuleResult {
  const { auction, bidder, supplyAfterCurrent, totalRemainingDemand } = ctx;

  if (auction.status !== "ACTIVE") return fail("AUCTION_CLOSED");
  if (bidder.hasPassed) return fail("ALREADY_PASSED");
  if (bidder.slotsRemaining <= 0) return fail("ROSTER_FULL");
  if (auction.highBidderId === bidder.playerId)
    return fail("ALREADY_HIGH_BIDDER");
  if (supplyAfterCurrent < totalRemainingDemand) return fail("MUST_BID");

  return OK;
}

/**
 * V2 clock: every accepted bid puts the full clock back rather than nudging the
 * deadline. A character sells when nobody has answered for a whole
 * `auctionSeconds` (30 by default), which is much easier to call out loud
 * across a table than "it added five seconds because you were inside the
 * window".
 *
 * Returns the new deadline in epoch ms.
 */
export function resetDeadline(
  now: number,
  config: Pick<RoomConfig, "auctionSeconds">,
): number {
  return now + config.auctionSeconds * 1000;
}

/**
 * An auction can close before the clock runs out when nobody is left who is
 * both able and willing to bid.
 */
export function shouldResolveEarly(
  bidders: BidderState[],
  auction: AuctionState,
): boolean {
  const stillLive = bidders.filter(
    (b) =>
      !b.hasPassed &&
      b.slotsRemaining > 0 &&
      b.playerId !== auction.highBidderId,
  );
  return stillLive.length === 0;
}

/**
 * Builds the ordered list of character ids to auction.
 *
 * `characters` is already filtered to the categories in play. The pool is
 * SELECTED first and ordered second — with a 50-character category and a
 * 25-character game, taking the first twenty-five every time would mean every
 * Marvel game drafted the same heroes. Selection happens once, server-side,
 * before the first character opens, and is then persisted with the game.
 */
export function buildAuctionQueue(
  characters: Character[],
  config: Pick<RoomConfig, "auctionOrder" | "manualOrder">,
  seed: string,
  size: number,
): string[] {
  const wanted = Math.min(Math.max(1, size), characters.length);
  const rng = createRng(seed);

  switch (config.auctionOrder) {
    case "POWER": {
      // Strongest first, and the pool is the strongest `size` of the category.
      return [...characters]
        .sort((a, b) => b.gamePower - a.gamePower || a.id.localeCompare(b.id))
        .slice(0, wanted)
        .map((c) => c.id);
    }
    case "MANUAL": {
      const ids = new Set(characters.map((c) => c.id));
      const manual = (config.manualOrder ?? []).filter((id) => ids.has(id));
      const rest = rng
        .shuffle(characters.map((c) => c.id))
        .filter((id) => !manual.includes(id));
      return [...manual, ...rest].slice(0, wanted);
    }
    case "RANDOM":
    default:
      return rng.shuffle(characters.map((c) => c.id)).slice(0, wanted);
  }
}
