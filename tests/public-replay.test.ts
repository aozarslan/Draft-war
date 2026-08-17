import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { playerColor } from "../src/lib/game/colors";
import { canShowHealth, type ProjectableResult } from "../src/lib/game/replay";
import { buildStage, elapsedFor } from "../src/lib/render/stage";
import { sceneAt } from "../src/lib/render/scene";
import { summaryOf } from "../src/lib/render/summary";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * A shared match plays the same battle the players watched.
 * ---------------------------------------------------------------------------
 * The public page and the live room differ in exactly one thing: where the
 * clock comes from. A live battle reads the server's timestamp because four
 * phones have to stay in step; a finished one has nobody to stay in step with
 * and gets play, pause and a scrub bar.
 *
 * Everything else has to be identical, and the way to be sure of that is not
 * to write it twice. These tests drive the *same* `buildStage` with the subset
 * of fields the public endpoint forwards, and require the scene at a given
 * elapsed to match the live one exactly.
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

const PLAYERS = [
  { id: "player-a", nickname: "Ege", formation: "AGGRESSIVE", colorHex: playerColor(0).hex },
  { id: "player-b", nickname: "Mikail", formation: "DEFENSIVE", colorHex: playerColor(1).hex },
];

/**
 * The payload `dw_public_match` really returns, in the shape it really
 * returns it.
 *
 * This mirrors the endpoint faithfully — and the faithful part that matters is
 * that the battlefield fields sit at the **top level**, beside the match,
 * while everything else sits inside `result`. Modelling it as one flat object
 * is what let a page ship that read `result.categoryIds`, found `undefined`,
 * and crashed on the first real match: the test agreed with the bug because
 * both had the same wrong idea of the payload.
 */
function publicPayload(result: BattleResult) {
  return {
    categoryIds: result.categoryIds,
    mapId: result.mapId,
    eventId: result.eventId,
    result: {
      seed: result.seed,
      durationMs: result.durationMs,
      rulesVersion: result.rulesVersion,
      log: result.log,
      teams: result.teams,
      combatants: result.combatants,
      winnerPlayerId: result.winnerPlayerId,
      upset: result.upset,
      turningPoint: result.turningPoint,
      mvp: result.mvp,
      awards: result.awards,
    },
  };
}

/** The join the page performs, mirrored here so the test exercises it too. */
function publicResult(result: BattleResult): ProjectableResult {
  const payload = publicPayload(result);
  return {
    ...payload.result,
    categoryIds: payload.categoryIds,
    mapId: payload.mapId,
    eventId: payload.eventId,
  };
}

const stageOf = (result: ProjectableResult) =>
  buildStage({
    battleId: "game-1",
    result,
    players: PLAYERS,
    charactersById: CHARACTERS_BY_ID,
  })!;

describe("the endpoint forwards what playback needs", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/0029_public_replay_playback.sql"),
    "utf8",
  );

  it("sends durationMs, without which a local clock has no end", () => {
    expect(migration).toContain("'durationMs', v_result->'durationMs'");
  });

  it("still sends the log and the combatants", () => {
    expect(migration).toContain("'log', v_result->'log'");
    expect(migration).toContain("'combatants', v_result->'combatants'");
  });

  it("keeps the battlefield fields at the top level, beside the match", () => {
    // Where they live is not cosmetic: the page has to join them onto the
    // result before projecting, and assuming otherwise crashed the first real
    // match this page was pointed at.
    expect(migration).toContain("'categoryIds', to_jsonb(g.category_ids)");
    expect(migration).toContain("'mapId', g.map_id");
    const resultBlock = migration.slice(migration.indexOf("'result', jsonb_build_object"));
    expect(resultBlock).not.toContain("categoryIds");
  });

  it("still refuses a match that has not finished", () => {
    expect(migration).toContain("MATCH_UNFINISHED");
    expect(migration).toContain("battle_result is null");
  });

  it("stays read-only", () => {
    // A `stable` function cannot write. Nothing about a shared link may
    // mutate a match.
    expect(migration).toContain("stable security definer");
    for (const write of ["insert into", "update ", "delete from"]) {
      expect(migration.toLowerCase()).not.toContain(write);
    }
  });

  it("adds no column and creates no table", () => {
    const lowered = migration.toLowerCase();
    expect(lowered).not.toContain("alter table");
    expect(lowered).not.toContain("create table");
  });
});

