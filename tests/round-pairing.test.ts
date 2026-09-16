import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pairRound,
  pairingInputFor,
  type MatchmakingSeat,
  type PairableMatch,
} from "../src/lib/game/matchmaking";
import { liveDefinitionOf } from "./support/migrations";

/**
 * ---------------------------------------------------------------------------
 * A round is paired once, or not at all.
 * ---------------------------------------------------------------------------
 * S8.3a proved the *decision*. This is the persistence half, and its failure
 * modes are different ones:
 *
 *   * a round paired twice — two callers reach `MATCHMAKING` (the phase advance
 *     and the tick), and the second one writes a second set of fixtures;
 *   * a round that leaves `MATCHMAKING` with no fixtures at all, which is not a
 *     shorter round but a round nobody played;
 *   * a seat left out, or named twice, or named while eliminated.
 *
 * All four live in plpgsql, which no unit test here can execute, so they are
 * checked as source for the specific constructs that make them impossible and
 * then verified against the live database with the milestone.
 */

const ROOT = process.cwd();
const M32 = readFileSync(
  join(ROOT, "supabase", "migrations", "0032_s8_round_pairing.sql"),
  "utf8",
);
const ENGINE = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");
/** The migration with its prose removed. A comment explaining why something is
 *  absent must not read as the thing being present. */
const M32_SQL = M32.replace(/^\s*--.*$/gm, "");

/**
 * The body as it will actually run, whichever migration wrote it last.
 *
 * Deliberately not pinned to a file. An earlier version asserted that every
 * function still came from 0032, which turned "a later migration fixed this"
 * into a collection-time crash — the helper exists to follow a definition when
 * it moves, not to forbid it moving. Which file owns what is asserted once,
 * below, where a move is visible instead of fatal.
 */
function fn(name: string): string {
  return liveDefinitionOf(name).sql;
}

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe("which migration owns which function", () => {
  it("records where each live definition currently lives", () => {
    // A move is a real event worth seeing in a diff — 0033 took the phase
    // advance from 0032 to close a guard hole — but it must not break the
    // tests that read it.
    // dw_pair_round superseded by 0037 (round_live_count column for damage scaling).
    expect(liveDefinitionOf("dw_pair_round").file).toBe("0037_s8_damage_scaling.sql");
    // 0033 took the phase advance to close the draft guard hole; 0034 took it
    // again, along with the tick and the snapshot, for round combat.
    expect(liveDefinitionOf("dw_advance_match_phase").file).toBe("0034_s8_round_combat.sql");
    expect(liveDefinitionOf("dw_match_tick").file).toBe("0034_s8_round_combat.sql");
    // dw_match_snapshot and dw_resolve_matchup are superseded by 0035 (ghost rounds).
    expect(liveDefinitionOf("dw_match_snapshot").file).toBe("0035_s8_ghost_rounds.sql");
    expect(liveDefinitionOf("dw_resolve_matchup").file).toBe("0035_s8_ghost_rounds.sql");
  });
});

