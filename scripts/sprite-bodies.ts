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

/**
 * Where identity layers attach, in frame pixels.
 *
 * Returned by the draw functions rather than computed alongside them: the head
 * moves with every pose, and a second copy of that arithmetic would drift from
 * the first the moment either was tuned. A horn that sits two pixels off its
 * skull is worse than no horn.
 */
/** A point on the body, and which way the body is facing there. */
export interface Anchored {
  x: number;
  y: number;
  /** Radians. Zero points along the body's forward axis. */
  angle: number;
}

export interface BodyAnchors {
  head: Anchored;
  back: Anchored;
  /** The body's own centre. */
  body: Anchored;
  /**
   * Points along the flank, from tail to shoulder, with the local surface
   * angle at each.
   *
   * Markings are stamped once per point instead of once per character, which
   * is what lets a stripe pattern follow a coiling snake or a rearing horse
   * instead of sitting flat across it. Reported by the body for the same
   * reason the anchors are: there must be exactly one piece of code that knows
   * where this body's flank is.
   */
  marks: Anchored[];
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

/**
 * Samples evenly along a line, giving each point the same local angle.
 *
 * The one place a body without its own curve describes its flank. Offsetting
 * each point sideways by `drop` puts the marks on the flank rather than
 * through the spine.
 */
function alongLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
  count: number,
  angle: number,
  drop: number,
): Anchored[] {
  const out: Anchored[] = [];
  const normal = angle + Math.PI / 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    out.push({
      x: from.x + (to.x - from.x) * t + Math.cos(normal) * drop,
      y: from.y + (to.y - from.y) * t + Math.sin(normal) * drop,
      angle,
    });
  }
  return out;
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
function drawQuadruped(cell: Pixels, pose: Pose, scale = 1): BodyAnchors {
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

  // The spine runs from the haunch to the shoulder; rearing lifts the front of
  // it, so the flank tilts and every marking on it tilts with it.
  const tailPoint = { x: 16 - 6 * scale + pose.push, y: backY };
  const shoulderPoint = { x: 16 + 4 * scale + pose.push, y: frontY };
  const spine = Math.atan2(shoulderPoint.y - tailPoint.y, shoulderPoint.x - tailPoint.x);

  return {
    head: { x: headX + pose.push, y: headY, angle: spine + pose.lean * 0.05 },
    back: { x: 16 + pose.push, y: bodyCy - bodyRy, angle: spine },
    body: { x: 16 + pose.push, y: bodyCy, angle: spine },
    marks: alongLine(tailPoint, shoulderPoint, 4, spine, bodyRy * 0.25),
  };
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
function drawHumanoid(cell: Pixels, pose: Pose): BodyAnchors {
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
    // Lying down: the whole figure is horizontal, so everything on it is too.
    return {
      head: { x: 9 + pose.push, y: y - 1, angle: 0 },
      back: { x: 16 + pose.push, y: y - 2, angle: 0 },
      body: { x: 16 + pose.push, y, angle: 0 },
      marks: alongLine(
        { x: 11 + pose.push, y }, { x: 21 + pose.push, y }, 3, 0, 1,
      ),
    };
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

  // Upright, so the torso's own lean is the angle everything on it inherits.
  const hip = { x: 16 + pose.push, y: hipY };
  const shoulder = { x: shoulderX + pose.push, y: shoulderY };
  const torso = Math.atan2(shoulder.y - hip.y, shoulder.x - hip.x) + Math.PI / 2;

  return {
    head: { x: headX + pose.push, y: headY, angle: torso },
    back: { x: shoulderX + pose.push, y: shoulderY, angle: torso },
    body: { x: 16 + pose.push, y: (hipY + shoulderY) / 2, angle: torso },
    marks: alongLine(hip, shoulder, 3, torso, 0.5),
  };
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
function drawWinged(cell: Pixels, pose: Pose): BodyAnchors {
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

  // A dive pitches the whole bird nose-down; `rear` is how far it is swept.
  const pitch = -pose.rear * 0.12 + pose.lean * 0.05;

  return {
    head: { x: headX + pose.push, y: headY, angle: pitch },
    back: { x: bodyX + pose.push, y: bodyY - 3, angle: pitch },
    body: { x: bodyX + pose.push, y: bodyY, angle: pitch },
    marks: alongLine(
      { x: bodyX - 3 + pose.push, y: bodyY }, { x: bodyX + 3 + pose.push, y: bodyY },
      3, pitch, 0.4,
    ),
  };
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
function drawSerpentine(cell: Pixels, pose: Pose): BodyAnchors {
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

  // A snake is all spine, so its marking points are sampled from the same
  // curve the body was drawn along rather than from a straight line.
  const marks: Anchored[] = [];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5.5;
    const x = 6 + t * 17;
    const wave = Math.sin(t * 5 + pose.tail) * (1.6 + coil * 0.3) * (1 - collapse * 0.7);
    const y = baseY - t * t * coil + wave - t * 1.2 - collapse * 1.5;

    // The local direction of travel, from a small step along the same curve.
    const t2 = t + 0.06;
    const x2 = 6 + t2 * 17;
    const wave2 = Math.sin(t2 * 5 + pose.tail) * (1.6 + coil * 0.3) * (1 - collapse * 0.7);
    const y2 = baseY - t2 * t2 * coil + wave2 - t2 * 1.2 - collapse * 1.5;

    marks.push({ x: x + pose.push, y, angle: Math.atan2(y2 - y, x2 - x) });
  }

  const headAngle = marks.length
    ? Math.atan2(headY - marks[marks.length - 1].y, headX - marks[marks.length - 1].x)
    : 0;

  return {
    head: { x: headX + pose.push, y: headY, angle: headAngle },
    back: { x: 14 + pose.push, y: baseY - coil * 0.4 - 2, angle: headAngle },
    body: { x: 14 + pose.push, y: baseY - coil * 0.3, angle: headAngle },
    marks,
  };
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
function drawAquatic(cell: Pixels, pose: Pose): BodyAnchors {
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

  // Breaching pitches the nose up; rolling over turns the whole animal.
  const pitch = -pose.rear * 0.1 + collapse * Math.PI;

  return {
    head: { x: headX + pose.push, y: headY, angle: pitch },
    back: { x: 17 + pose.push, y: bodyY + 5 * finDir, angle: pitch },
    body: { x: 16 + pose.push, y: bodyY, angle: pitch },
    marks: alongLine(
      { x: 10 + pose.push, y: bodyY }, { x: 21 + pose.push, y: bodyY },
      4, pitch, 0.6,
    ),
  };
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

export const BODIES: Record<BodyId, (cell: Pixels, pose: Pose) => BodyAnchors> = {
  humanoid_medium: drawHumanoid,
  quadruped_small: (cell, pose) => drawQuadruped(cell, pose, 0.72),
  quadruped_medium: (cell, pose) => drawQuadruped(cell, pose, 1),
  serpentine: drawSerpentine,
  winged: drawWinged,
  aquatic: drawAquatic,
};

// ---------------------------------------------------------------------------
// Identity tiles
// ---------------------------------------------------------------------------

/**
 * The features that tell two tenants of one body plan apart.
 *
 * Drawn as pixels on the same grid as the bodies, in the same greyscale, so a
 * horn is made of the same material as the skull it sits on. M7 drew these
 * with canvas curves and they read as a different medium stuck on top of the
 * sprite — smooth arcs over hard pixels.
 *
 * Each tile is drawn facing right, in its own small cell, and stamped at an
 * anchor the body reported. Fifteen tiles cover the whole catalogue; the
 * alternative was a sheet per archetype per feature.
 */
export const TILE = 16;

/** Where the tile's attachment point sits inside its own cell. */
export interface TilePivot {
  x: number;
  y: number;
}

export interface IdentityTile {
  id: string;
  /**
   * Which anchor it attaches to.
   *
   * `mark` is the odd one out: it is stamped once per flank point rather than
   * once per character, so a marking follows the body's curve.
   */
  slot: "head" | "back" | "body" | "mark";
  pivot: TilePivot;
  draw: (p: Pixels) => void;
}

const c = TILE / 2;

export const IDENTITY_TILES: IdentityTile[] = [
  // ---- head ----
  {
    id: "HORNS", slot: "head", pivot: { x: c, y: 11 },
    draw: (p) => {
      for (const side of [-1, 1]) {
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          p.set(c + side * (1 + t * 4), 11 - t * 5 - Math.sin(t * 2) * 1.5, i > 3 ? LIGHT : BASE);
        }
      }
    },
  },
  {
    id: "ANTLERS", slot: "head", pivot: { x: c, y: 11 },
    draw: (p) => {
      for (const side of [-1, 1]) {
        p.line(c + side, 11, c + side * 3, 4, BASE);
        p.line(c + side * 2, 7, c + side * 5, 5, LIGHT);
        p.set(c + side * 3, 3, LIGHT);
      }
    },
  },
  {
    id: "EARS", slot: "head", pivot: { x: c, y: 11 },
    draw: (p) => {
      for (const side of [-1, 1]) {
        p.triangle(c + side * 1, 11, c + side * 3, 5, c + side * 5, 11, BASE);
        p.set(c + side * 3, 9, LIGHT);
      }
    },
  },
  {
    id: "CREST", slot: "head", pivot: { x: c, y: 11 },
    draw: (p) => {
      p.triangle(c - 3, 11, c - 1, 4, c + 3, 10, LIGHT);
      p.triangle(c - 3, 11, c - 1, 6, c + 1, 11, BASE);
    },
  },
  {
    id: "TUSKS", slot: "head", pivot: { x: c, y: 8 },
    draw: (p) => {
      for (const side of [0, 1]) {
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          p.set(c + t * 5, 8 + side + t * t * 3 - t * 3, LIGHT);
        }
      }
    },
  },
  {
    id: "HELM", slot: "head", pivot: { x: c, y: 10 },
    draw: (p) => {
      p.rect(c - 4, 8, 9, 2, BASE);
      p.rect(c - 4, 7, 3, 1, LIGHT);
      p.set(c + 4, 7, LIGHT);
    },
  },

  // ---- back ----
  {
    id: "MANE", slot: "head", pivot: { x: c, y: 8 },
    draw: (p) => {
      for (let a = 0; a < 12; a++) {
        const angle = (a / 12) * Math.PI * 2;
        const r = 4 + (a % 2);
        p.set(c + Math.cos(angle) * r, 8 + Math.sin(angle) * r, a % 2 ? BASE : SHADE);
      }
      p.ellipse(c, 8, 3, 3, SHADE);
    },
  },
  {
    id: "SPINES", slot: "back", pivot: { x: c, y: 12 },
    draw: (p) => {
      for (let i = 0; i < 4; i++) {
        p.line(c - 5 + i * 3, 12, c - 4 + i * 3, 12 - 4 + (i % 2), LIGHT);
      }
    },
  },
  {
    id: "FIN", slot: "back", pivot: { x: c, y: 12 },
    draw: (p) => {
      p.triangle(c - 4, 12, c + 1, 3, c + 4, 12, BASE);
      p.triangle(c - 2, 12, c + 1, 6, c + 2, 12, LIGHT);
    },
  },
  {
    id: "CAPE", slot: "back", pivot: { x: c, y: 4 },
    draw: (p) => {
      // Kept a row clear of the bottom: the outline adds one more, and a tile
      // that touches its cell edge bleeds into the next row of the sheet.
      p.triangle(c + 2, 4, c - 5, 13, c + 3, 12, SHADE);
      p.line(c + 1, 5, c - 3, 12, BASE);
    },
  },
  {
    id: "SHELL", slot: "back", pivot: { x: c, y: 12 },
    draw: (p) => {
      p.ellipse(c, 10, 5, 3, SHADE);
      p.ellipse(c, 10, 3.4, 1.8, BASE);
      p.line(c - 4, 10, c + 4, 10, LIGHT);
    },
  },

  // ---- markings ----
  //
  // One mark each, not a pattern. The draw layer stamps them once per flank
  // point the body reported, rotated to the local surface angle — which is
  // what makes a stripe pattern bend around a coiling snake instead of lying
  // flat across it. A pattern baked into one tile could never do that.
  {
    id: "STRIPES", slot: "mark", pivot: { x: c, y: c },
    draw: (p) => {
      p.rect(c - 1, c - 3, 2, 6, SHADE);
      p.rect(c - 1, c - 3, 1, 6, OUTLINE, 90);
    },
  },
  {
    id: "SPOTS", slot: "mark", pivot: { x: c, y: c },
    draw: (p) => {
      p.rect(c - 2, c - 2, 2, 2, SHADE);
      p.rect(c + 1, c, 2, 2, SHADE);
    },
  },
  {
    id: "PATCH", slot: "mark", pivot: { x: c, y: c },
    draw: (p) => {
      p.ellipse(c, c, 3, 2, SHADE);
      p.set(c - 1, c - 1, LIGHT);
    },
  },
  {
    id: "BANDS", slot: "mark", pivot: { x: c, y: c },
    draw: (p) => {
      p.rect(c - 2, c - 4, 4, 8, SHADE);
      p.rect(c - 2, c - 4, 1, 8, LIGHT);
    },
  },
];
