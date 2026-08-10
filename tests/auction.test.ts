import { describe, expect, it } from "vitest";
import {
  buildAuctionQueue,
  charactersPerPlayer,
  maxAllowedBid,
  minAllowedBid,
  resetDeadline,
  shouldResolveEarly,
  validateBid,
  validatePass,
  type AuctionState,
  type BidderState,
} from "../src/lib/game/auction";
import { charactersInCategories } from "../src/lib/game/characters";
import { DEFAULT_CONFIG } from "../src/lib/game/types";

const NOW = 1_700_000_000_000;
const MARVEL_POOL = charactersInCategories(["marvel"]);

const auction = (over: Partial<AuctionState> = {}): AuctionState => ({
  status: "ACTIVE",
  currentBid: 0,
  highBidderId: null,
  endsAt: NOW + 20_000,
  ...over,
});

const bidder = (over: Partial<BidderState> = {}): BidderState => ({
  playerId: "p1",
  credits: 40,
  slotsRemaining: 5,
  hasPassed: false,
  ...over,
});

describe("roster sizing", () => {
  it("divides the pool across the players who actually turned up", () => {
    expect(charactersPerPlayer(4, 20)).toBe(5);
    expect(charactersPerPlayer(3, 20)).toBe(6); // 2 characters go unused
    expect(charactersPerPlayer(2, 20)).toBe(10);
  });

  it("honours a host override but never oversubscribes the pool", () => {
    expect(charactersPerPlayer(4, 20, 3)).toBe(3);
    expect(charactersPerPlayer(4, 20, 9)).toBe(5);
  });
});

