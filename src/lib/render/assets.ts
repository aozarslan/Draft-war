/**
 * ---------------------------------------------------------------------------
 * ASSETS
 * ---------------------------------------------------------------------------
 * Sprite sheets, and what to draw when there are none.
 *
 * There is no pixel art in the repository yet, and there will not be for
 * several milestones. That is exactly why the fallback comes first: a renderer
 * that only works once the art lands cannot be tested until the art lands, and
 * by then it is too late to find out the pipeline was wrong. Everything here is
 * built so a battle draws *something* honest with zero sprites — a portrait or
 * a palette disc — and quietly upgrades to a sheet the moment one is registered.
 *
 * Loading is lazy and non-blocking: `spriteFor()` never waits. It returns what
 * is ready now and starts a fetch for what is not, so a slow image can never
 * stall a frame or desynchronise playback. Playback is a function of the clock,
 * not of what finished downloading.
 */

import type { AnimationHint } from "@/lib/game/replay";
import type { IdentityConfig } from "./identity";

/** One animation strip inside a sheet: a row of equally sized frames. */
export interface SpriteClip {
  /** Row index in the sheet. */
  row: number;
  frames: number;
  /** Whether the strip repeats or holds its last frame. */
  loop: boolean;
}

export interface SpriteSheet {
  src: string;
  frameWidth: number;
  frameHeight: number;
  clips: Partial<Record<AnimationHint, SpriteClip>>;
}

/**
 * What the draw layer receives.
 *
 * A discriminated union rather than a nullable sheet, because the two cases
 * are drawn completely differently and the caller must not be able to forget
 * one of them.
 */
export type Drawable =
  | {
      kind: "SHEET";
      image: CanvasImageSource;
      sheet: SpriteSheet;
      /** Column in the sheet. */
      frame: number;
      /** Row in the sheet, i.e. which clip. */
      row: number;
    }
  | { kind: "PORTRAIT"; image: CanvasImageSource }
  | { kind: "PLACEHOLDER"; palette: [string, string]; initials: string };

/** Which frame of a clip is showing at `progress` through it. */
export function frameAt(clip: SpriteClip, progress: number): number {
  if (clip.frames <= 1) return 0;
  const p = progress < 0 ? 0 : progress;
  if (clip.loop) return Math.floor(p * clip.frames) % clip.frames;
  return Math.min(clip.frames - 1, Math.floor(p * clip.frames));
}

/** Initials for the placeholder, so five discs are still tellable apart. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface CharacterArt {
  characterId: string;
  name: string;
  palette: [string, string];
  /**
   * What separates this character from the others sharing its body plan.
   *
   * Optional so a caller that only has a portrait can still build art, but the
   * catalogue always supplies one.
   */
  identity?: IdentityConfig;
  /** Wikimedia thumbnail, when the character has one. */
  portraitUrl: string | null;
  /** Registered sprite sheet. None exist yet; the field is the seam. */
  sheet?: SpriteSheet;
  /** Which body plan drew the sheet, for looking up its anchors. */
  archetype?: string;
}

type Slot = { image: HTMLImageElement; ready: boolean; failed: boolean };

/** Where the identity tiles live. One sheet for every body plan. */
export const IDENTITY_TILES_SRC = "/sprites/identity.png";

/** Multiplies a flat colour through a greyscale sheet, keeping its alpha. */
function flatTint(
  image: CanvasImageSource,
  width: number,
  height: number,
  colour: string,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/**
 * Recolours a greyscale sheet with a character's palette.
 *
 * Sheets are drawn without colour so that one body plan can serve forty
 * animals: a lion and a wolf are the same silhouette in different palettes.
 * Multiplying preserves the shading and the dark outline instead of flattening
 * the sprite into a silhouette, which is what a plain fill would do.
 *
 * The result is cached per (sheet, palette) — there are far fewer palettes in a
 * battle than there are frames drawn per second.
 */
function tintSheet(
  image: CanvasImageSource,
  width: number,
  height: number,
  frameHeight: number,
  palette: [string, string],
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0);

  ctx.globalCompositeOperation = "multiply";
  // The gradient repeats per row of frames, top-down. Spanning it across the
  // whole sheet would make one animal a different colour in each frame, which
  // reads as flickering the moment a clip plays.
  for (let top = 0; top < height; top += frameHeight) {
    const gradient = ctx.createLinearGradient(0, top, 0, top + frameHeight);
    gradient.addColorStop(0, palette[1]);
    gradient.addColorStop(1, palette[0]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, top, width, frameHeight);
  }

  // Multiply paints whole rectangles; this clips them back to the sprite.
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(image, 0, 0);

  return canvas;
}

/**
 * Holds decoded images for one battle.
 *
 * Deliberately a plain class and not a React hook or a module singleton: the
 * canvas owns one, and it dies with the canvas. A module-level cache would
 * outlive the battle and leak every portrait the player ever watched.
 */
export class AssetStore {
  private readonly art = new Map<string, CharacterArt>();
  private readonly images = new Map<string, Slot>();
  private readonly tints = new Map<string, HTMLCanvasElement | null>();
  private readonly flats = new Map<string, HTMLCanvasElement | null>();
  private onReady: (() => void) | null = null;

