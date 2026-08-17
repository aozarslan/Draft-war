/**
 * ---------------------------------------------------------------------------
 * SPRITE BODIES
 * ---------------------------------------------------------------------------
 * Six body plans, drawn from one shared pose vocabulary.
 *
 * The key idea is that a `Pose` is abstract — "lift", "lean", "limbs", "jaw" —
 * and each body decides what those mean for its own anatomy. A quadruped reads
 * `rear` as rearing onto its hind legs; a snake reads it as the height of its
 * coil; a bird reads it as how far the wings are thrown back in a dive. So the
 * *timing* of every clip is written once and every body inherits it, which is
 * what keeps six archetypes in step instead of six sets of keyframes drifting
 * apart. Adding a seventh body is one draw function, not a new animation pass.
 *
 * Nothing here knows about a character. A lion and a wolf are the same
 * quadruped in different tints; that is the trade V5 accepts to have animation
 * at all before there is a budget for 268 hand-drawn characters.
 */

// ---------------------------------------------------------------------------
// Tones
// ---------------------------------------------------------------------------

/**
 * Everything is drawn in greyscale so the renderer can multiply a character's
 * palette over it. Values are chosen so the outline stays dark after tinting
 * and the highlight still reads.
 */
export const OUTLINE = 46;
export const SHADE = 122;
export const BASE = 178;
export const LIGHT = 224;

export const FRAME = 32;
/** The line every body stands on. The renderer anchors sprites here. */
export const GROUND = 27;

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export class Pixels {
  readonly data: Uint8Array;

  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, tone: number, alpha = 255): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const i = (py * this.width + px) * 4;
    this.data[i] = tone;
    this.data[i + 1] = tone;
    this.data[i + 2] = tone;
    this.data[i + 3] = alpha;
  }

  rect(x: number, y: number, w: number, h: number, tone: number, alpha = 255): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, tone, alpha);
    }
  }

  /** Filled ellipse: a body, a head, a haunch and a fin are all ovals. */
  ellipse(cx: number, cy: number, rx: number, ry: number, tone: number, alpha = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, tone, alpha);
      }
    }
  }

  line(
    x0: number, y0: number, x1: number, y1: number,
    tone: number, thickness = 1, alpha = 255,
  ): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (thickness <= 1) this.set(x, y, tone, alpha);
      else {
        this.rect(
          x - (thickness - 1) / 2, y - (thickness - 1) / 2,
          thickness, thickness, tone, alpha,
        );
      }
    }
  }

  /** A filled triangle. Wings, fins and claws are all wedges. */
  triangle(
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    tone: number,
  ): void {
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-6) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / area;
        const w1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) this.set(x, y, tone);
      }
    }
  }

  /** Traces a one-pixel dark edge around everything opaque. */
  outline(tone = OUTLINE): void {
    const alpha = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height
        ? 0
        : this.data[(y * this.width + x) * 4 + 3];

    const edges: [number, number][] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (alpha(x, y) !== 0) continue;
        if (alpha(x - 1, y) || alpha(x + 1, y) || alpha(x, y - 1) || alpha(x, y + 1)) {
          edges.push([x, y]);
        }
      }
    }
    for (const [x, y] of edges) this.set(x, y, tone);
  }

  blit(target: Pixels, atX: number, atY: number): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = (y * this.width + x) * 4;
        if (this.data[i + 3] === 0) continue;
        const j = ((atY + y) * target.width + atX + x) * 4;
        target.data[j] = this.data[i];
        target.data[j + 1] = this.data[i + 1];
        target.data[j + 2] = this.data[i + 2];
        target.data[j + 3] = this.data[i + 3];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pose
// ---------------------------------------------------------------------------

/**
 * The whole animation vocabulary, deliberately abstract.
 *
 * Every body reads these the same way where it can and its own way where it
 * must. The per-body meanings are documented on each draw function; the
 * important part is that a clip is written once, in `generate-sprites.ts`, and
 * six anatomies interpret it.
 */