describe("credit reserve rule", () => {
  it("keeps one credit back for every remaining slot", () => {
    // The example from the brief: 10 credits, 2 slots to fill -> max 9.
    expect(maxAllowedBid(10, 2, 1)).toBe(9);
    expect(maxAllowedBid(40, 5, 1)).toBe(36);
    expect(maxAllowedBid(3, 3, 1)).toBe(1);
    expect(maxAllowedBid(7, 1, 1)).toBe(7);
  });

  it("returns nothing biddable once the roster is full", () => {
    expect(maxAllowedBid(30, 0, 1)).toBe(0);
  });

  it("rejects a bid that would break the reserve", () => {
    const result = validateBid({
      auction: auction(),
      bidder: bidder({ credits: 10, slotsRemaining: 2 }),
      amount: 10,
      now: NOW,
      minBid: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("RESERVE_REQUIRED");
  });

  it("accepts the exact maximum", () => {
    const result = validateBid({
      auction: auction(),
      bidder: bidder({ credits: 10, slotsRemaining: 2 }),
      amount: 9,
      now: NOW,
      minBid: 1,
    });
    expect(result.ok).toBe(true);
  });
});

describe("bid validation", () => {
  it("requires the opening price on an untouched auction", () => {
    expect(minAllowedBid(0, false, 1)).toBe(1);
    expect(minAllowedBid(8, true, 1)).toBe(9);
  });

  it("rejects a bid at or below the standing bid", () => {
    const a = auction({ currentBid: 8, highBidderId: "p2" });
    for (const amount of [7, 8]) {
      expect(validateBid({ auction: a, bidder: bidder(), amount, now: NOW, minBid: 1 }).code).toBe(
        "BID_TOO_LOW",
      );
    }
    expect(validateBid({ auction: a, bidder: bidder(), amount: 9, now: NOW, minBid: 1 }).ok).toBe(
      true,
    );
  });

  it("rejects bids above the player's balance", () => {
    const result = validateBid({
      auction: auction(),
      bidder: bidder({ credits: 4, slotsRemaining: 1 }),
      amount: 5,
      now: NOW,
      minBid: 1,
    });
    expect(result.code).toBe("NOT_ENOUGH_CREDITS");
  });

  it("locks out a player who already passed", () => {
    expect(
      validateBid({
        auction: auction(),
        bidder: bidder({ hasPassed: true }),
        amount: 3,
        now: NOW,
        minBid: 1,
      }).code,
    ).toBe("ALREADY_PASSED");
  });

  it("locks out a player whose roster is full", () => {
    expect(
      validateBid({
        auction: auction(),
        bidder: bidder({ slotsRemaining: 0 }),
        amount: 3,
        now: NOW,
        minBid: 1,
      }).code,
    ).toBe("ROSTER_FULL");
  });

  it("does not let the leader bid against themselves", () => {
    expect(
      validateBid({
        auction: auction({ currentBid: 5, highBidderId: "p1" }),
        bidder: bidder(),
        amount: 6,
        now: NOW,
        minBid: 1,
      }).code,
    ).toBe("ALREADY_HIGH_BIDDER");
  });

  it("refuses bids after the deadline, using the server clock", () => {
    expect(
      validateBid({
        auction: auction({ endsAt: NOW - 1 }),
        bidder: bidder(),
        amount: 3,
        now: NOW,
        minBid: 1,
      }).code,
    ).toBe("AUCTION_CLOSED");
  });

  it("refuses fractional amounts", () => {
    expect(
      validateBid({ auction: auction(), bidder: bidder(), amount: 2.5, now: NOW, minBid: 1 }).code,
    ).toBe("BID_TOO_LOW");
  });
});

describe("simultaneous bids", () => {
  /**
   * Mirrors what the database does under a row lock: the two transactions are
   * serialised, so the second player is validated against the first player's
   * already-applied bid and loses.
   */
  it("only one of two identical bids can win", () => {
    let state = auction({ currentBid: 5, highBidderId: "p3" });
    const a = bidder({ playerId: "pA" });
    const b = bidder({ playerId: "pB" });

    const first = validateBid({ auction: state, bidder: a, amount: 6, now: NOW, minBid: 1 });
    expect(first.ok).toBe(true);
    state = { ...state, currentBid: 6, highBidderId: "pA" };

    const second = validateBid({ auction: state, bidder: b, amount: 6, now: NOW, minBid: 1 });
    expect(second.ok).toBe(false);
    expect(second.code).toBe("BID_TOO_LOW");
  });
});

describe("bidding clock (V2)", () => {
  it("puts the whole clock back on every bid, whenever it lands", () => {
    const cfg = { auctionSeconds: 30 };
    // Late bid, early bid — both reset to a full 30 seconds.
    expect(resetDeadline(NOW, cfg)).toBe(NOW + 30_000);
    expect(resetDeadline(NOW + 9_000, cfg)).toBe(NOW + 39_000);
  });

  it("honours a custom clock length", () => {
    expect(resetDeadline(NOW, { auctionSeconds: 15 })).toBe(NOW + 15_000);
  });
});

describe("passing", () => {
  const base = {
    auction: auction(),
    bidder: bidder(),
    supplyAfterCurrent: 19,
    totalRemainingDemand: 10,
  };

  it("is allowed while there is slack in the pool", () => {
    expect(validatePass(base).ok).toBe(true);
  });

  it("is blocked when supply exactly matches demand", () => {
    // 4 players x 5 characters from a 20 card pool: nothing may go unsold.
    const result = validatePass({ ...base, supplyAfterCurrent: 19, totalRemainingDemand: 20 });
    expect(result.code).toBe("MUST_BID");
  });

  it("cannot be repeated", () => {
    expect(validatePass({ ...base, bidder: bidder({ hasPassed: true }) }).code).toBe(
      "ALREADY_PASSED",
    );
  });

  it("is closed to a player who already leads", () => {
    expect(
      validatePass({ ...base, auction: auction({ highBidderId: "p1", currentBid: 4 }) }).code,
    ).toBe("ALREADY_HIGH_BIDDER");
  });
});

describe("early resolution", () => {
  const a = auction({ currentBid: 6, highBidderId: "p1" });

  it("closes once nobody but the leader can act", () => {
    expect(
      shouldResolveEarly(
        [
          bidder({ playerId: "p1" }),
          bidder({ playerId: "p2", hasPassed: true }),
          bidder({ playerId: "p3", slotsRemaining: 0 }),
        ],
        a,
      ),
    ).toBe(true);
  });

  it("stays open while somebody could still bid", () => {
    expect(
      shouldResolveEarly([bidder({ playerId: "p1" }), bidder({ playerId: "p2" })], a),
    ).toBe(false);
  });
});

describe("auction order", () => {
  it("random order is a permutation and is stable for a seed", () => {
    const q1 = buildAuctionQueue(MARVEL_POOL, DEFAULT_CONFIG, "seed-a");
    const q2 = buildAuctionQueue(MARVEL_POOL, DEFAULT_CONFIG, "seed-a");
    const q3 = buildAuctionQueue(MARVEL_POOL, DEFAULT_CONFIG, "seed-b");

    expect(q1).toEqual(q2);
    expect(q1).not.toEqual(q3);
    expect(new Set(q1).size).toBe(DEFAULT_CONFIG.poolSize);
  });

  it("power order is descending by game power", () => {
    const queue = buildAuctionQueue(
      MARVEL_POOL,
      { ...DEFAULT_CONFIG, auctionOrder: "POWER" },
      "x",
    );
    const powers = queue.map(
      (id) => MARVEL_POOL.find((x) => x.id === id)!.gamePower,
    );
    expect([...powers].sort((a, b) => b - a)).toEqual(powers);
  });

  it("manual order puts the chosen ids first and keeps the rest", () => {
    const first = MARVEL_POOL[7].id;
    const second = MARVEL_POOL[3].id;
    const queue = buildAuctionQueue(
      MARVEL_POOL,
      { ...DEFAULT_CONFIG, auctionOrder: "MANUAL", manualOrder: [first, second] },
      "x",
    );
    expect(queue.slice(0, 2)).toEqual([first, second]);
    expect(queue).toHaveLength(DEFAULT_CONFIG.poolSize);
  });

  it("draws the pool from the whole category, not just its first entries", () => {
    // A 50-character category must not always produce the same twenty.
    const a = new Set(buildAuctionQueue(MARVEL_POOL, DEFAULT_CONFIG, "seed-a"));
    const b = new Set(buildAuctionQueue(MARVEL_POOL, DEFAULT_CONFIG, "seed-b"));
    const overlap = [...a].filter((id) => b.has(id)).length;
    expect(a.size).toBe(DEFAULT_CONFIG.poolSize);
    expect(overlap).toBeLessThan(DEFAULT_CONFIG.poolSize);
  });
});
