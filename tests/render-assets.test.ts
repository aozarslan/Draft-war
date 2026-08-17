import { describe, expect, it } from "vitest";
import {
  AssetStore,
  frameAt,
  initialsOf,
  type CharacterArt,
  type SpriteClip,
} from "../src/lib/render/assets";
import { ParticlePool } from "../src/lib/render/particles";

/**
 * The store only reaches for `window.Image`, so a stub is enough to drive the
 * whole load lifecycle deterministically — no network, no timers.
 */
class FakeImage {
  src = "";
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

function withFakeImages<T>(sink: FakeImage[], body: () => T): T {
  const globals = globalThis as unknown as { window?: unknown };
  const previous = globals.window;
  globals.window = {
    Image: class extends FakeImage {
      constructor() {
        super();
        sink.push(this);
      }
    },
    devicePixelRatio: 1,
  };
  try {
    return body();
  } finally {
    if (previous === undefined) delete globals.window;
    else globals.window = previous;
  }
}

const art = (over: Partial<CharacterArt> = {}): CharacterArt => ({
  characterId: "iron-man",
  name: "Iron Man",
  palette: ["#dc2626", "#facc15"],
  portraitUrl: null,
  ...over,
});

describe("the renderer works before the art does", () => {
  it("falls back to a palette disc when there is no sheet and no portrait", () => {
    const store = new AssetStore([art()]);
    const drawable = store.spriteFor("iron-man", "ATTACK", 0.5);
    expect(drawable.kind).toBe("PLACEHOLDER");
    if (drawable.kind === "PLACEHOLDER") {
      expect(drawable.palette).toEqual(["#dc2626", "#facc15"]);
      expect(drawable.initials).toBe("IM");
    }
  });

  it("still draws a character it has never heard of", () => {
    const store = new AssetStore([]);
    expect(store.spriteFor("who", "IDLE", 0).kind).toBe("PLACEHOLDER");
  });

  it("draws a disc while a portrait is loading and upgrades when it lands", () => {
    const loaded: FakeImage[] = [];
    const store = withFakeImages(loaded, () => {
      const s = new AssetStore([art({ portraitUrl: "https://example.test/a.png" })]);
      // Asked for before the image is anywhere near ready.
      expect(s.spriteFor("iron-man", "IDLE", 0).kind).toBe("PLACEHOLDER");
      return s;
    });

    expect(loaded).toHaveLength(1);
    expect(loaded[0].src).toBe("https://example.test/a.png");

    loaded[0].onload?.();
    expect(store.spriteFor("iron-man", "IDLE", 0).kind).toBe("PORTRAIT");
  });

  it("keeps drawing a disc when the portrait 404s, and stops retrying", () => {
    const loaded: FakeImage[] = [];
    const store = withFakeImages(loaded, () => {
      const s = new AssetStore([art({ portraitUrl: "https://example.test/gone.png" })]);
      s.spriteFor("iron-man", "IDLE", 0);
      return s;
    });

    loaded[0].onerror?.();
    withFakeImages(loaded, () => {
      expect(store.spriteFor("iron-man", "IDLE", 0).kind).toBe("PLACEHOLDER");
      return store;
    });
    expect(loaded).toHaveLength(1); // no second attempt
  });

  it("tells the host when a late image is ready, so a paused canvas repaints", () => {
    const loaded: FakeImage[] = [];
    let repaints = 0;
    const store = withFakeImages(loaded, () => {
      const s = new AssetStore([art({ portraitUrl: "https://example.test/b.png" })]);
      s.setOnReady(() => repaints++);
      s.preload();
      return s;
    });
    expect(repaints).toBe(0);
    loaded[0].onload?.();
    expect(repaints).toBe(1);
    store.dispose();
  });

  it("gives distinguishable initials", () => {
    expect(initialsOf("Iron Man")).toBe("IM");
    expect(initialsOf("Thor")).toBe("TH");
    expect(initialsOf("Jean-Luc Picard Jr")).toBe("JJ");
    expect(initialsOf("   ")).toBe("?");
  });
});

describe("frame animator", () => {
  const looping: SpriteClip = { row: 0, frames: 4, loop: true };
  const once: SpriteClip = { row: 1, frames: 4, loop: false };

  it("walks a clip start to finish", () => {
    expect(frameAt(once, 0)).toBe(0);
    expect(frameAt(once, 0.5)).toBe(2);
    expect(frameAt(once, 0.99)).toBe(3);
  });

  it("holds the last frame of a one-shot instead of wrapping", () => {
    expect(frameAt(once, 1)).toBe(3);
    expect(frameAt(once, 5)).toBe(3);
  });

  it("wraps a loop", () => {
    expect(frameAt(looping, 1)).toBe(0);
    expect(frameAt(looping, 1.25)).toBe(1);
  });

  it("survives a single-frame clip", () => {
    expect(frameAt({ row: 0, frames: 1, loop: true }, 0.7)).toBe(0);
  });
});

describe("particle pool", () => {
  it("never grows past its capacity, however much it is asked to emit", () => {
    const pool = new ParticlePool(32);
    for (let i = 0; i < 50; i++) {
      pool.burst({ x: 10, y: 10, count: 16, color: "#fff", seed: i + 1 });
    }
    expect(pool.active).toBeLessThanOrEqual(32);
  });

  it("expires everything it emits", () => {
    const pool = new ParticlePool(64);
    pool.burst({ x: 0, y: 0, count: 20, color: "#fff", lifeSeconds: 0.4, seed: 7 });
    expect(pool.active).toBe(20);
    for (let i = 0; i < 20; i++) pool.update(0.05);
    expect(pool.active).toBe(0);
  });

  it("emits the same burst twice for the same seed", () => {
    const read = (pool: ParticlePool) => {
      const out: number[] = [];
      pool.forEach((p) => out.push(p.x, p.y, p.size));
      return out;
    };
    const a = new ParticlePool(16);
    const b = new ParticlePool(16);
    a.burst({ x: 5, y: 5, count: 8, color: "#fff", seed: 42 });
    b.burst({ x: 5, y: 5, count: 8, color: "#fff", seed: 42 });
    a.update(0.1);
    b.update(0.1);
    expect(read(a)).toEqual(read(b));
  });

  it("does not teleport particles when a backgrounded tab returns", () => {
    const pool = new ParticlePool(8);
    pool.burst({ x: 0, y: 0, count: 4, color: "#fff", lifeSeconds: 10, seed: 3 });
    pool.update(30); // thirty seconds of missed frames
    let maxDistance = 0;
    pool.forEach((p) => (maxDistance = Math.max(maxDistance, Math.hypot(p.x, p.y))));
    expect(maxDistance).toBeLessThan(100);
  });

  it("allocates nothing while walking live particles", () => {
    const pool = new ParticlePool(16);
    pool.burst({ x: 1, y: 1, count: 10, color: "#fff", seed: 9 });
    const seen: unknown[] = [];
    pool.forEach((p) => seen.push(p));
    // The same view object is handed out each time — that is the point of it.
    expect(new Set(seen).size).toBe(1);
  });

  it("clears on demand", () => {
    const pool = new ParticlePool(16);
    pool.burst({ x: 0, y: 0, count: 10, color: "#fff", seed: 1 });
    pool.clear();
    expect(pool.active).toBe(0);
  });
});
