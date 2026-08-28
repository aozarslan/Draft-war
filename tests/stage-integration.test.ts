import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { playerColor } from "../src/lib/game/colors";
import { buildStage, elapsedFor, isFinished, type StageInput } from "../src/lib/render/stage";
import { sceneAt } from "../src/lib/render/scene";
import { canShowHealth } from "../src/lib/game/replay";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * The real flow, without a browser
 * ---------------------------------------------------------------------------
 * `BattleStage` mounts a canvas and nothing else; everything that could be
 * wrong — which replay, how far into it, whose colours, which identities
 * collide — lives in `buildStage` and `elapsedFor`. These test that, against
 * real simulated battles and the same snapshot shape the room hands over.
 *
 * The two-client tests are the point of the milestone: two viewers with
 * different local clocks, different join times and different histories have to
 * land on the same frame, because the only thing either of them reads is the
 * server's own timestamp.
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

const STARTED_AT = "2026-08-17T12:00:00.000Z";
const STARTED_MS = new Date(STARTED_AT).getTime();

/** The snapshot shape the room actually hands to `BattleStage`. */
function input(over: Partial<StageInput> = {}): StageInput {
  return {
    battleId: "game-1",
    result: battle("stage-1"),
    players: [
      { id: "player-a", nickname: "Ege", formation: "AGGRESSIVE", colorHex: playerColor(0).hex },
      { id: "player-b", nickname: "Mikail", formation: "DEFENSIVE", colorHex: playerColor(1).hex },
    ],
    charactersById: CHARACTERS_BY_ID,
    ...over,
  };
}

describe("the stage is built from the snapshot, and from nothing else", () => {
  it("projects the stored result into a replay", () => {
    const stage = buildStage(input())!;
    expect(stage.replay.combatants).toHaveLength(10);
    expect(stage.replay.winnerPlayerId).toBe(input().result!.winnerPlayerId);
    expect(stage.durationMs).toBe(input().result!.durationMs);
  });

  it("takes team colours from the seats, not from the result", () => {
    const stage = buildStage(input())!;
    expect(stage.teamColors["player-a"]).toBe(playerColor(0).hex);
    expect(stage.teamColors["player-b"]).toBe(playerColor(1).hex);
  });

  it("takes formations from the players, so the lanes match the draft", () => {
    const stage = buildStage(input())!;
    const front = (team: string) =>
      stage.replay.combatants.filter((c) => c.teamId === team && c.lane === "FRONT").length;
    expect(front("player-a")).toBe(3); // aggressive
    expect(front("player-b")).toBe(1); // defensive
  });

  it("gives all ten a distinct look before they reach the canvas", () => {
    const stage = buildStage(input())!;
    const shapes = stage.art
      .filter((a) => stage.replay.combatants.some((c) => c.characterId === a.characterId))
      .map((a) => JSON.stringify(a.identity));
    expect(new Set(shapes).size).toBe(10);
  });

  it("carries the engine's own synergy through untouched", () => {
    const stage = buildStage(input())!;
    const engine = new Set(
      stage.replay.teams.flatMap((t) => t.synergies.map((g) => `${g.label}:${g.bonus}`)),
    );
    for (const cue of stage.interactions.synergies) {
      expect(engine.has(`${cue.label}:${cue.bonus}`)).toBe(true);
    }
  });
});

describe("nothing to draw yet", () => {
  it("builds nothing before the battle has been simulated", () => {
    expect(buildStage(input({ result: null }))).toBeNull();
  });

  it("leaves the start-time question to the caller", () => {
    // `buildStage` deliberately knows nothing about clocks: a finished match
    // served over a shared link has no `battleStartedAt` and must still stage.
    // `BattleStage` withholds the result until the server has stamped one.
    const stage = buildStage(input());
    expect(stage).not.toBeNull();
    expect(elapsedFor(null, STARTED_MS, stage!.durationMs)).toBe(0);
  });

  it("builds nothing from a result with no combatants", () => {
    const empty = { ...battle("stage-1"), combatants: [] };
    expect(buildStage(input({ result: empty }))).toBeNull();
  });

  it("still builds when a character has gone missing from the catalogue", () => {
    // A retired character must not take the arena down with it.
    const thinned = { ...CHARACTERS_BY_ID };
    delete thinned[ROSTER_A[0]];
    const stage = buildStage(input({ charactersById: thinned }));
    expect(stage).not.toBeNull();
    expect(stage!.art.length).toBe(9);
    expect(stage!.replay.combatants).toHaveLength(10);
  });
});

