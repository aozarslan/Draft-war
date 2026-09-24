import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAMAGE_CURVE,
  GHOST_PLAYER_PREFIX,
  UPSET_MULTIPLIER,
  battleSeedFor,
  battlefieldFor,
  battlefieldSeedFor,
  buildDuelInput,
  combatProgress,
  damageFor,
  fightingBoardOf,
  ghostSeedFor,
  outcomeOf,
  type CombatContext,
} from "../src/lib/game/combat";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { BOARD_CAPACITY } from "../src/lib/game/rounds";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";

/**
 * ---------------------------------------------------------------------------
 * The fight is the engine's. Everything around it is this file's.
 * ---------------------------------------------------------------------------
 * S8.5a decides two things and computes nothing else: **what fight to run** and
 * **what losing it costs**. Both were measured rather than chosen, and both are
 * sensitive enough that a plausible-looking change would not announce itself.
 *
 * The damage curve replaces the one in `docs/S8-DESIGN.md`, which was fitted
 * against a toy model where the winner's surviving fighters were a uniform
 * draw. They are not: over 4,000 real 5v5s the mean is 3.07 and the loser is
 * always wiped, so the old curve pinned every late loss to its cap and left a
 * four-player table on a median of 3 HP.
 *
 * The ghost board is used for odd-seat rounds: the bye player fights a copy of
 * another live player's board, chosen deterministically from the match seed.
 * The ghost owner's HP is never touched — `outcomeOf` treats `"ghost:{id}"`
 * as a non-real player id.
 */

const ROOT = process.cwd();
const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

const ctx = (over: Partial<CombatContext> = {}): CombatContext => ({
  matchSeed: "seed-abc",
  roundNo: 3,
  pairingIndex: 0,
  categoryIds: ["apex", "vigil"],
  charactersById: BY_ID,
  bands: BANDS,
  ...over,
});

const boardOf = (ids: string[]) => ids.map((characterId, i) => ({ characterId, price: i + 1 }));
const MARVEL = CHARACTERS.filter((c) => c.categoryId === "apex").map((c) => c.id);
const DC = CHARACTERS.filter((c) => c.categoryId === "vigil").map((c) => c.id);

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

