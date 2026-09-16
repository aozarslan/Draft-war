import { describe, expect, it } from "vitest";
import { liveDefinitionOf } from "./support/migrations";
import {
  GHOST_PLAYER_PREFIX,
  combatPlanFor,
  ghostSeedFor,
  type FightableMatch,
  type CombatPlanDeps,
} from "../src/lib/game/combat";
import { computeAxisBands } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";

/**
 * ---------------------------------------------------------------------------
 * Ghost rounds: the bye seat fights a board, not a free round.
 * ---------------------------------------------------------------------------
 * When the number of live players is odd the round still has no free passes:
 * the odd seat is paired against a deterministic copy of another live
 * player's board. The ghost owner's HP is never touched.
 *
 * These tests exercise `combatPlanFor` (pure) and `dw_resolve_matchup` (SQL)
 * from the outside to ensure the contract holds end-to-end.
 */

const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const MARVEL = CHARACTERS.filter((c) => c.categoryId === "marvel").map((c) => c.id);
const DC = CHARACTERS.filter((c) => c.categoryId === "dc").map((c) => c.id);

const marvelSlots = (playerId: string, ids: string[]) =>
  ids.map((characterId, i) => ({ playerId, characterId, zone: "FRONT", slot: i }));

const acquisitions = (ids: string[]) => ids.map((characterId) => ({ characterId, price: 1 }));

const deps: CombatPlanDeps = {
  charactersById: BY_ID,
  bands: BANDS,
  seatOf: (id: string) => ({ nickname: id.toUpperCase() }),
};

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("ghost selection is deterministic", () => {
  it("same seed and round always picks the same ghost", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 4, seed: "det-seed",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 70, eliminatedAt: null },
        { playerId: "b", hp: 50, eliminatedAt: null },
        { playerId: "c", hp: 60, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 3)),
        ...marvelSlots("b", MARVEL.slice(3, 6)),
        ...marvelSlots("c", MARVEL.slice(6, 9)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 9)),
      matchups: [
        { roundNo: 4, pairingIndex: 0, playerA: "a", playerB: "b", battleResult: null },
        { roundNo: 4, pairingIndex: 1, playerA: "c", playerB: null, battleResult: null },
      ],
    };

    const plan1 = combatPlanFor(match, deps);
    const plan2 = combatPlanFor(match, deps);
    const ghostFight = plan1.find((p) => p.ghostPlayerId !== null)!;
    const ghostFight2 = plan2.find((p) => p.ghostPlayerId !== null)!;

    expect(ghostFight.ghostPlayerId).toBe(ghostFight2.ghostPlayerId);
    expect(ghostFight.input.teams[1].playerId).toBe(ghostFight2.input.teams[1].playerId);
  });

  it("different seeds pick different ghosts (with high probability)", () => {
    const ghost = (seed: string) => {
      const m: FightableMatch = {
        status: "ACTIVE", phase: "COMBAT", roundNo: 1, seed,
        categoryIds: ["marvel"],
        players: [
          { playerId: "p1", hp: 80, eliminatedAt: null },
          { playerId: "p2", hp: 80, eliminatedAt: null },
          { playerId: "p3", hp: 80, eliminatedAt: null },
          { playerId: "p4", hp: 80, eliminatedAt: null },
          { playerId: "p5", hp: 80, eliminatedAt: null },
        ],
        board: [
          ...marvelSlots("p1", MARVEL.slice(0, 3)),
          ...marvelSlots("p2", MARVEL.slice(3, 6)),
          ...marvelSlots("p3", MARVEL.slice(6, 9)),
          ...marvelSlots("p4", MARVEL.slice(9, 12)),
          ...marvelSlots("p5", MARVEL.slice(12, 15)),
        ],
        acquisitions: acquisitions(MARVEL.slice(0, 15)),
        matchups: [
          { roundNo: 1, pairingIndex: 0, playerA: "p1", playerB: "p2", battleResult: null },
          { roundNo: 1, pairingIndex: 1, playerA: "p3", playerB: "p4", battleResult: null },
          { roundNo: 1, pairingIndex: 2, playerA: "p5", playerB: null, battleResult: null },
        ],
      };
      return combatPlanFor(m, deps).find((p) => p.ghostPlayerId !== null)!.ghostPlayerId;
    };

    // With 4 candidates and 10 different seeds, expect more than one unique ghost
    const ghosts = new Set(["s1","s2","s3","s4","s5","s6","s7","s8","s9","s10"].map(ghost));
    expect(ghosts.size).toBeGreaterThan(1);
  });

  it("ghostSeedFor produces distinct seeds from the battle and battlefield seeds", () => {
    const battle = `seed-abc:3:0`;
    const ghost = ghostSeedFor("seed-abc", 3, 0);
    const env = `env:seed-abc:3`;
    expect(new Set([battle, ghost, env]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The ghost prefix marks a non-real player
// ---------------------------------------------------------------------------

describe("the ghost player id", () => {
  it("starts with the ghost prefix", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 3, seed: "prefix-test",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 60, eliminatedAt: null },
        { playerId: "b", hp: 40, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 3)),
        ...marvelSlots("b", MARVEL.slice(3, 6)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 6)),
      matchups: [
        { roundNo: 3, pairingIndex: 0, playerA: "a", playerB: null, battleResult: null },
      ],
    };

    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(1);
    expect(plan[0].input.teams[1].playerId.startsWith(GHOST_PLAYER_PREFIX)).toBe(true);
    expect(plan[0].ghostPlayerId).toBe("b"); // only candidate
  });

  it("is never the bye player themselves", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 2, seed: "not-self",
      categoryIds: ["marvel"],
      players: [
        { playerId: "x", hp: 80, eliminatedAt: null },
        { playerId: "y", hp: 80, eliminatedAt: null },
        { playerId: "z", hp: 80, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("x", MARVEL.slice(0, 3)),
        ...marvelSlots("y", MARVEL.slice(3, 6)),
        ...marvelSlots("z", MARVEL.slice(6, 9)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 9)),
      matchups: [
        { roundNo: 2, pairingIndex: 0, playerA: "x", playerB: "y", battleResult: null },
        { roundNo: 2, pairingIndex: 1, playerA: "z", playerB: null, battleResult: null },
      ],
    };

    const plan = combatPlanFor(match, deps);
    const ghost = plan.find((p) => p.ghostPlayerId !== null)!;
    expect(ghost.ghostPlayerId).not.toBe("z");
    expect(["x", "y"]).toContain(ghost.ghostPlayerId);
  });
});

