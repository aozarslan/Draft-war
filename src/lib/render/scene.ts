/**
 * ---------------------------------------------------------------------------
 * SCENE (pure)
 * ---------------------------------------------------------------------------
 * The renderer's brain: what does this battle look like at millisecond N?
 *
 * `sceneAt(replay, elapsedMs)` is a pure function. It holds no state, advances
 * nothing, and can be called for any time in any order — scrubbing backwards
 * costs exactly what playing forwards costs. That is the property that keeps
 * two phones frame-aligned: they do not accumulate frames independently, they
 * both ask the same question about the same clock and get the same answer.
 *
 * It decides nothing about the game. Every HP it reports is an `hpAfter` the
 * simulation recorded; every death is an ELIMINATION the simulation logged.
 * What it invents is entirely presentational — where a sprite stands, which
 * animation it is playing, how hard the camera is shaking — and the drawing
 * layer is the only thing that consumes those.
 */

import type { Replay, ReplayEvent, Lane, AnimationHint } from "@/lib/game/replay";
import { clamp01, easeOutBack, easeOutQuad, pingPong, shakeOffset } from "./easing";

/** How long each animation holds before falling back to idle. */
const ANIMATION_MS: Record<AnimationHint, number> = {
  IDLE: 0,
  ATTACK: 420,
  CAST: 620,
  IMPACT: 300,
  GUARD: 360,
  DEATH: 700,
  CHEER: 1200,
  NONE: 0,
};

/** Arena in abstract units. The draw layer scales this to the canvas. */
export const ARENA = { width: 320, height: 180 } as const;

const LANE_X: Record<Lane, number> = { FRONT: 108, MID: 74, BACK: 40 };
const SLOT_SPACING = 26;

export interface SceneCombatant {
  characterId: string;
  teamId: string;
  /** Arena coordinates. Presentation only — the simulation has no space. */
  x: number;
  y: number;
  /** 0..1, or null when the replay cannot show health honestly. */
  health: number | null;
  hp: number | null;
  maxHp: number | null;
  alive: boolean;
  animation: AnimationHint;
  /** 0..1 through the current animation. */
  animationProgress: number;
  /** −1 faces left, +1 faces right. */
  facing: 1 | -1;
  /** Extra forward offset while lunging, in arena units. */
  lunge: number;
  /** 0..1, fades a corpse out after it dies. */
  opacity: number;
  /** 0..1, flashes white when just hit. */
  flash: number;
}

export interface SceneEffect {
  kind: "HIT" | "CRIT" | "SPECIAL" | "GUARD" | "DEATH";
  x: number;
  y: number;
  /** 0..1 through the effect's life. */
  progress: number;
  value?: number;
}

export interface SceneCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface SceneBanner {
  kind: "PHASE" | "TURNING_POINT" | "VICTORY";
  text: string;
  /** 0..1 through the banner's life. */
  progress: number;
}

export interface Scene {
  elapsedMs: number;
  /** True once playback has run past the replay's own duration. */
  finished: boolean;
  showHealth: boolean;
  combatants: SceneCombatant[];
  effects: SceneEffect[];
  camera: SceneCamera;
  banner: SceneBanner | null;
  /** The event being emphasised right now, for the draw layer to react to. */
  focusEventIndex: number | null;
}

const EFFECT_MS = 420;
const BANNER_MS = 1600;
const FLASH_MS = 180;
const CORPSE_FADE_MS = 900;

/**
 * Where a combatant stands.
 *
 * Team order decides the side, lane decides the depth, slot spreads them out.
 * Fully determined by the replay, so the same battle always arranges itself
 * the same way.
 */
function placement(
  lane: Lane,
  slot: number,
  side: 0 | 1,
): { x: number; y: number; facing: 1 | -1 } {
  const depth = LANE_X[lane];
  const x = side === 0 ? depth : ARENA.width - depth;
  const lanePeers = slot;
  const y =
    ARENA.height / 2 +
    ((lanePeers % 3) - 1) * SLOT_SPACING +
    (Math.floor(lanePeers / 3) * SLOT_SPACING) / 2;
  return { x, y, facing: side === 0 ? 1 : -1 };
}

