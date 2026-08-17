"use client";

/**
 * ---------------------------------------------------------------------------
 * BATTLE CANVAS
 * ---------------------------------------------------------------------------
 * The bridge between the game and the renderer, and deliberately the thinnest
 * thing that can be one.
 *
 * It does three things: hand the renderer a replay, hand it a clock, and give
 * it a canvas to draw on. It owns no battle state, decides no outcome and
 * keeps no timeline of its own — the clock it passes is the room's existing
 * `serverNow()` minus the room's existing `battleStartedAt`, which is what
 * already kept four phones frame-aligned before any of this was drawn.
 *
 * It also deliberately does not re-render per frame. The renderer runs its own
 * `requestAnimationFrame` loop and reads the clock through a ref, so React
 * reconciliation never sits inside the frame budget. A `useState` ticking at
 * 60Hz would put the whole component tree in the render path of every frame.
 */

import { useEffect, useRef } from "react";
import { BattleRenderer } from "@/lib/render/canvas";
import type { CharacterArt } from "@/lib/render/assets";
import type { Interactions } from "@/lib/render/interactions";
import type { Replay } from "@/lib/game/replay";

export function BattleCanvas({
  replay,
  art,
  interactions,
  teamColors,
  elapsedMs,
  reducedMotion,
  className,
}: {
  replay: Replay;
  art: CharacterArt[];
  interactions?: Interactions;
  teamColors: Record<string, string>;
  /**
   * The authoritative elapsed time, as a function.
   *
   * A function rather than a number so the renderer can sample it every frame
   * without React re-rendering. The caller computes it from the room's server
   * clock; nothing here adjusts, smooths or extrapolates it.
   */
  elapsedMs: () => number;
  reducedMotion?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Held in a ref so a new closure from the parent does not tear down and
  // rebuild the renderer — which would drop every composed sprite it cached.
  const clockRef = useRef(elapsedMs);
  clockRef.current = elapsedMs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new BattleRenderer({
      canvas,
      replay,
      art,
      interactions,
      teamColors,
      reducedMotion,
      clock: () => clockRef.current(),
    });
    renderer.start();

    // The canvas is laid out by CSS, so its backing store has to follow the
    // element rather than the window: a sidebar collapsing changes one and not
    // the other.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => renderer.resize());
    observer?.observe(canvas);

    return () => {
      observer?.disconnect();
      renderer.dispose();
    };
  }, [replay, art, interactions, teamColors, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // Pixel art: the browser must not smooth it when the backing store and
      // the element size disagree.
      style={{ imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}
