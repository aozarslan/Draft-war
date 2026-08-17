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
import { AssetStore, type CharacterArt } from "./assets";
import { SHEET_GROUND_RATIO } from "./archetypes";
import { ParticlePool } from "./particles";
import { ARENA, sceneAt, type Scene, type SceneCombatant } from "./scene";
import { clamp01, easeOutBack, easeOutCubic, easeOutQuad } from "./easing";

export interface BattleRendererOptions {
  canvas: HTMLCanvasElement;
  replay: Replay;
  art?: CharacterArt[];
  /** Elapsed milliseconds since the battle started. Owned by the caller. */
  clock: () => number;
  /** Team colour per playerId, from PLAYER_COLORS. */
  teamColors?: Record<string, string>;
  /** Reduce motion: no shake, no particles. Read from the media query. */
  reducedMotion?: boolean;
}

const SPRITE_SIZE = 22; // arena units
/** A sprite frame is mostly empty, so it is drawn larger than the disc it replaces. */
const SHEET_SCALE = 1.5;
/** How many frames the performance meter averages over. */
const SAMPLE_FRAMES = 120;
/**
 * The furthest the camera ever strays from centre: the largest shake plus the
 * pan toward a focused event. The ground is filled to cover exactly this and
 * no more.
 */
const MAX_CAMERA_OFFSET = 24;
const BAR_WIDTH = 22;
const BAR_HEIGHT = 3;