export interface Pose {
  /** Forward offset of the whole body. Negative is backwards. */
  push: number;
  /** Vertical offset of the whole body. Negative is up. */
  lift: number;
  /** Forward lean, in pixels of shear. */
  lean: number;
  /** Rearing / coiling / wings-back, depending on the body. */
  rear: number;
  headX: number;
  headY: number;
  /** Limb lift. Legs, wings or fins — whatever this body has four, two or none of. */
  limbs: [number, number, number, number];
  /** Tail sway, in radians. */
  tail: number;
  /** 0 = upright, 1 = down on the ground. */
  collapse: number;
  /** Mouth opening, 0..1. */
  jaw: number;
}

export const REST: Pose = {
  push: 0, lift: 0, lean: 0, rear: 0, headX: 0, headY: 0,
  limbs: [0, 0, 0, 0], tail: 0, collapse: 0, jaw: 0,
};

/**
 * Applies `push` once, so every body below can be written in rest coordinates.
 *
 * Without a whole-body offset, a lunge has to be faked by moving the head, and
 * the animal reads as a giraffe rather than as something charging.
 */
function shifted(cell: Pixels, dx: number) {
  return {
    set: (x: number, y: number, tone: number, alpha?: number) =>
      cell.set(x + dx, y, tone, alpha),
    rect: (x: number, y: number, w: number, h: number, tone: number, alpha?: number) =>
      cell.rect(x + dx, y, w, h, tone, alpha),
    ellipse: (cx: number, cy: number, rx: number, ry: number, tone: number, alpha?: number) =>
      cell.ellipse(cx + dx, cy, rx, ry, tone, alpha),
    line: (
      x0: number, y0: number, x1: number, y1: number,
      tone: number, thickness?: number, alpha?: number,
    ) => cell.line(x0 + dx, y0, x1 + dx, y1, tone, thickness, alpha),
    triangle: (
      ax: number, ay: number, bx: number, by: number, cx: number, cy: number, tone: number,
    ) => cell.triangle(ax + dx, ay, bx + dx, by, cx + dx, cy, tone),
  };
}

type Brush = ReturnType<typeof shifted>;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Quadruped
// ---------------------------------------------------------------------------

/**
 * Four legs, a head on a neck, a tail.
 *
 * `rear` lifts the front of the body onto the hind legs; `limbs` lifts each
 * foot; `collapse` rolls the animal onto its side. `scale` is the only thing
 * separating the small quadruped from the medium one — a badger is the same
 * anatomy at three-quarter size with a lower stance, and drawing it twice would
 * mean fixing every bug twice.
 */