/**
 * Projects the battle onto a moment.
 *
 * Walks the events once, in order, applying everything that has already
 * happened. Linear rather than incremental on purpose: it makes the function
 * total and order-independent, and a battle is a few hundred events, so the
 * cost is irrelevant next to the correctness it buys.
 */
export function sceneAt(replay: Replay, elapsedMs: number): Scene {
  const now = Math.max(0, elapsedMs);
  const showHealth = replay.combatants.every((c) => typeof c.maxHp === "number");

  // Sides, in the order the teams appear, so it is stable across calls.
  const sideOf = new Map<string, 0 | 1>();
  replay.teams.forEach((t, i) => sideOf.set(t.playerId, i === 0 ? 0 : 1));

  const combatants: SceneCombatant[] = replay.combatants.map((c) => {
    const side = sideOf.get(c.teamId) ?? 0;
    const { x, y, facing } = placement(c.lane, c.slot, side);
    return {
      characterId: c.characterId,
      teamId: c.teamId,
      x,
      y,
      health: showHealth ? 1 : null,
      hp: typeof c.maxHp === "number" ? c.maxHp : null,
      maxHp: typeof c.maxHp === "number" ? c.maxHp : null,
      alive: true,
      animation: "IDLE" as AnimationHint,
      animationProgress: 1,
      facing,
      lunge: 0,
      opacity: 1,
      flash: 0,
      // Internal bookkeeping, stripped before returning.
      _animAt: -Infinity,
      _diedAt: null as number | null,
    } as SceneCombatant & { _animAt: number; _diedAt: number | null };
  });

  const byId = new Map(
    (combatants as (SceneCombatant & { _animAt: number; _diedAt: number | null })[]).map(
      (c) => [c.characterId, c],
    ),
  );

  const effects: SceneEffect[] = [];
  let banner: SceneBanner | null = null;
  let focusEventIndex: number | null = null;
  let shake = 0;
  let shakeAt = -Infinity;
  let shakeSeed = 0;

  replay.events.forEach((event, index) => {
    if (event.atMs > now) return;
    const age = now - event.atMs;

    applyEvent(event, index, age, byId, effects, (b) => (banner = b), (s) => {
      shake = s.magnitude;
      shakeAt = event.atMs;
      shakeSeed = index;
    });

    if (event.emphasis && age < EFFECT_MS) focusEventIndex = index;
  });

  // Resolve the derived visual state now that every past event is applied.
  for (const raw of combatants) {
    const c = raw as SceneCombatant & { _animAt: number; _diedAt: number | null };
    const animAge = now - c._animAt;
    const duration = ANIMATION_MS[c.animation] || 1;

    if (c.animation !== "IDLE" && animAge >= duration) {
      c.animation = c.alive ? "IDLE" : "DEATH";
      c.animationProgress = 1;
    } else {
      c.animationProgress = clamp01(animAge / duration);
    }

    // A lunge on attack, an overshoot on cast: read off the same progress.
    if (c.animation === "ATTACK") c.lunge = pingPong(c.animationProgress) * 14 * c.facing;
    else if (c.animation === "CAST") c.lunge = easeOutBack(c.animationProgress) * 6 * c.facing;
    else c.lunge = 0;

    c.flash = c._animAt > -Infinity && animAge < FLASH_MS ? 1 - clamp01(animAge / FLASH_MS) : 0;

    if (!c.alive && c._diedAt !== null) {
      c.opacity = 1 - easeOutQuad(clamp01((now - c._diedAt) / CORPSE_FADE_MS)) * 0.65;
    }

    if (c.maxHp !== null && c.hp !== null) c.health = clamp01(c.hp / c.maxHp);

    delete (c as Partial<{ _animAt: number }>)._animAt;
    delete (c as Partial<{ _diedAt: number | null }>)._diedAt;
  }

  // Camera: centred, nudged toward the focused event, shaking on impact.
  const camera: SceneCamera = { x: ARENA.width / 2, y: ARENA.height / 2, zoom: 1 };
  if (focusEventIndex !== null) {
    const focus = replay.events[focusEventIndex];
    const target = focus.targetId ? byId.get(focus.targetId) : undefined;
    if (target) {
      const t = easeOutQuad(clamp01((now - focus.atMs) / EFFECT_MS));
      camera.x += (target.x - camera.x) * 0.35 * (1 - t);
      camera.y += (target.y - camera.y) * 0.35 * (1 - t);
      camera.zoom = 1 + 0.08 * (1 - t);
    }
  }
  if (shake > 0) {
    const t = clamp01((now - shakeAt) / 320);
    const offset = shakeOffset(shakeSeed, t, shake);
    camera.x += offset.x;
    camera.y += offset.y;
  }

  return {
    elapsedMs: now,
    finished: now >= replay.durationMs,
    showHealth,
    combatants: combatants as SceneCombatant[],
    effects: effects.filter((e) => e.progress < 1),
    camera,
    banner,
    focusEventIndex,
  };
}

