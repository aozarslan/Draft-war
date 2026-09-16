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
 * These tests pin the SQL source to the contract rather than executing it
 * (no database in CI), using the same pattern as round-pairing.test.ts.
 */

function fn(name: string): string {
  return liveDefinitionOf(name).sql;
}

const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const MARVEL = CHARACTERS.filter((c) => c.categoryId === "marvel").map((c) => c.id);

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

  it("dw_advance_match_phase moved to 0038", () => {
    expect(liveDefinitionOf("dw_advance_match_phase").file).toBe(
      "0038_s8_final_combat_champion.sql",
    );
  });

  it("dw_match_tick moved to 0038", () => {
    expect(liveDefinitionOf("dw_match_tick").file).toBe(
      "0038_s8_final_combat_champion.sql",
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
// dw_match_tick — FINAL_COMBAT recovery (SQL source inspection)
// ---------------------------------------------------------------------------

describe("dw_match_tick fires NEEDS_COMBAT for FINAL_COMBAT", () => {
  const sql = fn("dw_match_tick");

  it("has a dedicated FINAL_COMBAT block", () => {
    expect(sql).toMatch(/m\.phase = 'FINAL_COMBAT'/);
  });

  it("fires NEEDS_COMBAT when the FINAL matchup is absent", () => {
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    expect(finalBlock).toMatch(/not exists.*kind = 'FINAL'/s);
    expect(finalBlock).toMatch(/NEEDS_COMBAT/);
  });

  it("fires NEEDS_COMBAT when the FINAL matchup is unsettled", () => {
    const finalBlock = sql.slice(sql.indexOf("FINAL_COMBAT"));
    expect(finalBlock).toMatch(/exists.*kind = 'FINAL'.*battle_result is null/s);
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
      categoryIds: ["marvel"],
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
      categoryIds: ["marvel"],
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