describe("0032 records what cannot be recovered later", () => {
  it("adds the ratings that decided the pairing", () => {
    expect(M32).toMatch(/add column if not exists rating_a numeric\(6,4\)/);
    expect(M32).toMatch(/add column if not exists rating_b numeric\(6,4\)/);
  });

  it("adds the reason, constrained to the reasons that exist", () => {
    expect(M32).toMatch(/add column if not exists reason text/);
    const check = M32.match(/round_matchups_reason_valid[\s\S]*?\)\);/)?.[0] ?? "";
    for (const reason of [
      "ONLY_PAIRING", "NEW_OPPONENT", "CLOSEST_STRENGTH", "REMATCH_UNAVOIDABLE", "ODD_SEAT",
    ]) {
      expect(check, `${reason} is not allowed`).toContain(reason);
    }
    // And nothing that sounds like a handicap.
    for (const banned of ["LEADER", "STRONGEST", "PUNISH", "HANDICAP"]) {
      expect(check).not.toContain(banned);
    }
  });

  it("makes a self-match impossible at the database", () => {
    expect(M32).toMatch(/round_matchups_no_self[\s\S]*?player_b is null or player_b <> player_a/);
  });

  it("guards both constraints so the file can be re-run", () => {
    const guards = M32.match(/select 1 from pg_constraint where conname = '(\w+)'/g) ?? [];
    expect(guards).toHaveLength(2);
  });

  it("adds nothing destructive", () => {
    const sql = M32_SQL.toLowerCase();
    for (const bad of ["drop table", "drop column", "truncate", "delete from", "drop constraint"]) {
      expect(sql, `0032 contains ${bad}`).not.toContain(bad);
    }
  });

  it("does not duplicate what the rows already say", () => {
    // `player_b IS NULL` plus `kind` already identifies the odd seat; the seed
    // is on the match; a rematch count is derivable from the rows above it.
    for (const column of ["bye_player", "matchup_id", "rematch_count", "add column if not exists seed"]) {
      expect(M32_SQL, `0032 adds ${column}`).not.toContain(column);
    }
  });

  it("leaves the legacy functions alone", () => {
    for (const untouched of [
      "dw_snapshot", "dw_tick", "dw_place_bid", "dw_pass_auction",
      "dw_resolve_auction", "dw_open_next_auction", "dw_start_game",
    ]) {
      expect(M32_SQL, `${untouched} was redefined`).not.toContain(
        `create or replace function ${untouched}(`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Writing once
// ---------------------------------------------------------------------------

describe("a round is paired exactly once", () => {
  const pair = fn("dw_pair_round");

  it("takes the match row lock before deciding anything", () => {
    expect(pair).toMatch(/select \* into m from matches where id = v_room\.current_match_id for update/);
  });

  it("refuses to write out of turn", () => {
    expect(pair).toMatch(/m\.phase <> 'MATCHMAKING'/);
    expect(pair).toContain("WRONG_PHASE");
  });

  it("no-ops rather than writing a second set of fixtures", () => {
    expect(pair).toMatch(
      /if exists \(select 1 from round_matchups where match_id = m\.id and round_no = m\.round_no\)/,
    );
    expect(pair).toContain("'noop', true");
  });

  it("validates the payload instead of trusting it", () => {
    // It comes from our own server today. That is a property of the call sites,
    // not of the function.
    expect(pair).toContain("BAD_PAIRING");
    expect(pair, "a self-match is not rejected").toMatch(/v_b = v_a/);
    expect(pair, "a repeated seat is not rejected").toMatch(/v_a = any\(v_seen\)/);
    // Both seats, not just the first. A mutation that loosened only the
    // `player_a` check slipped past an assertion that any one occurrence
    // existed.
    expect([...pair.matchAll(/eliminated_at is null and mp\.hp > 0/g)],
      "an eliminated seat is not rejected on both sides").toHaveLength(2);
  });

  it("refuses a round that leaves somebody out", () => {
    // Pairing four of five people gives the fifth no round at all, which is
    // worse than not pairing.
    expect(pair).toMatch(/array_length\(v_seen, 1\) is distinct from v_live/);
  });

  it("does not pair a table that has fewer than two players left", () => {
    expect(pair).toMatch(/if v_live < 2 then[\s\S]*?'noop', true/);
  });
});

describe("a round cannot be played unpaired", () => {
  const advance = fn("dw_advance_match_phase");

  it("refuses to leave MATCHMAKING with no fixtures", () => {
    expect(advance).toMatch(/if m\.phase = 'MATCHMAKING' then/);
    expect(advance).toContain("NOT_PAIRED");
    // The condition, not only the error string. A guard whose branch is dead
    // still contains its own message.
    expect(advance).toMatch(
      /select 1 from round_matchups where match_id = m\.id and round_no = m\.round_no\s*\)\s*then\s*return dw_err\('NOT_PAIRED'/,
    );
  });

  it("still lets a one-survivor match through", () => {
    const guard = advance.match(/if m\.phase = 'MATCHMAKING' then[\s\S]*?end if;\s*end if;/)?.[0] ?? "";
    expect(guard).toMatch(/v_live >= 2/);
  });

  it("keeps every guard 0031 established", () => {
    for (const kept of [
      "for update", "CONCURRENT_PHASE_ADVANCE", "dw_min_phase_dwell()",
      "dw_match_next_phase(", "INVALID_TRANSITION", "phase_started_at = now()",
    ]) {
      expect(advance, `${kept} went missing`).toContain(kept);
    }
    expect(advance).toMatch(/v_next = 'ROUND_START' then m\.round_no \+ 1/);
    // Rewriting a function is where a guard goes missing, and a guard reduced
    // to a dead branch keeps its own error message — so the condition is what
    // gets asserted, not the string.
    //
    // The earlier version of this assertion pinned `if found and ... = 'ACTIVE'`
    // exactly, which is the shape that shipped the production bug: `found` is
    // false when no draft row exists, so the one case that needed stopping was
    // the one case that got through. A test that encodes the implementation
    // cannot notice the implementation is wrong.
    expect(advance, "a running auction can be walked out of").toMatch(
      /v_game\.status = 'ACTIVE' then\s*return dw_err\('AUCTION_INCOMPLETE'/,
    );
    expect(advance, "a draft that never opened can be walked past").toMatch(
      /if not found then\s*return dw_err\('AUCTION_INCOMPLETE'/,
    );
    expect(advance, "the dwell guard was reduced to a dead branch").toMatch(
      /if now\(\) < m\.phase_started_at \+ dw_min_phase_dwell\(\) then\s*return dw_err\('CONCURRENT_PHASE_ADVANCE'/,
    );
  });

  it("asks for a pairing when a round has none", () => {
    const tick = fn("dw_match_tick");
    expect(tick).toContain("NEEDS_ROUND_PAIRING");
    expect(tick).toMatch(/v_live >= 2/);
    // And the auction reporting from 0031 is untouched.
    for (const kept of ["NEEDS_ROUND_AUCTION", "ROUND_AUCTION_COMPLETE", "AUCTION_RESOLVED"]) {
      expect(tick, `${kept} went missing`).toContain(kept);
    }
  });

  it("carries the ratings and the reason back to the client", () => {
    const snap = fn("dw_match_snapshot");
    expect(snap).toContain("'ratingA', r.rating_a");
    expect(snap).toContain("'ratingB', r.rating_b");
    expect(snap).toContain("'reason', r.reason");
  });
});

// ---------------------------------------------------------------------------
// Whether to pair at all
// ---------------------------------------------------------------------------

describe("a match is asked to pair only when it should be", () => {
  const base: PairableMatch = {
    status: "ACTIVE",
    phase: "MATCHMAKING",
    roundNo: 3,
    seed: "abc",
    players: [
      { playerId: "a", hp: 100, eliminatedAt: null },
      { playerId: "b", hp: 40, eliminatedAt: null },
      { playerId: "c", hp: 0, eliminatedAt: 6 },
    ],
    board: [
      { playerId: "a", characterId: "x" },
      { playerId: "a", characterId: "y" },
      { playerId: "b", characterId: "z" },
    ],
    matchups: [{ roundNo: 1, playerA: "a", playerB: "b" }],
  };
  const seatOf = (id: string) => ({ a: 0, b: 1, c: 2 })[id as "a"] ?? 0;
  const powerOf = (id: string) => ({ x: 90, y: 70, z: 60 })[id as "x"];

  it("asks when the match is running, at matchmaking, and unpaired", () => {
    const q = pairingInputFor(base, seatOf, powerOf);
    expect(q).not.toBeNull();
    expect(q!.matchSeed).toBe("abc");
    expect(q!.roundNo).toBe(3);
  });

  it("does not ask a match that has finished or been abandoned", () => {
    for (const status of ["FINISHED", "ABANDONED"]) {
      expect(pairingInputFor({ ...base, status }, seatOf, powerOf)).toBeNull();
    }
  });

  it("does not ask outside the matchmaking phase", () => {
    for (const phase of ["AUCTION", "COMBAT", "BOARD_UPDATE", "ROUND_END", "CHAMPIONSHIP"]) {
      expect(pairingInputFor({ ...base, phase }, seatOf, powerOf), phase).toBeNull();
    }
  });

  it("does not ask twice for the same round", () => {
    const paired: PairableMatch = {
      ...base,
      matchups: [...base.matchups, { roundNo: 3, playerA: "a", playerB: "b" }],
    };
    expect(pairingInputFor(paired, seatOf, powerOf)).toBeNull();
  });

  it("still asks for a later round once an earlier one is paired", () => {
    // The trap: asking whether *any* round has matchups pairs round one and
    // then never pairs another.
    const paired: PairableMatch = {
      ...base,
      roundNo: 4,
      matchups: [...base.matchups, { roundNo: 3, playerA: "a", playerB: "b" }],
    };
    expect(pairingInputFor(paired, seatOf, powerOf)).not.toBeNull();
  });

  it("carries elimination through, so the pairing can exclude it", () => {
    const q = pairingInputFor(base, seatOf, powerOf)!;
    expect(q.seats.find((s) => s.playerId === "c")!.eliminatedAt).toBe(6);
    expect(pairRound(q).flatMap((p) => [p.playerA, p.playerB])).not.toContain("c");
  });

  it("builds each board from that player's own slots", () => {
    const q = pairingInputFor(base, seatOf, powerOf)!;
    expect(q.seats.find((s) => s.playerId === "a")!.board.sort((x, y) => y - x)).toEqual([90, 70]);
    expect(q.seats.find((s) => s.playerId === "b")!.board).toEqual([60]);
    expect(q.seats.find((s) => s.playerId === "c")!.board).toEqual([]);
  });

  it("drops a character the catalogue does not know rather than rating it zero", () => {
    const withGhost: PairableMatch = {
      ...base,
      board: [...base.board, { playerId: "b", characterId: "missing" }],
    };
    const q = pairingInputFor(withGhost, seatOf, powerOf)!;
    expect(q.seats.find((s) => s.playerId === "b")!.board).toEqual([60]);
  });

  it("leaves recentForm unset until combat exists", () => {
    const q = pairingInputFor(base, seatOf, powerOf)!;
    for (const s of q.seats) expect(s.recentForm).toBeUndefined();
  });

  it("copies the history verbatim", () => {
    const q = pairingInputFor(base, seatOf, powerOf)!;
    expect(q.history).toEqual([{ roundNo: 1, playerA: "a", playerB: "b" }]);
  });
});

// ---------------------------------------------------------------------------
// The engine side
// ---------------------------------------------------------------------------

describe("the server decides, and the client is not asked", () => {
  it("pairs on arrival at MATCHMAKING", () => {
    expect(ENGINE).toMatch(/phase === "MATCHMAKING" && !noop[\s\S]*?pairMatchRound\(roomId\)/);
  });

  it("retries through the tick rather than failing the transition", () => {
    expect(ENGINE).toMatch(/"NEEDS_ROUND_PAIRING"\)\s*await pairMatchRound/);
    const body = ENGINE.match(/export async function pairMatchRound[\s\S]*?\n}/)?.[0] ?? "";
    expect(body).toBeTruthy();
  });

  it("hands the pure function nothing but server state", () => {
    const body = ENGINE.match(/export async function pairMatchRound[\s\S]*?\n}/)![0];
    expect(body).toContain("pairingInputFor(");
    // No request body, no client input, no clock.
    for (const forbidden of ["action.", "request", "Math.random", "Date.now"]) {
      expect(body, `pairMatchRound reads ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("adds no client action for matchmaking", () => {
    const route = readFileSync(
      join(ROOT, "src", "app", "api", "rooms", "[code]", "action", "route.ts"),
      "utf8",
    );
    for (const forbidden of ["PAIR_ROUND", "SET_MATCHUP", "CHOOSE_OPPONENT", "MATCHMAKING"]) {
      expect(route, `the route accepts ${forbidden}`).not.toContain(`"${forbidden}"`);
    }
  });

  it("sends only the fields the database records", () => {
    const body = ENGINE.match(/export async function pairMatchRound[\s\S]*?\n}/)![0];
    const payload = body.match(/p_pairings: pairings\.map\([\s\S]*?\)\),/)![0];
    const keys = [...payload.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(["kind", "playerA", "playerB", "ratingA", "ratingB", "reason"]);
  });
});

// ---------------------------------------------------------------------------
// What gets stored is what was decided
// ---------------------------------------------------------------------------

describe("the stored row is the decision", () => {
  const seats: MatchmakingSeat[] = [
    { playerId: "a", seat: 0, hp: 100, eliminatedAt: null, board: [92, 88, 81, 76, 70] },
    { playerId: "b", seat: 1, hp: 62, eliminatedAt: null, board: [85, 79, 74, 68] },
    { playerId: "c", seat: 2, hp: 88, eliminatedAt: null, board: [90, 83, 78, 72, 61] },
    { playerId: "d", seat: 3, hp: 45, eliminatedAt: null, board: [71, 69, 64, 60, 55] },
    { playerId: "e", seat: 4, hp: 100, eliminatedAt: null, board: [66, 61, 58, 52, 44] },
  ];

  it("produces a payload every column can hold", () => {
    const pairs = pairRound({ matchSeed: "store", roundNo: 3, seats, history: [] });
    for (const p of pairs) {
      expect(["DUEL", "ENCOUNTER"]).toContain(p.kind);
      // numeric(6,4): four decimal places, and a rating never exceeds 1.
      expect(p.ratingA).toBeLessThanOrEqual(1);
      expect(p.ratingA).toBeGreaterThanOrEqual(0);
      expect(Number(p.ratingA.toFixed(4))).toBe(p.ratingA);
      if (p.ratingB !== null) {
        expect(Number(p.ratingB.toFixed(4))).toBe(p.ratingB);
      }
    }
  });

  it("names every live seat exactly once, which is what SQL then checks", () => {
    const pairs = pairRound({ matchSeed: "store", roundNo: 3, seats, history: [] });
    const named = pairs.flatMap((p) => (p.playerB ? [p.playerA, p.playerB] : [p.playerA]));
    expect(named.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("never names an eliminated seat", () => {
    const wounded = seats.map((s) => (s.playerId === "c" ? { ...s, eliminatedAt: 6 } : s));
    const pairs = pairRound({ matchSeed: "store", roundNo: 7, seats: wounded, history: [] });
    const named = pairs.flatMap((p) => (p.playerB ? [p.playerA, p.playerB] : [p.playerA]));
    expect(named).not.toContain("c");
  });
});
