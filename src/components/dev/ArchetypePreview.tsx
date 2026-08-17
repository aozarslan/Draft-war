"use client";

/**
 * ---------------------------------------------------------------------------
 * ARCHETYPE PREVIEW (development)
 * ---------------------------------------------------------------------------
 * Plays every clip of one body plan side by side, tinted with a real
 * character's palette.
 *
 * A battle is a bad place to judge animation: the interesting frames last a
 * fifth of a second and something is always in front of them. This draws each
 * clip on a loop at whatever scale is asked for, which is how the retimings in
 * `scripts/generate-sprites.ts` were actually checked — and it is where a
 * flickering tint or a sprite standing off its own ground line is obvious.
 */

import { useEffect, useRef } from "react";
import type { AnimationHint } from "@/lib/game/replay";
import { AssetStore, type CharacterArt } from "@/lib/render/assets";
import { SHEET_CLIPS, SHEET_GROUND_RATIO } from "@/lib/render/archetypes";

const CLIPS: AnimationHint[] = [
  "IDLE", "ATTACK", "CAST", "GUARD", "IMPACT", "DEATH", "CHEER",
];

/** How long one pass of each clip takes. Looping clips just repeat. */
const CLIP_MS: Record<string, number> = {
  IDLE: 1400, ATTACK: 700, CAST: 1100, GUARD: 700,
  IMPACT: 500, DEATH: 1400, CHEER: 900,
};

export function ArchetypePreview({
  art,
  scale = 3,
}: {
  art: CharacterArt;
  scale?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !art.sheet) return;

    const frame = art.sheet.frameHeight;
    const cell = frame * scale;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = cell * CLIPS.length * dpr;
    canvas.height = (cell + 16) * dpr;
    canvas.style.width = `${cell * CLIPS.length}px`;
    canvas.style.height = `${cell + 16}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const store = new AssetStore([art]);
    store.preload();

    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;

      CLIPS.forEach((hint, i) => {
        const clip = SHEET_CLIPS[hint];
        const elapsed = (now - start) % CLIP_MS[hint];
        const progress = elapsed / CLIP_MS[hint];
        const sprite = store.spriteFor(art.characterId, hint, progress);
        const x = i * cell;

        // The ground line every clip stands on, so a pose that drifts off it
        // shows up immediately.
        ctx.strokeStyle = "rgba(148,163,184,0.25)";
        ctx.beginPath();
        ctx.moveTo(x + 4, SHEET_GROUND_RATIO * cell);
        ctx.lineTo(x + cell - 4, SHEET_GROUND_RATIO * cell);
        ctx.stroke();

        if (sprite.kind === "SHEET") {
          ctx.drawImage(
            sprite.image,
            sprite.frame * sprite.sheet.frameWidth,
            sprite.row * sprite.sheet.frameHeight,
            sprite.sheet.frameWidth,
            sprite.sheet.frameHeight,
            x, 0, cell, cell,
          );
        }

        ctx.fillStyle = "#94a3b8";
        ctx.font = "10px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${hint} ${clip.frames}`, x + cell / 2, cell + 11);
      });

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      store.dispose();
    };
  }, [art, scale]);

  if (!art.sheet) {
    return (
      <p className="text-xs text-slate-500">
        {art.name} için sprite sheet yok — portre/palet yoluna düşüyor.
      </p>
    );
  }

  return <canvas ref={ref} className="max-w-full" />;
}