function drawQuadruped(cell: Pixels, pose: Pose, scale = 1): void {
  const p = shifted(cell, pose.push);
  const collapse = clamp01(pose.collapse);
  // The collapse is scaled with the body: an absolute drop buries a small
  // quadruped, whose back is only six pixels off the ground to begin with.
  const drop = collapse * 2.5 * scale;
  const squash = 1 - collapse * 0.45;

  const bodyCy = GROUND - 9 * scale + pose.lift * scale + drop;
  const bodyRx = 7 * scale;
  const bodyRy = 4.2 * scale * squash;

  const frontY = bodyCy - pose.rear;
  const backY = bodyCy + pose.rear * 0.3;

  // Legs first, so the body overlaps them and reads as in front.
  const spread = 4.5 * scale;
  const legX = [16 + spread, 16 + spread - 1, 16 - spread, 16 - spread - 1];
  for (let i = 0; i < 4; i++) {
    const x = legX[i];
    const top = (i < 2 ? frontY : backY) + 2 * scale;
    // Two rows up from the line, because the leg is drawn with a two-pixel
    // brush and then outlined; standing the foot on the line buries it.
    const foot = GROUND - 2 - pose.limbs[i] - drop * 1.6;
    const tone = i % 2 === 0 ? SHADE : BASE;
    if (collapse > 0.6) {
      p.line(x, top, x + (4 + i) * scale, top - 1 * scale, tone, 2);
    } else {
      const knee = (top + foot) / 2;
      p.line(x, top, x + pose.lean * 0.4, knee, tone, 2);
      p.line(x + pose.lean * 0.4, knee, x + pose.lean * 0.6, foot, tone, 2);
      p.rect(x + pose.lean * 0.6 - 1, foot, 3, 1, tone);
    }
  }

  p.ellipse(16 - 5 * scale, backY, 5 * scale, bodyRy + 0.4, SHADE);
  p.ellipse(16, bodyCy, bodyRx, bodyRy, BASE);
  p.ellipse(16 + 4 * scale, frontY, 4.6 * scale, bodyRy, BASE);
  p.ellipse(16, bodyCy - 1.4, bodyRx - 1.5, Math.max(0.8, bodyRy - 2.2), LIGHT);

  const tailX = 16 - 9 * scale;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    p.set(
      tailX - t * 5 * scale,
      backY - 1 - Math.sin(t * 2.2 + pose.tail) * 3 - t * 1.5,
      i > 4 ? LIGHT : SHADE,
    );
  }

  const headX = 14 + 7.5 * scale + pose.headX;
  const headY = frontY - 5 * scale + pose.headY * scale + drop * 0.6;
  p.line(16 + 5 * scale, frontY - 2, headX - 1, headY + 1, BASE, 3);
  p.ellipse(headX, headY, 3.4 * scale, 3 * scale, BASE);
  p.ellipse(headX + 0.6, headY - 1, 2.4 * scale, 1.6 * scale, LIGHT);

  const jaw = pose.jaw * 2;
  p.ellipse(headX + 3.4 * scale, headY + 0.2, 2.2 * scale, 1.4 * scale, BASE);
  if (jaw > 0.5) {
    p.ellipse(headX + 3.2 * scale, headY + 1 + jaw, 2 * scale, 1.1 * scale, SHADE);
    p.line(headX + 1.6, headY + 1.2, headX + 4.4 * scale, headY + 0.8 + jaw * 0.6, OUTLINE);
  }
  p.line(headX - 2 * scale, headY - 3 * scale, headX - 3 * scale, headY - 5.5 * scale, BASE, 2);
  p.set(headX + 1.4 * scale, headY - 0.6, OUTLINE);
}

// ---------------------------------------------------------------------------
// Humanoid
// ---------------------------------------------------------------------------

/**
 * Two legs, a torso, two arms, a head.
 *
 * `limbs[0..1]` are the arms and `limbs[2..3]` the legs, so the shared clips
 * that lift "all four" produce a jump and the ones that lift the front pair
 * produce a raised guard. `rear` throws the shoulders back, which is what a
 * roar looks like on a body that is already upright.
 */
