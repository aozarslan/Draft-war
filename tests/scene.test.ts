import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS_BY_ID } from "../src/lib/game/maps";
import { EVENTS_BY_ID } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { ARENA, sceneAt } from "../src/lib/render/scene";
import { clamp01, lerp, pingPong, shakeOffset } from "../src/lib/render/easing";
import type { BattleResult } from "../src/lib/game/types";

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const map = Object.values(MAPS_BY_ID)[0];
const event = Object.values(EVENTS_BY_ID)[0];
const marvel = CHARACTERS.filter((c) => c.categoryId === "apex");

const context: ReplayContext = {
  battleId: "battle-1",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

function battle(seed: string): BattleResult {
  return simulateBattle({
    teams: [
      {
        playerId: "player-a",
        nickname: "Ege",
        characters: marvel.slice(0, 5).map((c, i) => ({ characterId: c.id, price: 4 + i * 3 })),
        formation: "AGGRESSIVE",
      },
      {
        playerId: "player-b",
        nickname: "Mikail",
        characters: marvel.slice(5, 10).map((c, i) => ({ characterId: c.id, price: 6 + i * 2 })),
        formation: "DEFENSIVE",
      },
    ],
    map,
    event,
    charactersById: CHARACTERS_BY_ID,
    seed,
    categoryIds: ["apex"],
    bands: BANDS,
  });
}

const replayOf = (seed: string): Replay => toReplay(battle(seed), context);

/** A V4 battle: no maxHp, no hpAfter. */
function legacy(replay: Replay): Replay {
  return {
    ...replay,
    replayVersion: 0,
    combatants: replay.combatants.map(({ maxHp: _drop, ...rest }) => rest),
    events: replay.events.map(({ hpAfter: _drop, ...rest }) => rest),
  };
}

describe("the scene is a function of time, not of frames", () => {
  it("gives the same answer however many times it is asked", () => {
    const replay = replayOf("scene-1");
    expect(sceneAt(replay, 4200)).toEqual(sceneAt(replay, 4200));
  });

  it("does not care what order it is asked in", () => {
    const replay = replayOf("scene-2");
    const forwards = [0, 1000, 2000, 3000].map((t) => sceneAt(replay, t));
    const backwards = [3000, 2000, 1000, 0].map((t) => sceneAt(replay, t)).reverse();
    expect(backwards).toEqual(forwards);
  });

  it("scrubs backwards without leaving the dead on the floor", () => {
    const replay = replayOf("scene-3");
    const late = sceneAt(replay, replay.durationMs);
    const early = sceneAt(replay, 0);
    expect(late.combatants.some((c) => !c.alive)).toBe(true);
    expect(early.combatants.every((c) => c.alive)).toBe(true);
  });

  it("does not mutate the replay it is given", () => {
    const replay = replayOf("scene-4");
    const before = structuredClone(replay);
    sceneAt(replay, 500);
    sceneAt(replay, 5000);
    expect(replay).toEqual(before);
  });

  it("clamps a negative or absurd clock rather than throwing", () => {
    const replay = replayOf("scene-5");
    expect(sceneAt(replay, -5000).elapsedMs).toBe(0);
    expect(sceneAt(replay, 10_000_000).finished).toBe(true);
  });
});

describe("what it reports comes from the engine", () => {
  it("shows the HP the simulation recorded, never a subtraction of its own", () => {
    const result = battle("hp-scene");
    const replay = toReplay(result, context);

    // At the end, every combatant's HP must equal the last hpAfter the engine
    // logged for them — or their full maxHp if they were never hit.
    const scene = sceneAt(replay, replay.durationMs);
    for (const c of scene.combatants) {
      const hits = replay.events.filter(
        (e) => e.targetId === c.characterId && typeof e.hpAfter === "number",
      );
      const expected = hits.length ? hits[hits.length - 1].hpAfter! : c.maxHp;
      expect(c.hp).toBe(expected);
    }
  });

  it("kills exactly the characters the engine eliminated", () => {
    const replay = replayOf("dead-scene");
    const scene = sceneAt(replay, replay.durationMs);
    const eliminated = new Set(
      replay.events.filter((e) => e.kind === "ELIMINATION").map((e) => e.targetId),
    );
    for (const c of scene.combatants) {
      expect(c.alive).toBe(!eliminated.has(c.characterId));
    }
  });

  it("never lets health leave 0..1", () => {
    const replay = replayOf("health-bounds");
    for (let t = 0; t <= replay.durationMs; t += 250) {
      for (const c of sceneAt(replay, t).combatants) {
        if (c.health === null) continue;
        expect(c.health).toBeGreaterThanOrEqual(0);
        expect(c.health).toBeLessThanOrEqual(1);
      }
    }
  });

  it("only ever loses health as time goes forward", () => {
    const replay = replayOf("monotonic-hp");
    let previous = new Map<string, number>();
    for (let t = 0; t <= replay.durationMs; t += 200) {
      for (const c of sceneAt(replay, t).combatants) {
        if (c.hp === null) continue;
        const before = previous.get(c.characterId);
        if (before !== undefined) expect(c.hp).toBeLessThanOrEqual(before);
        previous.set(c.characterId, c.hp);
      }
    }
    expect(previous.size).toBeGreaterThan(0);
  });
});

describe("placement", () => {
  it("puts the two teams on opposite sides", () => {
    const scene = sceneAt(replayOf("sides"), 0);
    const a = scene.combatants.filter((c) => c.teamId === "player-a");
    const b = scene.combatants.filter((c) => c.teamId === "player-b");
    expect(Math.max(...a.map((c) => c.x))).toBeLessThan(Math.min(...b.map((c) => c.x)));
  });

  it("faces them at each other", () => {
    const scene = sceneAt(replayOf("facing"), 0);
    expect(scene.combatants.find((c) => c.teamId === "player-a")!.facing).toBe(1);
    expect(scene.combatants.find((c) => c.teamId === "player-b")!.facing).toBe(-1);
  });

  it("keeps everybody inside the arena", () => {
    const replay = replayOf("bounds");
    for (let t = 0; t <= replay.durationMs; t += 400) {
      for (const c of sceneAt(replay, t).combatants) {
        expect(c.x + c.lunge).toBeGreaterThan(0);
        expect(c.x + c.lunge).toBeLessThan(ARENA.width);
        expect(c.y).toBeGreaterThan(0);
        expect(c.y).toBeLessThan(ARENA.height);
      }
    }
  });

  it("gives an aggressive team the more forward line", () => {
    const scene = sceneAt(replayOf("lanes"), 0);
    const avg = (team: string) => {
      const xs = scene.combatants.filter((c) => c.teamId === team).map((c) => c.x);
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    };
    // Team A advances rightward, team B is mirrored, so both "forward" means
    // closer to the centre line.
    const centre = ARENA.width / 2;
    expect(centre - avg("player-a")).toBeLessThan(avg("player-b") - centre);
  });
});

describe("presentation", () => {
  it("plays an animation when something happens and returns to idle after", () => {
    const replay = replayOf("anim");
    const attack = replay.events.find((e) => e.kind === "ATTACK" && e.actorId)!;
    const during = sceneAt(replay, attack.atMs + 50).combatants.find(
      (c) => c.characterId === attack.actorId,
    )!;
    const after = sceneAt(replay, attack.atMs + 5000).combatants.find(
      (c) => c.characterId === attack.actorId,
    )!;
    expect(during.animation).toBe("ATTACK");
    expect(["IDLE", "DEATH"]).toContain(after.animation);
  });

  it("shakes the camera on a critical hit and settles afterwards", () => {
    const replay = replayOf("shake");
    const crit = replay.events.find((e) => e.kind === "CRIT");
    if (!crit) return;
    const during = sceneAt(replay, crit.atMs + 20).camera;
    const settled = sceneAt(replay, crit.atMs + 2000).camera;
    const offset = Math.hypot(during.x - ARENA.width / 2, during.y - ARENA.height / 2);
    const rest = Math.hypot(settled.x - ARENA.width / 2, settled.y - ARENA.height / 2);
    expect(offset).toBeGreaterThan(rest);
  });

  it("shows the victory banner at the end and nothing before the start", () => {
    const replay = replayOf("banner");
    expect(sceneAt(replay, replay.durationMs).banner?.kind).toBe("VICTORY");
    const opening = sceneAt(replay, 10).banner;
    expect(opening === null || opening.kind === "PHASE").toBe(true);
  });

  it("drops effects once they have played out", () => {
    const replay = replayOf("effects");
    const busy = sceneAt(replay, Math.round(replay.durationMs / 2));
    expect(busy.effects.every((e) => e.progress >= 0 && e.progress < 1)).toBe(true);
  });
});

describe("battles recorded before V5", () => {
  it("play without inventing health", () => {
    const replay = legacy(replayOf("legacy-scene"));
    const scene = sceneAt(replay, Math.round(replay.durationMs / 2));
    expect(scene.showHealth).toBe(false);
    for (const c of scene.combatants) {
      expect(c.health).toBeNull();
      expect(c.hp).toBeNull();
      expect(c.maxHp).toBeNull();
    }
  });

  it("still animate, still kill, still finish", () => {
    const replay = legacy(replayOf("legacy-plays"));
    const end = sceneAt(replay, replay.durationMs);
    expect(end.finished).toBe(true);
    expect(end.combatants.some((c) => !c.alive)).toBe(true);
    expect(end.banner?.kind).toBe("VICTORY");
  });
});

describe("easing", () => {
  it("clamps outside the unit interval", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(4)).toBe(1);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 9)).toBe(20);
  });

  it("returns a lunge to where it started", () => {
    expect(pingPong(0)).toBeCloseTo(0, 5);
    expect(pingPong(1)).toBeCloseTo(0, 5);
    expect(pingPong(0.5)).toBeCloseTo(1, 5);
  });

  it("shakes deterministically and decays to nothing", () => {
    expect(shakeOffset(3, 0.2, 8)).toEqual(shakeOffset(3, 0.2, 8));
    const early = shakeOffset(3, 0.1, 8);
    const late = shakeOffset(3, 0.95, 8);
    expect(Math.hypot(early.x, early.y)).toBeGreaterThan(Math.hypot(late.x, late.y));
    expect(Math.hypot(...Object.values(shakeOffset(3, 1, 8)))).toBeCloseTo(0, 5);
  });
});
