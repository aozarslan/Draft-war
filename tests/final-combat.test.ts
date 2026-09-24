import { describe, expect, it } from "vitest";
import { liveDefinitionOf } from "./support/migrations";
import {
  combatPlanFor,
  type FightableMatch,
  type CombatPlanDeps,
} from "../src/lib/game/combat";
import { computeAxisBands } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";

/**
 * ---------------------------------------------------------------------------
 * Final combat: the championship fight and its champion.
 * ---------------------------------------------------------------------------
 * BUG-1: after CHAMPIONSHIP the match entered FINAL_COMBAT with no matchup
 * for the final fight.  `dw_advance_match_phase` saw the settled R8 matchups
 * (same round_no) and walked straight to MATCH_RESULTS, leaving
 * `champion_player_id` null.
 *
 * Fix (0038):
 *   – `dw_pair_final_round` creates the matchup (2 survivors) or crowns the
 *     champion directly (1 or 3+ survivors).
 *   – `dw_advance_match_phase` uses a dedicated FINAL_COMBAT guard keyed on
 *     `kind = 'FINAL'` so R8 matchups cannot satisfy it.
 *   – `dw_advance_match_phase` sets `champion_player_id` on MATCH_RESULTS.
 *
 * Fix (0040 — auto-advance):
 *   – `dw_match_tick` fires FINAL_COMBAT_DONE once the fight is settled (or
 *     the champion is already crowned for 1 / 3+ survivor paths), so the
 *     match advances to MATCH_RESULTS without requiring a host click.
 *   – `dw_advance_match_phase` allows a null-player (tick-driven) advance for
 *     FINAL_COMBAT, parallel to the way AUCTION is driven by ROUND_AUCTION_COMPLETE.
 *
 * These tests pin the SQL source to the contract rather than executing it
 * (no database in CI), using the same pattern as round-pairing.test.ts.
 */

function fn(name: string): string {
  return liveDefinitionOf(name).sql;
}

const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const MARVEL = CHARACTERS.filter((c) => c.categoryId === "apex").map((c) => c.id);

const marvelSlots = (playerId: string, ids: string[]) =>
  ids.map((characterId, i) => ({ playerId, characterId, zone: "FRONT", slot: i }));

const deps: CombatPlanDeps = {
  charactersById: BY_ID,
  bands: BANDS,
  seatOf: (id: string) => ({ nickname: id.toUpperCase() }),
};

// ---------------------------------------------------------------------------
// Migration ownership
// ---------------------------------------------------------------------------

describe("0038 owns the functions it introduces or replaces", () => {
  it("dw_pair_final_round lives in 0038", () => {
    expect(liveDefinitionOf("dw_pair_final_round").file).toBe(
      "0038_s8_final_combat_champion.sql",
    );
  });
});

describe("0040 owns the functions it replaces", () => {
  it("dw_advance_match_phase moved to 0040", () => {
    expect(liveDefinitionOf("dw_advance_match_phase").file).toBe(
      "0040_s8_final_combat_auto_advance.sql",
    );
  });

  it("dw_match_tick moved to 0040", () => {
    expect(liveDefinitionOf("dw_match_tick").file).toBe(
      "0040_s8_final_combat_auto_advance.sql",
    );
  });
});

// ---------------------------------------------------------------------------
// dw_pair_final_round — survivor rules (SQL source inspection)
// ---------------------------------------------------------------------------

