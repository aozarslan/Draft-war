import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { ARENA, MAX_CAMERA_OFFSET, sceneAt, type Scene } from "../src/lib/render/scene";
import { ParticlePool } from "../src/lib/render/particles";

/**
 * ---------------------------------------------------------------------------
 * Can you read the fight?
 * ---------------------------------------------------------------------------
 * M6's goal is that someone watching the animation alone can answer: who
 * attacked, who they hit, how hard, whether it was blocked or critical, who
 * died, where it turned, who the MVP was, and who won. These tests assert the
 * scene actually carries each of those, on real 5v5 battles.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);
const animals = CHARACTERS.filter((c) => c.categoryId === "animals");

const ROSTER_A = [
  "animals-african-bush-elephant",
  "animals-green-anaconda",
  "animals-golden-eagle",
  "animals-honey-badger",
  "animals-western-gorilla",
];
const ROSTER_B = [
  "animals-orca",
  "animals-tiger",
  "animals-black-mamba",
  "animals-common-ostrich",
  "animals-wolverine",
];

const pick = (ids: string[]) =>
  ids.map((id, i) => {
    if (!animals.some((c) => c.id === id)) throw new Error(`${id} missing`);
    return { characterId: id, price: 4 + i * 3 };
  });

const context: ReplayContext = {
  battleId: "readability",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

const replayOf = (seed: string, opponents = ROSTER_B): Replay =>
  toReplay(
    simulateBattle({
      teams: [
        { playerId: "player-a", nickname: "Ege", characters: pick(ROSTER_A), formation: "AGGRESSIVE" },
        { playerId: "player-b", nickname: "Mikail", characters: pick(opponents), formation: "DEFENSIVE" },
      ],
      map: MAPS[0],
      event: EVENT_CARDS[0],
      charactersById: CHARACTERS_BY_ID,
      seed,
      categoryIds: ["animals"],
      bands: BANDS,
    }),
    context,
  );

/** The seed that produces a genuine upset, from M5. */
const UPSET = replayOf("u17", [
  "animals-lion",
  "animals-african-buffalo",
  "animals-leopard",
  "animals-common-ostrich",
  "animals-wolverine",
]);

const combatant = (scene: Scene, id: string) =>
  scene.combatants.find((c) => c.characterId === id)!;

const range = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
};

describe("who attacked, and who they hit", () => {
  const replay = replayOf("read-1");

  it("winds the attacker up before the blow lands, not after", () => {
    // The engine's atMs is the moment of contact. A swing that *starts* then
    // drops the health bar before the attacker has moved.
    const hit = replay.events.find((e) => e.kind === "ATTACK" && e.actorId && e.targetId)!;
    const before = combatant(sceneAt(replay, hit.atMs - 120), hit.actorId!);
    expect(before.animation).toBe("ATTACK");
    expect(before.animationProgress).toBeLessThan(0.5);

    const atContact = combatant(sceneAt(replay, hit.atMs), hit.actorId!);
    expect(atContact.animationProgress).toBeGreaterThan(0.35);
  });

  it("does not apply the blow before its timestamp", () => {
    const hit = replay.events.find(
      (e) => typeof e.hpAfter === "number" && e.targetId,
    )!;
    const early = combatant(sceneAt(replay, hit.atMs - 1), hit.targetId!);
    const landed = combatant(sceneAt(replay, hit.atMs), hit.targetId!);
    expect(early.hp).not.toBe(hit.hpAfter);
    expect(landed.hp).toBe(hit.hpAfter);
  });

  it("lunges the attacker toward the character it is actually hitting", () => {
    const hit = replay.events.find((e) => e.kind === "ATTACK" && e.actorId && e.targetId)!;
    const scene = sceneAt(replay, hit.atMs);
    const actor = combatant(scene, hit.actorId!);
    const target = combatant(scene, hit.targetId!);

    // The lunge must close the distance, not merely point down-field.
    const restGap = Math.hypot(target.x - actor.x, target.y - actor.y);
    const lungedGap = Math.hypot(
      target.x - (actor.x + actor.lunge),
      target.y - (actor.y + actor.lungeY),
    );
    expect(lungedGap).toBeLessThan(restGap);
  });

  it("draws a line back to whoever threw the blow", () => {
    const hit = replay.events.find((e) => e.kind === "ATTACK" && e.actorId && e.targetId)!;
    const effect = sceneAt(replay, hit.atMs + 60).effects.find((e) => e.kind === "HIT");
    expect(effect).toBeTruthy();
    expect(effect!.fromX).not.toBeNull();
    expect(effect!.fromY).not.toBeNull();

    const actor = combatant(sceneAt(replay, hit.atMs + 60), hit.actorId!);
    expect(effect!.fromX).toBeCloseTo(actor.x, 5);
  });
});

