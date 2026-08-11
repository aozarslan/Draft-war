/**
 * ---------------------------------------------------------------------------
 * COSMETIC CATALOG (pure)
 * ---------------------------------------------------------------------------
 * Everything a player can own. Avatars, banners, titles and frames — and that
 * is the whole list on purpose.
 *
 * Nothing in here touches a stat, a credit, a bid limit or a battle. There is
 * no field an item could use to do so: an item carries a name, a rarity, a
 * price and a bag of colours. A player who owns every item in the catalog walks
 * into an auction with exactly the same 50 credits as somebody who owns none.
 *
 * This file is the source of truth. `supabase/migrations/0010_seed_items.sql`
 * is generated from it (`npm run seed:items`) so the database and the client
 * cannot describe the same item differently.
 */

export type ItemKind = "AVATAR" | "BANNER" | "TITLE" | "FRAME";

export type ItemRarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

/** Where an item can come from. Nothing is bought with real money. */
export type ItemSource = "DEFAULT" | "SHOP" | "ACHIEVEMENT" | "SEASON" | "LEVEL";

export interface CosmeticItem {
  id: string;
  kind: ItemKind;
  name: string;
  description: string;
  rarity: ItemRarity;
  /** Coin price. 0 means it is never sold — it is earned or given. */
  price: number;
  source: ItemSource;
  /** What unlocks it, when it is not bought. Shown as a hint in the shop. */
  requirement?: string;
  /** Purely presentational. Shape depends on `kind`. */
  payload: Record<string, string | number>;
}

export const RARITY_STYLE: Record<ItemRarity, { label: string; colour: string }> = {
  COMMON: { label: "Common", colour: "#94a3b8" },
  RARE: { label: "Rare", colour: "#22d3ee" },
  EPIC: { label: "Epic", colour: "#a78bfa" },
  LEGENDARY: { label: "Legendary", colour: "#fbbf24" },
};

export const ITEM_KINDS: { id: ItemKind; label: string; slot: string; icon: string }[] = [
  { id: "AVATAR", label: "Avatars", slot: "Avatar", icon: "🙂" },
  { id: "FRAME", label: "Frames", slot: "Frame", icon: "🔲" },
  { id: "BANNER", label: "Banners", slot: "Banner", icon: "🌈" },
  { id: "TITLE", label: "Titles", slot: "Title", icon: "🏷" },
];

// ---------------------------------------------------------------------------
// Avatars — payload: { emoji }
// ---------------------------------------------------------------------------

const AVATARS: CosmeticItem[] = [
  ["avatar-target", "Bullseye", "🎯", "COMMON", 0, "DEFAULT"],
  ["avatar-flame", "Flame", "🔥", "COMMON", 0, "DEFAULT"],
  ["avatar-skull", "Skull", "💀", "COMMON", 0, "DEFAULT"],
  ["avatar-crown", "Crown", "👑", "COMMON", 0, "DEFAULT"],
  ["avatar-fox", "Fox", "🦊", "COMMON", 0, "DEFAULT"],
  ["avatar-wolf", "Wolf", "🐺", "COMMON", 0, "DEFAULT"],
  ["avatar-bolt", "Bolt", "⚡", "COMMON", 0, "DEFAULT"],
  ["avatar-mask", "Mask", "🎭", "COMMON", 0, "DEFAULT"],
  ["avatar-shield", "Shield", "🛡", "COMMON", 0, "DEFAULT"],
  ["avatar-blade", "Blade", "🗡", "COMMON", 0, "DEFAULT"],
  ["avatar-raven", "Raven", "🐦‍⬛", "RARE", 400, "SHOP"],
  ["avatar-octopus", "Deep Thinker", "🐙", "RARE", 400, "SHOP"],
  ["avatar-moth", "Nightmoth", "🦋", "RARE", 400, "SHOP"],
  ["avatar-mushroom", "Spore", "🍄", "RARE", 400, "SHOP"],
  ["avatar-robot", "Unit 7", "🤖", "RARE", 500, "SHOP"],
  ["avatar-alien", "Visitor", "👽", "RARE", 500, "SHOP"],
  ["avatar-dragon", "Wyrm", "🐉", "EPIC", 1200, "SHOP"],
  ["avatar-comet", "Comet", "☄️", "EPIC", 1200, "SHOP"],
  ["avatar-volcano", "Caldera", "🌋", "EPIC", 1400, "SHOP"],
  ["avatar-galaxy", "Spiral", "🌌", "EPIC", 1400, "SHOP"],
  ["avatar-phoenix", "Ashborn", "🕊", "LEGENDARY", 3000, "SHOP"],
  ["avatar-eclipse", "Eclipse", "🌑", "LEGENDARY", 3000, "SHOP"],
].map(([id, name, emoji, rarity, price, source]) => ({
  id: id as string,
  kind: "AVATAR" as const,
  name: name as string,
  description: `${name} avatar.`,
  rarity: rarity as ItemRarity,
  price: price as number,
  source: source as ItemSource,
  payload: { emoji: emoji as string },
}));