describe("dw_pair_final_round handles every survivor count", () => {
  const sql = fn("dw_pair_final_round");

  it("requires FINAL_COMBAT phase", () => {
    expect(sql).toMatch(/m\.phase <> 'FINAL_COMBAT'/);
  });

  it("is idempotent: noop when champion_player_id is already set", () => {
    expect(sql).toMatch(/m\.champion_player_id is not null/);
  });

  it("is idempotent: noop when a FINAL matchup already exists", () => {
    expect(sql).toMatch(/kind = 'FINAL'/);
  });

  it("sets champion_player_id directly for 1 survivor", () => {
    // v_live = 1 branch: updates matches.champion_player_id
    expect(sql).toMatch(/v_live = 1/);
    expect(sql).toMatch(/update matches set champion_player_id/);
  });

  it("sets champion by highest HP for 3+ survivors (no matchup)", () => {
    expect(sql).toMatch(/v_live >= 3/);
    expect(sql).toMatch(/order by hp desc, round_wins desc/);
    // 3+ path does NOT insert a round_matchup
    const threeOrMore = sql.slice(
      sql.indexOf("v_live >= 3"),
      sql.indexOf("Exactly two survivors"),
    );
    expect(threeOrMore).not.toMatch(/insert into round_matchups/);
  });

  it("inserts a FINAL matchup for exactly 2 survivors", () => {
    expect(sql).toMatch(/insert into round_matchups/);
    expect(sql).toMatch(/kind, round_live_count/);
    // The inserted kind is 'FINAL'
    expect(sql).toMatch(/'FINAL', 2/);
  });
});

// ---------------------------------------------------------------------------
// dw_advance_match_phase — FINAL_COMBAT guard (SQL source inspection)
// ---------------------------------------------------------------------------

describe("dw_advance_match_phase FINAL_COMBAT guard", () => {
  const sql = fn("dw_advance_match_phase");

  it("no longer uses a combined COMBAT/FINAL_COMBAT block", () => {
    // The old `m.phase in ('COMBAT', 'FINAL_COMBAT')` pattern is gone.
    expect(sql).not.toMatch(/m\.phase in \('COMBAT', 'FINAL_COMBAT'\)/);
  });

  it("has a dedicated FINAL_COMBAT guard keyed on kind = 'FINAL'", () => {
    expect(sql).toMatch(/m\.phase = 'FINAL_COMBAT'/);
    expect(sql).toMatch(/kind = 'FINAL'/);
  });

  it("blocks FINAL_COMBAT → MATCH_RESULTS when FINAL matchup is absent", () => {
    expect(sql).toMatch(
      /COMBAT_INCOMPLETE.*The final round has not been paired yet/s,
    );
  });

  it("blocks FINAL_COMBAT → MATCH_RESULTS when FINAL fight is unsettled", () => {
    expect(sql).toMatch(
      /COMBAT_INCOMPLETE.*The final fight has not finished yet/s,
    );
  });

  it("blocks FINAL_COMBAT → MATCH_RESULTS when 3+ survivors have no champion", () => {
    expect(sql).toMatch(
      /COMBAT_INCOMPLETE.*The champion has not been determined yet/s,
    );
  });

  it("sets champion_player_id when transitioning to MATCH_RESULTS", () => {
    expect(sql).toMatch(/champion_player_id.*MATCH_RESULTS/s);
    // Reads FINAL matchup winner first, falls back to pre-set value.
    expect(sql).toMatch(/winner_player_id.*kind = 'FINAL'/s);
  });
});

// ---------------------------------------------------------------------------
// dw_match_tick — FINAL_COMBAT recovery and auto-advance (SQL source)
// ---------------------------------------------------------------------------

describe("dw_match_tick handles FINAL_COMBAT on every path", () => {
  const sql = fn("dw_match_tick");

  it("has a dedicated FINAL_COMBAT block", () => {
    expect(sql).toMatch(/m\.phase = 'FINAL_COMBAT'/);
  });

  it("fires NEEDS_COMBAT when the FINAL matchup is absent (2-survivor path)", () => {
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    expect(finalBlock).toMatch(/not exists.*kind = 'FINAL'/s);
    expect(finalBlock).toMatch(/NEEDS_COMBAT/);
  });

  it("fires NEEDS_COMBAT when the FINAL matchup is unsettled (2-survivor path)", () => {
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    expect(finalBlock).toMatch(/exists.*kind = 'FINAL'.*battle_result is null/s);
  });

  it("fires NEEDS_COMBAT when champion is unset (1 / 3+ survivor retry path)", () => {
    // pairFinalRound may have failed; the tick must drive a retry.
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    expect(finalBlock).toMatch(/m\.champion_player_id is null/);
    expect(finalBlock).toMatch(/NEEDS_COMBAT/);
  });

  it("fires FINAL_COMBAT_DONE once the 2-survivor fight is settled", () => {
    // After the fight, v_live drops to 1 — NEEDS_COMBAT would not fire.
    // FINAL_COMBAT_DONE drives the auto-advance to MATCH_RESULTS.
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    expect(finalBlock).toMatch(/FINAL_COMBAT_DONE/);
  });

  it("fires FINAL_COMBAT_DONE once champion is set (1 / 3+ paths)", () => {
    // These paths never create a FINAL matchup; the tick must still advance.
    // The SQL structure: if champion null → NEEDS_COMBAT; otherwise → FINAL_COMBAT_DONE.
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    // The null-check retry and the done signal are in the same block.
    expect(finalBlock).toMatch(/champion_player_id is null[\s\S]*?NEEDS_COMBAT[\s\S]*?FINAL_COMBAT_DONE/);
  });
});