  constructor(art: CharacterArt[] = []) {
    for (const a of art) this.art.set(a.characterId, a);
  }

  /** Called when a late image finishes, so a paused canvas can repaint. */
  setOnReady(callback: (() => void) | null): void {
    this.onReady = callback;
  }

  register(art: CharacterArt): void {
    this.art.set(art.characterId, art);
  }

  /**
   * What to draw for this character right now.
   *
   * Never throws, never returns nothing: a character with no art at all still
   * gets a palette disc, which is enough to read a battle.
   */
  spriteFor(
    characterId: string,
    animation: AnimationHint,
    progress: number,
  ): Drawable {
    const art = this.art.get(characterId);
    if (!art) {
      return { kind: "PLACEHOLDER", palette: ["#334155", "#0f172a"], initials: "?" };
    }

    const clip = art.sheet?.clips[animation] ?? art.sheet?.clips.IDLE;
    if (art.sheet && clip) {
      const slot = this.load(art.sheet.src);
      if (slot?.ready) {
        return {
          kind: "SHEET",
          image: this.tinted(art) ?? slot.image,
          sheet: art.sheet,
          frame: frameAt(clip, progress),
          row: clip.row,
        };
      }
    }

    if (art.portraitUrl) {
      const slot = this.load(art.portraitUrl);
      if (slot?.ready) return { kind: "PORTRAIT", image: slot.image };
    }

    return {
      kind: "PLACEHOLDER",
      palette: art.palette,
      initials: initialsOf(art.name),
    };
  }

  /** What separates this character from its archetype's other tenants. */
  identityFor(characterId: string): IdentityConfig | null {
    return this.art.get(characterId)?.identity ?? null;
  }

  /** Which body plan this character is drawn with. */
  archetypeFor(characterId: string): string | null {
    return this.art.get(characterId)?.archetype ?? null;
  }

  /**
   * The identity tile sheet, flooded with one character's accent.
   *
   * Flat rather than gradient-tinted: a tile is a single feature a few pixels
   * across, and shading it across its own height only muddies the shape. The
   * greyscale still shows through as the shape's own light and dark because
   * the flood multiplies rather than replaces.
   */
  tiles(accent: string): HTMLCanvasElement | null {
    const cached = this.flats.get(accent);
    if (cached !== undefined) return cached;

    const slot = this.load(IDENTITY_TILES_SRC);
    if (!slot?.ready) return null;

    const canvas = flatTint(
      slot.image,
      slot.image.naturalWidth,
      slot.image.naturalHeight,
      accent,
    );
    this.flats.set(accent, canvas);
    return canvas;
  }

  /** Starts the tile sheet loading alongside the bodies. */
  preloadTiles(): void {
    this.load(IDENTITY_TILES_SRC);
  }

  /** Which row of the sheet an animation lives on, for the draw layer. */
  clipRow(characterId: string, animation: AnimationHint): number {
    const sheet = this.art.get(characterId)?.sheet;
    return (sheet?.clips[animation] ?? sheet?.clips.IDLE)?.row ?? 0;
  }

  /** Starts every portrait fetching, so the first frames are not all discs. */
  preload(): void {
    for (const art of this.art.values()) {
      if (art.sheet) this.load(art.sheet.src);
      else if (art.portraitUrl) this.load(art.portraitUrl);
    }
  }

  /** Releases handles. The canvas calls this on unmount. */
  dispose(): void {
    for (const slot of this.images.values()) slot.image.src = "";
    this.images.clear();
    this.tints.clear();
    this.flats.clear();
    this.onReady = null;
  }

  /** The character's sheet in its own colours, built once and kept. */
  private tinted(art: CharacterArt): HTMLCanvasElement | null {
    if (!art.sheet) return null;
    const key = `${art.sheet.src}|${art.palette[0]}|${art.palette[1]}`;
    const cached = this.tints.get(key);
    if (cached !== undefined) return cached;

    const slot = this.images.get(art.sheet.src);
    if (!slot?.ready) return null;

    const canvas = tintSheet(
      slot.image,
      slot.image.naturalWidth || art.sheet.frameWidth,
      slot.image.naturalHeight || art.sheet.frameHeight,
      art.sheet.frameHeight,
      art.palette,
    );
    this.tints.set(key, canvas);
    return canvas;
  }

  private load(src: string): Slot | null {
    const existing = this.images.get(src);
    if (existing) return existing.failed ? null : existing;
    if (typeof window === "undefined") return null;

    const image = new window.Image();
    const slot: Slot = { image, ready: false, failed: false };
    this.images.set(src, slot);

    image.crossOrigin = "anonymous";
    image.onload = () => {
      slot.ready = true;
      this.onReady?.();
    };
    // A missing portrait is not an error worth surfacing — it falls back to the
    // palette disc and the battle plays on.
    image.onerror = () => {
      slot.failed = true;
    };
    image.src = src;

    return slot;
  }
}
