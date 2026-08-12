/**
 * ---------------------------------------------------------------------------
 * ARCHETYPES AND HIDDEN POWER (pure)
 * ---------------------------------------------------------------------------
 * Two V4 draft-strategy features that share one idea: the auction gets more
 * interesting when a character is described rather than merely scored.
 *
 * **Archetypes are derived, not authored.** A tank is a character whose defence
 * dominates its own profile — that is already in the axes, so reading it out
 * beats hand-labelling 268 characters and then watching the labels drift when
 * the numbers are retuned. Add a character tomorrow and it gets an archetype
 * with no extra work and nothing to keep in sync.
 *
 * **Hidden power is deterministic.** Every player must see the same band for
 * the same character in the same game, or the auction is not fair. The band is
 * therefore a pure function of the character and the game seed, never a random
 * draw at render time.
 */

import { AXIS_KEYS, type AxisKey } from "./categories";

export type Axes = Record<AxisKey, number>;

// ---------------------------------------------------------------------------
// Archetypes
// ---------------------------------------------------------------------------

export type ArchetypeId =
  | "TANK"
  | "BRUISER"
  | "ASSASSIN"
  | "SPEEDSTER"
  | "STRATEGIST"
  | "RANGED"
  | "SUPPORT"
  | "CONTROL"
  | "WILD_CARD"
  | "BOSS";

export interface Archetype {
  id: ArchetypeId;
  name: string;
  icon: string;
  colour: string;
  /** One line, shown on the card during the auction. */
  blurb: string;
}

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  TANK: { id: "TANK", name: "Tank", icon: "🛡", colour: "#38bdf8", blurb: "Soaks damage and refuses to fall." },
  BRUISER: { id: "BRUISER", name: "Bruiser", icon: "🥊", colour: "#fb7185", blurb: "Hits hard and takes a hit." },
  ASSASSIN: { id: "ASSASSIN", name: "Assassin", icon: "🗡", colour: "#f43f5e", blurb: "Ends fights before they start." },
  SPEEDSTER: { id: "SPEEDSTER", name: "Speedster", icon: "⚡", colour: "#facc15", blurb: "Strikes first, always." },
  STRATEGIST: { id: "STRATEGIST", name: "Strategist", icon: "🧠", colour: "#a78bfa", blurb: "Wins on the plan, not the punch." },
  RANGED: { id: "RANGED", name: "Ranged", icon: "🎯", colour: "#34d399", blurb: "Damage from a safe distance." },
  SUPPORT: { id: "SUPPORT", name: "Support", icon: "✨", colour: "#22d3ee", blurb: "Makes the rest of the team better." },
  CONTROL: { id: "CONTROL", name: "Control", icon: "🌀", colour: "#818cf8", blurb: "Dictates how the fight goes." },
  WILD_CARD: { id: "WILD_CARD", name: "Wild Card", icon: "🎲", colour: "#f0abfc", blurb: "Unpredictable. Could be anything." },
  BOSS: { id: "BOSS", name: "Boss", icon: "👑", colour: "#fbbf24", blurb: "Good at everything. Priced accordingly." },
};

export interface ArchetypeRead {
  primary: Archetype;
  secondary: Archetype | null;
  /** 0..1 — how strongly the profile matches the primary. */
  confidence: number;
}

/**
 * Reads a character's shape out of its axes.
 *
 * The axes are compared against the character's own mean rather than against
 * other characters, so "a tank" means "defensive *for itself*". Without that,
 * every strong character would read as a boss and every weak one as support,
 * which describes the price tag rather than the fighter.
 */
export function archetypeOf(axes: Axes): ArchetypeRead {
  const values = AXIS_KEYS.map((k) => axes[k] ?? 0);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const spread = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length,
  );

  // Deviation from its own mean, per axis.
  const d = (k: AxisKey) => (axes[k] ?? 0) - mean;

  // A flat profile is not a specialist. High and flat is a boss; middling and
  // flat is a wild card, because nothing about it tells you how it fights.
  //
  // The thresholds are calibrated against the real pool rather than guessed:
  // across 268 characters the median mean is 79 and the median spread is 7.3,
  // so an earlier draft using `mean >= 78 && spread < 6` labelled a quarter of
  // the game BOSS. At `spread < 4 && mean >= 85` it is eleven characters —
  // Madara, Dante, Sephiroth, Gojo — which is what a boss should be.
  if (spread < 4) {
    const isBoss = mean >= 85;
    return {
      primary: isBoss ? ARCHETYPES.BOSS : ARCHETYPES.WILD_CARD,
      secondary: null,
      confidence: isBoss ? Math.min(1, (mean - 85) / 10) : 0.35,
    };
  }

  const scores: [ArchetypeId, number][] = [
    ["TANK", d("defense") * 1.6 - d("speed") * 0.4],
    ["BRUISER", d("power") * 1.0 + d("defense") * 0.9],
    // Fragility is the defining assassin trait, so the defence penalty is
    // weighted as heavily as the power bonus. At the original 0.6 only one
    // of the thirteen glass cannons in the pool actually got the label — the
    // rest lost to speedster or ranged. At 1.2 it is sixteen.
    ["ASSASSIN", d("power") * 1.2 + d("speed") * 0.9 - d("defense") * 1.2],
    ["SPEEDSTER", d("speed") * 1.7 - d("defense") * 0.3],
    ["STRATEGIST", d("strategy") * 1.7],
    ["RANGED", d("special") * 1.0 + d("speed") * 0.6 - d("defense") * 0.5],
    ["SUPPORT", d("special") * 0.9 + d("strategy") * 1.0 - d("power") * 0.7],
    ["CONTROL", d("strategy") * 1.0 + d("special") * 0.9 - d("speed") * 0.4],
  ];

  scores.sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = scores[0];
  const [secondId, secondScore] = scores[1];

  return {
    primary: ARCHETYPES[topId],
    // Only a genuinely close runner-up earns a second label. A secondary that
    // is always present tells the player nothing.
    secondary: secondScore > topScore * 0.72 ? ARCHETYPES[secondId] : null,
    confidence: Math.max(0, Math.min(1, topScore / 18)),
  };
}