// Earned rather than sold: the ones that mean something.
const EARNED_AVATARS: CosmeticItem[] = [
  {
    id: "avatar-gavel",
    kind: "AVATAR",
    name: "The Gavel",
    description: "For a player who has closed a lot of auctions.",
    rarity: "EPIC",
    price: 0,
    source: "ACHIEVEMENT",
    requirement: "Win 10 matches",
    payload: { emoji: "🔨" },
  },
  {
    id: "avatar-vault",
    kind: "AVATAR",
    name: "The Vault",
    description: "Awarded for reaching level 10.",
    rarity: "EPIC",
    price: 0,
    source: "LEVEL",
    requirement: "Reach level 10",
    payload: { emoji: "🏦" },
  },
];

// ---------------------------------------------------------------------------
// Frames — payload: { colour, glow, style }
//
// The ring drawn around an avatar. Read by the profile, the site header and the
// player rail in a room.
// ---------------------------------------------------------------------------

const FRAMES: CosmeticItem[] = [
  {
    id: "frame-default",
    kind: "FRAME",
    name: "Standard",
    description: "The frame every player starts with.",
    rarity: "COMMON",
    price: 0,
    source: "DEFAULT",
    payload: { colour: "#ffffff", glow: "0", style: "solid" },
  },
  {
    id: "frame-copper",
    kind: "FRAME",
    name: "Copper Bid",
    description: "A warm ring for a patient bidder.",
    rarity: "COMMON",
    price: 250,
    source: "SHOP",
    payload: { colour: "#b45309", glow: "0", style: "solid" },
  },
  {
    id: "frame-circuit",
    kind: "FRAME",
    name: "Circuit",
    description: "Cyan trace, faintly lit.",
    rarity: "RARE",
    price: 700,
    source: "SHOP",
    payload: { colour: "#22d3ee", glow: "10", style: "solid" },
  },
  {
    id: "frame-orchid",
    kind: "FRAME",
    name: "Orchid",
    description: "Violet, and slightly too pleased with itself.",
    rarity: "RARE",
    price: 700,
    source: "SHOP",
    payload: { colour: "#a78bfa", glow: "10", style: "double" },
  },
  {
    id: "frame-emberline",
    kind: "FRAME",
    name: "Emberline",
    description: "Burns quietly at the edge of the card.",
    rarity: "EPIC",
    price: 1600,
    source: "SHOP",
    payload: { colour: "#fb7185", glow: "18", style: "double" },
  },
  {
    id: "frame-goldleaf",
    kind: "FRAME",
    name: "Gold Leaf",
    description: "Reserved for people who close the deal.",
    rarity: "LEGENDARY",
    price: 3500,
    source: "SHOP",
    payload: { colour: "#fbbf24", glow: "24", style: "double" },
  },
  {
    id: "frame-champion",
    kind: "FRAME",
    name: "Champion's Ring",
    description: "Given for finishing a season at Champion.",
    rarity: "LEGENDARY",
    price: 0,
    source: "SEASON",
    requirement: "Finish a season at Champion",
    payload: { colour: "#f0abfc", glow: "28", style: "double" },
  },
];

// ---------------------------------------------------------------------------
// Banners — payload: { from, to, angle }
// ---------------------------------------------------------------------------

const BANNERS: CosmeticItem[] = [
  {
    id: "banner-default",
    kind: "BANNER",
    name: "Midnight",
    description: "The house colours.",
    rarity: "COMMON",
    price: 0,
    source: "DEFAULT",
    payload: { from: "#0b1020", to: "#05060c", angle: 135 },
  },
  {
    id: "banner-dusk",
    kind: "BANNER",
    name: "Dusk Market",
    description: "The hour when the bidding gets silly.",
    rarity: "COMMON",
    price: 300,
    source: "SHOP",
    payload: { from: "#7c2d12", to: "#1e1b4b", angle: 120 },
  },
  {
    id: "banner-signal",
    kind: "BANNER",
    name: "Signal",
    description: "Cyan on deep blue.",
    rarity: "RARE",
    price: 800,
    source: "SHOP",
    payload: { from: "#0e7490", to: "#0b1020", angle: 145 },
  },
  {
    id: "banner-nocturne",
    kind: "BANNER",
    name: "Nocturne",
    description: "Violet fading into nothing.",
    rarity: "RARE",
    price: 800,
    source: "SHOP",
    payload: { from: "#4c1d95", to: "#05060c", angle: 160 },
  },
  {
    id: "banner-arena",
    kind: "BANNER",
    name: "Arena Lights",
    description: "Two floodlights and a lot of noise.",
    rarity: "EPIC",
    price: 1800,
    source: "SHOP",
    payload: { from: "#be123c", to: "#0f172a", angle: 110 },
  },
  {
    id: "banner-aurora",
    kind: "BANNER",
    name: "Aurora",
    description: "Green over blue over black.",
    rarity: "EPIC",
    price: 1800,
    source: "SHOP",
    payload: { from: "#059669", to: "#1e1b4b", angle: 150 },
  },
  {
    id: "banner-sovereign",
    kind: "BANNER",
    name: "Sovereign",
    description: "Gold, and unembarrassed about it.",
    rarity: "LEGENDARY",
    price: 4000,
    source: "SHOP",
    payload: { from: "#b45309", to: "#1c1917", angle: 130 },
  },
];