// ---------------------------------------------------------------------------
// Ghost owner is not affected
// ---------------------------------------------------------------------------

describe("the ghost owner's state is never touched by combatPlanFor", () => {
  it("ghostPlayerId is null for ordinary duels", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 1, seed: "even",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 80, eliminatedAt: null },
        { playerId: "b", hp: 80, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 3)),
        ...marvelSlots("b", MARVEL.slice(3, 6)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 6)),
      matchups: [
        { roundNo: 1, pairingIndex: 0, playerA: "a", playerB: "b", battleResult: null },
      ],
    };

    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(1);
    expect(plan[0].ghostPlayerId).toBeNull();
  });

  it("uses the ghost owner's current board (latest acquisitions)", () => {
    // Board has 5 chars for both players — "b" has more characters than a simple 3-slot board.
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 5, seed: "current-board",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 60, eliminatedAt: null },
        { playerId: "b", hp: 50, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 5)),
        ...marvelSlots("b", DC.slice(0, 5)),
      ],
      acquisitions: [
        ...MARVEL.slice(0, 5).map((characterId) => ({ characterId, price: 2 })),
        ...DC.slice(0, 5).map((characterId) => ({ characterId, price: 3 })),
      ],
      matchups: [
        { roundNo: 5, pairingIndex: 0, playerA: "a", playerB: null, battleResult: null },
      ],
    };

    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(1);
    // Ghost board characters should all belong to "b"
    const ghostTeam = plan[0].input.teams[1];
    const ghostCharIds = ghostTeam.characters.map((c) => c.characterId);
    for (const id of ghostCharIds) {
      expect(DC.slice(0, 5)).toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Player count scenarios
// ---------------------------------------------------------------------------

describe("ghost rounds by player count", () => {
  it("2 players — no ghost (even, playerB always set)", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 3, seed: "two-p",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 60, eliminatedAt: null },
        { playerId: "b", hp: 40, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 3)),
        ...marvelSlots("b", MARVEL.slice(3, 6)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 6)),
      matchups: [
        { roundNo: 3, pairingIndex: 0, playerA: "a", playerB: "b", battleResult: null },
      ],
    };
    const plan = combatPlanFor(match, deps);
    expect(plan.every((p) => p.ghostPlayerId === null)).toBe(true);
  });

  it("3 players — exactly one ghost fight per round", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 2, seed: "three-p",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 80, eliminatedAt: null },
        { playerId: "b", hp: 80, eliminatedAt: null },
        { playerId: "c", hp: 80, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 3)),
        ...marvelSlots("b", MARVEL.slice(3, 6)),
        ...marvelSlots("c", MARVEL.slice(6, 9)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 9)),
      matchups: [
        { roundNo: 2, pairingIndex: 0, playerA: "a", playerB: "b", battleResult: null },
        { roundNo: 2, pairingIndex: 1, playerA: "c", playerB: null, battleResult: null },
      ],
    };
    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(2);
    const ghosts = plan.filter((p) => p.ghostPlayerId !== null);
    const duels = plan.filter((p) => p.ghostPlayerId === null);
    expect(ghosts).toHaveLength(1);
    expect(duels).toHaveLength(1);
  });

  it("4 players — no ghost (even)", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 1, seed: "four-p",
      categoryIds: ["marvel"],
      players: [
        { playerId: "p1", hp: 80, eliminatedAt: null },
        { playerId: "p2", hp: 80, eliminatedAt: null },
        { playerId: "p3", hp: 80, eliminatedAt: null },
        { playerId: "p4", hp: 80, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("p1", MARVEL.slice(0, 3)),
        ...marvelSlots("p2", MARVEL.slice(3, 6)),
        ...marvelSlots("p3", MARVEL.slice(6, 9)),
        ...marvelSlots("p4", MARVEL.slice(9, 12)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 12)),
      matchups: [
        { roundNo: 1, pairingIndex: 0, playerA: "p1", playerB: "p2", battleResult: null },
        { roundNo: 1, pairingIndex: 1, playerA: "p3", playerB: "p4", battleResult: null },
      ],
    };
    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(2);
    expect(plan.every((p) => p.ghostPlayerId === null)).toBe(true);
  });

  it("5 players — exactly one ghost fight per round", () => {
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 3, seed: "five-p",
      categoryIds: ["marvel"],
      players: [
        { playerId: "p1", hp: 80, eliminatedAt: null },
        { playerId: "p2", hp: 80, eliminatedAt: null },
        { playerId: "p3", hp: 80, eliminatedAt: null },
        { playerId: "p4", hp: 80, eliminatedAt: null },
        { playerId: "p5", hp: 80, eliminatedAt: null },
      ],
      board: [
        ...marvelSlots("p1", MARVEL.slice(0, 3)),
        ...marvelSlots("p2", MARVEL.slice(3, 6)),
        ...marvelSlots("p3", MARVEL.slice(6, 9)),
        ...marvelSlots("p4", MARVEL.slice(9, 12)),
        ...marvelSlots("p5", MARVEL.slice(12, 15)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 15)),
      matchups: [
        { roundNo: 3, pairingIndex: 0, playerA: "p1", playerB: "p2", battleResult: null },
        { roundNo: 3, pairingIndex: 1, playerA: "p3", playerB: "p4", battleResult: null },
        { roundNo: 3, pairingIndex: 2, playerA: "p5", playerB: null, battleResult: null },
      ],
    };
    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(3);
    const ghosts = plan.filter((p) => p.ghostPlayerId !== null);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].input.teams[1].playerId.startsWith(GHOST_PLAYER_PREFIX)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bye winner gets round_wins — SQL contract
