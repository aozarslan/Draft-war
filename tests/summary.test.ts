import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { summaryOf } from "../src/lib/render/summary";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * The summary copies; it does not calculate.
 * ---------------------------------------------------------------------------
 * A results summary is the most tempting place in the codebase to invent a
 * number — an average here, a re-derived probability there — and the least
 * visible place for it to be wrong, because it looks like presentation. These
 * tests hold it to the rule: every value it shows must appear, unchanged, in
 * the authoritative result.
 *
 * Validated on real 5v5 battles.
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
  battleId: "summary",
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

const ORDINARY = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`s-ord-${i}`);
    if (!replay.upset) return replay;
  }
  throw new Error("every one of 300 real battles was an upset");
})();

const WITH_UPSET = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`s-up-${i}`);
    if (replay.upset) return replay;
  }
  throw new Error("no upset in 300 real battles");
})();

describe("it answers the five questions", () => {
  const result = battle("sum-1");
  const replay = toReplay(result, context);
  const summary = summaryOf(replay);

  it("names the winner the engine named", () => {
    expect(summary.winner).toBeTruthy();
    expect(summary.winner!.playerId).toBe(result.winnerPlayerId);
    expect(summary.winner!.rank).toBe(1);
  });

  it("names a runner-up who is not the winner", () => {
    expect(summary.runnerUp).toBeTruthy();
    expect(summary.runnerUp!.playerId).not.toBe(summary.winner!.playerId);
  });

  it("carries the MVP the engine picked, with its own numbers", () => {
    expect(summary.mvp).toBeTruthy();
    expect(summary.mvp).toEqual({
      characterId: result.mvp!.characterId,
      playerId: result.mvp!.playerId,
      expected: result.mvp!.expected,
      actual: result.mvp!.actual,
      performance: result.mvp!.performance,
    });
  });

  it("stands the teams in the engine's finishing order", () => {
    expect(summary.standings.map((t) => t.rank)).toEqual(
      [...result.teams].map((t) => t.rank).sort((a, b) => a - b),
    );
  });
});

describe("every number is a copy", () => {
  const result = battle("sum-2");
  const replay = toReplay(result, context);
  const summary = summaryOf(replay);

  it("takes points and rank straight from the result", () => {
    for (const team of summary.standings) {
      const authoritative = result.teams.find((t) => t.playerId === team.playerId)!;
      expect(team.rank).toBe(authoritative.rank);
      expect(team.points).toBe(authoritative.points);
    }
  });

  it("rounds the forecast for display and does nothing else to it", () => {
    for (const team of summary.standings) {
      const authoritative = result.teams.find((t) => t.playerId === team.playerId)!;
      // One decimal place, and within a rounding step of the real value.
      expect(Math.abs(team.winProbability - authoritative.winProbability)).toBeLessThan(0.05);
    }
  });

  it("quotes the engine's turning-point sentence rather than writing one", () => {
    const withTurn = ["sum-2", "sum-3", "sum-4", "sum-5", "sum-6", "sum-7"]
      .map(replayOf)
      .find((r) => r.turningPoint);
    if (!withTurn) return;
    expect(summaryOf(withTurn).turningPoint!.text).toBe(withTurn.turningPoint!.text);
  });

  it("reports the upset with the forecast the winner actually beat", () => {
    const summaryUp = summaryOf(WITH_UPSET);
    expect(summaryUp.upset).toBeTruthy();
    const winner = WITH_UPSET.teams.find((t) => t.playerId === WITH_UPSET.winnerPlayerId)!;
    expect(summaryUp.upset!.wonAtProbability).toBeCloseTo(winner.winProbability, 1);
  });

  it("says nothing about an upset when there was not one", () => {
    expect(summaryOf(ORDINARY).upset).toBeNull();
  });

  it("passes the engine's award picks through untouched", () => {
    expect(summary.bestPerformer).toEqual({
      characterId: result.awards.bestPerformer!.characterId,
      playerId: result.awards.bestPerformer!.playerId,
      performance: result.awards.bestPerformer!.performance,
      price: result.awards.bestPerformer!.price,
    });
    expect(summary.biggestSurprise!.characterId).toBe(
      result.awards.biggestSurprise!.characterId,
    );
  });
});

describe("it omits rather than invents", () => {
  it("drops the award section when the source did not carry it", () => {
    // A payload that forwards fewer fields must produce a shorter summary, not
    // a reconstructed one.
    const replay = replayOf("sum-8");
    const withoutAwards: Replay = { ...replay };
    delete (withoutAwards as { awards?: unknown }).awards;

    const summary = summaryOf(withoutAwards);
    expect(summary.bestPerformer).toBeNull();
    expect(summary.biggestSurprise).toBeNull();
    // And everything else still answers.
    expect(summary.winner).toBeTruthy();
    expect(summary.mvp).toBeTruthy();
  });

  it("drops the MVP section when the result had none", () => {
    const replay = replayOf("sum-9");
    expect(summaryOf({ ...replay, mvp: null }).mvp).toBeNull();
  });

  it("drops the turning point when the engine found none", () => {
    const replay = replayOf("sum-9");
    expect(summaryOf({ ...replay, turningPoint: null }).turningPoint).toBeNull();
  });
});

describe("purity", () => {
  const replay = replayOf("sum-10");

  it("is deterministic", () => {
    expect(summaryOf(replay)).toEqual(summaryOf(replay));
  });

  it("does not touch the replay", () => {
    const before = structuredClone(replay);
    summaryOf(replay);
    expect(replay).toEqual(before);
  });

  it("changes when an authoritative field changes, and only then", () => {
    const before = summaryOf(replay);
    const shifted = summaryOf({
      ...replay,
      teams: replay.teams.map((t) =>
        t.rank === 1 ? { ...t, points: t.points + 7 } : t,
      ),
    });
    expect(shifted.winner!.points).toBe(before.winner!.points + 7);
    expect(shifted.mvp).toEqual(before.mvp);
  });
});