describe("telling the kinds of blow apart", () => {
  const replay = replayOf("read-2");

  const effectAt = (kind: string) => {
    const event = replay.events.find((e) => e.kind === kind);
    if (!event) return null;
    return sceneAt(replay, event.atMs + 60).effects;
  };

  it("gives every kind its own effect", () => {
    const seen = new Map<string, string>();
    for (const [event, effect] of [
      ["ATTACK", "HIT"], ["CRIT", "CRIT"], ["SPECIAL", "SPECIAL"],
      ["BLOCK", "GUARD"], ["ELIMINATION", "DEATH"],
    ]) {
      const effects = effectAt(event);
      if (!effects) continue;
      expect(effects.some((e) => e.kind === effect), `${event} → ${effect}`).toBe(true);
      seen.set(event, effect);
    }
    // All five occur in a real battle; if one stopped, this test would quietly
    // stop checking it.
    expect(seen.size).toBe(5);
  });

  it("marks a block as blocked and still reports its damage", () => {
    const block = replay.events.find((e) => e.kind === "BLOCK")!;
    const guard = sceneAt(replay, block.atMs + 60).effects.find((e) => e.kind === "GUARD")!;
    expect(guard.blocked).toBe(true);
    expect(guard.value).toBe(block.damage);
  });

  it("makes the blocker guard toward the attacker before the blow arrives", () => {
    const block = replay.events.find((e) => e.kind === "BLOCK")!;
    const early = combatant(sceneAt(replay, block.atMs - 80), block.targetId!);
    expect(early.animation).toBe("GUARD");
  });

  it("glows at the caster as well as the target on a special", () => {
    const special = replay.events.find((e) => e.kind === "SPECIAL" && e.actorId)!;
    const effects = sceneAt(replay, special.atMs + 60).effects;
    const cast = effects.find((e) => e.kind === "CAST");
    expect(cast).toBeTruthy();
    const actor = combatant(sceneAt(replay, special.atMs + 60), special.actorId!);
    expect(cast!.x).toBeCloseTo(actor.x, 5);
  });

  it("does not shake the camera on a block", () => {
    // A block is the absence of impact; shaking would read as a bigger hit.
    const block = replay.events.find((e) => e.kind === "BLOCK")!;
    const quiet = replay.events.filter(
      (e) => Math.abs(e.atMs - block.atMs) < 400 && e.kind !== "BLOCK" && e.emphasis,
    );
    if (quiet.length > 0) return; // another loud event overlaps; nothing to prove
    const scene = sceneAt(replay, block.atMs + 20);
    expect(Math.hypot(scene.camera.x - 160, scene.camera.y - 90)).toBeLessThan(1);
  });
});

describe("health reads as damage", () => {
  const replay = replayOf("read-3");

  it("keeps the trailing bar at or above the real one, always", () => {
    for (let t = 0; t <= replay.durationMs; t += 90) {
      for (const c of sceneAt(replay, t).combatants) {
        if (c.health === null || c.healthTrail === null) continue;
        expect(c.healthTrail).toBeGreaterThanOrEqual(c.health - 1e-9);
        expect(c.healthTrail).toBeLessThanOrEqual(1);
      }
    }
  });

  it("opens a gap the size of the blow, then closes it", () => {
    const hit = replay.events.find(
      (e) => typeof e.damage === "number" && e.damage > 12 && e.targetId,
    )!;
    const justAfter = combatant(sceneAt(replay, hit.atMs + 20), hit.targetId!);
    const settled = combatant(sceneAt(replay, hit.atMs + 900), hit.targetId!);

    expect(justAfter.healthTrail! - justAfter.health!).toBeGreaterThan(0);
    expect(settled.healthTrail! - settled.health!).toBeCloseTo(0, 5);
  });

  it("still shows nothing at all on a pre-V5 replay", () => {
    const legacy: Replay = {
      ...replay,
      replayVersion: 0,
      combatants: replay.combatants.map(({ maxHp: _d, ...rest }) => rest),
      events: replay.events.map(({ hpAfter: _d, ...rest }) => rest),
    };
    for (const c of sceneAt(legacy, Math.round(legacy.durationMs / 2)).combatants) {
      expect(c.health).toBeNull();
      expect(c.healthTrail).toBeNull();
    }
  });
});

