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
 *
 * ## Reading a fight
 *
 * The engine's `atMs` is the moment a blow *lands*. A swing that starts then
 * is unreadable: the health bar drops before the attacker has moved. So the
 * actor's animation is started *early*, by exactly the part of its clip that
 * comes before contact, and the blow lands on the engine's own timestamp. That
 * is the whole trick behind wind-up → contact → recoil, and it costs nothing:
 * the anticipation is still a pure function of the same timestamp.
 */

import type { Replay, ReplayEvent, Lane, AnimationHint } from "@/lib/game/replay";
import { clamp01, easeOutBack, easeOutCubic, easeOutQuad, pingPong, shakeOffset } from "./easing";

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

/**
 * How far through each clip the blow actually connects.
 *
 * The actor starts this fraction of the clip *before* the engine's timestamp,
 * so contact happens exactly on it. A guard braces earlier than a punch lands,
 * which is what makes a block read as a block rather than as a late flinch.
 */
const CONTACT_PHASE: Partial<Record<AnimationHint, number>> = {
  ATTACK: 0.5,
  CAST: 0.55,
  GUARD: 0.45,
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
  /**
   * A trailing bar that eases down to `health`.
   *
   * Always >= health. The gap between them is the damage of the last blow,
   * which is what makes a big hit legible at a glance without reading a number.
   */
  healthTrail: number | null;
  hp: number | null;
  maxHp: number | null;
  alive: boolean;
  animation: AnimationHint;
  /** 0..1 through the current animation. */
  animationProgress: number;
  /** −1 faces left, +1 faces right. */
  facing: 1 | -1;
  /** Offset toward whatever this combatant is acting on, in arena units. */
  lunge: number;
  lungeY: number;
  /** 0..1, fades a corpse out after it dies. */
  opacity: number;
  /** 0..1, flashes white when just hit. */
  flash: number;
  /** 0..1 while dying: the body sinks as it fades. */
  sink: number;
}

export type EffectKind = "HIT" | "CRIT" | "SPECIAL" | "GUARD" | "DEATH" | "CAST";

export interface SceneEffect {
  kind: EffectKind;
  x: number;
  y: number;
  /**
   * Where the blow came from.
   *
   * Lets the draw layer put a shield on the side it was struck from and run a
   * strike line back to the attacker — which is the only thing on screen that
   * answers "who hit whom" without reading the log.
   */
  fromX: number | null;
  fromY: number | null;
  /** 0..1 through the effect's life. */
  progress: number;
  value?: number;
  /** True when the engine reduced this hit — a block still deals damage. */
  blocked?: boolean;
  /**
   * Which row to float this number in, when several land close together.
   *
   * Derived from the replay's own event order rather than from a counter, so
   * two viewers stack an exchange identically and scrubbing back to the same
   * millisecond puts the numbers back in the same rows.
   */
  slot: number;
}

export interface SceneCamera {
  x: number;
  y: number;
  zoom: number;
  /**
   * How hard the camera is being shaken right now, in arena units.
   *
   * Carried separately from the offset it produces because the offset is
   * per-sample noise — it jumps between frames by design — so the magnitude is
   * the only part of it that means anything, whether you are a test asserting
   * that the loudest blow wins or a HUD deciding not to shake with the arena.
   */
  shake: number;
}

export interface SceneBanner {
  kind: "PHASE" | "TURNING_POINT" | "VICTORY";
  text: string;
  /** 0..1 through the banner's life. */
  progress: number;
}

/**
 * A short, loud moment the draw layer treats specially.
 *
 * Deliberately separate from the banner: a banner is text, a cinematic is a
 * vignette, a letterbox and a camera push. Both are presentation and neither
 * changes how long the replay runs — the window is carved out of time the
 * engine already allotted, never added to it.
 */
export interface SceneCinematic {
  kind: "TURNING_POINT" | "UPSET";
  /** 0..1 through the moment. */
  progress: number;
  /**
   * 0..1 how present the treatment should be right now.
   *
   * Kept here rather than in the draw layer because the shape of the curve is
   * a decision, not a detail: a turning point is a moment the battle moves on
   * from, so it fades back out — but an upset is the final state of the replay
   * and must not, or it disappears before playback stops. That exact mistake
   * had already been made once with the victory banner.
   */
  intensity: number;
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
  cinematic: SceneCinematic | null;
  /** The event being emphasised right now, for the draw layer to react to. */
  focusEventIndex: number | null;
  /**
   * The MVP, once the battle is over and the result is being presented.
   *
   * Null before the end, so the crown does not appear over someone who is
   * about to be eliminated. The identity is the engine's — the scene only
   * decides when to show it.
   */
  mvpCharacterId: string | null;
  /**
   * 0..1 while the closing beat plays, for the draw layer's victory treatment.
   * Timed to the replay's own tail, so it always completes before playback does.
   */
  outro: number;
  /** Copied from the result. An upset gets a louder ending, never a different one. */
  upset: boolean;
}

