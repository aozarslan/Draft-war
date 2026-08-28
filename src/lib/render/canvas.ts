/**
 * ---------------------------------------------------------------------------
 * CANVAS (impure)
 * ---------------------------------------------------------------------------
 * The only file in `render/` that touches a DOM node, a clock or a frame loop.
 *
 * Everything it draws it asks for: `sceneAt(replay, clock())`. It keeps no
 * battle state of its own, so dropping frames, backgrounding the tab, or
 * mounting halfway through a fight all land on the correct picture — the next
 * frame simply asks the scene where things are now. That is the whole reason
 * the pure/impure split was drawn here and not somewhere more convenient.
 *
 * The clock is injected rather than read, because the game already has one:
 * `battleStartedAt` on the room row, shared by every viewer. This file must
 * never start its own stopwatch, or two spectators drift apart.
 */

import type { Replay } from "@/lib/game/replay";
import { AssetStore, type CharacterArt, type SpriteSheet } from "./assets";
import { FRAME_SIZE, SHEET_GROUND_RATIO } from "./archetypes";
import {
  IDENTITY_TILE_ROWS,
  IDENTITY_TILE_SIZE,
  IDENTITY_TILE_SLOTS,
  SPRITE_ANCHORS,
} from "./anchors.generated";
import { BUILD_SCALE, type IdentityConfig } from "./identity";
import { cueIntensity, type Interactions } from "./interactions";
import {
  ARENA,
  MAX_CAMERA_OFFSET,
  sceneAt,
  type Scene,
  type SceneCombatant,
} from "./scene";
import { clamp01, easeOutBack, easeOutCubic, easeOutQuad } from "./easing";

export interface BattleRendererOptions {
  canvas: HTMLCanvasElement;
  replay: Replay;
  art?: CharacterArt[];
  /** Elapsed milliseconds since the battle started. Owned by the caller. */
  clock: () => number;
  /** Team colour per playerId, from PLAYER_COLORS. */
  teamColors?: Record<string, string>;
  /**
   * Reduce motion.
   *
   * Everything that moves for effect is turned off or damped — shake, camera
   * push, particles, letterbox slides. Everything that *carries information*
   * stays: damage numbers, health bars, hit rings, the strike line, team
   * colours, identity features. Calming the picture must not cost the viewer
   * the ability to read the fight.
   */
  reducedMotion?: boolean;
  /** Relationship cues to show over the opening seconds. */
  interactions?: Interactions;
}

const SPRITE_SIZE = 22; // arena units
/** A sprite frame is mostly empty, so it is drawn larger than the disc it replaces. */
const SHEET_SCALE = 1.5;
/**
 * How large a 16px identity tile is drawn, per slot.
 *
 * A head feature reads best slightly oversized — horns are what you look at.
 * A back feature at the same scale stood six pixels off an eight-pixel body
 * and read as a separate object hovering above it. Markings sit flat on the
 * flank and want to match the body, not exceed it.
 */
/**
 * The resolutions a composed frame may be assembled at.
 *
 * Bucketed rather than exact so the cache stays small — a handful of sizes
 * across a session instead of one per pixel of zoom. A fixed 64 was wasteful
 * on a phone, where a sprite is drawn at about thirteen pixels: the blit cost
 * the same as on a desktop and the mobile budget went from 1.7ms to 4.5ms.
 */
const COMPOSED_SIZES = [24, 32, 48, 64, 96] as const;

/** The smallest bucket that still covers what will be drawn. */
function composedSizeFor(devicePixels: number): number {
  for (const size of COMPOSED_SIZES) {
    if (size >= devicePixels) return size;
  }
  return COMPOSED_SIZES[COMPOSED_SIZES.length - 1];
}

/**
 * A character's look as a cache key.
 *
 * Cheap on purpose: it runs once per combatant per frame, and the composed
 * frame it guards costs far more to build than this costs to compare.
 */
function identityKeyOf(i: IdentityConfig): string {
  return `${i.head}${i.back}${i.marking}${i.prop}${i.build}${i.accent}`;
}

const TILE_SCALE: Record<string, number> = {
  head: 1.1,
  back: 0.72,
  body: 0.9,
  // A mark is stamped several times along the flank, so each one is small.
  mark: 0.5,
  // A prop has to read as an object rather than as a smudge on the body, so it
  // is drawn near full tile size — it is the layer doing the most work to say
  // what this character is.
  hand: 1.0,
  // A ball on the ground is smaller than a weapon held up: at hand scale it
  // was as wide as the player's shoulders.
  foot: 0.62,
};
/** How many frames the performance meter averages over. */
const SAMPLE_FRAMES = 120;
/** The colour a blow travels in, per kind. */
/**
 * Which anatomy delivers a blow which way.
 *
 * Keyed by visual archetype, so it scales with the body plans rather than with
 * the catalogue: adding a seventh archetype adds one line here, not 268.
 */
export type CombatStyle = "CLAW" | "FANG" | "TALON" | "WAVE" | "SWING";

