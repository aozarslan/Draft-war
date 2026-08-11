import { describe, expect, it } from "vitest";
import {
  DEFAULT_ITEM_IDS,
  DEFAULT_LOADOUT,
  ITEMS,
  ITEM_KINDS,
  RARITY_STYLE,
  avatarEmoji,
  bannerGradient,
  frameStyle,
  getItem,
  itemsOfKind,
  titleText,
  type ItemKind,
} from "../src/lib/game/items";

describe("catalog integrity", () => {
  it("has no duplicate ids", () => {
    const ids = new Set(ITEMS.map((i) => i.id));
    expect(ids.size).toBe(ITEMS.length);
  });

  it("gives every item a kind the database will accept", () => {
    const kinds = new Set(ITEM_KINDS.map((k) => k.id as string));
    for (const item of ITEMS) expect(kinds.has(item.kind)).toBe(true);
  });

  it("names every rarity it uses", () => {
    for (const item of ITEMS) expect(RARITY_STYLE[item.rarity]).toBeTruthy();
  });

  it("fills every slot with something", () => {
    for (const kind of ITEM_KINDS) {
      expect(itemsOfKind(kind.id).length).toBeGreaterThan(0);
    }
  });
});

describe("cosmetics stay cosmetic", () => {
  // The whole promise of the shop rests on this: an item can describe how it
  // looks and nothing else. A stat key appearing in a payload would be a
  // pay-to-win bug, so the test names them.
  const FORBIDDEN = [
    "power",
    "speed",
    "defense",
    "strategy",
    "special",
    "credits",
    "bid",
    "rank",
    "xp",
    "multiplier",
    "bonus",
  ];

  it("never carries a stat, a credit or a bid modifier", () => {
    for (const item of ITEMS) {
      for (const key of Object.keys(item.payload)) {
        expect(FORBIDDEN).not.toContain(key.toLowerCase());
      }
    }
  });

  it("only carries presentational keys", () => {
    const ALLOWED = ["emoji", "colour", "glow", "style", "from", "to", "angle", "text"];
    for (const item of ITEMS) {
      for (const key of Object.keys(item.payload)) {
        expect(ALLOWED).toContain(key);
      }
    }
  });
});

describe("defaults", () => {
  it("gives a new profile something in every slot", () => {
    for (const kind of ITEM_KINDS) {
      const id = DEFAULT_LOADOUT[kind.id as ItemKind];
      const item = getItem(id);
      expect(item, `${kind.id} has no default`).toBeTruthy();
      expect(item!.kind).toBe(kind.id);
    }
  });

  it("only equips free items by default", () => {
    for (const id of Object.values(DEFAULT_LOADOUT)) {
      expect(DEFAULT_ITEM_IDS).toContain(id);
      expect(getItem(id)!.price).toBe(0);
    }
  });

  it("never sells a default item", () => {
    for (const id of DEFAULT_ITEM_IDS) expect(getItem(id)!.price).toBe(0);
  });

  it("prices everything that is for sale and nothing that is not", () => {
    for (const item of ITEMS) {
      if (item.source === "SHOP") expect(item.price).toBeGreaterThan(0);
      else expect(item.price).toBe(0);
    }
  });

  it("tells a player how to earn what cannot be bought", () => {
    for (const item of ITEMS) {
      if (["ACHIEVEMENT", "SEASON", "LEVEL"].includes(item.source)) {
        expect(item.requirement, `${item.id} has no requirement`).toBeTruthy();
      }
    }
  });

  it("keeps the priciest item within a few weeks of ordinary play", () => {
    // A good match pays 225 coins plus 100 a day for showing up.
    const priciest = Math.max(...ITEMS.map((i) => i.price));
    expect(priciest).toBeLessThanOrEqual(5000);
  });
});

describe("rendering falls back rather than breaking", () => {
  it("renders a known avatar", () => {
    expect(avatarEmoji("avatar-fox")).toBe("🦊");
  });

  it("still renders a pre-inventory profile that stored a raw emoji", () => {
    expect(avatarEmoji("🐺")).toBe("🐺");
  });

  it("falls back for an unknown or missing id", () => {
    expect(avatarEmoji("avatar-does-not-exist")).toBe("🎯");
    expect(avatarEmoji(null)).toBe("🎯");
  });

  it("returns a usable frame for anything", () => {
    expect(frameStyle("frame-goldleaf").colour).toBe("#fbbf24");
    expect(frameStyle(null).colour).toBe("#ffffff");
    expect(frameStyle("nonsense").glow).toBe(0);
  });

  it("builds a gradient for a banner and for nothing", () => {
    expect(bannerGradient("banner-aurora")).toContain("#059669");
    expect(bannerGradient(undefined)).toContain("linear-gradient");
  });

  it("shows a legacy free-text title rather than dropping it", () => {
    expect(titleText("title-closer")?.text).toBe("The Closer");
    expect(titleText("Some Old Title")?.text).toBe("Some Old Title");
    expect(titleText(null)).toBeNull();
  });
});