const EFFECT_MS = 420;
const BANNER_MS = 1600;
const CINEMATIC_MS = 1100;
/**
 * Floor for the closing beat, for the rare replay that ends on its last frame.
 * An upset is emphasised by how it is drawn, not by stretching time — the
 * renderer does not get to decide how long a battle lasts.
 */
const MIN_OUTRO_MS = 1200;
const FLASH_MS = 180;
const CORPSE_FADE_MS = 900;
/** How long the trailing health bar takes to catch up to the real one. */
const HEALTH_TRAIL_MS = 520;
/** How close two damage numbers have to be before they need separate rows. */
const NUMBER_SPACING_X = 34;
const NUMBER_SPACING_Y = 30;

/**
 * The largest lead any animation takes over its own event.
 *
 * Events this far ahead still have to be walked, or an attacker would pop into
 * its swing instead of winding up into it.
 */
const MAX_ANTICIPATION_MS = Math.max(
  ...Object.entries(CONTACT_PHASE).map(
    ([hint, phase]) => ANIMATION_MS[hint as AnimationHint] * (phase ?? 0),
  ),
);

/** Camera shake never exceeds this, however many blows land at once. */
const MAX_SHAKE = 11;
const SHAKE_MS = 320;

/**
 * How far the camera may ever stray from the centre of the arena.
 *
 * Exported because the draw layer fills the ground to exactly this margin. An
 * unclamped pan toward a combatant at the edge reached forty units, well past
 * the fill, and left a bare strip along the side of the arena.
 */
export const MAX_CAMERA_OFFSET = 22;

/**
 * How far the camera leans toward the event it is following.
 *
 * Sized so the furthest combatant pulls the view about half the budget,
 * leaving the rest for shake. The clamp above is then a guard rail rather
 * than the position the camera normally sits at.
 */
const FOCUS_PULL = 0.1;

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

/** How early this animation has to start for contact to land on the event. */
function anticipationOf(hint: AnimationHint): number {
  return ANIMATION_MS[hint] * (CONTACT_PHASE[hint] ?? 0);
}

