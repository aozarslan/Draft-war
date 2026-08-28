"use client";

import { useEffect, useRef, useState } from "react";
import { activeCue, type NarrativeCue } from "@/lib/render/narrative";

/**
 * The battle's narration, as text.
 *
 * The arena is a canvas and the canvas is `aria-hidden`, because a bitmap has
 * nothing to offer a screen reader. That makes this region the *only* way the
 * narrative reaches someone not looking at the picture — so it is not a
 * caption or a nicety, it is the other half of the same information.
 *
 * Two things make it usable rather than hostile:
 *
 *  - **It announces cue changes, not frames.** The clock ticks sixty times a
 *    second; a live region wired to it would produce an unusable stream of
 *    speech. This samples slowly and writes only when the cue actually
 *    changes, so a viewer hears "Turning point" once.
 *  - **It is polite.** An assertive region interrupts whatever is being read,
 *    which during a battle means interrupting the battle log.
 *
 * It also carries the same reduced-motion contract as the canvas: the words
 * are identical either way. Calm motion removes movement, never meaning.
 */
export function BattleNarration({
  cues,
  elapsedMs,
  className,
}: {
  cues: NarrativeCue[];
  /** The caller's clock, sampled here rather than passed as a changing prop. */
  elapsedMs: () => number;
  className?: string;
}) {
  const [cue, setCue] = useState<NarrativeCue | null>(null);
  // Held in a ref as well so the interval can compare without re-subscribing
  // every time the cue changes.
  const shown = useRef<NarrativeCue | null>(null);

  useEffect(() => {
    const sample = () => {
      const next = activeCue(cues, elapsedMs());
      if (next === shown.current) return;
      shown.current = next;
      setCue(next);
    };
    sample();
    const id = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(id);
  }, [cues, elapsedMs]);

  return (
    <p
      aria-live="polite"
      className={
        className ??
        "min-h-[1.5rem] text-center text-xs font-black uppercase tracking-[0.2em] text-white/50"
      }
    >
      {cue ? spoken(cue) : ""}
    </p>
  );
}

/**
 * What the region reads out.
 *
 * Some cues already say their own label. A phase divider's line is
 * "ENGAGEMENT · ROUND 3", a last stand's card reads "LAST STAND", and the
 * final clash writes "FINAL CLASH · ROUND 8" — prefixing any of them produces
 * an echo: "Last stand: LAST STAND", "Final clash: FINAL CLASH · ROUND 8".
 *
 * So the prefix is dropped whenever the line already opens with it. Compared
 * case-insensitively because the card shouts and the label does not; they are
 * the same words either way.
 *
 * Named cues keep the prefix: "Turning point" is the part that tells a
 * listener why they are being interrupted, and the line itself does not say
 * it.
 */
function spoken(cue: NarrativeCue): string {
  const echoes = cue.text.toUpperCase().startsWith(cue.label.toUpperCase());
  return echoes ? cue.text : `${cue.label}: ${cue.text}`;
}

/**
 * How often the cue is sampled.
 *
 * Well below the frame rate and well above human reading speed: a cue holds
 * the screen for at least 1.2 seconds, so a fifth of a second cannot miss one
 * while costing nothing.
 */
const SAMPLE_MS = 200;
