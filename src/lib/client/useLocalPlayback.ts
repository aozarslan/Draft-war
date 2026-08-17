"use client";

/**
 * ---------------------------------------------------------------------------
 * LOCAL PLAYBACK
 * ---------------------------------------------------------------------------
 * A clock for a battle that is already over.
 *
 * A live match reads `serverNow() - battleStartedAt`, because four phones have
 * to stay in step with each other. A finished match has nobody to stay in step
 * with: it is a recording, and a recording wants play, pause, restart and a
 * scrub bar. Using the server clock here would be worse than useless — the
 * battle ended weeks ago, so every viewer would open the page on the final
 * frame forever.
 *
 * What does **not** change is the thing being drawn. The renderer still asks
 * `sceneAt(replay, elapsed)`; only where `elapsed` comes from differs. The
 * same replay at the same elapsed produces the same scene here as it does in a
 * live room, which is the property the whole architecture rests on.
 *
 * The elapsed value lives in a ref and is advanced by `requestAnimationFrame`,
 * so the renderer can sample it every frame without React re-rendering. A
 * separate, slow piece of state drives the scrub bar — a progress indicator
 * updating ten times a second is fine; a component tree re-rendering sixty
 * times a second is not.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface LocalPlayback {
  /** Sampled by the renderer, every frame. Never triggers a React render. */
  elapsedMs: () => number;
  /** Sampled by the UI, a few times a second. */
  displayMs: number;
  playing: boolean;
  finished: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  restart: () => void;
  /** Jump to a moment. Deterministic: the scene there is the scene there. */
  seek: (ms: number) => void;
}

/** How often the scrub bar's state updates. Nowhere near the frame rate. */
const DISPLAY_INTERVAL_MS = 100;

export function useLocalPlayback(durationMs: number): LocalPlayback {
  const elapsedRef = useRef(0);
  const [displayMs, setDisplayMs] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Reset when the recording itself changes.
  useEffect(() => {
    elapsedRef.current = 0;
    setDisplayMs(0);
    setPlaying(true);
  }, [durationMs]);

  // The advancing clock. It stops itself at the end rather than running past
  // it, so the last frame holds instead of the outro looping forever.
  useEffect(() => {
    if (!playing || durationMs <= 0) return;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsedRef.current = Math.min(durationMs, elapsedRef.current + (now - last));
      last = now;
      if (elapsedRef.current >= durationMs) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, durationMs]);

  // The scrub bar's own slow pulse, deliberately decoupled from the frame loop.
  useEffect(() => {
    const id = setInterval(() => setDisplayMs(elapsedRef.current), DISPLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const seek = useCallback(
    (ms: number) => {
      elapsedRef.current = Math.min(durationMs, Math.max(0, ms));
      setDisplayMs(elapsedRef.current);
    },
    [durationMs],
  );

  const restart = useCallback(() => {
    seek(0);
    setPlaying(true);
  }, [seek]);

  return {
    elapsedMs: useCallback(() => elapsedRef.current, []),
    displayMs,
    playing,
    finished: displayMs >= durationMs && durationMs > 0,
    play: useCallback(() => setPlaying(true), []),
    pause: useCallback(() => setPlaying(false), []),
    toggle: useCallback(() => setPlaying((p) => !p), []),
    restart,
    seek,
  };
}
