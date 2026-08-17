/**
 * ---------------------------------------------------------------------------
 * PARTICLES (pooled)
 * ---------------------------------------------------------------------------
 * A fixed-size ring of particles, allocated once and reused forever.
 *
 * The pool exists for one reason: a battle emits a few thousand sparks, and
 * allocating an object per spark hands the garbage collector a pause in the
 * middle of a hit. On a mid-range phone that pause is visible. So the arrays
 * are sized up front and a new burst overwrites the oldest slot rather than
 * growing anything.
 *
 * This is the one deliberately stateful piece of the renderer. It has to be:
 * particles are decoration with no authority over anything, and giving them
 * their own drift makes them look alive. Nothing here is ever read back into
 * the scene, so it cannot desynchronise two viewers — worst case, two phones
 * see slightly different sparks around identical numbers.
 */

const GRAVITY = 220; // arena units per second squared

export interface ParticleView {
  x: number;
  y: number;
  size: number;
  color: string;
  /** 0..1, ready to multiply into globalAlpha. */
  alpha: number;
}

export class ParticlePool {
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly color: string[];
  private cursor = 0;

  constructor(readonly capacity = 256) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.color = new Array<string>(capacity).fill("#ffffff");
  }

  /** How many particles are currently alive. Used by tests and the HUD. */
  get active(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.life[i] > 0) n++;
    return n;
  }

  /**
   * Emits a burst.
   *
   * `spread` is the half-angle in radians; pass Math.PI for an omnidirectional
   * pop and something small for a directional spray.
   */
  burst(options: {
    x: number;
    y: number;
    count: number;
    color: string;
    speed?: number;
    angle?: number;
    spread?: number;
    size?: number;
    lifeSeconds?: number;
    /** Deterministic when given; falls back to Math.random otherwise. */
    seed?: number;
  }): void {
    const {
      x,
      y,
      count,
      color,
      speed = 60,
      angle = -Math.PI / 2,
      spread = Math.PI,
      size = 2,
      lifeSeconds = 0.6,
      seed,
    } = options;

    let state = (seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const rand = () => {
      // xorshift32: cheap, good enough for sparks, and repeatable when seeded.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) % 100000) / 100000;
    };

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      const a = angle + (rand() - 0.5) * 2 * spread;
      const v = speed * (0.5 + rand());

      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v;
      this.size[i] = size * (0.6 + rand() * 0.8);
      this.maxLife[i] = lifeSeconds * (0.7 + rand() * 0.6);
      this.life[i] = this.maxLife[i];
      this.color[i] = color;
    }
  }

  /** Advances every live particle by `dtSeconds`. */
  update(dtSeconds: number): void {
    const dt = Math.min(dtSeconds, 0.1); // a tab that was backgrounded must not teleport sparks
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      this.vy[i] += GRAVITY * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }

  /** Walks the live particles. No array is allocated. */
  forEach(visit: (p: ParticleView) => void): void {
    const view: ParticleView = { x: 0, y: 0, size: 0, color: "#fff", alpha: 1 };
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      view.x = this.x[i];
      view.y = this.y[i];
      view.size = this.size[i];
      view.color = this.color[i];
      view.alpha = this.life[i] / this.maxLife[i];
      visit(view);
    }
  }

  clear(): void {
    this.life.fill(0);
    this.cursor = 0;
  }
}