describe("the clock is the server's", () => {
  const durationMs = battle("stage-1").durationMs;

  it("starts at zero and runs to the end", () => {
    expect(elapsedFor(STARTED_AT, STARTED_MS, durationMs)).toBe(0);
    expect(elapsedFor(STARTED_AT, STARTED_MS + 5_000, durationMs)).toBe(5_000);
    expect(elapsedFor(STARTED_AT, STARTED_MS + durationMs, durationMs)).toBe(durationMs);
  });

  it("clamps a client whose clock runs ahead of the start stamp", () => {
    expect(elapsedFor(STARTED_AT, STARTED_MS - 4_000, durationMs)).toBe(0);
  });

  it("stops at the end rather than running the outro forever", () => {
    expect(elapsedFor(STARTED_AT, STARTED_MS + durationMs * 10, durationMs)).toBe(durationMs);
    expect(isFinished(STARTED_AT, STARTED_MS + durationMs, durationMs)).toBe(true);
    expect(isFinished(STARTED_AT, STARTED_MS + 1_000, durationMs)).toBe(false);
  });

  it("survives a start stamp the server never wrote", () => {
    expect(elapsedFor(null, STARTED_MS, durationMs)).toBe(0);
    expect(elapsedFor("not a date", STARTED_MS, durationMs)).toBe(0);
  });
});

describe("two clients, one timeline", () => {
  const stage = buildStage(input())!;

  /** A client with its own wrong local clock and the offset the room measured. */
  const client = (localSkewMs: number) => {
    // This is exactly what `useRoom` does: the offset is the difference the
    // server reported, so `serverNow()` lands on the same instant everywhere
    // however wrong the device clock is.
    const offset = -localSkewMs;
    return (trueNowMs: number) => trueNowMs + localSkewMs + offset;
  };

  it("shows the same frame on two devices with wildly different clocks", () => {
    const deviceA = client(0);
    const deviceB = client(45 * 60 * 1000); // three quarters of an hour fast

    for (const trueNow of [STARTED_MS, STARTED_MS + 3_000, STARTED_MS + 19_000]) {
      const a = sceneAt(stage.replay, elapsedFor(STARTED_AT, deviceA(trueNow), stage.durationMs));
      const b = sceneAt(stage.replay, elapsedFor(STARTED_AT, deviceB(trueNow), stage.durationMs));
      expect(b).toEqual(a);
    }
  });

  it("puts a late joiner exactly where everyone else is", () => {
    // Fifteen seconds in, joining now: no catch-up, no replaying the events up
    // to here. The scene is a function of time, so the answer is the answer.
    const now = STARTED_MS + 15_000;
    const elapsed = elapsedFor(STARTED_AT, now, stage.durationMs);
    expect(elapsed).toBe(15_000);

    const late = sceneAt(stage.replay, elapsed);
    const early = sceneAt(stage.replay, elapsed);
    expect(late).toEqual(early);
    expect(late.combatants.some((c) => !c.alive)).toBe(true);
  });

  it("puts a refreshed client back on the same frame", () => {
    const now = STARTED_MS + 22_400;
    const before = sceneAt(stage.replay, elapsedFor(STARTED_AT, now, stage.durationMs));

    // A refresh rebuilds everything from the snapshot: new stage, new replay.
    const rebuilt = buildStage(input())!;
    const after = sceneAt(rebuilt.replay, elapsedFor(STARTED_AT, now, rebuilt.durationMs));
    expect(after).toEqual(before);
  });

  it("brings a backgrounded tab back to the right moment, not to where it left", () => {
    // The renderer has no accumulator, so time passing while suspended is
    // simply time: it wakes up and asks the clock.
    const suspendedAt = STARTED_MS + 4_000;
    const wokeAt = STARTED_MS + 24_000;
    const asleep = sceneAt(stage.replay, elapsedFor(STARTED_AT, suspendedAt, stage.durationMs));
    const awake = sceneAt(stage.replay, elapsedFor(STARTED_AT, wokeAt, stage.durationMs));

    expect(awake).not.toEqual(asleep);
    // Twenty seconds of suspension is simply twenty seconds: the renderer has
    // no accumulator to fall behind by.
    expect(awake).toEqual(sceneAt(stage.replay, 24_000));
  });

  it("is unmoved by a realtime event arriving twice", () => {
    // Realtime is a doorbell: it causes a refetch, and the refetch produces the
    // same snapshot. Two rings must not advance anything.
    const now = STARTED_MS + 11_000;
    const once = buildStage(input())!;
    const twice = buildStage(input())!;
    expect(sceneAt(twice.replay, elapsedFor(STARTED_AT, now, twice.durationMs))).toEqual(
      sceneAt(once.replay, elapsedFor(STARTED_AT, now, once.durationMs)),
    );
  });

  it("is unmoved by a realtime event arriving late", () => {
    // A doorbell that rings after the battle is over changes nothing about
    // what was drawn at any earlier moment.
    const mid = sceneAt(stage.replay, 9_000);
    const rebuilt = buildStage(input())!;
    expect(sceneAt(rebuilt.replay, 9_000)).toEqual(mid);
  });
});

