import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchAwards, matchStandings } from "../src/lib/client/standings";
import type { StateResponse } from "../src/lib/client/api";
import type { Character } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * The last screen five people look at together.
 * ---------------------------------------------------------------------------
 * A results screen is the easiest place in a game to tell a small lie. Every
 * figure on it is one somebody will check against the match they just played,
 * and the temptation is to fill the gaps: crown whoever is nominally first,
 * hand every award to the closest candidate, show a placing that was never
 * earned.
 *
 * Round combat is not wired up yet, so a match played today ends with every
 * seat on full health and no rounds won — a flat tie. `decided` is what stops
 * a tie-break from being presented as a victory, and most of this file exists
 * to hold that line until S8.5 makes it moot.
 */

const ROOT = process.cwd();

const CHARACTERS: Record<string, Character> = Object.fromEntries(
  [
    ["c-strong", 90], ["c-mid", 70], ["c-weak", 50], ["c-bench", 60],
  ].map(([id, gamePower]) => [id, { id, gamePower } as unknown as Character]),
);

function snapshot(over: {
  players?: { playerId: string; hp: number; roundWins: number; credits: number; eliminatedAt: number | null }[];
  matchups?: { winnerPlayerId: string | null }[];
  board?: { playerId: string; characterId: string; zone: string; slot: number }[];
  acquisitions?: { playerId: string; characterId: string; price: number }[];
  match?: null;
} = {}): StateResponse {
  if (over.match === null) return { players: [], match: null } as unknown as StateResponse;
  return {
    players: [
      { id: "a", nickname: "Ali", colorIndex: 0, seat: 0 },
      { id: "b", nickname: "Can", colorIndex: 1, seat: 1 },
      { id: "c", nickname: "Mehmet", colorIndex: 2, seat: 2 },
    ],
    match: {
      roundNo: 8,
      totalRounds: 8,
      players: over.players ?? [
        { playerId: "a", hp: 100, roundWins: 0, credits: 12, eliminatedAt: null },
        { playerId: "b", hp: 100, roundWins: 0, credits: 30, eliminatedAt: null },
        { playerId: "c", hp: 100, roundWins: 0, credits: 5, eliminatedAt: null },
      ],
      matchups: over.matchups ?? [{ winnerPlayerId: null }, { winnerPlayerId: null }],
      board: over.board ?? [],
      acquisitions: over.acquisitions ?? [],
    },
  } as unknown as StateResponse;
}

// ---------------------------------------------------------------------------
// The champion
// ---------------------------------------------------------------------------

