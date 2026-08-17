import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { highlightsOf, levelRank, HIGHLIGHT_LEVELS } from "../src/lib/render/highlights";
import { sceneAt } from "../src/lib/render/scene";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * Highlights describe; they do not decide.
 * ---------------------------------------------------------------------------
 * The classification is the sort of thing that quietly acquires authority: it
 * has opinions about importance, it sits next to the renderer, and nothing
 * about "level: MAJOR" looks dangerous. These tests pin the two properties
 * that keep it honest — it is a pure function of the replay, and computing it
 * changes nothing at all.
 *
 * Validated on real 5v5 battles: five characters a side, ten combatants.
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
  battleId: "highlights",
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

/** A real 5v5 that carries a turning point, for the cinematic rules. */
const WITH_TURNING_POINT = (() => {
  for (let i = 0; i < 200; i++) {
    const replay = replayOf(`tp-${i}`);
    if (replay.events.some((e) => e.kind === "TURNING_POINT")) return replay;
  }
  throw new Error("no turning point in 200 real battles");
})();

/** A real 5v5 the engine did *not* call an upset. */
const ORDINARY = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`ord-${i}`);
    if (!replay.upset) return replay;
  }
  throw new Error("every one of 300 real battles was an upset");
})();

/** A real 5v5 the engine called an upset. */
const WITH_UPSET = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`up-${i}`);
    if (replay.upset) return replay;
  }
  throw new Error("no upset in 300 real battles");
})();

describe("it is a real 5v5 being classified", () => {
  it("has ten combatants, five a side", () => {
    const replay = replayOf("h-1");
    expect(replay.combatants).toHaveLength(10);
    expect(replay.combatants.filter((c) => c.teamId === "player-a")).toHaveLength(5);
    expect(replay.combatants.filter((c) => c.teamId === "player-b")).toHaveLength(5);
  });
});

describe("determinism and purity", () => {
  const replay = replayOf("h-2");

  it("returns the same list every time it is asked", () => {
    expect(highlightsOf(replay)).toEqual(highlightsOf(replay));
  });

  it("does not touch the replay", () => {
    const before = structuredClone(replay);
    highlightsOf(replay);
    highlightsOf(replay);
    expect(replay).toEqual(before);
  });

  it("cannot change what the renderer draws", () => {
    // The strongest form of "observational": run the classifier between two
    // identical scene requests and require the scenes to match exactly.
    const before = sceneAt(replay, 9_000);
    highlightsOf(replay);
    expect(sceneAt(replay, 9_000)).toEqual(before);
  });

  it("has no dependence on a clock or on randomness", () => {
    // Two calls separated by real time, and by other work, agree.
    const first = highlightsOf(replay);
    for (let i = 0; i < 50; i++) highlightsOf(replayOf(`noise-${i}`));
    expect(highlightsOf(replay)).toEqual(first);
  });
});

describe("every highlight points at something that happened", () => {
  const replay = replayOf("h-3");
  const highlights = highlightsOf(replay);

  it("indexes only real events", () => {
    expect(highlights.length).toBeGreaterThan(20);
    for (const h of highlights) {
      expect(h.index).toBeGreaterThanOrEqual(0);
      expect(h.index).toBeLessThan(replay.events.length);
    }
  });

  it("carries the engine's own timestamp, never an adjusted one", () => {
    for (const h of highlights) {
      expect(h.atMs).toBe(replay.events[h.index].atMs);
      expect(h.kind).toBe(replay.events[h.index].kind);
    }
  });

  it("names a level the vocabulary contains", () => {
    for (const h of highlights) expect(HIGHLIGHT_LEVELS).toContain(h.level);
  });

  it("leaves structure unclassified", () => {
    // Phase dividers and spawns are scaffolding, not moments.
    for (const h of highlights) {
      expect(["PHASE", "ROUND_START", "SPAWN"]).not.toContain(h.kind);
    }
  });
});