function drawHumanoid(cell: Pixels, pose: Pose): void {
  const p = shifted(cell, pose.push);
  const collapse = clamp01(pose.collapse);

  if (collapse > 0.55) {
    // Lying down. Drawn outright rather than rotated: a rotated pixel body at
    // this size turns to mush, and a fallen figure is only a few shapes.
    const y = GROUND - 3;
    p.ellipse(16, y, 6.5, 2.4, BASE);
    p.ellipse(16, y - 0.8, 4.5, 1.2, LIGHT);
    p.ellipse(9, y - 1, 2.8, 2.4, BASE);
    p.ellipse(9.4, y - 1.6, 1.8, 1.2, LIGHT);
    p.set(8.2, y - 1.2, OUTLINE);
    // Legs and one flung-out arm, so it reads as a fallen figure rather than
    // as a log lying on the ground.
    p.line(21, y + 1, 26, y + 2, SHADE, 2);
    p.line(21, y - 1, 26, y - 1, SHADE, 2);
    p.line(13, y - 2, 17, y - 5, SHADE, 2);
    return;
  }

  const hipY = GROUND - 8 + pose.lift;
  const shoulderY = hipY - 7;

  // Legs.
  for (let i = 2; i < 4; i++) {
    const x = 16 + (i === 2 ? 2 : -2);
    const foot = GROUND - 2 - pose.limbs[i];
    const knee = (hipY + foot) / 2;
    p.line(x, hipY, x + pose.lean * 0.4, knee, i === 2 ? BASE : SHADE, 2);
    p.line(x + pose.lean * 0.4, knee, x + pose.lean * 0.7, foot, i === 2 ? BASE : SHADE, 2);
    p.rect(x + pose.lean * 0.7 - 1, foot, 3, 1, SHADE);
  }

  // Torso, leaning from the hip.
  p.line(16, hipY, 16 + pose.lean, shoulderY, BASE, 6);
  // Shoulders are drawn flat and narrow rather than as a ball: a round chest
  // the same width as the head merges into it and the figure loses its neck.
  p.ellipse(16 + pose.lean * 0.7, shoulderY + 1, 3.6, 2.2, BASE);
  p.ellipse(16 + pose.lean * 0.7, shoulderY + 1, 2.2, 1.2, LIGHT);

  // Arms. The near one leads a strike, the far one trails.
  const shoulderX = 16 + pose.lean;
  for (let i = 0; i < 2; i++) {
    const reach = pose.limbs[i];
    const tone = i === 0 ? BASE : SHADE;
    const handX = shoulderX + 3 + reach * 0.9 + pose.headX * 0.5;
    const handY = shoulderY + 4 - reach * 0.9 - pose.rear * 0.6;
    p.line(shoulderX + (i === 0 ? 1 : -1), shoulderY + 1, handX, handY, tone, 2);
    p.rect(handX - 1, handY - 1, 2, 2, tone);
  }

  // Neck, then head. The neck is what separates a person from a bollard.
  const headX = shoulderX + pose.headX * 0.4;
  const headY = shoulderY - 5 + pose.headY - pose.rear * 0.4;
  p.line(shoulderX, shoulderY, headX, headY + 2, SHADE, 2);
  p.ellipse(headX, headY, 3, 3, BASE);
  p.ellipse(headX + 0.4, headY - 0.8, 2, 1.6, LIGHT);
  if (pose.jaw > 0.4) p.rect(headX + 0.5, headY + 1, 2, Math.max(1, pose.jaw * 2), OUTLINE);
  p.set(headX + 1.6, headY - 0.4, OUTLINE);
  p.set(headX - 1, headY - 0.4, OUTLINE);
}

// ---------------------------------------------------------------------------
// Winged
// ---------------------------------------------------------------------------

/**
 * A flier: compact body, hooked beak, two wings, talons.
 *
 * It never touches the ground, which is legitimate — the renderer anchors to
 * a ground line but nothing requires a body to stand on it. `limbs[0..1]` set
 * the wingbeat, `rear` sweeps the wings back into a dive, and `collapse`
 * folds them and drops the bird onto the line.
 */