describe("nobody is crowned for a match that decided nothing", () => {
  it("refuses to name a champion when no matchup recorded a winner", () => {
    const s = matchStandings(snapshot())!;
    expect(s.decided).toBe(false);
    expect(s.champion).toBeNull();
    // The table is still there — the draft happened even if the fights did not.
    expect(s.rows).toHaveLength(3);
  });

  it("crowns as soon as a single matchup has a winner", () => {
    const s = matchStandings(
      snapshot({
        players: [
          { playerId: "a", hp: 74, roundWins: 3, credits: 12, eliminatedAt: null },
          { playerId: "b", hp: 100, roundWins: 5, credits: 30, eliminatedAt: null },
          { playerId: "c", hp: 20, roundWins: 1, credits: 5, eliminatedAt: null },
        ],
        matchups: [{ winnerPlayerId: "b" }],
      }),
    )!;
    expect(s.decided).toBe(true);
    expect(s.champion!.nickname).toBe("Can");
  });

  it("does not quietly promote a tie into a result", () => {
    // Everybody identical. Even with a winner recorded the order is a
    // tie-break, and the ordering must be stable rather than lucky.
    const tied = snapshot({ matchups: [{ winnerPlayerId: "a" }] });
    const first = matchStandings(tied)!;
    const second = matchStandings(tied)!;
    expect(first.rows.map((r) => r.playerId)).toEqual(second.rows.map((r) => r.playerId));
    expect(first.rows.map((r) => r.playerId)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing at all when there is no match", () => {
    expect(matchStandings(snapshot({ match: null }))).toBeNull();
    expect(matchAwards(snapshot({ match: null }), CHARACTERS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

describe("the final table", () => {
  const played = snapshot({
    players: [
      { playerId: "a", hp: 40, roundWins: 2, credits: 12, eliminatedAt: null },
      { playerId: "b", hp: 88, roundWins: 5, credits: 30, eliminatedAt: null },
      { playerId: "c", hp: 0, roundWins: 1, credits: 5, eliminatedAt: 7 },
    ],
    matchups: [{ winnerPlayerId: "b" }],
    acquisitions: [
      { playerId: "a", characterId: "c-strong", price: 12 },
      { playerId: "a", characterId: "c-mid", price: 4 },
      { playerId: "b", characterId: "c-weak", price: 3 },
    ],
  });

  it("ranks by health, then rounds won, then seat", () => {
    const rows = matchStandings(played)!.rows;
    expect(rows.map((r) => r.nickname)).toEqual(["Can", "Ali", "Mehmet"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("breaks a health tie on rounds won", () => {
    const s = matchStandings(
      snapshot({
        players: [
          { playerId: "a", hp: 50, roundWins: 1, credits: 0, eliminatedAt: null },
          { playerId: "b", hp: 50, roundWins: 4, credits: 0, eliminatedAt: null },
          { playerId: "c", hp: 50, roundWins: 2, credits: 0, eliminatedAt: null },
        ],
        matchups: [{ winnerPlayerId: "b" }],
      }),
    )!;
    expect(s.rows.map((r) => r.nickname)).toEqual(["Can", "Mehmet", "Ali"]);
  });

  it("carries the numbers the server recorded, untouched", () => {
    const ali = matchStandings(played)!.rows.find((r) => r.nickname === "Ali")!;
    expect(ali.hp).toBe(40);
    expect(ali.roundWins).toBe(2);
    expect(ali.credits).toBe(12);
    expect(ali.squadSize).toBe(2);
    expect(ali.spent).toBe(16);
  });

  it("keeps an eliminated player in the table", () => {
    const mehmet = matchStandings(played)!.rows.find((r) => r.nickname === "Mehmet")!;
    expect(mehmet.eliminatedAt).toBe(7);
    expect(mehmet.rank).toBe(3);
  });

  it("names a departed seat rather than crashing", () => {
    const orphan = snapshot();
    (orphan as unknown as { players: unknown[] }).players = [];
    expect(matchStandings(orphan)!.rows.every((r) => r.nickname === "—")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

describe("an award is only given when somebody earned it", () => {
  const drafted = snapshot({
    matchups: [{ winnerPlayerId: "a" }],
    board: [
      { playerId: "a", characterId: "c-strong", zone: "FRONT", slot: 0 },
      { playerId: "a", characterId: "c-mid", zone: "FRONT", slot: 1 },
      { playerId: "b", characterId: "c-weak", zone: "FRONT", slot: 0 },
      { playerId: "b", characterId: "c-bench", zone: "BENCH", slot: 5 },
    ],
    acquisitions: [
      { playerId: "a", characterId: "c-strong", price: 20 },
      { playerId: "a", characterId: "c-mid", price: 12 },
      { playerId: "b", characterId: "c-weak", price: 2 },
      { playerId: "b", characterId: "c-bench", price: 1 },
    ],
  });

  it("gives the strongest squad to the biggest board power, bench excluded", () => {
    const award = matchAwards(drafted, CHARACTERS).find((a) => a.key === "STRONGEST_SQUAD")!;
    expect(award.nickname).toBe("Ali");
    expect(award.detail).toBe("160 total power");
  });

  it("gives best value to power per credit, not to the biggest board", () => {
    const award = matchAwards(drafted, CHARACTERS).find((a) => a.key === "BEST_VALUE")!;
    // Ali: 160 board power for 32 credits = 5.0.
    // Can: 50 board power for 3 credits = 16.7 — the benched character's price
    // still counts against them, because they still spent it. Value is what the
    // squad returns on everything it cost, not on the part that fights.
    expect(award.nickname).toBe("Can");
    expect(award.detail).toBe("16.7 power per credit");
  });

  it("gives nothing away when nobody spent anything", () => {
    const free = snapshot({
      matchups: [{ winnerPlayerId: "a" }],
      board: [{ playerId: "a", characterId: "c-strong", zone: "FRONT", slot: 0 }],
      acquisitions: [],
    });
    const keys = matchAwards(free, CHARACTERS).map((a) => a.key);
    // Dividing a real board by a spend of zero produces an infinity, and an
    // award of infinity is not an award.
    expect(keys).not.toContain("BEST_VALUE");
    expect(keys).not.toContain("BIGGEST_SPENDER");
    expect(keys).toContain("STRONGEST_SQUAD");
  });

  it("omits every award for a match nobody drafted in", () => {
    expect(matchAwards(snapshot(), CHARACTERS)).toEqual([]);
  });

  it("counts a bench as a bench, never as board power", () => {
    const award = matchAwards(drafted, CHARACTERS).find((a) => a.key === "DEEPEST_BENCH")!;
    expect(award.nickname).toBe("Can");
    expect(award.detail).toBe("1 in reserve");
    const strongest = matchAwards(drafted, CHARACTERS).find((a) => a.key === "STRONGEST_SQUAD")!;
    expect(strongest.detail).not.toContain("220");
  });

  it("ignores a character the catalogue does not know", () => {
    const ghost = snapshot({
      matchups: [{ winnerPlayerId: "a" }],
      board: [
        { playerId: "a", characterId: "c-strong", zone: "FRONT", slot: 0 },
        { playerId: "a", characterId: "missing", zone: "FRONT", slot: 1 },
      ],
      acquisitions: [{ playerId: "a", characterId: "c-strong", price: 10 }],
    });
    const award = matchAwards(ghost, CHARACTERS).find((a) => a.key === "STRONGEST_SQUAD")!;
    expect(award.detail).toBe("90 total power");
  });
});

// ---------------------------------------------------------------------------
// What the screen must not do
// ---------------------------------------------------------------------------

describe("the results screen invents nothing", () => {
  const standings = readFileSync(join(ROOT, "src", "lib", "client", "standings.ts"), "utf8");
  const screen = readFileSync(join(ROOT, "src", "components", "MatchResults.tsx"), "utf8");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("reads no clock and rolls no dice", () => {
    for (const source of [standings, screen]) {
      for (const forbidden of ["Math.random", "Date.now", "new Date"]) {
        expect(code(source), `results reach for ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("computes no combat of its own", () => {
    for (const forbidden of ["simulateBattle", "damageFor", "combatValue", "teamRating"]) {
      expect(code(standings), `standings compute ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("hides the champion behind the decided flag", () => {
    expect(code(standings)).toMatch(/champion: decided \? /);
    expect(code(screen)).toMatch(/standings\.champion \?/);
  });

  it("keeps the drawing seam separate for Visual 2.0", () => {
    expect(screen).toMatch(/function SquadCharacter\(/);
  });

  it("does not show a phase rail or a live rail once the match is over", () => {
    const stage = readFileSync(join(ROOT, "src", "components", "MatchStage.tsx"), "utf8");
    expect(stage).toMatch(/\{finished \? \(\s*<MatchResults/);
    expect(stage).toMatch(/\{!finished \? \(\s*<Panel>/);
    // And the draft screens are hidden once it is over.
    expect(stage).toMatch(/\{!finished && phase === "AUCTION"/);
  });
});