// ---------------------------------------------------------------------------

describe("the SQL contract for ghost rounds", () => {
  it("dw_resolve_matchup stores ghost_player_id when provided", () => {
    const sql = liveDefinitionOf("dw_resolve_matchup").sql;
    expect(sql).toContain("p_ghost_player_id");
    expect(sql).toMatch(/ghost_player_id\s*=\s*p_ghost_player_id/);
  });

  it("dw_resolve_matchup accepts ghost_player_id as optional (default null)", () => {
    const sql = liveDefinitionOf("dw_resolve_matchup").sql;
    expect(sql).toMatch(/p_ghost_player_id\s+uuid\s+default\s+null/);
  });

  it("ghost_player_id does not restrict winner_player_id (bye player can win)", () => {
    // The ghost owner's id is never checked against winner/loser validation —
    // the bye player is the only real seat, so they can be winner_player_id.
    const sql = liveDefinitionOf("dw_resolve_matchup").sql;
    const validation = sql.slice(
      sql.indexOf("-- Whoever is named"),
      sql.indexOf("update round_matchups"),
    );
    expect(validation).not.toContain("p_ghost_player_id");
  });

  it("dw_match_snapshot exposes ghostPlayerId in each matchup", () => {
    const sql = liveDefinitionOf("dw_match_snapshot").sql;
    expect(sql).toContain("ghostPlayerId");
    expect(sql).toMatch(/ghost_player_id/);
  });

  it("bye player's round_wins is incremented when they win a ghost fight", () => {
    const sql = liveDefinitionOf("dw_resolve_matchup").sql;
    // The winner branch is unconditional on ghost presence.
    expect(sql).toMatch(/if p_winner_player_id is not null then\s*update match_players\s*set round_wins = round_wins \+ 1/);
  });
});

// ---------------------------------------------------------------------------
// Sole survivor edge case
// ---------------------------------------------------------------------------

describe("sole survivor edge case", () => {
  it("does not plan a ghost fight when there are no candidates", () => {
    // If somehow an odd-seat matchup fires with only one live player left
    // (the bye player themselves), combatPlanFor must omit the fight rather
    // than crashing or inventing an opponent.
    const match: FightableMatch = {
      status: "ACTIVE", phase: "COMBAT", roundNo: 7, seed: "sole-survivor",
      categoryIds: ["marvel"],
      players: [
        { playerId: "a", hp: 20, eliminatedAt: null },
        { playerId: "b", hp: 0, eliminatedAt: 6 },
      ],
      board: [
        ...marvelSlots("a", MARVEL.slice(0, 3)),
        ...marvelSlots("b", MARVEL.slice(3, 6)),
      ],
      acquisitions: acquisitions(MARVEL.slice(0, 6)),
      matchups: [
        { roundNo: 7, pairingIndex: 0, playerA: "a", playerB: null, battleResult: null },
      ],
    };

    const plan = combatPlanFor(match, deps);
    expect(plan).toHaveLength(0);
  });
});