/**
 * Archetype synergy: a squad of five identical roles is fragile, and a squad
 * with a role for every job is not. Returns a multiplier contribution in the
 * 0..0.04 range — small, because V4 caps *all* synergy at 10% and universe
 * synergy already uses most of that.
 */
export function archetypeSynergy(reads: ArchetypeRead[]): {
  bonus: number;
  label: string | null;
} {
  if (reads.length < 3) return { bonus: 0, label: null };

  const distinct = new Set(reads.map((r) => r.primary.id));
  const counts = new Map<ArchetypeId, number>();
  for (const r of reads) counts.set(r.primary.id, (counts.get(r.primary.id) ?? 0) + 1);
  const biggest = Math.max(...counts.values());

  // A balanced squad — four or more distinct roles — is the reward.
  if (distinct.size >= 4) return { bonus: 0.04, label: "Balanced squad" };
  if (distinct.size === 3) return { bonus: 0.02, label: "Mixed roles" };

  // Three or more of one role is a commitment, and gets a smaller, thematic
  // bonus rather than nothing: going all-in should be a real option.
  if (biggest >= 3) {
    const id = [...counts.entries()].find(([, n]) => n === biggest)![0];
    return { bonus: 0.015, label: `${ARCHETYPES[id].name} wall` };
  }

  return { bonus: 0, label: null };
}

// ---------------------------------------------------------------------------
// Hidden power
// ---------------------------------------------------------------------------

/** How much is hidden. Ranked hides more; casual hides less for beginners. */
export type Visibility = "CASUAL" | "RANKED";

/**
 * A deterministic hash of two strings into 0..1.
 *
 * Same character, same game, same band for every player — which is the whole
 * point. A random draw at render time would show different bands on different
 * phones and make the auction unfair in a way nobody could see.
 */
function hash01(a: string, b: string): number {
  let h = 2166136261;
  const s = `${a}::${b}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface PowerBand {
  low: number;
  high: number;
  /** The true value. Only ever sent to the client after the reveal. */
  exact: number | null;
  label: string;
}

/**
 * The band a bidder sees during the auction.
 *
 * The true value sits somewhere inside the band but not always in the middle —
 * otherwise the midpoint would simply be the answer and nothing is hidden.
 */
export function powerBand(
  characterId: string,
  gamePower: number,
  seed: string,
  visibility: Visibility = "CASUAL",
): PowerBand {
  const width = visibility === "RANKED" ? 8 : 5;
  const offset = Math.round(hash01(characterId, seed) * width);

  const low = Math.max(1, gamePower - offset);
  const high = Math.min(100, low + width);

  return { low, high, exact: null, label: `${low}–${high}` };
}

/** After the draft, the band is replaced by the number it was hiding. */
export function revealedBand(gamePower: number): PowerBand {
  return { low: gamePower, high: gamePower, exact: gamePower, label: String(gamePower) };
}

// ---------------------------------------------------------------------------
// Draft efficiency
// ---------------------------------------------------------------------------

/**
 * Team power per credit spent, on a scale that reads nicely.
 *
 * V4's example: 465 team power for 47 credits is 9.89. That is power ÷ credits
 * scaled by 1, and the numbers land where the brief says they should.
 *
 * Spending nothing is not infinitely efficient — a player who was handed free
 * characters did not out-draft anybody — so the floor price of one credit per
 * slot is used when a roster somehow cost nothing.
 */
export function draftEfficiency(teamPower: number, creditsSpent: number, roster: number): number {
  const spend = Math.max(creditsSpent, Math.max(1, roster));
  return Math.round((teamPower / spend) * 100) / 100;
}

/** Plain-language read on an efficiency number, for the results screen. */
export function efficiencyLabel(value: number): string {
  if (value >= 12) return "Daylight robbery";
  if (value >= 10) return "Excellent value";
  if (value >= 8) return "Solid drafting";
  if (value >= 6) return "Paid the going rate";
  return "Overpaid";
}
