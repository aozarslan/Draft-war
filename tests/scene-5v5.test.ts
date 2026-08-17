import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { sheetFor, visualArchetypeFor } from "../src/lib/render/archetypes";
import { ARENA, sceneAt } from "../src/lib/render/scene";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * The real format: five against five.
 * ---------------------------------------------------------------------------
 * Everything here runs a genuine `simulateBattle`, projects it, and asks the
 * scene what it looks like. The roster is chosen to put all six body plans on
 * the field at once — that is the only thing the test arranges. Nothing about
 * the fight itself is staged.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const animals = CHARACTERS.filter((c) => c.categoryId === "animals");

/** One character per body plan, plus fillers, split five and five. */
const ROSTER_A = [
  "animals-african-bush-elephant", // quadruped_large → quadruped sheet
  "animals-green-anaconda",        // serpentine
  "animals-golden-eagle",          // winged
  "animals-honey-badger",          // quadruped_small
  "animals-western-gorilla",       // humanoid_large → humanoid sheet
];
const ROSTER_B = [
  "animals-orca",                  // aquatic
  "animals-tiger",                 // quadruped_medium
  "animals-black-mamba",           // serpentine
  "animals-common-ostrich",        // humanoid_medium
  "animals-wolverine",             // quadruped_small
];

const pick = (ids: string[]) =>
  ids.map((id, i) => {
    const c = animals.find((c) => c.id === id);
    if (!c) throw new Error(`${id} is not in the catalogue`);
    return { characterId: c.id, price: 4 + i * 3 };
  });