const COMBAT_STYLE: Record<string, CombatStyle> = {
  quadruped_small: "CLAW",
  quadruped_medium: "CLAW",
  quadruped_large: "CLAW",
  serpentine: "FANG",
  winged: "TALON",
  aquatic: "WAVE",
  humanoid_medium: "SWING",
  humanoid_large: "SWING",
  default: "SWING",
};

/** What colour each kind of spark is. */
const PARTICLE_COLOR: Record<string, string> = {
  HIT: "#e2e8f0",
  CRIT: "#fb923c",
  SPECIAL: "#c084fc",
  DEATH: "#f8fafc",
};

const STRIKE_COLOR: Record<string, string> = {
  HIT: "#e2e8f0",
  CRIT: "#f97316",
  SPECIAL: "#c084fc",
  GUARD: "#38bdf8",
  DEATH: "#f8fafc",
};
const BAR_WIDTH = 22;
const BAR_HEIGHT = 3;

export class BattleRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly replay: Replay;
  private readonly assets: AssetStore;
  private readonly clock: () => number;
  private readonly teamColors: Record<string, string>;
  private readonly reducedMotion: boolean;
  private readonly interactions: Interactions | null;

  private frame = 0;
  private lastTs = 0;
  private running = false;
  private readonly frameTimes: number[] = [];
  private readonly intervals: number[] = [];
  private scale = 1;
  private dpr = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(options: BattleRendererOptions) {
    const ctx = options.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable");

    this.canvas = options.canvas;
    this.ctx = ctx;
    this.replay = options.replay;
    this.clock = options.clock;
    this.teamColors = options.teamColors ?? {};
    this.reducedMotion = options.reducedMotion ?? false;
    this.interactions = options.interactions ?? null;
    this.assets = new AssetStore(options.art ?? []);
    this.assets.setOnReady(() => {
      if (!this.running) this.renderAt(this.clock());
    });
    this.assets.preload();
    this.assets.preloadTiles();
    // A late sheet or tile arrival invalidates anything composed without it.
    this.assets.setOnReady(() => {
      this.assets.clearComposed();
      if (!this.running) this.renderAt(this.clock());
    });
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTs = 0;
    const loop = (ts: number) => {
      if (!this.running) return;
      const dt = this.lastTs ? (ts - this.lastTs) / 1000 : 0;
      this.lastTs = ts;
      const started = performance.now();
      this.renderAt(this.clock());
      this.recordFrame(performance.now() - started, dt);

      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /**
   * What the last few seconds actually cost.
   *
   * Measured rather than assumed: ten combatants, ten tinted sheets and a
   * particle pool is the load the game will really run, and the only way to
   * know it fits in a frame is to time it on the device it runs on.
   */
  stats(): { fps: number; drawMs: number; worstMs: number } {
    const frames = this.frameTimes.length;
    if (frames === 0) return { fps: 0, drawMs: 0, worstMs: 0 };
    const total = this.frameTimes.reduce((s, v) => s + v, 0);
    return {
      fps: this.intervals.length
        ? this.intervals.length / this.intervals.reduce((s, v) => s + v, 0)
        : 0,
      drawMs: total / frames,
      worstMs: Math.max(...this.frameTimes),
    };
  }

  private recordFrame(drawMs: number, dt: number): void {
    this.frameTimes.push(drawMs);
    if (this.frameTimes.length > SAMPLE_FRAMES) this.frameTimes.shift();
    if (dt > 0) {
      this.intervals.push(dt);
      if (this.intervals.length > SAMPLE_FRAMES) this.intervals.shift();
    }
  }

  stop(): void {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  dispose(): void {
    this.stop();
    this.assets.dispose();
  }

  /**
   * Matches the backing store to the element and the device pixel ratio.
   *
   * Called on construction and by the host on resize. Without it the arena is
   * blurry on every retina screen, which is most of them.
   */
  resize(): void {
    const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.width));
    const height = Math.max(1, Math.round(rect.height || this.canvas.height));

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Letterbox the arena so it never distorts, whatever the container is.
    const previousScale = this.scale;
    this.scale = Math.min(width / ARENA.width, height / ARENA.height);
    // A different scale picks a different bucket; the old cells are for a size
    // nothing will ask for again.
    if (previousScale !== this.scale) this.assets.clearComposed();
    this.offsetX = (width - ARENA.width * this.scale) / 2;
    this.offsetY = (height - ARENA.height * this.scale) / 2;

    if (!this.running) this.renderAt(this.clock());
  }

  /** Draws one frame. Public so a paused viewer can be repainted on demand. */
  renderAt(elapsedMs: number): void {
    const scene = sceneAt(this.replay, elapsedMs);
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.restore();

    ctx.save();
    // World transform: letterbox, then camera.
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    // Reduced motion holds the camera perfectly still: no shake, no pan, no
    // push. What the camera was communicating — *where* to look — is still
    // carried by the strike line, the ring and the number, all of which stay.
    const cam = this.reducedMotion
      ? { x: ARENA.width / 2, y: ARENA.height / 2, zoom: 1, shake: 0 }
      : scene.camera;
    ctx.translate(ARENA.width / 2, ARENA.height / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    this.drawGround(ctx);

    // Painter's order: farther up the screen is farther away.
    const ordered = [...scene.combatants].sort((a, b) => a.y - b.y);
    for (const c of ordered) this.drawCombatant(ctx, c, scene.showHealth);

    this.drawInteractions(ctx, scene);
    this.drawEffects(ctx, scene);
    if (scene.mvpCharacterId) this.drawMvp(ctx, scene);
    if (!this.reducedMotion) this.drawParticles(ctx, scene);

    ctx.restore();

    // Screen space from here: a vignette that shook with the camera would read
    // as a bug, and banner text has to stay level.
    this.drawCinematic(ctx, scene);
    this.drawBanner(ctx, scene);
  }

  /**
   * The short, loud moments: a turning point and an upset.
   *
   * A vignette and letterbox bars rather than slow motion, because slowing the
   * picture down would mean the renderer deciding how long the battle lasts.
   * The whole moment fits inside time the engine already allotted.
   */
  private drawCinematic(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (!scene.cinematic) return;
    const { kind, progress, intensity } = scene.cinematic;

    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.width;
    const height = rect.height || this.canvas.height;

    const strength = clamp01(intensity);
    if (strength <= 0) return;

    ctx.save();

    // Vignette: darkens the edges so the eye goes to the middle of the arena.
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.22,
      width / 2, height / 2, Math.max(width, height) * 0.62,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    // A softer vignette when motion is reduced: the darkening still says "this
    // moment matters" without pulsing the whole frame.
    vignette.addColorStop(
      1,
      `rgba(0,0,0,${(this.reducedMotion ? 0.35 : 0.55) * strength})`,
    );
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    // Letterbox bars slide in from top and bottom — or simply appear, held at
    // a constant height, when motion is reduced.
    const bar = height * 0.075 * (this.reducedMotion ? 1 : easeOutCubic(strength));
    ctx.fillStyle = "rgba(2,6,23,0.92)";
    ctx.fillRect(0, 0, width, bar);
    ctx.fillRect(0, height - bar, width, bar);

    // Screen-space type has to scale with the canvas or it swamps a phone: at
    // a fixed 26px the upset stamp landed on top of the victory banner.
    const scale = clamp01((height - 220) / 520) * 0.6 + 0.7;
    const accent = kind === "UPSET" ? "#f472b6" : "#f59e0b";
    ctx.fillStyle = accent;
    ctx.globalAlpha = strength;
    ctx.fillRect(0, bar, width, 1);
    ctx.fillRect(0, height - bar - 1, width, 1);

    if (kind === "UPSET") {
      // A stamp that lands rather than fades: the result is unchanged, but the
      // fact that the engine called it an upset should be impossible to miss.
      // The stamp lands with an overshoot normally, and simply is there when
      // motion is reduced — the word is the information, the bounce is not.
      const drop = this.reducedMotion ? 1 : easeOutBack(clamp01(progress / 0.35));
      ctx.save();
      // Well clear of the victory band in the middle of the frame.
      ctx.translate(width / 2, height * 0.26);
      ctx.scale(scale * (0.6 + drop * 0.4), scale * (0.6 + drop * 0.4));
      ctx.rotate(-0.06);
      ctx.globalAlpha = strength;
      ctx.fillStyle = accent;
      ctx.font = "bold 26px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("UPSET", 0, 0);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = strength * 0.7;
      ctx.strokeRect(-56, -17, 112, 34);
      ctx.restore();
    }

    ctx.restore();
  }

  // -- pieces ---------------------------------------------------------------

  private drawGround(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, ARENA.height);
    gradient.addColorStop(0, "#0b1220");
    gradient.addColorStop(1, "#111c30");
    ctx.fillStyle = gradient;
    // Just enough margin to cover the camera's shake and zoom. It used to fill
    // three arenas by three, which is nine times the area of a gradient fill
    // every single frame for a border nobody ever sees.
    const margin = MAX_CAMERA_OFFSET;
    ctx.fillRect(
      -margin, -margin,
      ARENA.width + margin * 2, ARENA.height + margin * 2,
    );

    // A centre line, so the two sides read as two sides.
    ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ARENA.width / 2, 12);
    ctx.lineTo(ARENA.width / 2, ARENA.height - 12);
    ctx.stroke();
  }

  private drawCombatant(
    ctx: CanvasRenderingContext2D,
    c: SceneCombatant,
    showHealth: boolean,
  ): void {
    // Reduced motion damps the sprite's travel rather than removing it: a
    // lunge that vanished would take "who is attacking" with it, so it is cut
    // to a quarter — visible as intent, not as motion.
    const travel = this.reducedMotion ? 0.25 : 1;
    const x = c.x + c.lunge * travel;
    // The body sinks as it fades, so a corpse settles instead of hanging in
    // the air at a quarter opacity where the survivors are.
    const y = c.y + c.lungeY * travel + c.sink * 3;

    ctx.save();
    ctx.globalAlpha = c.opacity;

    // Shadow first: it is what stops a sprite floating.
    const ringIdentity = this.assets.identityFor(c.characterId);
    const ringScale = ringIdentity?.scale ?? 1;
    // A heavy build stands on a wider footprint. Height does not enter here —
    // a shadow is a plan view.
    const [ringWide] = BUILD_SCALE[ringIdentity?.build ?? "NORMAL"];
    const ringX = (SPRITE_SIZE * ringScale * ringWide) / 2.4;
    const ringY = (SPRITE_SIZE * ringScale) / 6;
    const feetY = y + SPRITE_SIZE / 2;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, feetY, ringX, ringY, 0, 0, Math.PI * 2);
    ctx.fill();

    // A team-coloured ring on the ground, under every combatant regardless of
    // how it is drawn. Sprites are tinted with the *character's* palette, which
    // says nothing about whose side they are on — without this, two teams of
    // animals from one category are indistinguishable.
    const team = this.teamColors[c.teamId];
    if (team && c.alive) {
      ctx.strokeStyle = team;
      ctx.globalAlpha = c.opacity * 0.85;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, feetY, ringX, ringY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = c.opacity;
    }

    const sprite = this.assets.spriteFor(c.characterId, c.animation, c.animationProgress);
    const identity = this.assets.identityFor(c.characterId);
    // Size is part of identity: an elephant and a badger sharing one body plan
    // should not be the same height.
    const bodyScale = identity?.scale ?? 1;
    // Proportions. NORMAL is [1, 1], so a character that asks for no build is
    // drawn through arithmetic that cannot move it.
    const [buildW, buildH] = BUILD_SCALE[identity?.build ?? "NORMAL"];
    const half = (SPRITE_SIZE * bodyScale * buildH) / 2;

    if (sprite.kind === "SHEET") {
      // Anchored by the ground line, not the centre: a frame is mostly empty
      // air above the animal, so centring it leaves the sprite hovering over
      // its own shadow.
      const drawSize = SPRITE_SIZE * SHEET_SCALE * bodyScale;
      // The build stretches the *composed* frame, not the body inside it, so
      // horns, markings and a held prop stretch with the body and cannot come
      // apart from it. Width is centred; height hangs from the ground line, so
      // a towering character grows upward instead of sinking through the floor.
      const boxW = drawSize * buildW;
      const boxH = drawSize * buildH;
      // Composed once per character and frame — body, markings, back and head
      // together — then blitted. Assembling seven layers per combatant per
      // frame cost twice the budget at ten combatants.
      const cell = identity
        ? this.assets.composedFrame(
            c.characterId,
            sprite.row,
            sprite.frame,
            (cellCtx, size) => this.composeSprite(cellCtx, size, sprite, identity, c.characterId),
            composedSizeFor(drawSize * this.scale * this.dpr),
            // The body plan is already implied by the character id, so the key
            // only has to carry what identity itself decides.
            identityKeyOf(identity),
          )
        : null;

      ctx.save();
      ctx.translate(x, feetY - SHEET_GROUND_RATIO * boxH);
      ctx.scale(c.facing, 1);
      ctx.imageSmoothingEnabled = false;

      if (cell) {
        ctx.drawImage(cell, -boxW / 2, 0, boxW, boxH);
      } else {
        const { sheet, frame, row, image } = sprite;
        ctx.drawImage(
          image,
          frame * sheet.frameWidth, row * sheet.frameHeight,
          sheet.frameWidth, sheet.frameHeight,
          -boxW / 2, 0, boxW, boxH,
        );
      }
      ctx.restore();
    } else if (sprite.kind === "PORTRAIT") {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(sprite.image, x - half, y - half, SPRITE_SIZE, SPRITE_SIZE);
      ctx.restore();
      ctx.strokeStyle = this.teamColors[c.teamId] ?? "#94a3b8";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const gradient = ctx.createLinearGradient(x - half, y - half, x + half, y + half);
      gradient.addColorStop(0, sprite.palette[0]);
      gradient.addColorStop(1, sprite.palette[1]);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(sprite.initials, x, y);

      ctx.strokeStyle = this.teamColors[c.teamId] ?? "#94a3b8";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Identity layers, over the body and under the flash. Drawn rather than
    // stamped from a sheet: six body plans times a dozen features would be
    // seventy-odd sprite sheets, and at thirty screen pixels a horn is four
    // lines. Everything here is positioned from the sprite's own drawn box, so
    // it follows the lunge, the scale and the sink without extra bookkeeping.
    // Hit flash, over whatever was drawn.
    if (c.flash > 0) {
      ctx.globalAlpha = c.opacity * c.flash * 0.7;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = c.opacity;
    }

    // Health bars are drawn only when the replay can back them with a real
    // denominator. A pre-V5 battle shows none at all rather than a guess.
    if (showHealth && c.health !== null && c.alive) {
      const bx = x - BAR_WIDTH / 2;
      const by = y - half - 7;

      ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
      ctx.fillRect(bx - 0.5, by - 0.5, BAR_WIDTH + 1, BAR_HEIGHT + 1);

      // The trailing bar drains down to the real one over half a second. The
      // gap between them *is* the last hit, which makes the size of a blow
      // readable without anyone reading the number.
      if (c.healthTrail !== null && c.healthTrail > c.health) {
        ctx.fillStyle = "#fca5a5";
        ctx.fillRect(bx, by, BAR_WIDTH * c.healthTrail, BAR_HEIGHT);
      }

      ctx.fillStyle =
        c.health > 0.5 ? "#22c55e" : c.health > 0.2 ? "#f59e0b" : "#ef4444";
      ctx.fillRect(bx, by, BAR_WIDTH * c.health, BAR_HEIGHT);
    }

    ctx.restore();
  }

  /**
   * Who is allied with whom, and who shares history with whom.
   *
   * Shown only over the opening seconds, before the first blow. A permanent
   * badge would sit in exactly the space the damage numbers need. The synergy
   * bonus drawn here is the engine's own; the rivalry line is a note about the
   * roster, and neither changes anything about the fight.
   */
  private drawInteractions(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (!this.interactions) return;
    const strength = cueIntensity(scene.elapsedMs);
    if (strength <= 0) return;

    const at = (id: string) => scene.combatants.find((c) => c.characterId === id);

    ctx.save();

    // Rivalry first, underneath: a thin dashed line between two opposing
    // combatants that share a tag.
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 0.8;
    for (const rivalry of this.interactions.rivalries) {
      const a = at(rivalry.a);
      const b = at(rivalry.b);
      if (!a || !b) continue;
      ctx.globalAlpha = strength * 0.35;
      ctx.strokeStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Synergy: an arc linking the squad members that triggered the group, in
    // their team's colour, with the engine's bonus written once. Labels are
    // stacked per team — two groups on one side used to print on top of each
    // other and neither was readable.
    const rowByTeam = new Map<string, number>();
    for (const cue of this.interactions.synergies) {
      const members = cue.characterIds.map(at).filter(Boolean) as SceneCombatant[];
      if (members.length < 2) continue;

      const colour = this.teamColors[cue.teamId] ?? "#94a3b8";
      ctx.globalAlpha = strength * 0.8;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      members.forEach((m, i) => {
        const y = m.y + SPRITE_SIZE / 2 + 2;
        if (i === 0) ctx.moveTo(m.x, y);
        else ctx.lineTo(m.x, y);
      });
      ctx.stroke();

      for (const m of members) {
        ctx.beginPath();
        ctx.arc(m.x, m.y + SPRITE_SIZE / 2 + 2, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      }

      const row = rowByTeam.get(cue.teamId) ?? 0;
      rowByTeam.set(cue.teamId, row + 1);

      // One column per team, not one label per group's midpoint: stacking
      // vertically fixed the rows but two labels centred on different members
      // still ran into each other sideways.
      const squad = scene.combatants.filter((c) => c.teamId === cue.teamId);
      const columnX =
        squad.reduce((sum, c) => sum + c.x, 0) / Math.max(1, squad.length);
      const columnY =
        Math.max(...squad.map((c) => c.y)) + SPRITE_SIZE / 2 + 12;

      ctx.globalAlpha = strength;
      ctx.fillStyle = colour;
      ctx.font = "bold 6px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${cue.label}  +${Math.round(cue.bonus * 100)}%`,
        columnX,
        columnY + row * 8,
      );
    }

    ctx.restore();
  }

  /**
   * Horns, manes, markings — what tells two green quadrupeds apart.
   *
   * Every measurement is a fraction of the sprite's drawn box, so a feature
   * cannot drift when the body scales, lunges or sinks. Nothing here reads a
   * character id; it reads the configuration the identity layer resolved.
   */
  /**
   * Assembles one character's frame: the tinted body, then its identity.
   *
   * Called once per character per frame and cached, so everything here is
   * allowed to be as many draw calls as the picture needs. Coordinates are in
   * the sheet's own 32-pixel frame space scaled to the cell, which is why the
   * anchors the generator emitted drop straight in.
   */
  private composeSprite(
    ctx: CanvasRenderingContext2D,
    size: number,
    sprite: { sheet: SpriteSheet; frame: number; row: number; image: CanvasImageSource },
    identity: IdentityConfig,
    characterId: string,
  ): void {
    const { sheet, frame, row, image } = sprite;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      image,
      frame * sheet.frameWidth, row * sheet.frameHeight,
      sheet.frameWidth, sheet.frameHeight,
      0, 0, size, size,
    );

    const archetype = this.assets.archetypeFor(characterId);
    if (!archetype) return;
    const tiles = this.assets.tiles(identity.accent);
    if (!tiles) return;
    const anchors = SPRITE_ANCHORS[archetype]?.[row]?.[frame];
    if (!anchors) return;

    const unit = size / FRAME_SIZE;

    const stamp = (feature: string, anchor: readonly number[]) => {
      const meta = IDENTITY_TILE_SLOTS[feature];
      if (!meta) return;
      const rowIndex = IDENTITY_TILE_ROWS.indexOf(feature);
      if (rowIndex < 0) return;

      const tileSize = IDENTITY_TILE_SIZE * unit * (TILE_SCALE[meta.slot] ?? 1);
      const pivotX = (meta.pivot[0] / IDENTITY_TILE_SIZE) * tileSize;
      const pivotY = (meta.pivot[1] / IDENTITY_TILE_SIZE) * tileSize;

      ctx.save();
      ctx.translate(anchor[0] * unit, anchor[1] * unit);
      // The body's own angle at that point, so horns tip back when a horse
      // rears and a stripe lies across a coiling snake rather than through it.
      // The angle is the body's, reported while it was drawn — this layer
      // never works out a pose for itself.
      if (anchor[2]) ctx.rotate(anchor[2]);
      ctx.drawImage(
        tiles,
        0, rowIndex * IDENTITY_TILE_SIZE,
        IDENTITY_TILE_SIZE, IDENTITY_TILE_SIZE,
        -pivotX, -pivotY,
        tileSize, tileSize,
      );
      ctx.restore();
    };

    const place = (feature: string) => {
      const meta = IDENTITY_TILE_SLOTS[feature];
      if (!meta) return;

      if (meta.slot === "mark") {
        // One stamp per flank point. A patch is a single blemish, so it takes
        // only the middle one; everything else runs the length of the body.
        const points = anchors.marks ?? [];
        if (points.length === 0) return;
        const chosen =
          feature === "PATCH" ? [points[Math.floor(points.length / 2)]] : points;
        for (const point of chosen) stamp(feature, point);
        return;
      }

      stamp(
        feature,
        meta.slot === "head" ? anchors.head
        : meta.slot === "back" ? anchors.back
        : meta.slot === "hand" ? anchors.hand
        : meta.slot === "foot" ? anchors.foot
        : anchors.body,
      );
    };

    // Markings under the features, so a mane sits over a stripe rather than
    // being cut by it.
    if (identity.marking !== "PLAIN") place(identity.marking);
    if (identity.back !== "NONE") place(identity.back);
    if (identity.head !== "PLAIN") place(identity.head);
    // The prop last, so a sword passes in front of the body that holds it
    // rather than being swallowed by a mane.
    if (identity.prop !== "NONE") place(identity.prop);
  }

  /**
   * The visual vocabulary of a blow.
   *
   * Each kind has to be tellable from the others at a glance and at speed, so
   * they differ on three axes at once — colour, shape and motion — rather than
   * on colour alone. A block is cyan, a flat shield on the side it was struck
   * from, and does not shake. A crit is orange, a double ring, and does. A
   * special is violet with a glow at the caster as well as the target. A plain
   * hit is a small white spark. An elimination is a white shockwave.
   */
  private drawEffects(ctx: CanvasRenderingContext2D, scene: Scene): void {
    for (const effect of scene.effects) {
      const t = effect.progress;
      ctx.save();

      // The line back to whoever threw it. Without this, ten combatants trade
      // blows and nothing on screen says who hit whom.
      if (
        effect.fromX !== null && effect.fromY !== null &&
        effect.kind !== "CAST" && t < 0.55
      ) {
        const lead = clamp01(t / 0.55);
        const fade = 1 - lead;
        ctx.globalAlpha = fade * 0.7;
        ctx.strokeStyle = STRIKE_COLOR[effect.kind] ?? "#e2e8f0";
        ctx.lineWidth = effect.kind === "CRIT" ? 1.8 : 1;
        // Drawn as a receding tail rather than a full line: a static line
        // between two sprites reads as a wire, a shrinking one reads as travel.
        const hx = effect.fromX + (effect.x - effect.fromX) * (0.25 + lead * 0.75);
        const hy = effect.fromY + (effect.y - effect.fromY) * (0.25 + lead * 0.75);
        ctx.beginPath();
        ctx.moveTo(effect.fromX + (effect.x - effect.fromX) * lead * 0.6, 
                   effect.fromY + (effect.y - effect.fromY) * lead * 0.6);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      }

      const angle =
        effect.fromX !== null && effect.fromY !== null
          ? Math.atan2(effect.fromY - effect.y, effect.fromX - effect.x)
          : Math.PI;

      // How this body plan delivers a blow. The event, its damage and its
      // timing are the engine's and unchanged; only the shape drawn over the
      // target differs, so a snake's strike does not look like a bear's swipe.
      const style = COMBAT_STYLE[
        (effect.actorId ? this.assets.archetypeFor(effect.actorId) : null) ?? ""
      ] ?? COMBAT_STYLE.default;

      switch (effect.kind) {
        case "GUARD": {
          // A shield arc facing the blow, holding rather than expanding: a
          // block is the absence of impact and should not look like one.
          ctx.globalAlpha = (1 - t) * 0.95;
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 11 + easeOutQuad(t) * 2, angle - 0.9, angle + 0.9);
          ctx.stroke();
          ctx.globalAlpha = (1 - t) * 0.35;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 14 + easeOutQuad(t) * 2, angle - 0.7, angle + 0.7);
          ctx.stroke();
          break;
        }

        case "CRIT": {
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, easeOutCubic(t) * 21, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = (1 - t) * 0.6;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, easeOutCubic(t) * 13, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1 - t;
          ctx.lineWidth = 1.6;
          this.drawSignature(ctx, style, effect.x, effect.y, angle, t, 1.25);
          break;
        }

        case "SPECIAL": {
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = "#c084fc";
          ctx.lineWidth = 1.8;
          // A rotating pair of arcs: unmistakable against the plain rings.
          for (let i = 0; i < 2; i++) {
            // The arcs stop spinning under reduced motion; the violet pair
            // still says "special" without the rotation.
            const a = angle + i * Math.PI + (this.reducedMotion ? 0 : t * 2.2);
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, 8 + easeOutCubic(t) * 11, a, a + 1.6);
            ctx.stroke();
          }
          break;
        }

        case "CAST": {
          // The caster's own glow, so a special reads as something someone did.
          ctx.globalAlpha = (1 - t) * 0.8;
          ctx.strokeStyle = "#a855f7";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 13 - easeOutQuad(t) * 7, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }

        case "DEATH": {
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 2 * (1 - t) + 0.6;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, easeOutCubic(t) * 24, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }

        default: {
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = "#e2e8f0";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, easeOutCubic(t) * 11, 0, Math.PI * 2);
          ctx.stroke();
          this.drawSignature(ctx, style, effect.x, effect.y, angle, t, 1);
        }
      }

      // Damage numbers float and fade. The number itself is the engine's — a
      // blocked hit still did damage, so it is shown, just muted and marked.
      if (typeof effect.value === "number" && effect.value > 0) {
        // Stacked upward by slot, so simultaneous numbers do not overprint.
        const rise = 14 + easeOutCubic(t) * 11 + effect.slot * 10;
        ctx.globalAlpha = 1 - easeOutQuad(t);
        ctx.textAlign = "center";

        if (effect.kind === "CRIT") {
          ctx.fillStyle = "#fb923c";
          ctx.font = "bold 12px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(`${effect.value}!`, effect.x, effect.y - rise);
        } else if (effect.blocked) {
          ctx.fillStyle = "#7dd3fc";
          ctx.font = "bold 9px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText(`${effect.value}`, effect.x, effect.y - rise);
          ctx.font = "bold 7px ui-sans-serif, system-ui, sans-serif";
          ctx.fillText("BLOCK", effect.x, effect.y - rise + 8);
        } else {
          ctx.fillStyle = effect.kind === "SPECIAL" ? "#d8b4fe" : "#f8fafc";
          ctx.font = `bold ${effect.kind === "SPECIAL" ? 11 : 9}px ui-sans-serif, system-ui, sans-serif`;
          ctx.fillText(String(effect.value), effect.x, effect.y - rise);
        }
      }

      ctx.restore();
    }
  }

  /**
   * Marks the MVP once the fight is over.
   *
   * A ring and a chevron rather than a label: the name is already on the
   * results screen, and at twenty-two pixels a word is unreadable anyway. The
   * character is the engine's choice; all this decides is where to draw.
   */
  private drawMvp(ctx: CanvasRenderingContext2D, scene: Scene): void {
    const mvp = scene.combatants.find((c) => c.characterId === scene.mvpCharacterId);
    if (!mvp) return;

    const t = easeOutCubic(scene.outro);
    const half = SPRITE_SIZE / 2;
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(scene.elapsedMs / 260) * 0.06;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(
      mvp.x, mvp.y + half,
      (SPRITE_SIZE / 2.1) * pulse, (SPRITE_SIZE / 5.5) * pulse,
      0, 0, Math.PI * 2,
    );
    ctx.stroke();

    // A chevron above the head, dropping into place.
    const top = mvp.y - half - 8 - (this.reducedMotion ? 0 : (1 - t) * 10);
    ctx.fillStyle = "#facc15";
    ctx.beginPath();
    ctx.moveTo(mvp.x, top + 5);
    ctx.lineTo(mvp.x - 4, top);
    ctx.lineTo(mvp.x - 2, top);
    ctx.lineTo(mvp.x, top + 2.5);
    ctx.lineTo(mvp.x + 2, top);
    ctx.lineTo(mvp.x + 4, top);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * The mark a body plan leaves on the thing it hits.
   *
   * Claw rakes for a quadruped, a pair of fang punctures for a serpent, a
   * downward talon sweep for a flier, a wave front for a swimmer, a straight
   * swing arc for a humanoid. All of them are the same event with the same
   * damage at the same instant — the engine decided everything; this decides
   * only what the blow looks like coming from that anatomy.
   */
  private drawSignature(
    ctx: CanvasRenderingContext2D,
    style: CombatStyle,
    x: number,
    y: number,
    angle: number,
    t: number,
    weight: number,
  ): void {
    const reach = (6 + easeOutCubic(t) * 9) * weight;
    const fade = 1 - t;
    // The blow arrives from `angle`, so marks are laid across that direction.
    const across = angle + Math.PI / 2;

    switch (style) {
      case "CLAW": {
        // Three parallel rakes.
        for (let i = -1; i <= 1; i++) {
          const offset = i * 4 * weight;
          const cx = x + Math.cos(across) * offset;
          const cy = y + Math.sin(across) * offset;
          ctx.beginPath();
          ctx.moveTo(cx - Math.cos(angle) * reach * 0.6, cy - Math.sin(angle) * reach * 0.6);
          ctx.lineTo(cx + Math.cos(angle) * reach * 0.5, cy + Math.sin(angle) * reach * 0.5);
          ctx.stroke();
        }
        break;
      }
      case "FANG": {
        // Two punctures, close together, driven inward.
        for (const side of [-1, 1]) {
          const cx = x + Math.cos(across) * side * 2.5 * weight;
          const cy = y + Math.sin(across) * side * 2.5 * weight;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * reach * 0.55, cy + Math.sin(angle) * reach * 0.55);
          ctx.lineTo(cx, cy);
          ctx.stroke();
        }
        break;
      }
      case "TALON": {
        // A hooked sweep, coming down out of the dive.
        ctx.beginPath();
        ctx.arc(x, y, reach * 0.8, angle - 1.1, angle + 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle + 0.5) * reach * 0.8, y + Math.sin(angle + 0.5) * reach * 0.8);
        ctx.lineTo(x + Math.cos(angle + 0.9) * reach * 0.4, y + Math.sin(angle + 0.9) * reach * 0.4);
        ctx.stroke();
        break;
      }
      case "WAVE": {
        // Concentric fronts washing outward.
        for (let i = 0; i < 2; i++) {
          ctx.globalAlpha = fade * (1 - i * 0.4);
          ctx.beginPath();
          ctx.arc(x, y, reach * (0.6 + i * 0.5), angle - 1.4, angle + 1.4);
          ctx.stroke();
        }
        ctx.globalAlpha = fade;
        break;
      }
      case "SWING": {
        // One wide arc, the way a swung arm or weapon lands.
        ctx.beginPath();
        ctx.arc(x, y, reach * 0.9, angle - 1.5, angle + 0.4);
        ctx.stroke();
        break;
      }
    }
  }

  /**
   * Sparks, straight from the scene.
   *
   * The renderer used to own a pool and emit into it from `renderAt`, which
   * made drawing a frame a mutation: scrubbing back to the same millisecond
   * produced different sparks, and the benchmark's tight loop filled the arena
   * with debris. The scene now derives them from the clock instead.
   */
  private drawParticles(ctx: CanvasRenderingContext2D, scene: Scene): void {
    ctx.save();
    for (const p of scene.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = PARTICLE_COLOR[p.kind];
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  /** Banners are screen-space, so the camera shake does not wobble the text. */
  private drawBanner(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (!scene.banner) return;
    const { text, progress, kind } = scene.banner;

    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width || this.canvas.width;
    const height = rect.height || this.canvas.height;

    // In for a fifth, then hold — except a phase divider, which fades back out.
    // The victory band is the final state of the replay and must not vanish
    // before playback stops, which is exactly what it used to do.
    const fadesOut = kind === "PHASE";
    const alpha =
      progress < 0.2
        ? progress / 0.2
        : fadesOut && progress > 0.8
          ? (1 - progress) / 0.2
          : 1;
    const slide = this.reducedMotion
      ? 0
      : (1 - easeOutBack(clamp01(progress / 0.2))) * 16;

    ctx.save();
    ctx.globalAlpha = clamp01(alpha);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // A turning point sits centred like a title card. Left at the top it drew a
    // second dark band directly under the cinematic's letterbox bar, which read
    // as two stacked bars rather than one moment.
    const centred = kind === "VICTORY" || kind === "TURNING_POINT";
    const y = centred ? height / 2 : height * 0.18;
    const tall = centred;

    const bandHalf = Math.round((tall ? 20 : 14) * (clamp01((height - 220) / 520) * 0.6 + 0.7));
    ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
    ctx.fillRect(0, y - bandHalf + slide, width, bandHalf * 2);

    // A turning point and an upset get a rule above and below the band. It is
    // the cheapest way to make a beat feel bigger than a phase divider without
    // moving the camera, which would fight the shake already happening.
    if (tall) {
      ctx.strokeStyle = kind === "TURNING_POINT" ? "#f59e0b" : "#22c55e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y - bandHalf + slide);
      ctx.lineTo(width, y - bandHalf + slide);
      ctx.moveTo(0, y + bandHalf + slide);
      ctx.lineTo(width, y + bandHalf + slide);
      ctx.stroke();
    }

    ctx.fillStyle =
      kind === "TURNING_POINT" ? "#f59e0b" : kind === "VICTORY" ? "#22c55e" : "#e2e8f0";
    const scale = clamp01((height - 220) / 520) * 0.6 + 0.7;
    const size = Math.round((kind === "VICTORY" ? 18 : 13) * scale);
    ctx.font = `bold ${size}px ui-sans-serif, system-ui, sans-serif`;
    // Long victory lines have to fit the arena, not run off the side of it.
    ctx.fillText(text, width / 2, y + slide, width * 0.92);

    // The upset is announced by the cinematic stamp, not here — two labels
    // saying the same word at the same moment read as a bug.
    ctx.restore();
  }

  /**
   * Turns newly focused events into sparks, once each.
   *
   * Particles are the one thing that cannot be derived from the clock alone —
   * they have their own drift — so this guards on the event index rather than
   * on time, and a scrub backwards simply replays them.
   */
}
