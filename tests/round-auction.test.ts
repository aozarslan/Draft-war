import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOARD_CAPACITY,
  MIN_PHASE_DWELL_SECONDS,
  acquisitionRequired,
  minimumPoolFor,
  roundQueueSize,
  totalRoundsFor,
} from "../src/lib/game/rounds";
import { buildAuctionQueue } from "../src/lib/game/auction";
import { CHARACTERS } from "../src/lib/game/characters";
import { creditsOf, boardOf, inMatch, pricesOf } from "../src/lib/client/economy";
import { liveDefinitionOf } from "./support/migrations";
import type { StateResponse } from "../src/lib/client/api";

/**
 * ---------------------------------------------------------------------------
 * One wallet, one lot at a time, one character per player per round.
 * ---------------------------------------------------------------------------
 * S8.2 puts a draft inside a round. Almost all of the rules it needs already
 * existed — the reserve rule, the full-clock reset, the pass rule, the row
 * lock, the idempotency key — and the milestone's real work was arranging for
 * them to run against a *different balance* without touching any of them.
 *
 * That makes the dangerous surface unusually easy to name:
 *
 *   1. a legacy draft quietly starts spending match credits, or the reverse;
 *   2. two balances appear and drift;
 *   3. a player buys twice in one round;
 *   4. a character is sold twice in one match;
 *   5. a phase advances more than once per intention.
 *
 * Every one of those is a property of plpgsql, which no unit test can execute
 * here. So the tests below split honestly: the pure rules are exercised
 * directly, and the SQL is checked *as source* for the specific constructs that
 * make those five things impossible. The behavioural half — concurrent bids,
 * refresh, double spend — is verified against the live database and reported
 * with the milestone, because that is the only place it can be verified at all.
 */

const ROOT = process.cwd();
const M31 = readFileSync(
  join(ROOT, "supabase", "migrations", "0031_s8_round_auction.sql"),
  "utf8",
);

/**
 * The body of a function *as it will actually run*, which is not necessarily
 * the one 0031 wrote: 0032 replaces `dw_advance_match_phase`, `dw_match_tick`
 * and `dw_match_snapshot` again. Reading 0031 for those would be checking a
 * definition the database never executes — a tripwire quietly disconnected.
 */
function fn(name: string): string {
  return liveDefinitionOf(name).sql;
}

/** The body as 0031 wrote it, for the assertions that are about 0031 itself. */
function fn31(name: string): string {
  const body = M31.match(
    new RegExp(`create or replace function ${name}\\b[\\s\\S]*?\\$\\$;`),
  )?.[0];
  expect(body, `${name} is not defined in 0031`).toBeTruthy();
  return body!;
}

// ---------------------------------------------------------------------------
// The rules that are ours to state
// ---------------------------------------------------------------------------

describe("acquisition fills the board, then becomes a choice", () => {
  it("demands a purchase in rounds one to five", () => {
    for (const round of [1, 2, 3, 4, 5]) {
      expect(acquisitionRequired(round), `round ${round}`).toBe(true);
    }
  });

  it("leaves rounds six to eight optional", () => {
    for (const round of [6, 7, 8]) {
      expect(acquisitionRequired(round), `round ${round}`).toBe(false);
    }
  });

  it("means a five-player match needs twenty-five mandatory lots, not forty", () => {
    const mandatory = 5 * BOARD_CAPACITY;
    expect(mandatory).toBe(25);
    expect(minimumPoolFor(5)).toBeGreaterThanOrEqual(mandatory);
    expect(minimumPoolFor(5)).toBeLessThan(5 * totalRoundsFor(5));
  });

  it("means a two-player match needs ten", () => {
    expect(2 * BOARD_CAPACITY).toBe(10);
    expect(minimumPoolFor(2)).toBeGreaterThanOrEqual(10);
  });
});