describe("leaving the field", () => {
  const replay = replayOf("read-4");

  it("plays the death animation first, then clears the body away", () => {
    const kill = replay.events.find((e) => e.kind === "ELIMINATION")!;
    const dying = combatant(sceneAt(replay, kill.atMs + 200), kill.targetId!);
    const gone = combatant(sceneAt(replay, kill.atMs + 2600), kill.targetId!);

    expect(dying.animation).toBe("DEATH");
    expect(dying.sink).toBe(0);
    expect(dying.opacity).toBe(1);

    expect(gone.sink).toBeGreaterThan(0.9);
    expect(gone.opacity).toBeLessThan(0.25);
  });

  it("never revives anyone as the clock runs on", () => {
    const kill = replay.events.find((e) => e.kind === "ELIMINATION")!;
    for (let t = kill.atMs; t <= replay.durationMs; t += 250) {
      expect(combatant(sceneAt(replay, t), kill.targetId!).alive).toBe(false);
    }
  });

  it("does not flinch a corpse when something lands near it", () => {
    const kill = replay.events.find((e) => e.kind === "ELIMINATION")!;
    for (let t = kill.atMs + 800; t <= replay.durationMs; t += 200) {
      expect(combatant(sceneAt(replay, t), kill.targetId!).animation).toBe("DEATH");
    }
  });
});

describe("the loud moments", () => {
  it("turns a turning point into a short cinematic", () => {
    const replay = ["read-1", "read-2", "read-3", "read-4", "read-5", "read-6"]
      .map((s) => replayOf(s))
      .find((r) => r.events.some((e) => e.kind === "TURNING_POINT"));
    expect(replay, "no turning point in six real battles").toBeTruthy();

    const event = replay!.events.find((e) => e.kind === "TURNING_POINT")!;
    const during = sceneAt(replay!, event.atMs + 200);
    expect(during.cinematic?.kind).toBe("TURNING_POINT");
    expect(during.camera.zoom).toBeGreaterThan(1);

    // Short: gone well before the next round would start.
    expect(sceneAt(replay!, event.atMs + 1400).cinematic?.kind).not.toBe("TURNING_POINT");
  });

  it("stamps an upset over the closing beat, and only on an upset", () => {
    expect(UPSET.upset).toBe(true);
    const end = sceneAt(UPSET, UPSET.durationMs);
    expect(end.cinematic?.kind).toBe("UPSET");

    const ordinary = replayOf("read-1");
    expect(ordinary.upset).toBe(false);
    expect(sceneAt(ordinary, ordinary.durationMs).cinematic).toBeNull();
  });

  it("holds the upset stamp to the last frame instead of fading it out", () => {
    // It faded on the same curve as a turning point and had vanished by the
    // time playback stopped — the same mistake the victory banner made.
    expect(sceneAt(UPSET, UPSET.durationMs).cinematic!.intensity).toBe(1);
    expect(sceneAt(UPSET, UPSET.durationMs - 200).cinematic!.intensity).toBe(1);
  });

  it("fades a turning point back out, because the battle carries on", () => {
    const replay = ["read-1", "read-2", "read-3", "read-4", "read-5", "read-6"]
      .map((s) => replayOf(s))
      .find((r) => r.events.some((e) => e.kind === "TURNING_POINT"))!;
    const event = replay.events.find((e) => e.kind === "TURNING_POINT")!;

    expect(sceneAt(replay, event.atMs + 550).cinematic!.intensity).toBe(1);
    expect(sceneAt(replay, event.atMs + 1050).cinematic!.intensity).toBeLessThan(0.3);
    expect(sceneAt(replay, event.atMs + 1400).cinematic).toBeNull();
  });

  it("shows no cinematic during ordinary exchanges", () => {
    const replay = replayOf("read-1");
    let seen = 0;
    for (let t = 0; t < replay.durationMs * 0.8; t += 120) {
      if (sceneAt(replay, t).cinematic) seen++;
    }
    // A turning point may fire; an upset must not, and neither may anything
    // else. Well under a tenth of the battle.
    expect(seen).toBeLessThan((replay.durationMs * 0.8) / 120 / 10);
  });
});