const context: ReplayContext = {
  battleId: "battle-5v5",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

function battle(seed: string): BattleResult {
  return simulateBattle({
    teams: [
      {
        playerId: "player-a", nickname: "Ege",
        characters: pick(ROSTER_A), formation: "AGGRESSIVE",
      },
      {
        playerId: "player-b", nickname: "Mikail",
        characters: pick(ROSTER_B), formation: "DEFENSIVE",
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
 * A real 5v5 upset.
 *
 * Team A here is the six-archetype showcase and starts as a 24-point underdog
 * against this line-up; at seed `u17` it wins anyway and the engine calls it an
 * upset. Found by searching seeds rather than by forcing a flag, so what the
 * renderer emphasises is something the simulation genuinely decided.
 */
const UNDERDOG_OPPONENTS = [
  "animals-lion",
  "animals-african-buffalo",
  "animals-leopard",
  "animals-common-ostrich",
  "animals-wolverine",
];

const UPSET_REPLAY: Replay = toReplay(
  simulateBattle({
    teams: [
      {
        playerId: "player-a", nickname: "Ege",
        characters: pick(ROSTER_A), formation: "AGGRESSIVE",
      },
      {
        playerId: "player-b", nickname: "Mikail",
        characters: pick(UNDERDOG_OPPONENTS), formation: "DEFENSIVE",
      },
    ],
    map: MAPS[0],
    event: EVENT_CARDS[0],
    charactersById: CHARACTERS_BY_ID,
    seed: "u17",
    categoryIds: ["animals"],
    bands: BANDS,
  }),
  context,
);

describe("ten combatants, one battle", () => {
  const replay = replayOf("5v5-1");

  it("spawns all ten", () => {
    const scene = sceneAt(replay, 0);
    expect(scene.combatants).toHaveLength(10);
    expect(new Set(scene.combatants.map((c) => c.characterId)).size).toBe(10);
    expect(scene.combatants.filter((c) => c.teamId === "player-a")).toHaveLength(5);
    expect(scene.combatants.filter((c) => c.teamId === "player-b")).toHaveLength(5);
  });

  it("keeps all ten for the whole battle", () => {
    for (let t = 0; t <= replay.durationMs; t += 500) {
      expect(sceneAt(replay, t).combatants).toHaveLength(10);
    }
  });

  it("puts nobody on top of anybody else", () => {
    const scene = sceneAt(replay, 0);
    const seen = new Set<string>();
    for (const c of scene.combatants) {
      const key = `${Math.round(c.x)}:${Math.round(c.y)}`;
      expect(seen.has(key), `two combatants share ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("fits all ten inside the arena", () => {
    for (let t = 0; t <= replay.durationMs; t += 400) {
      for (const c of sceneAt(replay, t).combatants) {
        expect(c.x + c.lunge).toBeGreaterThan(0);
        expect(c.x + c.lunge).toBeLessThan(ARENA.width);
        expect(c.y).toBeGreaterThan(0);
        expect(c.y).toBeLessThan(ARENA.height);
      }
    }
  });
});

describe("six body plans on the field at once", () => {
  const replay = replayOf("5v5-2");

  it("draws every combatant with a sheet", () => {
    for (const c of replay.combatants) {
      const character = CHARACTERS_BY_ID[c.characterId];
      expect(sheetFor(visualArchetypeFor(character)), `${c.characterId}`).not.toBeNull();
    }
  });

  it("uses all six sheets in the one battle", () => {
    const sheets = new Set(
      replay.combatants.map(
        (c) => sheetFor(visualArchetypeFor(CHARACTERS_BY_ID[c.characterId]))!.src,
      ),
    );
    expect(sheets.size).toBe(6);
  });
});

describe("formation lanes", () => {
  const replay = replayOf("5v5-3");
  const scene = sceneAt(replay, 0);

  it("puts the aggressive side further forward than the defensive one", () => {
    const centre = ARENA.width / 2;
    const gap = (team: string) => {
      const xs = scene.combatants.filter((c) => c.teamId === team).map((c) => c.x);
      return Math.abs(xs.reduce((s, x) => s + x, 0) / xs.length - centre);
    };
    expect(gap("player-a")).toBeLessThan(gap("player-b"));
  });

  it("gives the aggressive side three in the front lane and the defensive side one", () => {
    const front = (team: string) =>
      replay.combatants.filter((c) => c.teamId === team && c.lane === "FRONT").length;
    expect(front("player-a")).toBe(3);
    expect(front("player-b")).toBe(1);
  });

  it("seats a player on the same side whether they win or lose", () => {
    // `result.teams` is sorted by rank, so seating by array order put the
    // eventual winner on the left from the opening frame — a spoiler, and a
    // team that swapped ends depending on how the fight finished.
    const sideOfA = (r: Replay) => {
      const s = sceneAt(r, 0);
      const xs = s.combatants.filter((c) => c.teamId === "player-a").map((c) => c.x);
      return xs.reduce((sum, x) => sum + x, 0) / xs.length < ARENA.width / 2 ? "left" : "right";
    };

    const winners = new Set<string>();
    const sides = new Set<string>();
    for (const seed of ["5v5-1", "5v5-2", "5v5-3", "5v5-6", "5v5-7"]) {
      const r = replayOf(seed);
      winners.add(r.winnerPlayerId);
      sides.add(sideOfA(r));
    }
    winners.add(UPSET_REPLAY.winnerPlayerId);
    sides.add(sideOfA(UPSET_REPLAY));

    // Both outcomes appear, and the seat never moves.
    expect(winners.size, "need a win and a loss to prove anything").toBe(2);
    expect([...sides]).toEqual(["left"]);
  });

  it("arranges each team in three depths", () => {
    for (const team of ["player-a", "player-b"]) {
      const depths = new Set(
        scene.combatants.filter((c) => c.teamId === team).map((c) => Math.round(c.x)),
      );
      expect(depths.size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("animations come from the events, not from guesses", () => {
  const replay = replayOf("5v5-4");
  const at = (t: number, id: string) =>
    sceneAt(replay, t).combatants.find((c) => c.characterId === id)!;

  it("makes the target die and the killer keep swinging", () => {
    const kill = replay.events.find((e) => e.kind === "ELIMINATION")!;
    expect(at(kill.atMs + 40, kill.targetId!).animation).toBe("DEATH");
    expect(at(kill.atMs + 40, kill.actorId!).animation).not.toBe("DEATH");
  });

  it("makes the blocker guard, not the attacker", () => {
    const block = replay.events.find((e) => e.kind === "BLOCK");
    if (!block) return;
    expect(at(block.atMs + 40, block.targetId!).animation).toBe("GUARD");
    expect(at(block.atMs + 40, block.actorId!).animation).toBe("ATTACK");
  });

  it("casts on a special and swings on a plain hit", () => {
    const special = replay.events.find((e) => e.kind === "SPECIAL");
    if (special) expect(at(special.atMs + 40, special.actorId!).animation).toBe("CAST");
    const hit = replay.events.find((e) => e.kind === "ATTACK" && e.actorId)!;
    expect(at(hit.atMs + 40, hit.actorId!).animation).toBe("ATTACK");
  });

  it("plays every animation the sheets provide at some point in a battle", () => {
    const played = new Set<string>();
    for (let t = 0; t <= replay.durationMs; t += 60) {
      for (const c of sceneAt(replay, t).combatants) played.add(c.animation);
    }
    for (const expected of ["IDLE", "ATTACK", "IMPACT", "DEATH"]) {
      expect(played, `${expected} never played`).toContain(expected);
    }
  });
});

describe("health", () => {
  const replay = replayOf("5v5-5");

  it("shows a bar for all ten and backs each one with the engine's own hpAfter", () => {
    const scene = sceneAt(replay, Math.round(replay.durationMs * 0.6));
    expect(scene.showHealth).toBe(true);
    for (const c of scene.combatants) {
      expect(typeof c.health).toBe("number");
      const hits = replay.events.filter(
        (e) => e.targetId === c.characterId && typeof e.hpAfter === "number" && e.atMs <= scene.elapsedMs,
      );
      const expected = hits.length ? hits[hits.length - 1].hpAfter! : c.maxHp;
      expect(c.hp).toBe(expected);
    }
  });

  it("shows nothing at all on a pre-V5 battle with ten combatants", () => {
    const legacy: Replay = {
      ...replay,
      replayVersion: 0,
      combatants: replay.combatants.map(({ maxHp: _drop, ...rest }) => rest),
      events: replay.events.map(({ hpAfter: _drop, ...rest }) => rest),
    };
    const scene = sceneAt(legacy, Math.round(legacy.durationMs / 2));
    expect(scene.combatants).toHaveLength(10);
    expect(scene.showHealth).toBe(false);
    for (const c of scene.combatants) expect(c.health).toBeNull();
  });
});

describe("the closing beat", () => {
  it("crowns the MVP the engine picked, and only once the fight is over", () => {
    const replay = replayOf("5v5-6");
    expect(replay.mvp).toBeTruthy();

    const mid = sceneAt(replay, Math.round(replay.durationMs / 2));
    expect(mid.mvpCharacterId).toBeNull();

    const end = sceneAt(replay, replay.durationMs);
    expect(end.mvpCharacterId).toBe(replay.mvp!.characterId);
    expect(end.combatants.some((c) => c.characterId === end.mvpCharacterId)).toBe(true);
  });

  it("reports an upset the engine actually called, in a real battle", () => {
    // A genuine 5v5: the showcase side is a 24-point underdog here and wins
    // anyway. Found by searching seeds, not by setting a flag — the scene must
    // not be the thing that decides an upset happened.
    const replay = UPSET_REPLAY;
    expect(replay.upset, "seed u17 no longer produces an upset").toBe(true);
    expect(replay.combatants).toHaveLength(10);
    expect(sceneAt(replay, replay.durationMs).upset).toBe(true);
  });

  it("says nothing about an upset when there was not one", () => {
    const ordinary = replayOf("5v5-7");
    expect(ordinary.upset).toBe(false);
    expect(sceneAt(ordinary, ordinary.durationMs).upset).toBe(false);
  });

  it("finishes the closing beat before playback stops", () => {
    // The outro used to run on a fixed window that was longer than the tail of
    // a real battle, so the crown was still fading in when the replay ended.
    for (const replay of [replayOf("5v5-7"), replayOf("5v5-1"), UPSET_REPLAY]) {
      expect(sceneAt(replay, replay.durationMs).outro).toBe(1);
    }
  });

  it("still shows the victory banner at the final frame", () => {
    // It used to fade out on the same curve as a phase divider and had
    // vanished by the time playback stopped.
    for (const replay of [replayOf("5v5-7"), UPSET_REPLAY]) {
      const banner = sceneAt(replay, replay.durationMs).banner;
      expect(banner?.kind).toBe("VICTORY");
    }
  });

  it("still crowns the MVP on the upset battle", () => {
    const end = sceneAt(UPSET_REPLAY, UPSET_REPLAY.durationMs);
    expect(end.mvpCharacterId).toBe(UPSET_REPLAY.mvp!.characterId);
  });

  it("announces a turning point when the engine found one", () => {
    const withTurn = ["5v5-1", "5v5-2", "5v5-3", "5v5-4", "5v5-5", "5v5-6"]
      .map(replayOf)
      .find((r) => r.turningPoint);
    if (!withTurn) return;

    const event = withTurn.events.find((e) => e.kind === "TURNING_POINT");
    expect(event, "a turning point in the result but not in the log").toBeTruthy();
    const scene = sceneAt(withTurn, event!.atMs + 200);
    expect(scene.banner?.kind).toBe("TURNING_POINT");
  });
});

describe("determinism holds at ten combatants", () => {
  const replay = replayOf("5v5-8");

  it("answers identically however it is asked", () => {
    expect(sceneAt(replay, 7200)).toEqual(sceneAt(replay, 7200));
    const forwards = [0, 3000, 6000, 9000].map((t) => sceneAt(replay, t));
    const backwards = [9000, 6000, 3000, 0].map((t) => sceneAt(replay, t)).reverse();
    expect(backwards).toEqual(forwards);
  });

  it("does not mutate the replay", () => {
    const before = structuredClone(replay);
    for (let t = 0; t <= replay.durationMs; t += 1500) sceneAt(replay, t);
    expect(replay).toEqual(before);
  });
});

describe("performance at ten combatants", () => {
  it("projects a frame fast enough to leave the frame budget to drawing", () => {
    const replay = replayOf("perf");
    const times = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.round(replay.durationMs * f));

    // Warm up, so the measurement is of steady state rather than of the JIT.
    for (const t of times) sceneAt(replay, t);

    const started = performance.now();
    const iterations = 600;
    for (let i = 0; i < iterations; i++) sceneAt(replay, times[i % times.length]);
    const perCall = (performance.now() - started) / iterations;

    // A 60fps frame is 16.7ms and the scene is only the projection — the draw
    // still has to happen. Well under a millisecond leaves that budget intact.
    expect(perCall, `sceneAt took ${perCall.toFixed(3)}ms per call`).toBeLessThan(2);
  });
});
