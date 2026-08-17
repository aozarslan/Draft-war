/**
 * ---------------------------------------------------------------------------
 * EASING (pure)
 * ---------------------------------------------------------------------------
 * The whole tween vocabulary the battle renderer needs, and nothing else.
 *
 * Every function here is a pure map from 0..1 to a number. That matters more
 * than it sounds: it is what lets the scene be a function of elapsed time
 * rather than of accumulated frames. A renderer that advances state per frame
 * drifts between two phones with different frame rates; one that asks "what
 * does this look like at 4.2 seconds" cannot.
 */

/** Clamps to the unit interval so a late frame cannot overshoot an animation. */
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

export function easeOutQuad(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

export function easeInQuad(t: number): number {
  const x = clamp01(t);
  return x * x;
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** Overshoots and settles. For impacts and card slams. */
export function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Out and back to where it started. For a lunge. */
export function pingPong(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? easeOutQuad(x * 2) : 1 - easeInQuad((x - 0.5) * 2);
}

/**
 * A decaying shake offset.
 *
 * Deterministic in `seed` and `t` rather than random, so two phones watching
 * the same battle shake identically — and so a test can assert the camera is
 * where it should be.
 */
export function shakeOffset(seed: number, t: number, magnitude: number): {
  x: number;
  y: number;
} {
  const decay = 1 - clamp01(t);
  const angle = Math.sin(seed * 12.9898 + t * 78.233) * 43758.5453;
  const a = angle - Math.floor(angle);
  return {
    x: Math.cos(a * Math.PI * 2) * magnitude * decay * decay,
    y: Math.sin(a * Math.PI * 2) * magnitude * decay * decay,
  };
}