type Working = SceneCombatant & {
  _animAt: number;
  _diedAt: number | null;
  /** HP before the most recent blow, and when it landed, for the trail bar. */
  _prevHp: number | null;
  _hitAt: number;
  /** Where this combatant is acting, so the lunge points at something. */
  _aimX: number | null;
  _aimY: number | null;
};

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

  // Sides come from the seat, never from the array order: `result.teams` is
  // sorted by rank, so seating by index would place the eventual winner on the
  // left from the very first frame and give the result away.
  const sideOf = new Map<string, 0 | 1>();
  replay.teams.forEach((t, i) => sideOf.set(t.playerId, (t.seat ?? i) === 0 ? 0 : 1));

  const combatants: Working[] = replay.combatants.map((c) => {
    const side = sideOf.get(c.teamId) ?? 0;
    const { x, y, facing } = placement(c.lane, c.slot, side);
    const maxHp = typeof c.maxHp === "number" ? c.maxHp : null;
    return {
      characterId: c.characterId,
      teamId: c.teamId,
      x,
      y,
      health: showHealth ? 1 : null,
      healthTrail: showHealth ? 1 : null,
      hp: maxHp,
      maxHp,
      alive: true,
      animation: "IDLE",
      animationProgress: 1,
      facing,
      lunge: 0,
      lungeY: 0,
      opacity: 1,
      flash: 0,
      sink: 0,
      _animAt: -Infinity,
      _diedAt: null,
      _prevHp: null,
      _hitAt: -Infinity,
      _aimX: null,
      _aimY: null,
    };
  });

  const byId = new Map(combatants.map((c) => [c.characterId, c]));

  const effects: SceneEffect[] = [];
  let banner: SceneBanner | null = null;
  let cinematic: SceneCinematic | null = null;
  let focusEventIndex: number | null = null;
  // Every shake still inside its window, so the strongest one wins rather than
  // the most recent. Otherwise a small blow landing after a big one restarts
  // the decay lower and the big moment lands softer than the little one.
  const shakes: { magnitude: number; atMs: number; seed: number }[] = [];

  replay.events.forEach((event, index) => {
    // Events slightly in the future are still walked, so their actor can be
    // mid-wind-up. Nothing they *do* is applied until their timestamp.
    if (event.atMs - MAX_ANTICIPATION_MS > now) return;

    applyEvent(
      event,
      index,
      now,
      byId,
      effects,
      (b) => (banner = b),
      (c) => (cinematic = c),
      (magnitude) => {
        shakes.push({
          magnitude: Math.min(MAX_SHAKE, magnitude),
          atMs: event.atMs,
          seed: index,
        });
      },
    );

    const age = now - event.atMs;
    if (event.emphasis && age >= 0 && age < EFFECT_MS) focusEventIndex = index;
  });

  // Resolve the derived visual state now that every past event is applied.
  for (const c of combatants) {
    const animAge = now - c._animAt;
    const duration = ANIMATION_MS[c.animation] || 1;

    if (c.animation !== "IDLE" && animAge >= duration) {
      c.animation = c.alive ? "IDLE" : "DEATH";
      c.animationProgress = 1;
    } else {
      c.animationProgress = clamp01(animAge / duration);
    }

    // The lunge points at whatever this combatant is acting on, not simply
    // forward: on a five-a-side field, "forward" tells you nothing about who
    // is being hit.
    const reach =
      c.animation === "ATTACK"
        ? pingPong(c.animationProgress) * 14
        : c.animation === "CAST"
          ? easeOutBack(c.animationProgress) * 6
          : 0;
    if (reach !== 0 && c._aimX !== null && c._aimY !== null) {
      const dx = c._aimX - c.x;
      const dy = c._aimY - c.y;
      const length = Math.hypot(dx, dy) || 1;
      c.lunge = (dx / length) * reach;
      c.lungeY = (dy / length) * reach;
    } else {
      c.lunge = reach * c.facing;
      c.lungeY = 0;
    }

    const hitAge = now - c._hitAt;
    c.flash = hitAge >= 0 && hitAge < FLASH_MS ? 1 - clamp01(hitAge / FLASH_MS) : 0;

    if (!c.alive && c._diedAt !== null) {
      // The body finishes its death animation, then sinks and fades out of the
      // way. Ten corpses at full opacity make the survivors impossible to find.
      const gone = clamp01((now - c._diedAt - ANIMATION_MS.DEATH) / CORPSE_FADE_MS);
      c.sink = easeOutCubic(gone);
      c.opacity = 1 - c.sink * 0.82;
    }

    if (c.maxHp !== null && c.hp !== null) {
      c.health = clamp01(c.hp / c.maxHp);
      // The trail starts at the HP before the blow and eases down to it.
      const from = c._prevHp === null ? c.hp : c._prevHp;
      const t = easeOutQuad(clamp01(hitAge / HEALTH_TRAIL_MS));
      c.healthTrail = clamp01(
        (hitAge < 0 ? from : from + (c.hp - from) * t) / c.maxHp,
      );
    }
  }

  // Camera: centred, nudged toward the focused event, shaking on impact.
  const camera: SceneCamera = {
    x: ARENA.width / 2,
    y: ARENA.height / 2,
    zoom: 1,
    shake: 0,
  };
  if (focusEventIndex !== null) {
    const focus = replay.events[focusEventIndex];
    const target = focus.targetId ? byId.get(focus.targetId) : undefined;
    if (target) {
      // A tenth of the way, not a third. A third put the camera on the clamp
      // for every single emphatic event — so the view sat at maximum offset
      // most of the fight and the shake had no room left to read as impact.
      const t = easeOutQuad(clamp01((now - focus.atMs) / EFFECT_MS));
      camera.x += (target.x - camera.x) * FOCUS_PULL * (1 - t);
      camera.y += (target.y - camera.y) * FOCUS_PULL * (1 - t);
      camera.zoom = 1 + 0.08 * (1 - t);
    }
  }
  if (cinematic) {
    // A slow push in, following the treatment's own intensity so the camera
    // and the vignette arrive and leave together.
    camera.zoom += 0.12 * (cinematic as SceneCinematic).intensity;
  }
  // The loudest live shake, measured by what it is contributing right now.
  let loudest: { magnitude: number; atMs: number; seed: number } | null = null;
  let loudestPull = 0;
  for (const s of shakes) {
    const age = now - s.atMs;
    if (age < 0 || age >= SHAKE_MS) continue;
    // Matches the decay in `shakeOffset`, so "loudest" means loudest on screen
    // rather than loudest when it started.
    const decay = 1 - age / SHAKE_MS;
    const pull = s.magnitude * decay * decay;
    if (pull > loudestPull) {
      loudestPull = pull;
      loudest = s;
    }
  }
  if (loudest) {
    const t = clamp01((now - loudest.atMs) / SHAKE_MS);
    const offset = shakeOffset(loudest.seed, t, loudest.magnitude);
    camera.shake = loudestPull;
    camera.x += offset.x;
    camera.y += offset.y;
  }

  // Clamped last, so pan and shake together can never exceed what the ground
  // fill covers — and so a blow at the edge of the field cannot yank the view.
  const dx = camera.x - ARENA.width / 2;
  const dy = camera.y - ARENA.height / 2;
  const stray = Math.hypot(dx, dy);
  if (stray > MAX_CAMERA_OFFSET) {
    const scale = MAX_CAMERA_OFFSET / stray;
    camera.x = ARENA.width / 2 + dx * scale;
    camera.y = ARENA.height / 2 + dy * scale;
  }

  // The closing beat runs over whatever the replay leaves after its END event,
  // not over a constant. A fixed window was longer than the tail of a real
  // battle, so the crown was still fading in when playback stopped.
  const endEvent = replay.events.find((e) => e.kind === "END");
  const endAt = endEvent ? endEvent.atMs : replay.durationMs;
  const outroMs = Math.max(MIN_OUTRO_MS, replay.durationMs - endAt);
  const outro = now >= endAt ? clamp01((now - endAt) / outroMs) : 0;

  // An upset takes over the closing beat once the victory has registered.
  if (!cinematic && replay.upset && outro > 0.25) {
    const progress = clamp01((outro - 0.25) / 0.75);
    cinematic = {
      kind: "UPSET",
      progress,
      // In, then hold to the end. This is where the replay stops.
      intensity: clamp01(progress / 0.25),
    };
  }

  assignNumberSlots(effects);

  return {
    elapsedMs: now,
    finished: now >= replay.durationMs,
    showHealth,
    combatants: combatants.map(strip),
    effects: effects.filter((e) => e.progress >= 0 && e.progress < 1),
    camera,
    banner,
    cinematic,
    focusEventIndex,
    // Only once the fight is over: a crown over someone who is about to be
    // eliminated would be a spoiler, and a wrong one.
    mvpCharacterId: outro > 0 ? replay.mvp?.characterId ?? null : null,
    outro,
    upset: replay.upset,
  };
}

