/**
 * ---------------------------------------------------------------------------
 * FORMATIONS (pure)
 * ---------------------------------------------------------------------------
 * The one decision a player makes between the draft and the battle.
 *
 * Every formation is a small trade, never a free gain: whatever it adds to one
 * axis it takes from another. That is what keeps it a decision rather than a
 * correct answer — V4 is explicit that formations must not dominate the game,
 * and a modifier that only ever helps would decide matches on its own.
 *
 * The numbers are deliberately small. A formation should be worth roughly what
 * one good bid is worth, not what a whole draft is worth.
 *
 * They are also *measured*, not guessed. V4's own illustration — "Attack +5%,
 * Defense -3%" — is a net stat gain rather than a trade, and shipping it made
 * every formation beat BALANCED by 14 to 21 points in simulation. These values
 * were tuned against the simulator itself using mirrored, fixed matchups (each
 * pairing played from both sides so squad strength cancels), and every
 * formation now lands within about a point of 50% against a balanced opponent.
 * See `formationWinRates` in tests/formations.test.ts, which will fail if that
 * stops being true.
 */

import { AXIS_KEYS, type AxisKey } from "./categories";

export type FormationId = "BALANCED" | "AGGRESSIVE" | "DEFENSIVE" | "SPEED" | "CONTROL";

export interface Formation {
  id: FormationId;
  name: string;
  icon: string;
  colour: string;
  /** One line the player reads before committing. */
  blurb: string;
  /** Multipliers per axis. 1 is untouched. */
  modifiers: Partial<Record<AxisKey, number>>;
}

export const FORMATIONS: Record<FormationId, Formation> = {
  BALANCED: {
    id: "BALANCED",
    name: "Balanced",
    icon: "⚖️",
    colour: "#94a3b8",
    blurb: "No trade-offs. Play the squad you drafted.",
    modifiers: {},
  },
  AGGRESSIVE: {
    id: "AGGRESSIVE",
    name: "Aggressive",
    icon: "⚔️",
    colour: "#fb7185",
    blurb: "Hit harder, and take more coming back.",
    modifiers: { power: 1.04, defense: 0.96 },
  },
  DEFENSIVE: {
    id: "DEFENSIVE",
    name: "Defensive",
    icon: "🛡",
    colour: "#38bdf8",
    blurb: "Outlast them. Trade damage for survival.",
    modifiers: { defense: 1.04, power: 0.96 },
  },
  SPEED: {
    id: "SPEED",
    name: "Blitz",
    icon: "⚡",
    colour: "#facc15",
    blurb: "Strike first and often. Fragile if it stalls.",
    modifiers: { speed: 1.04, defense: 0.955 },
  },
  CONTROL: {
    id: "CONTROL",
    name: "Control",
    icon: "🌀",
    colour: "#a78bfa",
    blurb: "Dictate the fight. Fewer big hits, better ones.",
    modifiers: { strategy: 1.05, special: 1.04, power: 0.97 },
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export const DEFAULT_FORMATION: FormationId = "BALANCED";

export function getFormation(id: string | null | undefined): Formation {
  return FORMATIONS[(id ?? "") as FormationId] ?? FORMATIONS[DEFAULT_FORMATION];
}

/** Applies a formation to one character's axes. */
export function applyFormation(
  axes: Record<AxisKey, number>,
  formation: Formation,
): Record<AxisKey, number> {
  const out = {} as Record<AxisKey, number>;
  for (const key of AXIS_KEYS) {
    out[key] = Math.max(1, Math.round(axes[key] * (formation.modifiers[key] ?? 1)));
  }
  return out;
}

/**
 * The net effect of a formation on a squad, as a percentage of its combat
 * value. Used by the tests to hold the balance promise, and by the UI to show
 * an honest "about +2%" rather than a list of multipliers.
 *
 * Combat value is what the round loop actually fights with, so this measures
 * the thing that matters rather than the sum of the modifiers.
 */
export function formationSwing(
  axes: Record<AxisKey, number>,
  formation: Formation,
  combatValue: (a: Record<AxisKey, number>) => number,
): number {
  const before = combatValue(axes);
  const after = combatValue(applyFormation(axes, formation));
  return before > 0 ? (after - before) / before : 0;
}