describe("a round offers more lots than it needs", () => {
  it("gives every live player a lot plus room to refuse one", () => {
    for (const players of [2, 3, 4, 5]) {
      expect(roundQueueSize(players)).toBeGreaterThan(players);
    }
  });

  it("does not put a whole draft on the block", () => {
    // A round is one decision. Ten lots for five players is already enough
    // that nobody is forced to take the first thing they see.
    expect(roundQueueSize(5)).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("the pool a round opens with is decided by the seed", () => {
  const pool = CHARACTERS.filter((c) => c.categoryId === "marvel");
  const config = { auctionOrder: "RANDOM" as const };
  const queueFor = (seed: string, round: number) =>
    buildAuctionQueue(pool, config, `${seed}:${round}`, roundQueueSize(5));

  it("is identical for the same match, round and pool", () => {
    expect(queueFor("abc", 3)).toEqual(queueFor("abc", 3));
  });

  it("differs between rounds of the same match", () => {
    expect(queueFor("abc", 3)).not.toEqual(queueFor("abc", 4));
  });

  it("differs between matches on the same round", () => {
    expect(queueFor("abc", 3)).not.toEqual(queueFor("xyz", 3));
  });

  it("is seeded by the match and the round, with nothing else mixed in", () => {
    const engine = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");
    const start = engine.match(/export async function startRoundAuction[\s\S]*?\n}/)?.[0];
    expect(start, "startRoundAuction is missing").toBeTruthy();
    expect(start).toContain("`${match.seed}:${match.roundNo}`");
    // Anything drawn at call time would make the same round open differently
    // on a retry, and a replay could never reproduce it.
    expect(start).not.toMatch(/Math\.random|Date\.now|randomSeed/);
  });

  it("shrinks with the pool, so a consumed character cannot come back", () => {
    // The engine excludes everything the match has already sold before
    // building the queue; the database refuses a duplicate independently.
    const consumed = new Set(queueFor("abc", 1).slice(0, 5));
    const remaining = pool.filter((c) => !consumed.has(c.id));
    const second = buildAuctionQueue(remaining, config, "abc:2", roundQueueSize(5));
    for (const id of second) expect(consumed.has(id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Which wallet is on screen
// ---------------------------------------------------------------------------

function snapshotWith(match: StateResponse["match"]): StateResponse {
  return {
    players: [
      { id: "a", credits: 50 },
      { id: "b", credits: 50 },
    ],
    match,
  } as unknown as StateResponse;
}

const liveMatch = {
  status: "ACTIVE",
  players: [
    { playerId: "a", credits: 31, hp: 100, roundWins: 0, streak: 0, eliminatedAt: null, modifiers: [] },
    { playerId: "b", credits: 44, hp: 100, roundWins: 0, streak: 0, eliminatedAt: null, modifiers: [] },
  ],
  board: [
    { playerId: "a", characterId: "marvel-thor", zone: "FRONT", slot: 0 },
    { playerId: "a", characterId: "marvel-hulk", zone: "BENCH", slot: 5 },
    { playerId: "b", characterId: "marvel-loki", zone: "FRONT", slot: 0 },
  ],
  acquisitions: [
    { roundNo: 1, playerId: "a", characterId: "marvel-thor", price: 12, acquiredAt: "" },
    { roundNo: 2, playerId: "a", characterId: "marvel-hulk", price: 7, acquiredAt: "" },
  ],
} as unknown as NonNullable<StateResponse["match"]>;

describe("the auction screen spends the right wallet", () => {
  it("reads match credits while a match is live", () => {
    const snap = snapshotWith(liveMatch);
    expect(inMatch(snap)).toBe(true);
    expect(creditsOf(snap, "a")).toBe(31);
    expect(creditsOf(snap, "b")).toBe(44);
  });

  it("falls back to the legacy wallet when there is no match", () => {
    const snap = snapshotWith(null);
    expect(inMatch(snap)).toBe(false);
    expect(creditsOf(snap, "a")).toBe(50);
  });

  it("falls back for a finished match rather than showing a dead balance", () => {
    const snap = snapshotWith({ ...liveMatch, status: "FINISHED" } as never);
    expect(creditsOf(snap, "a")).toBe(50);
  });

  it("computes nothing — every figure is one the server sent", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "client", "economy.ts"), "utf8");
    // No arithmetic operators on credits anywhere in the seam. A client that
    // works out a balance is a client that can invite a bid the server refuses.
    const body = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(body).not.toMatch(/credits\s*[-+*/]/);
    expect(body).not.toMatch(/[-+*/]\s*credits/);
  });
});

describe("the board accumulates across rounds", () => {
  it("keeps every earlier round's character", () => {
    const board = boardOf(snapshotWith(liveMatch), "a");
    expect(board.map((b) => b.characterId)).toEqual(["marvel-thor", "marvel-hulk"]);
  });

  it("separates the bench from the board", () => {
    const board = boardOf(snapshotWith(liveMatch), "a");
    expect(board.filter((b) => b.zone !== "BENCH")).toHaveLength(1);
    expect(board.filter((b) => b.zone === "BENCH")).toHaveLength(1);
  });

  it("does not mix squads", () => {
    expect(boardOf(snapshotWith(liveMatch), "b").map((b) => b.characterId)).toEqual([
      "marvel-loki",
    ]);
  });

  it("carries the price the engine recorded", () => {
    expect(pricesOf(snapshotWith(liveMatch))).toEqual({
      "marvel-thor": 12,
      "marvel-hulk": 7,
    });
  });

  it("is read from the server's board, never summed from round rosters", () => {
    // `players[].roster` is scoped to the current round's game. Accumulating it
    // here would drop every earlier round — silently, and only in a match.
    const source = readFileSync(join(ROOT, "src", "lib", "client", "economy.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code).toMatch(/match\.board/);
    expect(code, "the board is being summed from round rosters").not.toMatch(/\.roster/);
  });
});

// ---------------------------------------------------------------------------
// The half that lives in Postgres
// ---------------------------------------------------------------------------

describe("one balance, and the database picks it", () => {
  it("routes both credit reads in dw_place_bid through the accessor", () => {
    const bid = fn("dw_place_bid");
    expect(bid, "the accessor is not used").toContain("dw_bid_credits(a.game_id, p_player_id)");
    // And the legacy column is not read directly any more, which is the only
    // way the two can disagree.
    expect(bid).not.toMatch(/pl\.credits/);
  });

  it("routes every debit in dw_resolve_auction through the accessor", () => {
    const resolve = fn("dw_resolve_auction");
    expect(resolve).toContain("dw_debit_credits(");
    // The direct write is what would take money from the wrong wallet.
    expect(resolve).not.toMatch(/update players\s+set credits/);
    // Both sales — the ordinary one and the forced assignment — go through it.
    expect([...resolve.matchAll(/dw_debit_credits\(/g)]).toHaveLength(2);
  });

  it("treats an unknown balance as no money rather than no check", () => {
    // NULL propagation is the quiet version of this bug: `p_amount > NULL` is
    // NULL, an `if` on NULL does not fire, and the affordability check is
    // skipped entirely rather than failed. A character won for free.
    expect(fn("dw_bid_credits")).toMatch(/coalesce\([\s\S]*?\), 0\);/);
  });

  it("says why, rather than reporting an empty wallet", () => {
    const bid = fn("dw_place_bid");
    expect(bid).toContain("NOT_IN_MATCH");
    expect(bid).toMatch(/not exists \(\s*select 1 from match_players/);
  });

  it("keeps the accessor's branch in exactly one place", () => {
    // Each accessor must know about both wallets and choose between them on
    // whether the game belongs to a match. Phrasing is not the assertion —
    // reaching both tables from one branch is.
    for (const name of ["dw_bid_credits", "dw_debit_credits"]) {
      const body = fn(name);
      expect(body, `${name} does not branch on the match`).toMatch(/match_id is null|v_match is null/);
      expect(body, `${name} cannot reach match credits`).toContain("match_players");
      expect(body, `${name} cannot reach legacy credits`).toMatch(/from players|update players/);
    }
  });

  it("only ever debits the winner", () => {
    const resolve = fn("dw_resolve_auction");
    const calls = [...resolve.matchAll(/dw_debit_credits\([^;]*?\);/g)].map((m) => m[0]);
    // Assert over *every* call site rather than over the ones that happen to
    // match a loose shape — a debit rewritten as a subquery would slip past a
    // pattern that only recognises a bare identifier, and the loop would then
    // check nothing at all.
    expect(calls).toHaveLength(2);
    expect(calls.sort()).toEqual([
      "dw_debit_credits(a.game_id, v_forced, v_min);",
      "dw_debit_credits(a.game_id, v_winner, v_price);",
    ]);
  });

  it("never writes match credits back onto the legacy wallet", () => {
    // No transfer, in either direction, ever. That is what "authoritative"
    // means, and a match ending is where a helpful copy would appear.
    expect(fn("dw_abandon_match"), "abandoning a match touches credits").not.toMatch(/credits/);
    expect(M31).not.toMatch(/players\s+set credits\s*=\s*.*match_players/);
  });
});

describe("a player buys once per round, and a character sells once per match", () => {
  it("gives a round game a quota of one", () => {
    // Everything else follows from this number: `dw_slots_remaining` returns 0
    // after the first purchase, so the second bid is refused as ROSTER_FULL by
    // the rule that already existed.
    expect(fn("dw_start_round_auction")).toMatch(/values \(p_room_id, v_no, p_seed, p_queue, 1,/);
  });

  it("still checks the quota before accepting a bid", () => {
    const bid = fn("dw_place_bid");
    expect(bid).toContain("dw_slots_remaining(a.game_id, p_player_id)");
    expect(bid).toContain("ROSTER_FULL");
  });

  it("makes a duplicate sale impossible in the schema, not just in the queue", () => {
    expect(M31).toMatch(/create table if not exists match_acquisitions[\s\S]*?unique \(match_id, character_id\)/);
  });

  it("also refuses to offer a character the match already sold", () => {
    expect(fn("dw_open_next_round_auction")).toMatch(
      /not exists \(\s*select 1 from match_acquisitions[\s\S]*?character_id = v_char/,
    );
  });

  it("records the sale in the same transaction as the debit", () => {
    // A price, a character and the credits that paid for it cannot end up
    // disagreeing if one statement writes all three.
    const resolve = fn("dw_resolve_auction");
    expect(resolve).toContain("dw_record_acquisition(");
    const record = fn("dw_record_acquisition");
    expect(record).toContain("insert into match_acquisitions");
    expect(record).toContain("insert into board_slots");
  });

  it("leaves the earlier board alone when a new character lands", () => {
    const record = fn("dw_record_acquisition");
    expect(record).toContain("on conflict (match_id, player_id, character_id) do nothing");
    expect(record).not.toMatch(/delete from board_slots/);
    expect(record).not.toMatch(/update board_slots/);
  });
});

describe("a round's draft is not something to walk out of", () => {
  it("refuses to leave AUCTION while the draft is running", () => {
    const advance = fn("dw_advance_match_phase");
    expect(advance).toContain("AUCTION_INCOMPLETE");
    expect(advance).toMatch(/v_game\.status = 'ACTIVE'/);
  });

  it("closes the draft itself when every quota is filled", () => {
    const open = fn("dw_open_next_round_auction");
    expect(open).toContain("dw_round_demand(p_game_id)");
    expect(open).toContain("ROUND_AUCTION_COMPLETE");
  });

  it("recycles only in a mandatory round", () => {
    // Recycling exists so nobody ends a draft short. From round six there is
    // nothing to guarantee, and a player keeping their credits has made a
    // decision rather than a mistake.
    const open = fn("dw_open_next_round_auction");
    const recycle = open.match(/if v_required then[\s\S]*?end if;/)?.[0];
    expect(recycle, "recycling is not gated on the round being mandatory").toBeTruthy();
    expect(recycle).toContain("status = 'UNSOLD'");
  });

  it("skips the pass rule only in an optional round", () => {
    const pass = fn("dw_pass_auction");
    expect(pass).toMatch(/g\.match_id is null or dw_acquisition_required\(g\.round_no\)/);
    expect(pass).toContain("MUST_BID");
  });

  it("never force-assigns in an optional round", () => {
    expect(fn("dw_resolve_auction")).toMatch(
      /g\.match_id is null or dw_acquisition_required\(g\.round_no\)/,
    );
  });
});

describe("a phase advances once per intention", () => {
  const advance = fn("dw_advance_match_phase");

  it("takes the row lock before reading the phase", () => {
    expect(advance).toMatch(/select \* into m from matches where id = v_room\.current_match_id for update/);
  });

  it("still no-ops when the caller's phase is already stale", () => {
    expect(advance).toMatch(/m\.phase <> p_from/);
    expect(advance).toContain("'noop', true");
  });

  it("refuses a manual advance inside the dwell window", () => {
    // The lock was never the problem: six requests each read a phase that was
    // genuinely current when they read it. Only a clock separates a decision
    // from the same tap arriving twice.
    expect(advance).toMatch(/now\(\) < m\.phase_started_at \+ dw_min_phase_dwell\(\)/);
    expect(advance).toContain("CONCURRENT_PHASE_ADVANCE");
  });

  it("says so rather than reporting a success it did not perform", () => {
    const guard = advance.match(/if now\(\) < m\.phase_started_at[\s\S]*?end if;/)?.[0];
    expect(guard).toContain("dw_err(");
    expect(guard).not.toContain("'ok', true");
  });

  it("moves the round by exactly one, in the version that actually runs", () => {
    // 0031 replaces this function, so the 0030 mirror in rounds.test.ts no
    // longer covers it. A tripwire that checks a superseded definition is a
    // tripwire that has been quietly disconnected.
    expect(advance).toMatch(
      /v_round := case when v_next = 'ROUND_START' then m\.round_no \+ 1 else m\.round_no end;/,
    );
  });

  it("stamps the new phase's start time in the same statement", () => {
    expect(advance).toMatch(/update matches[\s\S]*?phase_started_at = now\(\)/);
  });

  it("keeps the clock path idempotent through the deadline", () => {
    expect(advance).toMatch(/if m\.phase_deadline is not null then[\s\S]*?now\(\) < m\.phase_deadline/);
  });

  it("does not silently skip a phase a subsystem has not finished", () => {
    // COMBAT has no deadline yet and no completion check. It must wait rather
    // than be walked past; S8.5 replaces this branch with the battle's clock.
    expect(advance).toMatch(/elsif m\.phase <> 'AUCTION' then/);
  });

  it("agrees with TypeScript about how long the window is", () => {
    const dwell = fn("dw_min_phase_dwell");
    expect(dwell).toContain(`interval '${MIN_PHASE_DWELL_SECONDS} second'`);
  });

  it("agrees with TypeScript about which rounds demand a purchase", () => {
    const sql = fn("dw_acquisition_required");
    expect(sql).toMatch(/p_round_no >= 1 and p_round_no <= 5/);
    expect(acquisitionRequired(5)).toBe(true);
    expect(acquisitionRequired(6)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy
// ---------------------------------------------------------------------------

describe("the game people are playing right now", () => {
  it("does not redefine the legacy draft's engine", () => {
    // `dw_open_next_auction` ends a draft by flipping the room to TEAM_REVIEW.
    // A match must not leave the MATCH phase, so a round gets its own opener
    // beside it rather than a branch inside it.
    expect(M31).not.toContain("create or replace function dw_open_next_auction");
    expect(M31).toContain("create or replace function dw_open_next_round_auction");
  });

  it("leaves the other load-bearing functions alone", () => {
    for (const untouched of [
      "dw_total_demand", "dw_slots_remaining", "dw_auction_is_dead",
      "dw_start_game", "dw_tick", "dw_return_to_lobby", "dw_snapshot",
    ]) {
      expect(M31, `${untouched} was redefined`).not.toContain(
        `create or replace function ${untouched}(`,
      );
    }
  });

  it("keeps a legacy branch in every function it does replace", () => {
    // Every replaced function must still have a path for a game with no match,
    // and that path is the body it had before.
    for (const name of ["dw_place_bid", "dw_pass_auction", "dw_resolve_auction"]) {
      expect(fn(name), `${name} lost its legacy branch`).toMatch(
        /match_id is null|v_match is null/,
      );
    }
  });

  it("dispatches to the legacy opener at every exit", () => {
    // Two sales resolve a lot — the ordinary one and the forced assignment —
    // and both have to hand a legacy draft back to its own engine. Asserting
    // that the branch appears *somewhere* would pass with one of them rewired.
    const resolve = fn("dw_resolve_auction");
    expect([...resolve.matchAll(/perform dw_open_next_auction\(/g)]).toHaveLength(2);
    expect([...resolve.matchAll(/perform dw_open_next_round_auction\(/g)]).toHaveLength(2);
    expect([...resolve.matchAll(/if g\.match_id is null then perform dw_open_next_auction\(/g)])
      .toHaveLength(2);
  });

  it("keeps every auction rule that was already there", () => {
    const bid = fn("dw_place_bid");
    for (const rule of [
      "dw_prior_result(p_action_id)",      // idempotency
      "dw_rate_limited(",                   // rate limit
      "for update",                         // the row lock
      "RESERVE_REQUIRED",                   // the reserve rule
      "ALREADY_PASSED",
      "ALREADY_HIGH_BIDDER",
      "BID_TOO_LOW",
      "NOT_ENOUGH_CREDITS",
      "v_max_ext",                          // the extension cap
    ]) {
      expect(bid, `${rule} went missing`).toContain(rule);
    }
  });

  it("leaves no arity of a rule behind with the old body", () => {
    // `dw_place_bid` has existed at two arities since 0019 added an
    // idempotency key. The application only ever calls the four-argument one,
    // so the three-argument version from 0005 was unreachable — and still
    // contained a body that reads `players.credits` directly. Unreachable and
    // old is tolerable; unreachable and now *wrong about which wallet to
    // charge* is not.
    const bid3 = M31.match(
      /create or replace function dw_place_bid\(\s*p_player_id uuid, p_auction_id uuid, p_amount int\s*\)[\s\S]*?\$\$;/,
    )?.[0];
    expect(bid3, "the three-argument dw_place_bid is not collapsed").toBeTruthy();
    expect(bid3).toContain("select dw_place_bid(p_player_id, p_auction_id, p_amount, null::text);");
    expect(bid3, "the stale arity still reads a wallet for itself").not.toMatch(/credits/);

    const pass2 = M31.match(
      /create or replace function dw_pass_auction\(\s*p_player_id uuid, p_auction_id uuid\s*\)[\s\S]*?\$\$;/,
    )?.[0];
    expect(pass2, "the two-argument dw_pass_auction is not collapsed").toBeTruthy();
    expect(pass2).toContain("select dw_pass_auction(p_player_id, p_auction_id, null::text);");
    expect(pass2, "the stale arity still carries its own pass rule").not.toMatch(/MUST_BID/);
  });

  it("defines the acquisition recorder before the function that calls it", () => {
    // Not a correctness bug — plpgsql resolves callees at run time — but a
    // migration that half-applies should leave the callee present rather than
    // the caller.
    expect(M31.indexOf("create or replace function dw_record_acquisition"))
      .toBeLessThan(M31.indexOf("create or replace function dw_resolve_auction"));
  });

  it("adds no destructive statement", () => {
    const sql = M31.toLowerCase();
    expect(sql).not.toMatch(/drop\s+table/);
    expect(sql).not.toMatch(/drop\s+column/);
    expect(sql).not.toMatch(/truncate/);
    expect(sql).not.toMatch(/delete\s+from/);
  });
});

// ---------------------------------------------------------------------------
// Server authority
// ---------------------------------------------------------------------------

describe("a draft that fails to open is not a match that is stuck", () => {
  const engine = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");

  it("lets the tick reopen a round whose draft never started", () => {
    // The phase moves first and the draft opens second, so a failure between
    // them leaves a round at AUCTION with no game. That state is detected
    // rather than waited on.
    expect(fn("dw_match_tick")).toContain("NEEDS_ROUND_AUCTION");
    expect(engine).toMatch(/"NEEDS_ROUND_AUCTION"\)\s*await startRoundAuction/);
  });

  it("tells a losing request that it lost", () => {
    // Found live: every burst advanced exactly one phase — the database was
    // right — but two, three and four requests out of each burst came back
    // `ok: true`. The dwell guard rejects the ones that read a stale phase;
    // the ones that read a *fresh* phase and lost the write got SQL's
    // `noop: true`, which the Node layer was dropping on the floor. A caller
    // told "ok" for a transition somebody else made will trust its own screen.
    const engine = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");
    const route = readFileSync(
      join(ROOT, "src", "app", "api", "rooms", "[code]", "action", "route.ts"),
      "utf8",
    );
    expect(engine, "the noop is not carried out of the RPC").toMatch(
      /const noop = result\.noop === true;/,
    );
    expect(engine, "advanceMatchPhase does not report it").toMatch(/return \{ phase, roundNo, noop \};/);

    const branch = route.match(/case "ADVANCE_MATCH": \{[\s\S]*?\n      \}/)?.[0];
    expect(branch, "the route still reports a lost race as a success").toMatch(
      /if \(result\.noop\)[\s\S]*?CONCURRENT_PHASE_ADVANCE/,
    );
  });

  it("does not report a failed draft as a failed transition", () => {
    const advance = engine.match(/export async function advanceMatchPhase[\s\S]*?\n}/)?.[0];
    expect(advance).toBeTruthy();
    expect(advance).toMatch(/try \{[\s\S]*?startRoundAuction\(roomId\)[\s\S]*?\} catch/);
  });

  it("opens a round's draft exactly once", () => {
    // Idempotent in SQL as well as guarded here, because the tick and the
    // phase advance can both reach it.
    expect(fn("dw_start_round_auction")).toContain("'noop', true");
    expect(engine).toMatch(/if \(match\.roundGameId\) return;/);
  });
});

describe("a client sends an intention and nothing else", () => {
  const route = readFileSync(
    join(ROOT, "src", "app", "api", "rooms", "[code]", "action", "route.ts"),
    "utf8",
  );
  /** The route with its prose removed — comments explain, they do not forward. */
  const code = route.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("forwards only an auction id and an amount when bidding", () => {
    const branch = code.match(/case "BID": \{[\s\S]*?\n      \}/)?.[0];
    expect(branch).toBeTruthy();
    // The server decides the character, the winner, the price and the wallet.
    // Checked as bare words rather than as `action.x`: a cast, a destructure or
    // a rename would carry the same value past a narrower pattern.
    for (const forbidden of ["characterId", "winner", "price", "credits", "round", "phase", "reward"]) {
      expect(branch, `BID forwards ${forbidden}`).not.toMatch(new RegExp(forbidden, "i"));
    }
  });

  it("refuses an absurd bid rather than letting the database refuse it", () => {
    // Found live: 10^18 was accepted by the route, overflowed Postgres `int`
    // inside dw_place_bid and came back as a 500. The outcome was right — no
    // state changed — but a hostile input reported as a server fault is a
    // hostile input that looks like an outage.
    expect(route).toMatch(/const MAX_BID = /);
    const branch = route.match(/case "BID": \{[\s\S]*?\n      \}/)?.[0];
    expect(branch).toMatch(/amount > MAX_BID/);
    expect(branch).toMatch(/Number\.isInteger\(amount\)/);
    expect(branch).toMatch(/amount < 1/);
  });

  it("answers unreadable JSON with a refusal, not a crash", () => {
    expect(route).toMatch(/catch \{\s*return errorResponse\("BAD_REQUEST"/);
  });

  it("forwards only an auction id when passing", () => {
    const branch = code.match(/case "PASS": \{[\s\S]*?\n      \}/)?.[0];
    expect(branch).toBeTruthy();
    expect(branch).toContain("p_auction_id: action.auctionId");
    for (const forbidden of ["characterId", "winner", "price", "credits", "round", "phase"]) {
      expect(branch, `PASS forwards ${forbidden}`).not.toMatch(new RegExp(forbidden, "i"));
    }
  });

  it("takes the character from the auction row, never from the request", () => {
    // The one place a character id could enter from outside.
    expect(fn("dw_place_bid")).toContain("a.character_id");
    expect(fn("dw_place_bid")).not.toMatch(/p_character_id/);
  });

  it("derives the round from the match, never from the request", () => {
    const start = fn("dw_start_round_auction");
    expect(start).toContain("m.round_no");
    expect(start).not.toMatch(/p_round_no/);
  });
});
