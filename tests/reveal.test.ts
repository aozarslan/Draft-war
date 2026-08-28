import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { revealOf } from "../src/lib/render/reveal";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * The reveal knows the result and must never show it.
 * ---------------------------------------------------------------------------
 * A head-to-head is built from the same object that holds the winner, the
 * ranks, the points, the MVP and the upset flag — and it is drawn before the
 * viewer is allowed to know any of them. Every leak available here is silent:
 * nothing crashes, nothing looks wrong, the reader just finds out early.
 *
 * The two that matter are seating and content. `result.teams` is sorted by
 * rank, so laying the screen out in array order puts the winner on the left
 * from the opening frame — the exact bug M5 shipped in the arena. And a single
 * stray field would give away the ending in a number nobody reads closely.
 *
 * Both are checked here by rewriting the outcome and requiring the reveal not
 * to move.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

const ROSTER_A = [
  "animals-lion", "animals-tiger", "animals-wolf",
  "animals-leopard", "animals-spotted-hyena",
];
const ROSTER_B = [
  "animals-jaguar", "animals-cheetah", "animals-grizzly-bear",
  "animals-polar-bear", "animals-wild-boar",
];

const context: ReplayContext = {
  battleId: "reveal",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

function battle(seed: string): BattleResult {
  return simulateBattle({
    teams: [
      {
        playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE",
        characters: ROSTER_A.map((id, i) => ({ characterId: id, price: 4 + i * 3 })),
      },
      {
        playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE",
        characters: ROSTER_B.map((id, i) => ({ characterId: id, price: 6 + i * 2 })),
      },
    ],
    map: MAPS[0],
    event: EVENT_CARDS[0],
    charactersById: CHARACTERS_BY_ID,
    seed,
    categoryIds: ["animals"],
    bands: BANDS,
  });
}

const replayOf = (seed: string): Replay => toReplay(battle(seed), context);

/**
 * A battle whose winner sits in seat 1 — the second player.
 *
 * Chosen by property rather than by seed name. In a battle the first-seated
 * player happened to win, seating by rank and seating by seat agree, and a
 * test written against it passes on a broken implementation. That is exactly
 * how an earlier milestone's vacuous test slipped through.
 */
const WINNER_SEATED_SECOND = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`r-second-${i}`);
    const winner = replay.teams.find((t) => t.playerId === replay.winnerPlayerId)!;
    const first = [...replay.teams].sort((a, b) => a.rank - b.rank)[0];
    if (winner.seat === 1 && first.playerId === winner.playerId) return replay;
  }
  throw new Error("no battle in 300 where the second-seated player won");
})();

describe("it is a real 5v5 being revealed", () => {
  it("shows two squads of five", () => {
    const reveal = revealOf(replayOf("r-1"));
    expect(reveal.sides).toHaveLength(2);
    expect(reveal.squadSize).toBe(5);
    for (const side of reveal.sides) expect(side.fighters).toHaveLength(5);
  });
});

describe("seating comes from the draft, not from the result", () => {
  it("orders the sides by seat", () => {
    const reveal = revealOf(replayOf("r-2"));
    expect(reveal.sides.map((s) => s.seat)).toEqual([0, 1]);
  });

  it("puts the eventual winner on the right when they drafted second", () => {
    // The discriminating case: here rank order and seat order disagree, so an
    // implementation that sorted by rank — or simply used `teams` as it came —
    // would put the winner first and give the ending away in frame one.
    const replay = WINNER_SEATED_SECOND;
    const reveal = revealOf(replay);
    expect(reveal.sides[0].playerId).not.toBe(replay.winnerPlayerId);
    expect(reveal.sides[1].playerId).toBe(replay.winnerPlayerId);
  });

  it("seats the same way no matter what order the teams arrive in", () => {
    const replay = replayOf("r-3");
    const reversed: Replay = { ...replay, teams: [...replay.teams].reverse() };
    expect(revealOf(reversed)).toEqual(revealOf(replay));
  });

  it("does not reorder the caller's replay", () => {
    const replay = replayOf("r-4");
    const before = structuredClone(replay);
    revealOf(replay);
    expect(replay).toEqual(before);
  });
});

describe("it cannot leak the ending", () => {
  const replay = replayOf("r-5");

  it("is unchanged when the winner is rewritten", () => {
    const other = replay.teams.find((t) => t.playerId !== replay.winnerPlayerId)!;
    const flipped: Replay = { ...replay, winnerPlayerId: other.playerId };
    expect(revealOf(flipped)).toEqual(revealOf(replay));
  });

  it("is unchanged when ranks and points are rewritten", () => {
    const shuffled: Replay = {
      ...replay,
      teams: replay.teams.map((t) => ({
        ...t,
        rank: t.rank === 1 ? 2 : 1,
        points: t.points + 99,
      })),
    };
    expect(revealOf(shuffled)).toEqual(revealOf(replay));
  });

  it("is unchanged when the MVP, the upset and the turning point are rewritten", () => {
    const rewritten: Replay = {
      ...replay,
      mvp: null,
      upset: !replay.upset,
      turningPoint: null,
    };
    expect(revealOf(rewritten)).toEqual(revealOf(replay));
  });

  it("is unchanged when the whole fight is deleted", () => {
    // The strongest statement of "a projection of the draft": with no events
    // at all, the head-to-head is identical.
    const noFight: Replay = { ...replay, events: [] };
    expect(revealOf(noFight)).toEqual(revealOf(replay));
  });

  it("carries no outcome field at all", () => {
    // Structural, not stylistic: showing rank would require adding it here
    // first, in a commit somebody reads.
    for (const side of revealOf(replay).sides) {
      const keys = Object.keys(side);
      for (const forbidden of ["rank", "points", "survived", "totalDamage", "mvp", "upset"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });

  it("says nothing about who survived", () => {
    const survivors = replay.combatants.filter((c) => c.survived).map((c) => c.characterId);
    expect(survivors.length).toBeGreaterThan(0);
    const json = JSON.stringify(revealOf(replay));
    // Every fighter appears, so survival cannot be read off who is listed.
    for (const c of replay.combatants) expect(json).toContain(c.characterId);
  });
});

describe("what it does show is what the draft produced", () => {
  const replay = replayOf("r-6");
  const reveal = revealOf(replay);

  it("copies the nickname, formation and forecast the engine recorded", () => {
    for (const side of reveal.sides) {
      const team = replay.teams.find((t) => t.playerId === side.playerId)!;
      expect(side.nickname).toBe(team.nickname);
      expect(side.formation).toBe(team.formation);
      expect(side.winProbability).toBe(team.winProbability);
      expect(side.synergies).toEqual(team.synergies);
    }
  });

  it("totals the prices already shown at auction, and calculates nothing else", () => {
    for (const side of reveal.sides) {
      const paid = replay.combatants
        .filter((c) => c.teamId === side.playerId)
        .reduce((sum, c) => sum + c.price, 0);
      expect(side.spent).toBe(paid);
    }
  });

  it("lists each squad front to back, matching the arena", () => {
    const order = { FRONT: 0, MID: 1, BACK: 2 };
    for (const side of reveal.sides) {
      const ranks = side.fighters.map((f) => order[f.lane]);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
  });

  it("gives every fighter to exactly one side", () => {
    const all = reveal.sides.flatMap((s) => s.fighters.map((f) => f.characterId));
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(replay.combatants.map((c) => c.characterId).sort());
  });

  it("is deterministic", () => {
    expect(revealOf(replay)).toEqual(revealOf(replay));
  });
});