/** Applies one past event to the working state. Never reads the clock. */
function applyEvent(
  event: ReplayEvent,
  index: number,
  age: number,
  byId: Map<string, SceneCombatant & { _animAt: number; _diedAt: number | null }>,
  effects: SceneEffect[],
  setBanner: (b: SceneBanner | null) => void,
  setShake: (s: { magnitude: number }) => void,
): void {
  const actor = event.actorId ? byId.get(event.actorId) : undefined;
  const target = event.targetId ? byId.get(event.targetId) : undefined;

  // HP comes from the engine, never from subtracting damage here.
  if (typeof event.hpAfter === "number" && target) target.hp = event.hpAfter;

  if (actor && event.animation !== "NONE" && ANIMATION_MS[event.animation] > 0) {
    if (age < ANIMATION_MS[event.animation]) {
      actor.animation = event.animation;
      actor._animAt = event.atMs;
    }
  }

  switch (event.kind) {
    case "ATTACK":
    case "CRIT":
    case "SPECIAL":
    case "BLOCK": {
      if (target && age < EFFECT_MS) {
        effects.push({
          kind:
            event.kind === "CRIT" ? "CRIT" : event.kind === "SPECIAL" ? "SPECIAL"
            : event.kind === "BLOCK" ? "GUARD" : "HIT",
          x: target.x,
          y: target.y,
          progress: clamp01(age / EFFECT_MS),
          ...(typeof event.damage === "number" ? { value: event.damage } : {}),
        });
        if (target.animation === "IDLE" && age < FLASH_MS) target._animAt = event.atMs;
      }
      if ((event.kind === "CRIT" || event.kind === "SPECIAL") && age < 320) {
        setShake({ magnitude: event.kind === "CRIT" ? 6 : 4 });
      }
      break;
    }

    case "ELIMINATION": {
      if (target) {
        target.alive = false;
        target._diedAt = event.atMs;
        target.animation = "DEATH";
        target._animAt = event.atMs;
      }
      if (age < EFFECT_MS && target) {
        effects.push({ kind: "DEATH", x: target.x, y: target.y, progress: clamp01(age / EFFECT_MS) });
      }
      if (age < 320) setShake({ magnitude: 8 });
      break;
    }

    case "PHASE":
    case "ROUND_START": {
      if (age < BANNER_MS) {
        setBanner({ kind: "PHASE", text: event.text, progress: clamp01(age / BANNER_MS) });
      }
      break;
    }

    case "TURNING_POINT": {
      if (age < BANNER_MS) {
        setBanner({ kind: "TURNING_POINT", text: event.text, progress: clamp01(age / BANNER_MS) });
        if (age < 320) setShake({ magnitude: 10 });
      }
      break;
    }

    case "END": {
      setBanner({ kind: "VICTORY", text: event.text, progress: clamp01(age / BANNER_MS) });
      break;
    }
  }

  void index;
}