describe("the levels mean what they say", () => {
  const replay = replayOf("h-4");
  const highlights = highlightsOf(replay);
  const levelOf = (kind: string) =>
    highlights.filter((h) => h.kind === kind).map((h) => h.level);

  it("puts crits and specials above ordinary blows", () => {
    expect(new Set(levelOf("CRIT"))).toEqual(new Set(["HIGH"]));
    expect(new Set(levelOf("SPECIAL"))).toEqual(new Set(["HIGH"]));
    for (const level of levelOf("ATTACK")) {
      expect(levelRank(level)).toBeLessThan(levelRank("HIGH"));
    }
  });

  it("puts every elimination at MAJOR", () => {
    expect(levelOf("ELIMINATION").length).toBeGreaterThan(0);
    expect(new Set(levelOf("ELIMINATION"))).toEqual(new Set(["MAJOR"]));
  });

  it("splits ordinary hits around each squad's own median", () => {
    const attacks = highlights.filter((h) => h.kind === "ATTACK");
    const low = attacks.filter((h) => h.level === "LOW");
    const normal = attacks.filter((h) => h.level === "NORMAL");
    // Both sides of the split are populated, or the median is doing nothing.
    expect(low.length).toBeGreaterThan(3);
    expect(normal.length).toBeGreaterThan(3);
  });

  it("reserves CINEMATIC for a turning point", () => {
    const cinematic = highlightsOf(WITH_TURNING_POINT).filter(
      (h) => h.level === "CINEMATIC",
    );
    expect(cinematic.some((h) => h.kind === "TURNING_POINT")).toBe(true);
  });

  it("raises the ending to CINEMATIC only when the engine called an upset", () => {
    const upsetEnd = highlightsOf(WITH_UPSET).find((h) => h.kind === "END")!;
    expect(upsetEnd.level).toBe("CINEMATIC");

    expect(ORDINARY.upset).toBe(false);
    expect(highlightsOf(ORDINARY).find((h) => h.kind === "END")!.level).toBe("MAJOR");
  });
});

describe("the derived cases come from the log, not from new state", () => {
  it("recognises the closing rounds from the engine's own divider", () => {
    const replay = replayOf("h-5");
    const finalDivider = replay.events.find(
      (e) => e.kind === "PHASE" && e.text.toUpperCase().startsWith("FINAL CLASH"),
    );
    expect(finalDivider, "no final clash in this battle").toBeTruthy();

    const inClash = highlightsOf(replay).filter(
      (h) => h.kind === "ELIMINATION" && h.atMs >= finalDivider!.atMs,
    );
    expect(inClash.length).toBeGreaterThan(0);
    for (const h of inClash) expect(h.reason).toContain("final clash");
  });

  it("spots an elimination thrown by the shorter-handed side", () => {
    // Counted from the elimination history alone: "five minus how many of
    // yours have died". Search real battles for one that contains the case.
    let found = false;
    for (let i = 0; i < 60 && !found; i++) {
      const replay = replayOf(`cb-${i}`);
      found = highlightsOf(replay).some((h) => h.reason.includes("shorter-handed"));
    }
    expect(found, "no comeback kill in 60 real battles").toBe(true);
  });
});

describe("winner-independence", () => {
  it("classifies nothing by who won, except the upset flag the engine set", () => {
    // Rewriting the winner must change nothing: no rule reads it. (The END is
    // raised by `upset`, which is a separate field the engine set.)
    const replay = replayOf("h-6");
    const flipped: Replay = {
      ...replay,
      winnerPlayerId: replay.teams.find((t) => t.playerId !== replay.winnerPlayerId)!
        .playerId,
    };

    const before = highlightsOf(replay);
    const after = highlightsOf(flipped);
    expect(after).toEqual(before);
  });

  it("changes the ending when, and only when, the upset flag changes", () => {
    // Chosen by property, not by seed name: `h-6` turned out to be an upset
    // already, so flipping its flag changed nothing and the test proved
    // nothing.
    const replay = ORDINARY;
    const asUpset: Replay = { ...replay, upset: true };

    const before = highlightsOf(replay);
    const after = highlightsOf(asUpset);

    const differing = after.filter((h, i) => h.level !== before[i].level);
    expect(differing).toHaveLength(1);
    expect(differing[0].kind).toBe("END");
  });
});