describe("shake and particles under load", () => {
  it("never strays further than the ground is drawn, however dense the fight", () => {
    // The bound is not arbitrary: the draw layer fills the arena to exactly
    // this margin, so a camera that exceeded it would show a bare strip.
    for (const seed of ["read-1", "read-2", "read-3", "read-4"]) {
      const replay = replayOf(seed);
      for (let t = 0; t <= replay.durationMs; t += 30) {
        const { camera } = sceneAt(replay, t);
        const offset = Math.hypot(camera.x - ARENA.width / 2, camera.y - ARENA.height / 2);
        expect(offset, `${seed} at ${t}ms`).toBeLessThanOrEqual(MAX_CAMERA_OFFSET + 1e-6);
        expect(camera.zoom).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it("actually reaches that bound, so the clamp is doing something", () => {
    let peak = 0;
    for (const seed of ["read-1", "read-2", "read-3", "read-4"]) {
      const replay = replayOf(seed);
      for (let t = 0; t <= replay.durationMs; t += 30) {
        const { camera } = sceneAt(replay, t);
        peak = Math.max(
          peak,
          Math.hypot(camera.x - ARENA.width / 2, camera.y - ARENA.height / 2),
        );
      }
    }
    expect(peak).toBeGreaterThan(MAX_CAMERA_OFFSET * 0.9);
  });

  /**
   * A real battle's events, jammed into a fraction of the time.
   *
   * The engine currently spaces its loud beats out — across six battles no two
   * land within 320ms — so no real replay exercises what happens when they
   * pile up. Compressing the timeline is the only honest way to test the
   * density behaviour without inventing a battle result: every event, actor,
   * target and number is the engine's, only the spacing is artificial.
   */
  const compressed = (replay: Replay, factor: number): Replay => ({
    ...replay,
    durationMs: Math.round(replay.durationMs / factor),
    events: replay.events.map((e) => ({ ...e, atMs: Math.round(e.atMs / factor) })),
  });

  it("holds the bound when every blow in a battle lands within a few seconds", () => {
    const dense = compressed(replayOf("read-2"), 12);
    let peak = 0;
    for (let t = 0; t <= dense.durationMs; t += 10) {
      const { camera } = sceneAt(dense, t);
      peak = Math.max(
        peak,
        Math.hypot(camera.x - ARENA.width / 2, camera.y - ARENA.height / 2),
      );
      expect(camera.zoom).toBeLessThanOrEqual(1.25);
    }
    expect(peak).toBeLessThanOrEqual(MAX_CAMERA_OFFSET + 1e-6);
  });

  it("does not let a lesser blow cut a bigger one's shake short", () => {
    // A loud event, then a much quieter one 25ms later while the first is
    // still near full strength. Taking the most recent shake rather than the
    // loudest would drop the camera from an elimination to a weaker special,
    // so the biggest moment in the battle would land softer than the beat
    // after it.
    const base = replayOf("read-2");
    const kill = base.events.find((e) => e.kind === "ELIMINATION")!;
    const special = base.events.find((e) => e.kind === "SPECIAL")!;

    const staged: Replay = {
      ...base,
      events: [
        ...base.events.filter((e) => e.kind === "SPAWN"),
        { ...kill, atMs: 5000 },
        { ...special, atMs: 5025 },
      ],
    };
    const alone: Replay = {
      ...base,
      events: [...base.events.filter((e) => e.kind === "SPAWN"), { ...kill, atMs: 5000 }],
    };

    // While the elimination is still the louder of the two, its shake must be
    // unchanged by the quieter blow's arrival. (Late in the decay the special
    // does take over — a fresh small shake genuinely is louder than an almost
    // finished big one, which is the rule working, not failing.)
    for (const t of range(5026, 5170, 12)) {
      expect(sceneAt(staged, t).camera.shake, `at ${t}ms`).toBeCloseTo(
        sceneAt(alone, t).camera.shake,
        9,
      );
    }
    // And the elimination really is the louder of the two, or this proves
    // nothing.
    expect(sceneAt(alone, 5010).camera.shake).toBeGreaterThan(
      sceneAt(
        { ...base, events: [...base.events.filter((e) => e.kind === "SPAWN"), { ...special, atMs: 5000 }] },
        5010,
      ).camera.shake,
    );
  });

  it("stops shaking once a blow's window has passed", () => {
    const base = replayOf("read-2");
    const kill = base.events.find((e) => e.kind === "ELIMINATION")!;
    const staged: Replay = {
      ...base,
      events: [...base.events.filter((e) => e.kind === "SPAWN"), { ...kill, atMs: 5000 }],
    };
    expect(sceneAt(staged, 5010).camera.shake).toBeGreaterThan(0);
    expect(sceneAt(staged, 5400).camera.shake).toBe(0);
    expect(sceneAt(staged, 4990).camera.shake).toBe(0);
  });

  it("stays deterministic at that density", () => {
    const dense = compressed(replayOf("read-2"), 12);
    for (let t = 0; t <= dense.durationMs; t += 23) {
      expect(sceneAt(dense, t)).toEqual(sceneAt(dense, t));
    }
  });

  it("keeps the busiest moment of a battle within the pool", () => {
    const replay = replayOf("read-2");
    // Emit for every emphatic event in the densest second of the battle.
    const pool = new ParticlePool(320);
    const loud = replay.events.filter((e) => e.emphasis);
    for (const [i] of loud.entries()) {
      pool.burst({ x: 100, y: 90, count: 24, color: "#fff", seed: i + 1 });
    }
    expect(pool.active).toBeLessThanOrEqual(320);
    expect(loud.length).toBeGreaterThan(10);
  });
});

describe("the ending, tied to the replay's own clock", () => {
  it("crowns the engine's MVP and only after the fight", () => {
    const replay = replayOf("read-5");
    expect(sceneAt(replay, Math.round(replay.durationMs * 0.5)).mvpCharacterId).toBeNull();
    expect(sceneAt(replay, replay.durationMs).mvpCharacterId).toBe(replay.mvp!.characterId);
  });

  it("finishes the closing beat inside the replay, never past it", () => {
    for (const replay of [replayOf("read-1"), replayOf("read-5"), UPSET]) {
      expect(sceneAt(replay, replay.durationMs).outro).toBe(1);
      expect(sceneAt(replay, replay.durationMs).banner?.kind).toBe("VICTORY");
    }
  });
});

describe("determinism survives all of it", () => {
  const replay = replayOf("read-6");

  it("answers identically however and whenever it is asked", () => {
    const times = [0, 2500, 9000, 17000, 26000, replay.durationMs];
    const forwards = times.map((t) => sceneAt(replay, t));
    const backwards = [...times].reverse().map((t) => sceneAt(replay, t)).reverse();
    expect(backwards).toEqual(forwards);
    expect(sceneAt(replay, 12345)).toEqual(sceneAt(replay, 12345));
  });

  it("holds at fine granularity through the busiest stretch", () => {
    for (let t = 8000; t < 12000; t += 37) {
      expect(sceneAt(replay, t)).toEqual(sceneAt(replay, t));
    }
  });

  it("does not mutate the replay", () => {
    const before = structuredClone(replay);
    for (let t = 0; t <= replay.durationMs; t += 600) sceneAt(replay, t);
    expect(replay).toEqual(before);
  });

  it("returns no bookkeeping fields to the draw layer", () => {
    for (const c of sceneAt(replay, 9000).combatants) {
      for (const key of Object.keys(c)) {
        expect(key.startsWith("_"), `${key} leaked`).toBe(false);
      }
    }
  });
});