describe("battles recorded before V5 still play", () => {
  const legacyResult: BattleResult = {
    ...battle("stage-legacy"),
    rulesVersion: undefined,
    combatants: battle("stage-legacy").combatants.map(({ maxHp: _drop, ...rest }) => rest),
    log: battle("stage-legacy").log.map(({ hpAfter: _drop, ...rest }) => rest),
  };
  const stage = buildStage(input({ result: legacyResult }))!;

  it("builds a stage at all", () => {
    expect(stage).not.toBeNull();
    expect(stage.replay.replayVersion).toBe(0);
    expect(canShowHealth(stage.replay)).toBe(false);
  });

  it("shows no health, invented or otherwise", () => {
    const scene = sceneAt(stage.replay, Math.round(stage.durationMs / 2));
    expect(scene.showHealth).toBe(false);
    for (const c of scene.combatants) {
      expect(c.health).toBeNull();
      expect(c.healthTrail).toBeNull();
    }
  });

  it("still shows the attacks, the damage and the deaths", () => {
    const hit = stage.replay.events.find((e) => typeof e.damage === "number")!;
    const scene = sceneAt(stage.replay, hit.atMs + 60);
    expect(scene.effects.some((e) => e.value === hit.damage)).toBe(true);

    const end = sceneAt(stage.replay, stage.durationMs);
    expect(end.combatants.some((c) => !c.alive)).toBe(true);
  });

  it("still shows the victory and the MVP", () => {
    const end = sceneAt(stage.replay, stage.durationMs);
    expect(end.banner?.kind).toBe("VICTORY");
    expect(end.mvpCharacterId).toBe(stage.replay.mvp!.characterId);
  });
});

describe("the renderer cannot change the result", () => {
  const stage = buildStage(input())!;

  it("reports the winner the engine reported, at every moment", () => {
    const result = input().result!;
    expect(stage.replay.winnerPlayerId).toBe(result.winnerPlayerId);
    // And no amount of scrubbing changes it.
    for (let t = 0; t <= stage.durationMs; t += 4000) {
      sceneAt(stage.replay, t);
    }
    expect(stage.replay.winnerPlayerId).toBe(result.winnerPlayerId);
    expect(stage.replay.mvp).toEqual(result.mvp);
    expect(stage.replay.upset).toBe(Boolean(result.upset));
  });

  it("reports HP the engine recorded, never a subtraction of its own", () => {
    const scene = sceneAt(stage.replay, stage.durationMs);
    for (const c of scene.combatants) {
      const hits = stage.replay.events.filter(
        (e) => e.targetId === c.characterId && typeof e.hpAfter === "number",
      );
      const expected = hits.length ? hits[hits.length - 1].hpAfter! : c.maxHp;
      expect(c.hp).toBe(expected);
    }
  });

  it("does not mutate the stored result while drawing it", () => {
    const result = battle("stage-1");
    const before = structuredClone(result);
    const built = buildStage(input({ result }))!;
    for (let t = 0; t <= built.durationMs; t += 2000) sceneAt(built.replay, t);
    expect(result).toEqual(before);
  });
});

describe("the client has no way to send a result", () => {
  /**
   * Read from the source rather than asserted about a type: types vanish at
   * runtime, and the guarantee that matters is what the deployed route
   * actually accepts. If someone adds a `SUBMIT_RESULT` case, this fails.
   */
  const route = readFileSync(
    resolve(process.cwd(), "src/app/api/rooms/[code]/action/route.ts"),
    "utf8",
  );
  const api = readFileSync(resolve(process.cwd(), "src/lib/client/api.ts"), "utf8");

  const handled = [...route.matchAll(/case "([A-Z_]+)":/g)].map((m) => m[1]);

  it("handles a fixed, known set of actions", () => {
    // The phase names inside ADVANCE are matched by the same pattern; what
    // matters is that nothing outside this list is handled.
    const allowed = new Set([
      "HEARTBEAT", "READY", "START", "PICK_CATEGORY", "SET_MAX_PLAYERS",
      "VOTE_CATEGORY", "BID", "PASS", "SET_FORMATION", "CHAT", "REACTION",
      "VOTE_MAP", "ADVANCE", "REMATCH", "PLAY_AGAIN",
      // S8 match backbone. All three are verbs with no arguments — see
      // "a client can ask, never decide" in tests/rounds.test.ts, which holds
      // them to carrying no phase, round, HP, damage or reward.
      "START_MATCH", "ADVANCE_MATCH", "ABANDON_MATCH",
      // ADVANCE's inner phase switch.
      "CATEGORY", "TEAM_REVIEW", "MAP_SELECTION", "EVENT", "BATTLE", "RESULTS",
    ]);
    for (const action of handled) {
      expect(allowed.has(action), `route handles unexpected action "${action}"`).toBe(true);
    }
    expect(handled.length).toBeGreaterThan(10);
  });

  it("rejects anything it does not know", () => {
    expect(route).toContain('errorResponse("UNKNOWN_ACTION"');
  });

  it("offers the client no vocabulary for a result", () => {
    // Not "the server ignores it" — there is no way to express it. A client
    // cannot send a winner, a damage figure, an HP value, an MVP or an elapsed
    // time, because no action carries one.
    for (const forbidden of [
      "winner", "winnerPlayerId", "damage", "hpAfter", "maxHp",
      "mvp", "battleResult", "elapsed", "durationMs",
    ]) {
      expect(
        api.slice(api.indexOf("export type ClientAction")).includes(forbidden),
        `ClientAction mentions "${forbidden}"`,
      ).toBe(false);
    }
  });
});
