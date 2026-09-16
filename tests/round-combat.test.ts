import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { liveDefinitionOf } from "./support/migrations";
import { STARTING_HP, ELIMINATION_FROM_ROUND, nextPhaseOf, type MatchPhase } from "../src/lib/game/rounds";
import {
  DAMAGE_CURVE, GHOST_PLAYER_PREFIX, LIVE_COUNT_SCALE,
  buildDuelInput, combatPlanFor, damageFor,
  fightOne, fightingBoardOf, outcomeOf, type CombatContext,
} from "../src/lib/game/combat";
import { computeAxisBands, computeSynergy, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";

/**
 * ---------------------------------------------------------------------------
 * A fight happens once, and it costs exactly one player exactly one life total.
 * ---------------------------------------------------------------------------
 * S8.5b is the milestone where the round loop stops being a draft with a
 * scoreboard. Almost none of it is combat — the engine already existed — and
 * almost all of the risk is in the four sentences below being true at the same
 * time:
 *
 *   a stored result implies the HP was applied;
 *   applied HP implies a stored result;
 *   two callers cannot both resolve one matchup;
 *   two matchups cannot both change one player's HP.
 *
 * Only a single transaction gives you the first two, and only a row lock gives
 * you the third. The fourth is a property of the pairing, and is asserted
 * rather than assumed.
 */

const ROOT = process.cwd();
const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const MARVEL = CHARACTERS.filter((c) => c.categoryId === "marvel").map((c) => c.id);
const DC = CHARACTERS.filter((c) => c.categoryId === "dc").map((c) => c.id);

const fn = (name: string) => liveDefinitionOf(name).sql;
const boardOf = (ids: string[]) => ids.map((characterId, i) => ({ characterId, price: i + 1 }));
const ctx = (over: Partial<CombatContext> = {}): CombatContext => ({
  matchSeed: "s", roundNo: 3, pairingIndex: 0, categoryIds: ["marvel", "dc"],
  charactersById: BY_ID, bands: BANDS, ...over,
});

// ---------------------------------------------------------------------------
// The life total
// ---------------------------------------------------------------------------

describe("the life a match starts with", () => {
  it("is sixty, in both copies", () => {
    expect(STARTING_HP).toBe(60);
    const start = fn("dw_start_match");
    expect(start, "the database still deals a different life total").toMatch(
      /select v_match, p\.id, 60, v_credits/,
    );
  });

  it("survives more losses than a round can inflict, and fewer than eight", () => {
    // The arc the calibration is for: nobody dies to one unlucky round, and
    // nobody survives a whole match of losing.
    const worst = damageFor({ roundNo: 8, winnerHpFraction: 1, upset: true });
    expect(worst).toBeLessThan(STARTING_HP / 2);
    expect(worst * 7).toBeGreaterThan(STARTING_HP);
  });
});

// ---------------------------------------------------------------------------
// Reading the engine's own numbers
// ---------------------------------------------------------------------------

describe("the damage comes from the winner's remaining health", () => {
  it("uses remainingHpPct and never the survivor count", () => {
    const body = readFileSync(join(ROOT, "src", "lib", "game", "combat.ts"), "utf8")
      .match(/export function outcomeOf[\s\S]*?\n}/)![0];
    expect(body).toContain("remainingHpPct / 100");
    expect(body, "survivors is not remaining power").not.toContain("survivors");
  });

  it("agrees with what a real battle reports", () => {
    const built = buildDuelInput(
      ctx(),
      { playerId: "a", nickname: "A", board: boardOf(MARVEL.slice(0, 5)) },
      { playerId: "b", nickname: "B", board: boardOf(DC.slice(0, 5)) },
    );
    if (!built.ok) throw new Error("input did not build");
    const result = simulateBattle(built.input);
    const winner = result.teams.find((t) => t.playerId === result.winnerPlayerId)!;
    const out = outcomeOf(result, 3, new Set(["a", "b"]));
    expect(out.damage).toBe(
      damageFor({ roundNo: 3, winnerHpFraction: winner.remainingHpPct / 100, upset: result.upset }),
    );
  });

  it("charges nobody when a seat beats a non-real opponent (ghost or arena)", () => {
    const ghostId = `${GHOST_PLAYER_PREFIX}some-player`;
    const out = outcomeOf(
      {
        teams: [
          { playerId: "a", remainingHpPct: 60 } as never,
          { playerId: ghostId, remainingHpPct: 0 } as never,
        ],
        winnerPlayerId: "a", upset: false,
      },
      4, new Set(["a"]),
    );
    expect(out.loserPlayerId).toBeNull();
    expect(out.damage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// One matchup, one resolution
// ---------------------------------------------------------------------------

describe("a matchup is fought exactly once", () => {
  const resolve = fn("dw_resolve_matchup");

  it("locks the matchup row, not the match", () => {
    // Two fights in one round must not wait on each other, and neither may be
    // fought twice. The row they both write is the row to lock.
    expect(resolve).toMatch(
      /select \* into r from round_matchups[\s\S]*?pairing_index = p_pairing_index\s*for update;/,
    );
  });

  it("returns the stored fight instead of running a second one", () => {
    expect(resolve).toMatch(/if r\.battle_result is not null then/);
    expect(resolve).toContain("'alreadyResolved', true");
    const branch = resolve.match(/if r\.battle_result is not null then[\s\S]*?end if;/)![0];
    for (const write of ["update match_players", "update round_matchups", "hp -"]) {
      expect(branch, `the noop branch performs ${write}`).not.toContain(write);
    }
  });

  it("writes the result and the life it costs in one statement sequence", () => {
    const body = resolve.slice(resolve.indexOf("update round_matchups"));
    expect(body).toContain("update round_matchups");
    expect(body).toContain("update match_players");
    // No commit, no savepoint, no second entry point between them.
    expect(resolve).not.toMatch(/commit;|rollback;|savepoint/i);
  });

  it("refuses a result for a seat that is not in the matchup", () => {
    expect(resolve).toContain("BAD_RESULT");
    expect(resolve).toMatch(/p_winner_player_id is distinct from r\.player_a/);
    expect(resolve).toMatch(/p_loser_player_id is distinct from r\.player_a/);
    expect(resolve, "one seat could be both winner and loser")
      .toMatch(/p_loser_player_id = p_winner_player_id/);
  });

  it("refuses a matchup that does not exist, and a phase that is not combat", () => {
    expect(resolve).toContain("NO_MATCHUP");
    expect(resolve).toMatch(/m\.phase not in \('COMBAT', 'FINAL_COMBAT'\)/);
  });
});

// ---------------------------------------------------------------------------
// HP and elimination
// ---------------------------------------------------------------------------

describe("what a loss costs", () => {
  const resolve = fn("dw_resolve_matchup");

  it("never takes a life total below zero", () => {
    expect(resolve).toMatch(/hp\s*= greatest\(v_floor, hp - greatest\(0, coalesce\(p_damage, 0\)\)\)/);
  });

  it("floors at one before the elimination round", () => {
    expect(ELIMINATION_FROM_ROUND).toBe(6);
    expect(resolve).toMatch(/v_floor := case when m\.round_no >= 6 then 0 else 1 end/);
  });

  it("puts a seat out once, and only from that round", () => {
    expect(resolve).toMatch(/if v_hp <= 0 and v_out is null then/);
    expect(resolve).toMatch(/eliminated_at = m\.round_no/);
    expect(resolve, "a seat could be eliminated twice")
      .toMatch(/where match_id = m\.id and player_id = p_loser_player_id\s*and eliminated_at is null/);
  });

  it("charges only the loser", () => {
    const hp = resolve.match(/update match_players\s*set hp[\s\S]*?;/)![0];
    expect(hp).toContain("player_id = p_loser_player_id");
    expect(hp).not.toContain("p_winner_player_id");
  });

  it("never touches either wallet", () => {
    expect(resolve, "combat moved credits").not.toMatch(/credits/);
  });
});

// ---------------------------------------------------------------------------
// The round cannot be walked past
// ---------------------------------------------------------------------------

describe("a round is not over until every fight is", () => {
  const advance = fn("dw_advance_match_phase");
  const tick = fn("dw_match_tick");

  it("refuses to leave combat with a fight outstanding", () => {
    expect(advance).toContain("COMBAT_INCOMPLETE");
    expect(advance).toMatch(
      /and battle_result is null\s*\)\s*then\s*return dw_err\('COMBAT_INCOMPLETE'/,
    );
  });

  it("refuses to leave combat that never happened", () => {
    // The hole 0033 closed for the draft, closed here before it can open.
    expect(advance).toMatch(
      /if not exists \(select 1 from round_matchups[\s\S]*?return dw_err\('COMBAT_INCOMPLETE', 'This round has no fights yet\.'\)/,
    );
  });

  it("asks the clock for the fights it is missing", () => {
    expect(tick).toContain("NEEDS_COMBAT");
    expect(tick).toMatch(/battle_result is null/);
  });

  it("keeps every guard the earlier migrations installed", () => {
    for (const kept of [
      "CONCURRENT_PHASE_ADVANCE", "dw_min_phase_dwell()", "AUCTION_INCOMPLETE",
      "NOT_PAIRED", "INVALID_TRANSITION", "phase_started_at = now()", "for update",
    ]) {
      expect(advance, `${kept} went missing`).toContain(kept);
    }
    expect(advance, "the draft-never-opened guard was lost")
      .toMatch(/if not found then\s*return dw_err\('AUCTION_INCOMPLETE'/);
    expect(tick, "the draft reports went missing").toContain("NEEDS_ROUND_AUCTION");
    expect(tick, "the pairing report went missing").toContain("NEEDS_ROUND_PAIRING");
  });
});

describe("a decided match stops", () => {
  it("hands over to the championship when one seat is left", () => {
    expect(nextPhaseOf("ROUND_END", { roundNo: 3, totalRounds: 8, liveCount: 1 }))
      .toBe("CHAMPIONSHIP");
    expect(nextPhaseOf("ROUND_END", { roundNo: 3, totalRounds: 8, liveCount: 0 }))
      .toBe("CHAMPIONSHIP");
  });

  it("plays the round out while two or more remain", () => {
    expect(nextPhaseOf("ROUND_END", { roundNo: 3, totalRounds: 8, liveCount: 2 }))
      .toBe("ROUND_START");
    expect(nextPhaseOf("ROUND_END", { roundNo: 8, totalRounds: 8, liveCount: 4 }))
      .toBe("CHAMPIONSHIP");
  });

  it("does not assume a table size it was not told", () => {
    // Most callers ask about the shape of the machine rather than one match.
    expect(nextPhaseOf("ROUND_END", { roundNo: 3, totalRounds: 8 })).toBe("ROUND_START");
  });

  it("is mirrored in the database", () => {
    expect(fn("dw_advance_match_phase")).toMatch(
      /if m\.phase = 'ROUND_END' then[\s\S]*?v_live < 2 then v_next := 'CHAMPIONSHIP'/,
    );
  });
});

// ---------------------------------------------------------------------------
// The board that fights
// ---------------------------------------------------------------------------

describe("the strongest five hold the board", () => {
  const record = fn("dw_record_acquisition");

  it("re-ranks the whole squad after every purchase", () => {
    // Before this, the first five bought were the only five that could fight,
    // and rounds six to eight bought nothing at all.
    expect(record).toMatch(/row_number\(\) over \(\s*order by coalesce\(c\.game_power, 0\) desc/);
    expect(record).toMatch(/zone = case when r\.rn <= 5 then 'FRONT' else 'BENCH' end/);
  });

  it("breaks a power tie the same way every time", () => {
    expect(record).toMatch(/b\.character_id asc/);
  });

  it("keeps the fighting board to five, whatever the zones say", () => {
    const stuffed = Array.from({ length: 9 }, (_, i) => ({
      playerId: "a", characterId: `c${i}`, zone: "FRONT", slot: i,
    }));
    expect(fightingBoardOf(stuffed, "a", () => 1)).toHaveLength(5);
  });

  it("still leaves the bench out of the fight", () => {
    const slots = [
      { playerId: "a", characterId: "x", zone: "FRONT", slot: 0 },
      { playerId: "a", characterId: "y", zone: "BENCH", slot: 5 },
    ];
    expect(fightingBoardOf(slots, "a", () => 1).map((c) => c.characterId)).toEqual(["x"]);
  });
});

// ---------------------------------------------------------------------------
// Synergy reaches the fight, once
// ---------------------------------------------------------------------------

describe("the existing synergy decides the fight", () => {
  it("is computed by the engine and nowhere else", () => {
    const combat = readFileSync(join(ROOT, "src", "lib", "game", "combat.ts"), "utf8");
    const engine = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");
    for (const source of [combat, engine]) {
      expect(source, "a second synergy calculation appeared")
        .not.toMatch(/computeSynergy|synergyTotal|synergyBonus/);
    }
  });

  it("changes a real fight", () => {
    // A stacked board against a scattered one of comparable power. The bonus is
    // capped at +10%, so this is a thumb on the scale rather than a decision —
    // which is the point.
    const byTag: Record<string, string[]> = {};
    for (const c of CHARACTERS.filter((x) => x.categoryId === "marvel")) {
      for (const t of c.tags) (byTag[t] ??= []).push(c.id);
    }
    const stacked = Object.values(byTag).sort((a, b) => b.length - a.length)[0].slice(0, 5);
    expect(computeSynergy(stacked.map((id) => BY_ID[id])).total).toBeGreaterThan(0);
    expect(computeSynergy([BY_ID[stacked[0]]]).total).toBe(0);
  });

  it("grows with the board, which is where the mid game comes from", () => {
    const tagged = Object.entries(
      CHARACTERS.filter((c) => c.categoryId === "marvel")
        .reduce<Record<string, string[]>>((acc, c) => {
          for (const t of c.tags) (acc[t] ??= []).push(c.id);
          return acc;
        }, {}),
    ).sort((a, b) => b[1].length - a[1].length)[0][1];

    const at = (n: number) => computeSynergy(tagged.slice(0, n).map((id) => BY_ID[id])).total;
    expect(at(1)).toBe(0);
    expect(at(3)).toBeGreaterThan(at(2));
    expect(at(5)).toBeGreaterThanOrEqual(at(4));
  });
});

// ---------------------------------------------------------------------------
// The server decides
// ---------------------------------------------------------------------------

describe("no client can name a fight", () => {
  const route = readFileSync(
    join(ROOT, "src", "app", "api", "rooms", "[code]", "action", "route.ts"), "utf8",
  );
  const engine = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");

  it("adds no action for combat", () => {
    // Scoped to the action union, not the whole file: the legacy ADVANCE case
    // switches on the old game's phase names and one of them is "BATTLE".
    // What matters is what a client may *send*.
    const union = route.match(/^type Action =[\s\S]*?;$/m)?.[0];
    expect(union, "the action union is missing").toBeTruthy();
    const declared = [...union!.matchAll(/type:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
    for (const forbidden of ["RESOLVE", "RESOLVE_MATCHUP", "COMBAT", "BATTLE", "FIGHT", "SET_HP"]) {
      expect(declared, `the client may send ${forbidden}`).not.toContain(forbidden);
    }
    expect(declared).toContain("ADVANCE_MATCH");
  });

  it("fights on arrival and retries through the tick", () => {
    expect(engine).toMatch(/phase === "COMBAT" \|\| phase === "FINAL_COMBAT"[\s\S]*?resolveRoundCombat/);
    expect(engine).toMatch(/"NEEDS_COMBAT"\)\s*await resolveRoundCombat/);
  });

  it("takes every input from server state", () => {
    const body = engine.match(/export async function resolveRoundCombat[\s\S]*?\n}/)![0];
    for (const forbidden of ["action.", "request", "Math.random", "Date.now"]) {
      expect(body, `combat reads ${forbidden}`).not.toContain(forbidden);
    }
    // Which fights are owed, and their inputs, come from a pure function whose
    // three decisions — right phase, right round, not already fought — are
    // executed by tests rather than read out of this file.
    expect(body).toContain("combatPlanFor(match,");
    expect(body).toContain("fightOne(fight.input");
  });
});

// ---------------------------------------------------------------------------
// Which fights a round owes — executed, not inspected
// ---------------------------------------------------------------------------

describe("a round owes exactly the fights it has not had", () => {
  const marvel = MARVEL.slice(0, 12);
  const base = {
    status: "ACTIVE", phase: "COMBAT", roundNo: 3, seed: "s",
    categoryIds: ["marvel", "dc"],
    players: [
      { playerId: "a", hp: 60, eliminatedAt: null },
      { playerId: "b", hp: 40, eliminatedAt: null },
      { playerId: "c", hp: 0, eliminatedAt: 6 },
    ],
    board: [
      ...marvel.slice(0, 3).map((characterId, i) => ({ playerId: "a", characterId, zone: "FRONT", slot: i })),
      ...marvel.slice(3, 6).map((characterId, i) => ({ playerId: "b", characterId, zone: "FRONT", slot: i })),
    ],
    acquisitions: marvel.slice(0, 6).map((characterId) => ({ characterId, price: 3 })),
    matchups: [
      { roundNo: 3, pairingIndex: 0, playerA: "a", playerB: "b", battleResult: null },
      { roundNo: 2, pairingIndex: 0, playerA: "a", playerB: "b", battleResult: { seed: "old" } },
    ],
  };
  const deps = {
    charactersById: BY_ID, bands: BANDS,
    seatOf: (id: string) => ({ nickname: id.toUpperCase() }),
  };

  it("plans this round's unfought matchup and nothing else", () => {
    const plan = combatPlanFor(base as never, deps as never);
    expect(plan.map((p) => p.pairingIndex)).toEqual([0]);
    expect(plan[0].input.teams.map((t) => t.playerId)).toEqual(["a", "b"]);
  });

  it("does not fight a round the match has moved past", () => {
    const older = { ...base, roundNo: 2 };
    // Round 2's only matchup already has a result.
    expect(combatPlanFor(older as never, deps as never)).toEqual([]);
  });

  it("does not fight a matchup that already has a result", () => {
    const done = {
      ...base,
      matchups: [{ ...base.matchups[0], battleResult: { seed: "already" } }],
    };
    expect(combatPlanFor(done as never, deps as never)).toEqual([]);
  });

  it("does not fight outside the combat phases", () => {
    for (const phase of ["AUCTION", "MATCHMAKING", "BOARD_UPDATE", "ROUND_END"]) {
      expect(combatPlanFor({ ...base, phase } as never, deps as never), phase).toEqual([]);
    }
    expect(combatPlanFor({ ...base, phase: "FINAL_COMBAT" } as never, deps as never)).toHaveLength(1);
  });

  it("does not fight a match that has finished", () => {
    expect(combatPlanFor({ ...base, status: "FINISHED" } as never, deps as never)).toEqual([]);
    expect(combatPlanFor({ ...base, status: "ABANDONED" } as never, deps as never)).toEqual([]);
  });

  it("omits a fight it cannot assemble rather than awarding it", () => {
    const noBoard = { ...base, board: base.board.filter((b) => b.playerId === "a") };
    expect(combatPlanFor(noBoard as never, deps as never)).toEqual([]);
  });

  it("builds a ghost fight for an odd seat", () => {
    const odd = {
      ...base,
      matchups: [{ roundNo: 3, pairingIndex: 0, playerA: "a", playerB: null, battleResult: null }],
    };
    const plan = combatPlanFor(odd as never, deps as never);
    expect(plan).toHaveLength(1);
    // The ghost side's playerId starts with the ghost prefix.
    expect(plan[0].input.teams[1].playerId).toMatch(new RegExp(`^${GHOST_PLAYER_PREFIX}`));
    // The fight records which real player was ghosted.
    expect(plan[0].ghostPlayerId).not.toBeNull();
  });

  it("is the same plan every time", () => {
    const once = JSON.stringify(combatPlanFor(base as never, deps as never));
    for (let i = 0; i < 200; i++) {
      expect(JSON.stringify(combatPlanFor(base as never, deps as never))).toBe(once);
    }
  });
});

describe("one fight, run by the engine", () => {
  it("returns the engine's own result and the cost derived from it", () => {
    const built = buildDuelInput(
      ctx(),
      { playerId: "a", nickname: "A", board: boardOf(MARVEL.slice(0, 5)) },
      { playerId: "b", nickname: "B", board: boardOf(DC.slice(0, 5)) },
    );
    if (!built.ok) throw new Error("input did not build");
    const { result, outcome } = fightOne(built.input, 3, new Set(["a", "b"]));

    // The result is the engine's, byte for byte.
    expect(JSON.stringify(result)).toBe(JSON.stringify(simulateBattle(built.input)));
    expect(result.log.length).toBeGreaterThan(0);
    expect([outcome.winnerPlayerId, outcome.loserPlayerId].sort()).toEqual(["a", "b"]);
    expect(outcome.damage).toBeGreaterThanOrEqual(DAMAGE_CURVE.floor);
  });

  it("is deterministic", () => {
    const built = buildDuelInput(
      ctx(),
      { playerId: "a", nickname: "A", board: boardOf(MARVEL.slice(0, 5)) },
      { playerId: "b", nickname: "B", board: boardOf(DC.slice(0, 5)) },
    );
    if (!built.ok) throw new Error("input did not build");
    const first = JSON.stringify(fightOne(built.input, 3, new Set(["a", "b"])));
    for (let i = 0; i < 300; i++) {
      expect(JSON.stringify(fightOne(built.input, 3, new Set(["a", "b"])))).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------

describe("0034 adds behaviour, not schema", () => {
  const M34 = readFileSync(
    join(ROOT, "supabase", "migrations", "0034_s8_round_combat.sql"), "utf8",
  ).replace(/^\s*--.*$/gm, "");

  it("creates no table and no column", () => {
    for (const ddl of ["create table", "add column", "alter table", "create index"]) {
      expect(M34, `0034 performs ${ddl}`).not.toContain(ddl);
    }
  });

  it("destroys nothing", () => {
    for (const bad of ["drop table", "drop column", "truncate", "delete from", "drop constraint"]) {
      expect(M34.toLowerCase(), `0034 contains ${bad}`).not.toContain(bad);
    }
  });

  it("stores nothing that is already derivable", () => {
    for (const dup of ["matchup_seed", "board_snapshot", "encounter_flag", "bye_player", "rematch_count"]) {
      expect(M34, `0034 stores ${dup}`).not.toContain(dup);
    }
  });

  it("owns the definitions it is supposed to own", () => {
    for (const name of [
      "dw_record_acquisition",
      "dw_advance_match_phase", "dw_match_tick",
    ]) {
      expect(liveDefinitionOf(name).file, `${name} is not live from 0034`)
        .toBe("0034_s8_round_combat.sql");
    }
    // dw_start_match superseded by 0036 (HP 80 → 60).
    expect(liveDefinitionOf("dw_start_match").file).toBe("0036_s8_starting_hp_60.sql");
    // dw_resolve_matchup and dw_match_snapshot are superseded by 0035.
    expect(liveDefinitionOf("dw_resolve_matchup").file).toBe("0035_s8_ghost_rounds.sql");
    expect(liveDefinitionOf("dw_match_snapshot").file).toBe("0035_s8_ghost_rounds.sql");
    // dw_pair_round superseded by 0037 (round_live_count column).
    expect(liveDefinitionOf("dw_pair_round").file).toBe("0037_s8_damage_scaling.sql");
  });

  it("hands the stored fight back to the client", () => {
    expect(fn("dw_match_snapshot")).toContain("'battleResult', r.battle_result");
  });
});

// ---------------------------------------------------------------------------
// Live-count damage scaling (S8 ADIM 4 / 0037)
// ---------------------------------------------------------------------------

describe("live-count damage scaling", () => {
  const base = { roundNo: 5, winnerHpFraction: 0.5 };

  it("scales match LIVE_COUNT_SCALE: 2→0.75, 3→0.90, 4+→1.00", () => {
    expect(LIVE_COUNT_SCALE[2]).toBe(0.75);
    expect(LIVE_COUNT_SCALE[3]).toBe(0.90);
    expect(LIVE_COUNT_SCALE[4]).toBeUndefined(); // absent = 1.0
    expect(LIVE_COUNT_SCALE[5]).toBeUndefined(); // absent = 1.0
  });

  it("reduces damage for smaller fields", () => {
    const d5 = damageFor({ ...base, liveCount: 5 });
    const d4 = damageFor({ ...base, liveCount: 4 });
    const d3 = damageFor({ ...base, liveCount: 3 });
    const d2 = damageFor({ ...base, liveCount: 2 });
    expect(d5).toBeGreaterThanOrEqual(d4);
    expect(d4).toBeGreaterThanOrEqual(d3);
    expect(d3).toBeGreaterThanOrEqual(d2);
    expect(d5).toBeGreaterThan(d2);
  });

  it("absent liveCount behaves as 5+ (scale 1.0)", () => {
    const withoutScale = damageFor(base);
    const withFive = damageFor({ ...base, liveCount: 5 });
    const withSix = damageFor({ ...base, liveCount: 6 });
    expect(withoutScale).toBe(withFive);
    expect(withoutScale).toBe(withSix);
  });

  it("same round, two fights use the same liveCount scale (round-start fixed)", () => {
    // Simulates DÜZELTME A: both fights in a round use liveCount=3.
    // An elimination mid-round does NOT change the second fight's damage.
    const fightEarly = damageFor({ ...base, liveCount: 3 });
    const fightLate = damageFor({ roundNo: 5, winnerHpFraction: 0.8, liveCount: 3 });
    // Both are scaled by 0.80 — verify they are less than their unscaled equivalents.
    expect(fightEarly).toBeLessThanOrEqual(damageFor({ ...base }));
    expect(fightLate).toBeLessThanOrEqual(damageFor({ roundNo: 5, winnerHpFraction: 0.8 }));
    // And both are MORE than liveCount=2 at the same inputs.
    expect(fightEarly).toBeGreaterThanOrEqual(damageFor({ ...base, liveCount: 2 }));
    expect(fightLate).toBeGreaterThanOrEqual(damageFor({ roundNo: 5, winnerHpFraction: 0.8, liveCount: 2 }));
  });

  it("SQL 0037 mirrors LIVE_COUNT_SCALE in its scale comment", () => {
    // liveDefinitionOf returns the function body; the scale comment is inside it.
    const sql = liveDefinitionOf("dw_pair_round").sql;
    expect(sql).toContain("0.75");
    expect(sql).toContain("0.90");
    expect(sql).toContain("1.00");
  });

  it("SQL 0037 stores round_live_count on each matchup row", () => {
    const sql = liveDefinitionOf("dw_pair_round").sql;
    // Column is referenced in the INSERT statement.
    expect(sql).toContain("round_live_count");
    // v_live is computed once before the loop; round_live_count is the stored value.
    expect(sql).toContain("v_live");
  });
});
