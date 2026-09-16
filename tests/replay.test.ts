import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS_BY_ID } from "../src/lib/game/maps";
import { EVENTS_BY_ID } from "../src/lib/game/events";
import {
  LEGACY_REPLAY_VERSION,
  REPLAY_VERSION,
  canShowHealth,
  toReplay,
  type ReplayContext,
  type ToReplayOptions,
} from "../src/lib/game/replay";
import type { BattleResult } from "../src/lib/game/types";

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const map = MAPS_BY_ID["open-field"] ?? Object.values(MAPS_BY_ID)[0];
const event = EVENTS_BY_ID["close-quarters"] ?? Object.values(EVENTS_BY_ID)[0];

const marvel = CHARACTERS.filter((c) => c.categoryId === "marvel");

const teamA = {
  playerId: "player-a",
  nickname: "Ege",
  characters: marvel.slice(0, 5).map((c, i) => ({ characterId: c.id, price: 4 + i * 3 })),
  formation: "AGGRESSIVE" as const,
};
const teamB = {
  playerId: "player-b",
  nickname: "Mikail",
  characters: marvel.slice(5, 10).map((c, i) => ({ characterId: c.id, price: 6 + i * 2 })),
  formation: "DEFENSIVE" as const,
};

const context: ReplayContext = {
  battleId: "battle-1",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

const run = (seed: string): BattleResult =>
  simulateBattle({
    teams: [teamA, teamB],
    map,
    event,
    charactersById: CHARACTERS_BY_ID,
    seed,
    categoryIds: ["marvel"],
    bands: BANDS,
  });

/** A V4 result: strip every field V5 added. */
function asLegacy(result: BattleResult): BattleResult {
  return {
    ...result,
    rulesVersion: undefined,
    combatants: result.combatants.map(({ maxHp: _drop, ...rest }) => rest),
    log: result.log.map(({ hpAfter: _drop, ...rest }) => rest),
  };
}

describe("the adapter is a projection, not a decision", () => {
  it("is deterministic", () => {
    const result = run("replay-1");
    expect(toReplay(result, context)).toEqual(toReplay(result, context));
  });

  it("does not mutate its input", () => {
    const result = run("replay-2");
    const before = structuredClone(result);
    toReplay(result, context);
    expect(result).toEqual(before);
  });

  it("changes nothing the server decided", () => {
    const result = run("replay-3");
    const replay = toReplay(result, context);

    expect(replay.winnerPlayerId).toBe(result.winnerPlayerId);
    expect(replay.upset).toBe(Boolean(result.upset));
    expect(replay.turningPoint).toEqual(result.turningPoint);
    expect(replay.mvp).toEqual(result.mvp);
    expect(replay.teams.map((t) => [t.playerId, t.rank])).toEqual(
      result.teams.map((t) => [t.playerId, t.rank]),
    );
  });

  it("carries the seed, map, event and duration across unchanged", () => {
    const result = run("replay-4");
    const replay = toReplay(result, context);
    expect(replay.seed).toBe(result.seed);
    expect(replay.mapId).toBe(result.mapId);
    expect(replay.eventId).toBe(result.eventId);
    expect(replay.durationMs).toBe(result.durationMs);
  });
});

describe("events", () => {
  it("plays in non-decreasing time order", () => {
    const times = toReplay(run("replay-5"), context).events.map((e) => e.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("spawns every combatant before anything happens to them", () => {
    const replay = toReplay(run("replay-6"), context);
    const spawned = new Set(
      replay.events.filter((e) => e.kind === "SPAWN").map((e) => e.actorId),
    );
    expect(spawned.size).toBe(replay.combatants.length);
    for (const c of replay.combatants) expect(spawned.has(c.characterId)).toBe(true);

    // Nobody is eliminated before they exist.
    const firstNonSpawn = replay.events.findIndex((e) => e.kind !== "SPAWN");
    const kos = replay.events.filter((e) => e.kind === "ELIMINATION");
    for (const ko of kos) {
      expect(replay.events.indexOf(ko)).toBeGreaterThan(firstNonSpawn - 1);
      expect(spawned.has(ko.targetId!)).toBe(true);
    }
  });

  it("copies damage across without reinterpreting it", () => {
    const result = run("replay-7");
    const replay = toReplay(result, context);

    // The same relationship the existing model already defines: what the
    // engine logged per hit adds up to what it reported per character.
    const dealt = new Map<string, number>();
    for (const e of replay.events) {
      if (!e.damage || !e.actorId) continue;
      dealt.set(e.actorId, (dealt.get(e.actorId) ?? 0) + e.damage);
    }
    for (const c of result.combatants) {
      expect(dealt.get(c.characterId) ?? 0).toBe(c.damageDealt);
    }
  });

  it("gives every event an animation and marks the loud ones", () => {
    const replay = toReplay(run("replay-8"), context);
    for (const e of replay.events) expect(e.animation).toBeTruthy();
    expect(replay.events.some((e) => e.emphasis)).toBe(true);
    expect(replay.events.find((e) => e.kind === "SPECIAL")?.animation ?? "CAST").toBe("CAST");
  });

  it("makes the right person die, and the right person block", () => {
    const replay = toReplay(run("replay-9"), context);

    // The engine logs the killer as the actor on an ELIMINATION. Playing the
    // actor's animation there would have the killer fall over.
    const kill = replay.events.find((e) => e.kind === "ELIMINATION")!;
    expect(kill.animation).toBe("ATTACK");
    expect(kill.targetAnimation).toBe("DEATH");

    const block = replay.events.find((e) => e.kind === "BLOCK");
    if (block) {
      expect(block.animation).toBe("ATTACK");
      expect(block.targetAnimation).toBe("GUARD");
    }

    // Everyone on the receiving end of a hit flinches.
    const hit = replay.events.find((e) => e.kind === "ATTACK" && e.targetId)!;
    expect(hit.targetAnimation).toBe("IMPACT");
  });
});

describe("health", () => {
  it("stays inside zero and maxHp", () => {
    for (const seed of ["hp-1", "hp-2", "hp-3", "hp-4"]) {
      const result = run(seed);
      const replay = toReplay(result, context);
      const max = new Map(replay.combatants.map((c) => [c.characterId, c.maxHp!]));

      for (const e of replay.events) {
        if (typeof e.hpAfter !== "number") continue;
        expect(e.hpAfter).toBeGreaterThanOrEqual(0);
        expect(e.hpAfter).toBeLessThanOrEqual(max.get(e.targetId!)!);
      }
    }
  });

  it("reports hpAfter on every damaging event and on no other", () => {
    const replay = toReplay(run("hp-5"), context);
    for (const e of replay.events) {
      if (typeof e.damage === "number") expect(typeof e.hpAfter).toBe("number");
      else expect(e.hpAfter).toBeUndefined();
    }
  });

  it("agrees with the final survival the engine reported", () => {
    const result = run("hp-6");
    const replay = toReplay(result, context);

    // Last reported HP for a character who died must be zero, and for a
    // survivor must match the engine's own survivalPct.
    for (const c of result.combatants) {
      const hits = replay.events.filter(
        (e) => e.targetId === c.characterId && typeof e.hpAfter === "number",
      );
      if (hits.length === 0) continue;
      const last = hits[hits.length - 1].hpAfter!;
      if (!c.survived) expect(last).toBe(0);
      else expect(Math.round((last / c.maxHp!) * 1000) / 10).toBeCloseTo(c.survivalPct, 1);
    }
  });
});

describe("combatants", () => {
  it("lists each character once", () => {
    const replay = toReplay(run("who-1"), context);
    const ids = replay.combatants.map((c) => c.characterId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts an aggressive team further forward than a defensive one", () => {
    const replay = toReplay(run("who-2"), context);
    const front = (team: string) =>
      replay.combatants.filter((c) => c.teamId === team && c.lane === "FRONT").length;
    expect(front("player-a")).toBeGreaterThan(front("player-b"));
  });

  it("gives everybody a lane even when the formation is unknown", () => {
    const replay = toReplay(run("who-3"), {
      battleId: "b",
      players: [{ playerId: "player-a", nickname: "A" }, { playerId: "player-b", nickname: "B" }],
    });
    for (const c of replay.combatants) {
      expect(["FRONT", "MID", "BACK"]).toContain(c.lane);
    }
  });
});

describe("battles recorded before V5", () => {
  it("are marked as legacy rather than repaired", () => {
    const replay = toReplay(asLegacy(run("old-1")), context);
    expect(replay.replayVersion).toBe(LEGACY_REPLAY_VERSION);
    expect(replay.rulesVersion).toBeUndefined();
    expect(canShowHealth(replay)).toBe(false);
  });

  it("invent no health at all", () => {
    const replay = toReplay(asLegacy(run("old-2")), context);
    for (const c of replay.combatants) expect(c.maxHp).toBeUndefined();
    for (const e of replay.events) expect(e.hpAfter).toBeUndefined();
  });

  it("still play: the timeline, damage and result survive", () => {
    const result = asLegacy(run("old-3"));
    const replay = toReplay(result, context);
    expect(replay.events.length).toBeGreaterThan(10);
    expect(replay.events.some((e) => typeof e.damage === "number")).toBe(true);
    expect(replay.winnerPlayerId).toBe(result.winnerPlayerId);
    expect(replay.durationMs).toBe(result.durationMs);
  });

  it("are told apart from current ones", () => {
    expect(canShowHealth(toReplay(run("old-4"), context))).toBe(true);
    expect(toReplay(run("old-4"), context).replayVersion).toBe(REPLAY_VERSION);
  });
});

describe("durationOverrideMs compresses the timeline", () => {
  const OVERRIDE = 18_000;
  const opts: ToReplayOptions = { durationOverrideMs: OVERRIDE };

  it("sets durationMs to the override value", () => {
    const replay = toReplay(run("override-1"), context, opts);
    expect(replay.durationMs).toBe(OVERRIDE);
  });

  it("clamps every event atMs within the override window", () => {
    const replay = toReplay(run("override-2"), context, opts);
    for (const e of replay.events) {
      expect(e.atMs).toBeGreaterThanOrEqual(0);
      expect(e.atMs).toBeLessThanOrEqual(OVERRIDE);
    }
  });

  it("preserves event order after scaling", () => {
    const replay = toReplay(run("override-3"), context, opts);
    const times = replay.events.map((e) => e.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("winner and other game facts are unchanged", () => {
    const result = run("override-4");
    const replay = toReplay(result, context, opts);
    expect(replay.winnerPlayerId).toBe(result.winnerPlayerId);
    expect(replay.events.filter((e) => e.kind === "ELIMINATION").length).toBe(
      result.log.filter((e) => e.kind === "ELIMINATION").length,
    );
  });

  it("leaves durationMs untouched when no override is given", () => {
    const result = run("override-5");
    expect(toReplay(result, context).durationMs).toBe(result.durationMs);
  });

  it("does not mutate the source result", () => {
    const result = run("override-6");
    const before = structuredClone(result);
    toReplay(result, context, opts);
    expect(result).toEqual(before);
  });
});