export class BattleRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly replay: Replay;
  private readonly assets: AssetStore;
  private readonly particles = new ParticlePool(320);
  private readonly clock: () => number;
  private readonly teamColors: Record<string, string>;
  private readonly reducedMotion: boolean;

  private frame = 0;
  private lastTs = 0;
  private running = false;
  /** Which events have already thrown sparks, so a repaint does not re-emit. */
  private sparked = new Set<number>();
  private readonly frameTimes: number[] = [];
  private readonly intervals: number[] = [];
  private scale = 1;
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
    this.assets = new AssetStore(options.art ?? []);
    this.assets.setOnReady(() => {
      if (!this.running) this.renderAt(this.clock());
    });
    this.assets.preload();
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
      this.particles.update(dt);

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
    this.particles.clear();
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
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.width));
    const height = Math.max(1, Math.round(rect.height || this.canvas.height));

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Letterbox the arena so it never distorts, whatever the container is.
    this.scale = Math.min(width / ARENA.width, height / ARENA.height);
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

    this.emitSparks(scene);

    ctx.save();
    // World transform: letterbox, then camera.
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    const cam = this.reducedMotion
      ? { x: ARENA.width / 2, y: ARENA.height / 2, zoom: 1 }
      : scene.camera;
    ctx.translate(ARENA.width / 2, ARENA.height / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    this.drawGround(ctx);

    // Painter's order: farther up the screen is farther away.
    const ordered = [...scene.combatants].sort((a, b) => a.y - b.y);
    for (const c of ordered) this.drawCombatant(ctx, c, scene.showHealth);

    this.drawEffects(ctx, scene);
    if (scene.mvpCharacterId) this.drawMvp(ctx, scene);
    if (!this.reducedMotion) this.drawParticles(ctx);

    ctx.restore();

    this.drawBanner(ctx, scene);
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
    const x = c.x + c.lunge;
    const y = c.y;

    ctx.save();
    ctx.globalAlpha = c.opacity;

    // Shadow first: it is what stops a sprite floating.
    const feetY = y + SPRITE_SIZE / 2;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, feetY, SPRITE_SIZE / 2.4, SPRITE_SIZE / 6, 0, 0, Math.PI * 2);
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
      ctx.ellipse(x, feetY, SPRITE_SIZE / 2.4, SPRITE_SIZE / 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = c.opacity;
    }

    const sprite = this.assets.spriteFor(c.characterId, c.animation, c.animationProgress);
    const half = SPRITE_SIZE / 2;

    if (sprite.kind === "SHEET") {
      const { sheet, frame, row, image } = sprite;
      // Anchored by the ground line, not the centre: a frame is mostly empty
      // air above the animal, so centring it leaves the sprite hovering over
      // its own shadow.
      const drawSize = SPRITE_SIZE * SHEET_SCALE;
      const feet = y + SPRITE_SIZE / 2;
      ctx.save();
      ctx.translate(x, feet - SHEET_GROUND_RATIO * drawSize);
      ctx.scale(c.facing, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        image,
        frame * sheet.frameWidth,
        row * sheet.frameHeight,
        sheet.frameWidth,
        sheet.frameHeight,
        -drawSize / 2,
        0,
        drawSize,
        drawSize,
      );
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
      const by = y - half - 6;
      ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
      ctx.fillRect(bx, by, BAR_WIDTH, BAR_HEIGHT);
      ctx.fillStyle =
        c.health > 0.5 ? "#22c55e" : c.health > 0.2 ? "#f59e0b" : "#ef4444";
      ctx.fillRect(bx, by, BAR_WIDTH * c.health, BAR_HEIGHT);
    }

    ctx.restore();
  }

  private drawEffects(ctx: CanvasRenderingContext2D, scene: Scene): void {
    for (const effect of scene.effects) {
      const t = effect.progress;
      ctx.save();

      if (effect.kind === "GUARD") {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, 12 + easeOutQuad(t) * 5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === "DEATH") {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, easeOutCubic(t) * 22, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const color =
          effect.kind === "CRIT" ? "#f97316" : effect.kind === "SPECIAL" ? "#a855f7" : "#e2e8f0";
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = color;
        ctx.lineWidth = effect.kind === "CRIT" ? 2 : 1.2;
        const r = easeOutCubic(t) * (effect.kind === "CRIT" ? 20 : 14);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Damage numbers float and fade. The number itself is the engine's.
      if (typeof effect.value === "number" && effect.value > 0) {
        ctx.globalAlpha = 1 - easeOutQuad(t);
        ctx.fillStyle = effect.kind === "CRIT" ? "#fb923c" : "#f8fafc";
        ctx.font = `bold ${effect.kind === "CRIT" ? 11 : 9}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(String(effect.value), effect.x, effect.y - 14 - easeOutCubic(t) * 10);
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
    const pulse = 1 + Math.sin(scene.elapsedMs / 260) * 0.06;

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
    const top = mvp.y - half - 8 - (1 - t) * 10;
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

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    this.particles.forEach((p) => {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
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
    const slide = (1 - easeOutBack(clamp01(progress / 0.2))) * 16;

    ctx.save();
    ctx.globalAlpha = clamp01(alpha);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const y = kind === "VICTORY" ? height / 2 : height * 0.18;
    const tall = kind === "TURNING_POINT" || kind === "VICTORY";

    ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
    ctx.fillRect(0, y - (tall ? 20 : 14) + slide, width, tall ? 40 : 28);

    // A turning point and an upset get a rule above and below the band. It is
    // the cheapest way to make a beat feel bigger than a phase divider without
    // moving the camera, which would fight the shake already happening.
    if (tall) {
      ctx.strokeStyle = kind === "TURNING_POINT" ? "#f59e0b" : "#22c55e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y - 20 + slide);
      ctx.lineTo(width, y - 20 + slide);
      ctx.moveTo(0, y + 20 + slide);
      ctx.lineTo(width, y + 20 + slide);
      ctx.stroke();
    }

    ctx.fillStyle =
      kind === "TURNING_POINT" ? "#f59e0b" : kind === "VICTORY" ? "#22c55e" : "#e2e8f0";
    ctx.font = `bold ${kind === "VICTORY" ? 18 : 13}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(text, width / 2, y + slide);

    // An upset says so, under the result. The engine decided it was one; this
    // only makes that visible instead of leaving it in a results table.
    if (kind === "VICTORY" && scene.upset) {
      ctx.fillStyle = "#f472b6";
      ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("UPSET", width / 2, y + 26 + slide);
    }
    ctx.restore();
  }

  /**
   * Turns newly focused events into sparks, once each.
   *
   * Particles are the one thing that cannot be derived from the clock alone —
   * they have their own drift — so this guards on the event index rather than
   * on time, and a scrub backwards simply replays them.
   */
  private emitSparks(scene: Scene): void {
    if (this.reducedMotion) return;
    const index = scene.focusEventIndex;
    if (index === null || this.sparked.has(index)) return;
    this.sparked.add(index);

    const event = this.replay.events[index];
    const target = scene.combatants.find((c) => c.characterId === event.targetId);
    if (!target) return;

    if (event.kind === "ELIMINATION") {
      this.particles.burst({
        x: target.x, y: target.y, count: 24, color: "#f8fafc",
        speed: 90, spread: Math.PI, size: 2.2, lifeSeconds: 0.8, seed: index + 1,
      });
    } else if (event.kind === "CRIT") {
      this.particles.burst({
        x: target.x, y: target.y, count: 14, color: "#fb923c",
        speed: 80, spread: Math.PI, size: 2, lifeSeconds: 0.5, seed: index + 1,
      });
    } else if (event.kind === "SPECIAL") {
      this.particles.burst({
        x: target.x, y: target.y, count: 16, color: "#c084fc",
        speed: 60, spread: Math.PI, size: 1.8, lifeSeconds: 0.7, seed: index + 1,
      });
    }
  }
}