describe("what losing a round costs", () => {
  it("costs more when the winner walked away untouched", () => {
    const swept = damageFor({ roundNo: 1, winnerHpFraction: 1 });
    const scraped = damageFor({ roundNo: 1, winnerHpFraction: 0 });
    expect(swept).toBeGreaterThan(scraped);
  });

  it("costs more late in a match than early", () => {
    const early = damageFor({ roundNo: 1, winnerHpFraction: 0.5 });
    const late = damageFor({ roundNo: 8, winnerHpFraction: 0.5 });
    expect(late).toBeGreaterThan(early);
  });

  it("puts the floor and the cap where the design put them", () => {
    // Asserted as literals, not read back out of the constant the assertions
    // below would otherwise compare against. A bound that supplies its own
    // expected value cannot fail.
    expect(DAMAGE_CURVE.floor).toBe(4);
    expect(DAMAGE_CURVE.cap).toBe(24);
  });

  it("never gives a loss away and never ends a match in one blow", () => {
    for (const roundNo of [1, 2, 3, 4, 5, 6, 7, 8, 20]) {
      for (const hp of [0, 0.25, 0.5, 0.75, 1]) {
        for (const upset of [false, true]) {
          const d = damageFor({ roundNo, winnerHpFraction: hp, upset });
          // Hard numbers. A loss always costs something, and no single round
          // can take a quarter of somebody's health.
          expect(d, `r${roundNo} hp${hp}`).toBeGreaterThanOrEqual(4);
          expect(d, `r${roundNo} hp${hp}`).toBeLessThanOrEqual(24);
          expect(Number.isInteger(d)).toBe(true);
        }
      }
    }
  });

  it("survives nonsense without producing nonsense", () => {
    // NaN is the one that matters: Math.min/Math.max propagate it rather than
    // clamping, so an unguarded curve returns NaN straight through the clamp
    // and writes NaN into an int column at the end of a transaction that has
    // already decided a winner.
    expect(Number.isFinite(damageFor({ roundNo: 4, winnerHpFraction: Number.NaN }))).toBe(true);
    expect(Number.isFinite(damageFor({ roundNo: Number.NaN, winnerHpFraction: 0.5 }))).toBe(true);
    for (const hp of [-5, 2, Number.NaN]) {
      const d = damageFor({ roundNo: 4, winnerHpFraction: hp });
      expect(d).toBeGreaterThanOrEqual(DAMAGE_CURVE.floor);
      expect(d).toBeLessThanOrEqual(DAMAGE_CURVE.cap);
    }
    expect(damageFor({ roundNo: 0, winnerHpFraction: 0.5 }))
      .toBe(damageFor({ roundNo: 1, winnerHpFraction: 0.5 }));
    expect(damageFor({ roundNo: -3, winnerHpFraction: 0.5 }))
      .toBe(damageFor({ roundNo: 1, winnerHpFraction: 0.5 }));
  });

  it("charges more for losing a fight you were favoured to win", () => {
    const ordinary = damageFor({ roundNo: 3, winnerHpFraction: 0.4 });
    const upset = damageFor({ roundNo: 3, winnerHpFraction: 0.4, upset: true });
    expect(upset).toBeGreaterThan(ordinary);
    expect(UPSET_MULTIPLIER).toBeGreaterThan(1);
  });

  it("is a pure function of its three inputs", () => {
    const once = damageFor({ roundNo: 5, winnerHpFraction: 0.37, upset: true });
    for (let i = 0; i < 500; i++) {
      expect(damageFor({ roundNo: 5, winnerHpFraction: 0.37, upset: true })).toBe(once);
    }
  });

  it("does not reproduce the curve the design replaced", () => {
    // `(8 + 2.4 x survivors) x (1 + 0.18(r-1))` capped at 32 left a four-player
    // table on a median of 3 HP because it pinned to its cap from round five.
    // A curve that reaches 32 has regressed to it.
    expect(DAMAGE_CURVE.cap).toBeLessThan(32);
    const worst = damageFor({ roundNo: 8, winnerHpFraction: 1, upset: true });
    expect(worst).toBeLessThanOrEqual(DAMAGE_CURVE.cap);
    // And seven maximum losses must not be survivable-by-accident either: the
    // curve has to be able to end somebody.
    expect(worst * 5).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

describe("the same fight, every time", () => {
  it("gives two matchups of one round different fights", () => {
    expect(battleSeedFor("s", 3, 0)).not.toBe(battleSeedFor("s", 3, 1));
  });

  it("gives two rounds different fights", () => {
    expect(battleSeedFor("s", 3, 0)).not.toBe(battleSeedFor("s", 4, 0));
  });

  it("gives two matches different fights", () => {
    expect(battleSeedFor("a", 3, 0)).not.toBe(battleSeedFor("b", 3, 0));
  });

  it("keeps the ghost, the fight and the battlefield in separate namespaces", () => {
    const a = battleSeedFor("s", 3, 0);
    const b = ghostSeedFor("s", 3, 0);
    const c = battlefieldSeedFor("s", 3);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("leaves the engine's own prefix to the engine", () => {
    // `simulateBattle` prepends `battle:` itself. Passing an already-prefixed
    // seed produced `battle:battle:...` — harmless, and unreadable.
    expect(battleSeedFor("s", 3, 0).startsWith("battle:")).toBe(false);
  });

  it("draws one battlefield per round and shares it", () => {
    const first = battlefieldFor("s", 3);
    expect(battlefieldFor("s", 3)).toEqual(first);
    expect(MAPS).toContainEqual(first.map);
    expect(EVENT_CARDS).toContainEqual(first.event);
  });

  it("moves the battlefield between rounds and between matches", () => {
    const keys = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      for (const round of [1, 2, 3]) {
        const f = battlefieldFor(seed, round);
        keys.add(`${f.map.id}/${f.event.id}`);
      }
    }
    expect(keys.size).toBeGreaterThan(1);
  });

  it("reads no clock and draws nothing of its own", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "game", "combat.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const forbidden of ["Math.random", "Date.now", "new Date", "performance.now"]) {
      expect(code, `combat reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

describe("the board that fights", () => {
  const slots = [
    { playerId: "a", characterId: "x1", zone: "FRONT", slot: 0 },
    { playerId: "a", characterId: "x2", zone: "MID", slot: 1 },
    { playerId: "a", characterId: "x3", zone: "BACK", slot: 2 },
    { playerId: "a", characterId: "x4", zone: "BENCH", slot: 5 },
    { playerId: "b", characterId: "y1", zone: "FRONT", slot: 0 },
  ];
  const priceOf = (id: string) => ({ x1: 7, x2: 3, x3: 9 })[id as "x1"];

  it("leaves the bench out", () => {
    expect(fightingBoardOf(slots, "a", priceOf).map((c) => c.characterId))
      .toEqual(["x1", "x2", "x3"]);
  });

  it("does not mix squads", () => {
    expect(fightingBoardOf(slots, "b", priceOf).map((c) => c.characterId)).toEqual(["y1"]);
  });

  it("does not depend on the order rows arrive in", () => {
    const scrambled = [...slots].reverse();
    expect(fightingBoardOf(scrambled, "a", priceOf)).toEqual(fightingBoardOf(slots, "a", priceOf));
  });

  it("cannot field more than a board holds, whatever the zones say", () => {
    const stuffed = Array.from({ length: 9 }, (_, i) => ({
      playerId: "a", characterId: `c${i}`, zone: "FRONT", slot: i,
    }));
    expect(fightingBoardOf(stuffed, "a", () => 1)).toHaveLength(BOARD_CAPACITY);
  });

  it("carries the price the match recorded", () => {
    expect(fightingBoardOf(slots, "a", priceOf).map((c) => c.price)).toEqual([7, 3, 9]);
    // And a character with no recorded price still fields, rather than vanishing.
    expect(fightingBoardOf(slots, "a", () => undefined).map((c) => c.price)).toEqual([1, 1, 1]);
  });
});


// ---------------------------------------------------------------------------
// Battle input
// ---------------------------------------------------------------------------

describe("assembling a duel", () => {
  const a = { playerId: "a", nickname: "Ali", board: boardOf(MARVEL.slice(0, 5)) };
  const b = { playerId: "b", nickname: "Can", board: boardOf(DC.slice(0, 5)) };

  it("puts both seats in, with the round's battlefield", () => {
    const built = buildDuelInput(ctx(), a, b);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.teams.map((t) => t.playerId)).toEqual(["a", "b"]);
    expect(built.input.seed).toBe(battleSeedFor("seed-abc", 3, 0));
    expect(built.input.map).toEqual(battlefieldFor("seed-abc", 3).map);
    expect(built.input.event).toEqual(battlefieldFor("seed-abc", 3).event);
    expect(built.input.categoryIds).toEqual(["apex", "vigil"]);
  });

  it("refuses rather than fielding an empty side", () => {
    const empty = { playerId: "c", nickname: "Empty", board: [] };
    expect(buildDuelInput(ctx(), a, empty)).toMatchObject({ ok: false, code: "EMPTY_BOARD" });
    expect(buildDuelInput(ctx(), empty, a)).toMatchObject({ ok: false, code: "EMPTY_BOARD" });
  });

  it("produces a byte-identical result a thousand times over", () => {
    const built = buildDuelInput(ctx(), a, b);
    if (!built.ok) throw new Error("input did not build");
    const first = JSON.stringify(simulateBattle(built.input));
    for (let i = 0; i < 1000; i++) {
      expect(JSON.stringify(simulateBattle(built.input))).toBe(first);
    }
  });

  it("gives the two matchups of one round different fights", () => {
    const one = buildDuelInput(ctx({ pairingIndex: 0 }), a, b);
    const two = buildDuelInput(ctx({ pairingIndex: 1 }), a, b);
    if (!one.ok || !two.ok) throw new Error("input did not build");
    expect(simulateBattle(one.input).log).not.toEqual(simulateBattle(two.input).log);
  });
});


// ---------------------------------------------------------------------------
// Reading a result
// ---------------------------------------------------------------------------

describe("what a result costs the match", () => {
  const real = new Set(["a", "b"]);
  const team = (playerId: string, remainingHpPct: number) =>
    ({ playerId, remainingHpPct, rank: 1, points: 3, survivors: 3, totalDamage: 0,
       winProbability: 50, teamRating: 100, synergies: [] });

  it("charges the loser and credits the winner", () => {
    const out = outcomeOf(
      { teams: [team("a", 40), team("b", 0)], winnerPlayerId: "a", upset: false }, 3, real,
    );
    expect(out.winnerPlayerId).toBe("a");
    expect(out.loserPlayerId).toBe("b");
    expect(out.damage).toBe(damageFor({ roundNo: 3, winnerHpFraction: 0.4 }));
  });

  it("credits nobody when the arena wins", () => {
    const out = outcomeOf(
      { teams: [team("a", 0), team("encounter", 55)], winnerPlayerId: "encounter", upset: false },
      4, new Set(["a"]),
    );
    expect(out.winnerPlayerId).toBeNull();
    expect(out.loserPlayerId).toBe("a");
    expect(out.damage).toBe(damageFor({ roundNo: 4, winnerHpFraction: 0.55 }));
  });

  it("charges nobody when the seat beats the arena", () => {
    const out = outcomeOf(
      { teams: [team("a", 60), team("encounter", 0)], winnerPlayerId: "a", upset: false },
      4, new Set(["a"]),
    );
    expect(out.winnerPlayerId).toBe("a");
    expect(out.loserPlayerId).toBeNull();
    expect(out.damage).toBe(0);
  });

  it("carries the engine's upset flag into the cost", () => {
    const plain = outcomeOf(
      { teams: [team("a", 30), team("b", 0)], winnerPlayerId: "a", upset: false }, 5, real);
    const upset = outcomeOf(
      { teams: [team("a", 30), team("b", 0)], winnerPlayerId: "a", upset: true }, 5, real);
    expect(upset.damage).toBeGreaterThan(plain.damage);
    expect(upset.upset).toBe(true);
  });

  it("reads the health the engine reported and recomputes nothing", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "game", "combat.ts"), "utf8");
    const body = source.match(/export function outcomeOf[\s\S]*?\n}/)![0];
    // The only arithmetic permitted is turning a percentage into a fraction.
    expect(body).toContain("remainingHpPct / 100");
    for (const forbidden of ["survivors", "totalDamage", "combatValue", "teamRating"]) {
      expect(body, `outcomeOf reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("works end to end on a real battle", () => {
    const built = buildDuelInput(
      ctx(),
      { playerId: "a", nickname: "Ali", board: boardOf(MARVEL.slice(0, 5)) },
      { playerId: "b", nickname: "Can", board: boardOf(DC.slice(0, 5)) },
    );
    if (!built.ok) throw new Error("input did not build");
    const result = simulateBattle(built.input);
    const out = outcomeOf(result, 3, real);
    expect([out.winnerPlayerId, out.loserPlayerId].sort()).toEqual(["a", "b"]);
    expect(out.damage).toBeGreaterThanOrEqual(DAMAGE_CURVE.floor);
    expect(out.damage).toBeLessThanOrEqual(DAMAGE_CURVE.cap);
  });
});

// ---------------------------------------------------------------------------
// Round completion
// ---------------------------------------------------------------------------

describe("when a round's combat is finished", () => {
  const round = (roundNo: number, resolved: boolean[]) =>
    resolved.map((r, i) => ({ roundNo, pairingIndex: i, battleResult: r ? { seed: "x" } : null }));

  it("is finished only when every fight is", () => {
    expect(combatProgress(round(3, [true, true, true]), 3).complete).toBe(true);
    expect(combatProgress(round(3, [true, false, true]), 3).complete).toBe(false);
    expect(combatProgress(round(3, [false, false, false]), 3).complete).toBe(false);
  });

  it("says how many are missing, not just that some are", () => {
    const p = combatProgress(round(3, [true, false, false]), 3);
    expect(p).toMatchObject({ total: 3, resolved: 1, unresolved: 2, complete: false });
  });

  it("counts only the round it was asked about", () => {
    const mixed = [...round(2, [true, true]), ...round(3, [false])];
    expect(combatProgress(mixed, 2).complete).toBe(true);
    expect(combatProgress(mixed, 3).complete).toBe(false);
  });

  it("does not call a round with no fights finished", () => {
    // A round nobody played is not a round everybody won. Whether that is legal
    // depends on how many seats are still alive, which is the state machine's
    // question, not this one's.
    expect(combatProgress([], 3)).toMatchObject({ total: 0, complete: false });
  });

  it("treats an absent result the same as a null one", () => {
    expect(combatProgress([{ roundNo: 1, pairingIndex: 0 }], 1).complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What this layer must not touch
// ---------------------------------------------------------------------------

describe("the boundaries of S8.5a", () => {
  const source = readFileSync(join(ROOT, "src", "lib", "game", "combat.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("does not reach for a database, a request or a clock", () => {
    for (const forbidden of ["supabase", "rpc(", "fetch(", "process.env", "await "]) {
      expect(code, `combat reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does not touch either wallet", () => {
    expect(code).not.toMatch(/credits/i);
  });

  it("does not apply HP — that belongs to the transaction that writes it", () => {
    // Reading who is still alive is fine and necessary; *writing* a life total
    // here would be a second source of truth for the same number, and one of
    // them would be outside the transaction that stores the result.
    expect(code, "combat clamps a life total").not.toMatch(/clampHp/);
    expect(code, "combat assigns a life total").not.toMatch(/\bhp\s*(-=|\+=|=[^=])/);
    expect(code, "combat writes an elimination").not.toMatch(/eliminatedAt\s*=[^=]/);
  });

  it("calls the engine without re-implementing it", () => {
    // `fightOne` runs the fight on purpose, so that "the result came from
    // simulateBattle" is a property a test can execute rather than grep for.
    // What must never appear is a second copy of the maths.
    expect(code).toContain("simulateBattle(input)");
    expect(code, "the engine's own maths was copied")
      .not.toMatch(/combatValue|projectAxes|computeSynergy|applyFormation/);
  });

  it("leaves the rules version alone", () => {
    const battle = readFileSync(join(ROOT, "src", "lib", "game", "battle.ts"), "utf8");
    expect(battle).toMatch(/export const RULES_VERSION = 1;/);
  });
});