describe("the public page stages the same battle", () => {
  const result = battle("pub-1");
  const live = stageOf(result);
  const shared = stageOf(publicResult(result));

  it("keeps all ten combatants, five a side", () => {
    expect(shared.replay.combatants).toHaveLength(10);
    expect(shared.replay.combatants.filter((c) => c.teamId === "player-a")).toHaveLength(5);
    expect(shared.replay.combatants.filter((c) => c.teamId === "player-b")).toHaveLength(5);
  });

  it("produces the very same replay from the forwarded subset", () => {
    expect(shared.replay).toEqual(live.replay);
  });

  it("draws the same scene at the same elapsed", () => {
    // The acceptance criterion of the whole slice: only the clock differs.
    for (const t of [0, 4_000, 15_000, 26_000, shared.durationMs]) {
      expect(sceneAt(shared.replay, t)).toEqual(sceneAt(live.replay, t));
    }
  });

  it("loses nobody over the course of playback", () => {
    for (let t = 0; t <= shared.durationMs; t += 900) {
      expect(sceneAt(shared.replay, t).combatants).toHaveLength(10);
    }
  });

  it("summarises identically to the live results screen", () => {
    expect(summaryOf(shared.replay)).toEqual(summaryOf(live.replay));
  });
});

describe("the local clock", () => {
  const stage = stageOf(publicResult(battle("pub-2")));

  it("reaches the final frame at the duration", () => {
    const end = sceneAt(stage.replay, stage.durationMs);
    expect(end.finished).toBe(true);
    expect(end.banner?.kind).toBe("VICTORY");
    expect(end.outro).toBe(1);
    expect(end.mvpCharacterId).toBe(stage.replay.mvp!.characterId);
  });

  it("holds that frame rather than running the outro on", () => {
    // `sceneAt` itself does not clamp — it answers honestly for any time, and
    // the clock is what stops. So the picture past the end is identical in
    // everything except the clock reading it was given.
    const { elapsedMs: _end, ...endFrame } = sceneAt(stage.replay, stage.durationMs);
    const { elapsedMs: _past, ...pastFrame } = sceneAt(
      stage.replay,
      stage.durationMs + 60_000,
    );
    expect(pastFrame).toEqual(endFrame);
  });

  it("clamps the clock so the renderer is never asked past the end", () => {
    // The clamping belongs to the clock, and both clocks do it: the live
    // helper here, and `useLocalPlayback` for a finished match.
    expect(elapsedFor("2026-01-01T00:00:00.000Z", Date.now(), stage.durationMs)).toBe(
      stage.durationMs,
    );
  });

  it("seeks deterministically: the same moment is the same picture", () => {
    const at = sceneAt(stage.replay, 12_345);
    sceneAt(stage.replay, 30_000);
    sceneAt(stage.replay, 1_000);
    expect(sceneAt(stage.replay, 12_345)).toEqual(at);
  });

  it("is not the server clock", () => {
    // Why a finished match needs its own clock at all: fed through the live
    // helper, a battle from 2020 opens on its final frame, forever.
    const longAgo = "2020-01-01T00:00:00.000Z";
    expect(elapsedFor(longAgo, Date.now(), stage.durationMs)).toBe(stage.durationMs);
  });
});

describe("a payload from before the migration degrades, rather than breaking", () => {
  it("stages, but reports no duration to play against", () => {
    // The field arrives as `undefined`, not as zero — and `undefined <= 0` is
    // false, so the obvious guard would have let it through to a canvas stuck
    // on frame zero. The page withholds the arena instead.
    const raw = battle("pub-old");
    const old = { ...publicResult(raw), durationMs: undefined as unknown as number };
    const stage = buildStage({
      battleId: "game-1",
      result: old,
      players: PLAYERS,
      charactersById: CHARACTERS_BY_ID,
    });

    expect(stage).not.toBeNull();
    expect(stage!.durationMs > 0).toBe(false);
    // The rest of the page is unaffected: the summary still answers.
    expect(summaryOf(stage!.replay).winner).toBeTruthy();
  });
});

describe("a match recorded before V5 still plays when shared", () => {
  const raw = battle("pub-legacy");
  const legacy: ProjectableResult = {
    ...publicResult(raw),
    rulesVersion: undefined,
    combatants: raw.combatants.map(({ maxHp: _drop, ...rest }) => rest),
    log: raw.log.map(({ hpAfter: _drop, ...rest }) => rest),
  };
  const stage = stageOf(legacy);

  it("stages, and is marked legacy", () => {
    expect(stage.replay.replayVersion).toBe(0);
    expect(canShowHealth(stage.replay)).toBe(false);
  });

  it("shows no health bars, and invents none", () => {
    const scene = sceneAt(stage.replay, Math.round(stage.durationMs / 2));
    expect(scene.showHealth).toBe(false);
    for (const c of scene.combatants) {
      expect(c.health).toBeNull();
      expect(c.healthTrail).toBeNull();
    }
  });

  it("still shows the attacks, the deaths and the result", () => {
    const hit = stage.replay.events.find((e) => typeof e.damage === "number")!;
    expect(sceneAt(stage.replay, hit.atMs + 60).effects.some((e) => e.value === hit.damage))
      .toBe(true);

    const end = sceneAt(stage.replay, stage.durationMs);
    expect(end.combatants.some((c) => !c.alive)).toBe(true);
    expect(end.banner?.kind).toBe("VICTORY");
    expect(end.mvpCharacterId).toBe(stage.replay.mvp!.characterId);
  });
});