// ---------------------------------------------------------------------------
// Titles — payload: { text, colour }
// ---------------------------------------------------------------------------

const TITLES: CosmeticItem[] = [
  ["title-rookie", "Rookie", "#94a3b8", "COMMON", 0, "DEFAULT", "Everyone starts here."],
  ["title-bidder", "Bidder", "#94a3b8", "COMMON", 200, "SHOP", "You raise, therefore you are."],
  ["title-collector", "Collector", "#22d3ee", "RARE", 600, "SHOP", "One of everything, please."],
  ["title-tactician", "Tactician", "#22d3ee", "RARE", 600, "SHOP", "The plan survived contact."],
  ["title-highroller", "High Roller", "#a78bfa", "EPIC", 1500, "SHOP", "Budget is a suggestion."],
  ["title-closer", "The Closer", "#a78bfa", "EPIC", 1500, "SHOP", "Last bid, every time."],
  ["title-kingmaker", "Kingmaker", "#fbbf24", "LEGENDARY", 3200, "SHOP", "Decides who wins. Rarely wins."],
].map(([id, text, colour, rarity, price, source, description]) => ({
  id: id as string,
  kind: "TITLE" as const,
  name: text as string,
  description: description as string,
  rarity: rarity as ItemRarity,
  price: price as number,
  source: source as ItemSource,
  payload: { text: text as string, colour: colour as string },
}));

const EARNED_TITLES: CosmeticItem[] = [
  {
    id: "title-undefeated",
    kind: "TITLE",
    name: "Undefeated",
    description: "Won three matches in a row.",
    rarity: "LEGENDARY",
    price: 0,
    source: "ACHIEVEMENT",
    requirement: "Win 3 matches in a row",
    payload: { text: "Undefeated", colour: "#f0abfc" },
  },
  {
    id: "title-veteran",
    kind: "TITLE",
    name: "Veteran",
    description: "Fifty matches played.",
    rarity: "EPIC",
    price: 0,
    source: "ACHIEVEMENT",
    requirement: "Play 50 matches",
    payload: { text: "Veteran", colour: "#a78bfa" },
  },
];

export const ITEMS: CosmeticItem[] = [
  ...AVATARS,
  ...EARNED_AVATARS,
  ...FRAMES,
  ...BANNERS,
  ...TITLES,
  ...EARNED_TITLES,
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function getItem(id: string | null | undefined): CosmeticItem | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function itemsOfKind(kind: ItemKind): CosmeticItem[] {
  return ITEMS.filter((i) => i.kind === kind);
}

/** Handed to every profile the moment it is created, and free forever. */
export const DEFAULT_ITEM_IDS: string[] = ITEMS.filter((i) => i.source === "DEFAULT").map(
  (i) => i.id,
);

/** What a brand new profile wears. */
export const DEFAULT_LOADOUT = {
  AVATAR: "avatar-target",
  FRAME: "frame-default",
  BANNER: "banner-default",
  TITLE: "title-rookie",
} as const satisfies Record<ItemKind, string>;

// ---------------------------------------------------------------------------
// Rendering helpers
//
// Both the profile page and the site header need these, and a legacy profile
// stores a raw emoji in `avatar` rather than an item id — so every lookup
// falls back rather than rendering an empty box.
// ---------------------------------------------------------------------------

export function avatarEmoji(value: string | null | undefined): string {
  const item = getItem(value);
  if (item?.kind === "AVATAR") return String(item.payload.emoji);
  // Pre-inventory profiles stored the emoji itself.
  if (value && value.length <= 4 && !value.includes("-")) return value;
  return String(getItem(DEFAULT_LOADOUT.AVATAR)!.payload.emoji);
}

export function frameStyle(value: string | null | undefined): {
  colour: string;
  glow: number;
  style: string;
} {
  const item = getItem(value) ?? getItem(DEFAULT_LOADOUT.FRAME)!;
  return {
    colour: String(item.payload.colour ?? "#ffffff"),
    glow: Number(item.payload.glow ?? 0),
    style: String(item.payload.style ?? "solid"),
  };
}

export function bannerGradient(value: string | null | undefined): string {
  const item = getItem(value) ?? getItem(DEFAULT_LOADOUT.BANNER)!;
  return `linear-gradient(${item.payload.angle ?? 135}deg, ${item.payload.from}, ${item.payload.to})`;
}

export function titleText(
  value: string | null | undefined,
): { text: string; colour: string } | null {
  const item = getItem(value);
  if (item?.kind === "TITLE") {
    return { text: String(item.payload.text), colour: String(item.payload.colour) };
  }
  // A legacy free-text title is still worth showing.
  return value ? { text: value, colour: "#22d3ee" } : null;
}