function drawWinged(cell: Pixels, pose: Pose): void {
  const p = shifted(cell, pose.push);
  const collapse = clamp01(pose.collapse);

  // Hovering height, coming down to the ground as it dies.
  const hover = -5 + collapse * 5;
  const bodyY = GROUND - 8 + hover + pose.lift;
  const bodyX = 16;

  // Wings behind the body, then in front, so the near one overlaps.
  const beat = pose.limbs[0];
  // Capped, because a wing is a triangle: let the far vertex run out to the
  // edge of the frame and it degenerates into a thin spike rather than reading
  // as a spread wing.
  const sweep = Math.max(-2, Math.min(pose.rear, 2.5));
  const wing = (dir: number, tone: number, lift: number) => {
    if (collapse > 0.5) {
      p.line(bodyX - 1, bodyY, bodyX - 7, bodyY + 2, tone, 2);
      return;
    }
    p.triangle(
      bodyX - 1, bodyY - 1,
      bodyX - 9 - sweep, bodyY - lift * dir - 3,
      bodyX - 3 + sweep * 0.4, bodyY + 3 - lift * dir * 0.3,
      tone,
    );
  };
  wing(1, SHADE, beat + 2);
  wing(-1, BASE, beat);

  p.ellipse(bodyX, bodyY, 4.4, 3.2, BASE);
  p.ellipse(bodyX, bodyY - 1, 3, 1.8, LIGHT);

  // Tail feathers.
  p.triangle(
    bodyX - 4, bodyY + 1,
    bodyX - 9, bodyY + 3 + Math.sin(pose.tail) * 2,
    bodyX - 4, bodyY + 3,
    SHADE,
  );

  // Head and hooked beak.
  const headX = bodyX + 4 + pose.headX;
  const headY = bodyY - 2 + pose.headY;
  p.ellipse(headX, headY, 2.6, 2.4, BASE);
  p.triangle(
    headX + 1.5, headY - 0.5,
    headX + 5, headY + 0.5 + pose.jaw * 2,
    headX + 1.5, headY + 1.5,
    LIGHT,
  );
  p.set(headX + 0.6, headY - 0.6, OUTLINE);

  // Talons, tucked while flying and reaching on a strike.
  if (collapse < 0.5) {
    const reach = pose.limbs[2];
    p.line(bodyX + 1, bodyY + 2, bodyX + 3 + reach, bodyY + 5 + reach * 0.5, SHADE, 2);
    p.line(bodyX - 1, bodyY + 2, bodyX + 1 + reach, bodyY + 5 + reach * 0.5, BASE, 2);
  }
}

// ---------------------------------------------------------------------------
// Serpentine
// ---------------------------------------------------------------------------

/**
 * A body that is entirely spine.
 *
 * There are no limbs to lift, so `limbs` is ignored and the shared clips read
 * through `rear` (how tightly it is coiled), `push` (the strike) and `tail`
 * (the wave along the body). A snake striking is the coil collapsing into a
 * straight line, which is exactly `rear` falling to zero while `push` spikes.
 */
function drawSerpentine(cell: Pixels, pose: Pose): void {
  const p = shifted(cell, pose.push);
  const collapse = clamp01(pose.collapse);

  const coil = Math.max(0, pose.rear) * (1 - collapse);
  // Four rows up, not two: the body is three pixels thick and waves by another
  // one and a half, so resting any lower puts the belly through the floor.
  // Only upward lift is obeyed. A snake is already lying on the ground, so a
  // clip that tells other bodies to sink — buckling, crouching — has nowhere
  // to move it except through the floor.
  const baseY = GROUND - 4 + Math.min(0, pose.lift) * 0.4;

  // The body is sampled along a curve: amplitude falls as it coils upright and
  // as it dies, so one expression covers slack, coiled and limp.
  const segments = 22;
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const x = 6 + t * 17;
    const wave = Math.sin(t * 5 + pose.tail) * (1.6 + coil * 0.3) * (1 - collapse * 0.7);
    const rise = t * t * coil;
    const y = baseY - rise + wave - t * 1.2 - collapse * 1.5;
    const thickness = 3 - t * 1.4;
    p.line(x, y, x, y, t > 0.75 ? LIGHT : t > 0.35 ? BASE : SHADE, Math.max(1, thickness));
  }

  // Head at the leading end.
  const headX = 23 + pose.headX;
  const headY = baseY - coil + Math.min(0, pose.headY) - 1.2 - Math.sin(5 + pose.tail) * 0.8;
  p.ellipse(headX, headY, 3, 2.2, BASE);
  p.ellipse(headX + 0.6, headY - 0.6, 2, 1.2, LIGHT);
  p.set(headX + 1.2, headY - 0.6, OUTLINE);

  // Open jaw and tongue: the only tell a snake has.
  if (pose.jaw > 0.3) {
    p.triangle(
      headX + 2, headY - 1,
      headX + 5, headY - 1 - pose.jaw * 2,
      headX + 2, headY + 0.5,
      SHADE,
    );
    p.triangle(
      headX + 2, headY + 0.5,
      headX + 5, headY + 1 + pose.jaw * 2,
      headX + 2, headY + 2,
      SHADE,
    );
  } else {
    p.line(headX + 2.5, headY + 0.4, headX + 5, headY + 0.4, LIGHT);
  }
}