/**
 * Stacks damage numbers that would otherwise overlap.
 *
 * Two blows landing within a few hundred milliseconds on neighbouring
 * combatants printed their numbers on top of each other and neither was
 * readable. Effects arrive in the replay's own event order, so walking them in
 * that order and taking the lowest free row is deterministic: the same battle
 * at the same millisecond always stacks the same way, on any device.
 */
function assignNumberSlots(effects: SceneEffect[]): void {
  const placed: { x: number; y: number; slot: number }[] = [];

  for (const effect of effects) {
    if (typeof effect.value !== "number") continue;

    const taken = new Set(
      placed
        .filter((p) => Math.abs(p.x - effect.x) < NUMBER_SPACING_X &&
                       Math.abs(p.y - effect.y) < NUMBER_SPACING_Y)
        .map((p) => p.slot),
    );
    let slot = 0;
    while (taken.has(slot)) slot++;
    effect.slot = slot;
    placed.push({ x: effect.x, y: effect.y, slot });
  }
}

/** Drops the bookkeeping fields so the returned scene is exactly the contract. */
function strip(c: Working): SceneCombatant {
  const {
    _animAt: _a, _diedAt: _d, _prevHp: _p, _hitAt: _h, _aimX: _x, _aimY: _y,
    ...rest
  } = c;
  return rest;
}