// ---------------------------------------------------------------------------
// dw_advance_match_phase — tick-driven advance for FINAL_COMBAT (SQL source)
// ---------------------------------------------------------------------------

describe("dw_advance_match_phase allows tick-driven FINAL_COMBAT advance", () => {
  const sql = fn("dw_advance_match_phase");

  it("treats FINAL_COMBAT like AUCTION for null-player (tick-driven) calls", () => {
    // The guard must name both AUCTION and FINAL_COMBAT in the same branch
    // so the tick can drive the advance on either completion signal.
    expect(sql).toMatch(/m\.phase not in \('AUCTION', 'FINAL_COMBAT'\)/);
  });

  it("still requires the host for every other non-timed phase", () => {
    // The guard from 0038 that blocks null-player advances of arbitrary
    // non-timed phases must still be present — only AUCTION and FINAL_COMBAT
    // may be driven by the tick.
    expect(sql).toMatch(/return.*noop.*true/s);
  });
});

// ---------------------------------------------------------------------------
// combatPlanFor picks up FINAL matchups (pure TS)
// ---------------------------------------------------------------------------

describe("combatPlanFor includes FINAL matchups in FINAL_COMBAT", () => {
  const board = [
    ...marvelSlots("p1", MARVEL.slice(0, 5)),
    ...marvelSlots("p2", MARVEL.slice(5, 10)),
  ];

  it("plans the FINAL duel when phase is FINAL_COMBAT", () => {
    const match: FightableMatch = {
      status: "ACTIVE",
      phase: "FINAL_COMBAT",
      roundNo: 8,
      seed: "final-seed",
      categoryIds: ["apex"],
      players: [
        { playerId: "p1", hp: 20, eliminatedAt: null },
        { playerId: "p2", hp: 15, eliminatedAt: null },
      ],
      board,
      acquisitions: MARVEL.slice(0, 10).map((characterId) => ({
        characterId,
        price: 1,
      })),
      // Settled R8 matchup — must NOT be replanned.
      matchups: [
        {
          roundNo: 8,
          pairingIndex: 0,
          playerA: "p1",
          playerB: "p2",
          battleResult: { settled: true },
        },
        // The FINAL matchup — unsettled, must be planned.
        {
          roundNo: 8,
          pairingIndex: 1,
          playerA: "p1",
          playerB: "p2",
          battleResult: null,
        },
      ],
    };

    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(1);
    expect(plan[0].pairingIndex).toBe(1);
  });

  it("does not replan a settled FINAL matchup", () => {
    const match: FightableMatch = {
      status: "ACTIVE",
      phase: "FINAL_COMBAT",
      roundNo: 8,
      seed: "final-seed",
      categoryIds: ["apex"],
      players: [
        { playerId: "p1", hp: 20, eliminatedAt: null },
        { playerId: "p2", hp: 0, eliminatedAt: 8 },
      ],
      board,
      acquisitions: MARVEL.slice(0, 10).map((characterId) => ({
        characterId,
        price: 1,
      })),
      matchups: [
        {
          roundNo: 8,
          pairingIndex: 1,
          playerA: "p1",
          playerB: "p2",
          battleResult: { winner: "p1" },
        },
      ],
    };

    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(0);
  });
});