// ---------------------------------------------------------------------------
// Aquatic
// ---------------------------------------------------------------------------

/**
 * A swimmer: torpedo body, dorsal fin, tail fluke, pectoral fin.
 *
 * Like the flier it never stands. `collapse` rolls it belly-up, which is drawn
 * by putting the dorsal fin underneath rather than by rotating the sprite —
 * a rotated pixel silhouette at this size loses its shape entirely.
 */
function drawAquatic(cell: Pixels, pose: Pose): void {
  const p = shifted(cell, pose.push);
  const collapse = clamp01(pose.collapse);
  const bellyUp = collapse > 0.5;

  // Rolling over puts the dorsal fin underneath, so a belly-up body has to sit
  // higher than an upright one rather than lower.
  const bodyY = GROUND - 8 + pose.lift - collapse * 2 - pose.rear * 0.5;
  const finDir = bellyUp ? 1 : -1;

  // Tail fluke.
  const swing = Math.sin(pose.tail) * 2.5 * (1 - collapse);
  p.triangle(6, bodyY + swing, 11, bodyY - 3 + swing, 11, bodyY + 3 + swing, SHADE);

  p.ellipse(16, bodyY, 8, 3.2, BASE);
  p.ellipse(17, bodyY - 1, 6, 1.6, LIGHT);
  // A pale underside, flipped when it rolls over.
  p.ellipse(16, bodyY + 1.6 * -finDir, 6.5, 1.2, bellyUp ? LIGHT : SHADE);

  // Dorsal fin.
  p.triangle(
    15, bodyY + 2 * finDir,
    17, bodyY + 6 * finDir,
    20, bodyY + 2 * finDir,
    SHADE,
  );

  // Pectoral fin.
  p.triangle(15, bodyY + 1, 13, bodyY + 4 * -finDir, 18, bodyY + 1, SHADE);

  // Snout and jaw.
  const headX = 23 + pose.headX * 0.6;
  const headY = bodyY + pose.headY * 0.4;
  p.ellipse(headX, headY, 3.2, 2.4, BASE);
  if (pose.jaw > 0.3 && !bellyUp) {
    p.triangle(
      headX, headY + 0.5,
      headX + 4, headY + 0.5 + pose.jaw * 3,
      headX + 1, headY + 2.2,
      SHADE,
    );
    p.line(headX - 1, headY + 0.6, headX + 3.5, headY + 0.6, LIGHT);
  }
  p.set(headX + 0.4, headY - 0.8 * -finDir, OUTLINE);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type BodyId =
  | "humanoid_medium"
  | "quadruped_small"
  | "quadruped_medium"
  | "serpentine"
  | "winged"
  | "aquatic";

export const BODIES: Record<BodyId, (cell: Pixels, pose: Pose) => void> = {
  humanoid_medium: drawHumanoid,
  quadruped_small: (cell, pose) => drawQuadruped(cell, pose, 0.72),
  quadruped_medium: (cell, pose) => drawQuadruped(cell, pose, 1),
  serpentine: drawSerpentine,
  winged: drawWinged,
  aquatic: drawAquatic,
};