/** Applies one event to the working state. Never reads the clock. */
function applyEvent(
  event: ReplayEvent,
  index: number,
  now: number,
  byId: Map<string, Working>,
  effects: SceneEffect[],
  setBanner: (b: SceneBanner | null) => void,
  setCinematic: (c: SceneCinematic | null) => void,
  setShake: (magnitude: number) => void,
): void {
  const actor = event.actorId ? byId.get(event.actorId) : undefined;
  const target = event.targetId ? byId.get(event.targetId) : undefined;
  const age = now - event.atMs;
  const landed = age >= 0;

  // The actor starts early enough that its blow connects on the engine's own
  // timestamp. Everything the blow *does* still waits for that timestamp.
  if (actor && event.animation !== "NONE" && ANIMATION_MS[event.animation] > 0) {
    const startAt = event.atMs - anticipationOf(event.animation);
    if (now >= startAt && now - startAt < ANIMATION_MS[event.animation]) {
      actor.animation = event.animation;
      actor._animAt = startAt;
      if (target) {
        actor._aimX = target.x;
        actor._aimY = target.y;
      }
    }
  }

  // The target's reaction is also an animation, so it gets the same treatment:
  // a guard braces *into* the blow and so starts before it, while a flinch has
  // no anticipation at all and begins exactly on contact.
  const targetHint = event.targetAnimation ?? "NONE";
  if (target && targetHint !== "NONE" && ANIMATION_MS[targetHint] > 0) {
    const startAt = event.atMs - anticipationOf(targetHint);
    if (now >= startAt && now - startAt < ANIMATION_MS[targetHint] && target.alive) {
      target.animation = targetHint;
      target._animAt = startAt;
      if (actor) {
        target._aimX = actor.x;
        target._aimY = actor.y;
      }
    }
  }

  if (!landed) return;

  // HP comes from the engine, never from subtracting damage here.
  if (typeof event.hpAfter === "number" && target) {
    if (target.hp !== event.hpAfter) {
      target._prevHp = target.hp;
      target._hitAt = event.atMs;
    }
    target.hp = event.hpAfter;
  }

  switch (event.kind) {
    case "ATTACK":
    case "CRIT":
    case "SPECIAL":
    case "BLOCK": {
      if (target && age < EFFECT_MS) {
        effects.push({
          kind:
            event.kind === "CRIT" ? "CRIT"
            : event.kind === "SPECIAL" ? "SPECIAL"
            : event.kind === "BLOCK" ? "GUARD"
            : "HIT",
          x: target.x,
          y: target.y,
          fromX: actor?.x ?? null,
          fromY: actor?.y ?? null,
          progress: clamp01(age / EFFECT_MS),
          slot: 0,
          ...(typeof event.damage === "number" ? { value: event.damage } : {}),
          ...(event.kind === "BLOCK" ? { blocked: true } : {}),
        });
      }
      // A cast glows at the caster too, so a special reads as something someone
      // did rather than as something that happened.
      if (event.kind === "SPECIAL" && actor && age < EFFECT_MS) {
        effects.push({
          kind: "CAST",
          x: actor.x,
          y: actor.y,
          fromX: null,
          fromY: null,
          progress: clamp01(age / EFFECT_MS),
          slot: 0,
        });
      }
      // A block is the one hit that does not shake the camera: it is the
      // absence of impact, and shaking it would read as a bigger hit.
      if (event.kind === "CRIT" && age < SHAKE_MS) setShake(7);
      else if (event.kind === "SPECIAL" && age < SHAKE_MS) setShake(5);
      break;
    }

    case "ELIMINATION": {
      if (target) {
        target.alive = false;
        target._diedAt = event.atMs;
        target.animation = "DEATH";
        target._animAt = event.atMs;
        target._aimX = null;
        target._aimY = null;
        if (age < EFFECT_MS) {
          effects.push({
            kind: "DEATH",
            x: target.x,
            y: target.y,
            fromX: actor?.x ?? null,
            fromY: actor?.y ?? null,
            progress: clamp01(age / EFFECT_MS),
            slot: 0,
          });
        }
      }
      if (age < SHAKE_MS) setShake(9);
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
        setBanner({
          kind: "TURNING_POINT",
          text: event.text,
          progress: clamp01(age / BANNER_MS),
        });
      }
      if (age < CINEMATIC_MS) {
        const progress = clamp01(age / CINEMATIC_MS);
        setCinematic({
          kind: "TURNING_POINT",
          progress,
          // In fast, hold, out — the battle carries on afterwards.
          intensity: clamp01(
            progress < 0.15 ? progress / 0.15
            : progress > 0.7 ? (1 - progress) / 0.3
            : 1,
          ),
        });
        if (age < SHAKE_MS) setShake(MAX_SHAKE);
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
