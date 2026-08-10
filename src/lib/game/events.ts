import type { EventCard } from "./types";

/**
 * Event cards are drawn once per battle, after the map is locked in.
 * `kind` is the only thing the simulator switches on, so a new card that reuses
 * an existing kind needs zero engine changes.
 */
export const EVENT_CARDS: EventCard[] = [
  {
    id: "ambush",
    name: "AMBUSH",
    description: "The fastest team strikes first and hits harder in round 1.",
    kind: "FIRST_STRIKE_FASTEST",
    icon: "🗡️",
  },
  {
    id: "power-outage",
    name: "POWER OUTAGE",
    description: "Technology-based abilities receive -10%.",
    kind: "TAG_BONUS",
    tag: "tech",
    amount: -0.1,
    icon: "🔌",
  },
  {
    id: "close-quarters",
    name: "CLOSE QUARTERS",
    description: "Melee characters receive +10%.",
    kind: "TAG_BONUS",
    tag: "melee",
    amount: 0.1,
    icon: "🥊",
  },
  {
    id: "chaos",
    name: "CHAOS",
    description: "Every team loses a random slice of one stat for this battle.",
    kind: "RANDOM_STAT_DRAIN",
    icon: "🌀",
  },
  {
    id: "no-rules",
    name: "NO RULES",
    description: "All map modifiers are doubled.",
    kind: "DOUBLE_MAP_MODIFIERS",
    icon: "☠️",
  },
  {
    id: "long-night",
    name: "LONG NIGHT",
    description: "Stealth characters receive +10%.",
    kind: "TAG_BONUS",
    tag: "stealth",
    amount: 0.1,
    icon: "🌙",
  },
  {
    id: "open-ground",
    name: "OPEN GROUND",
    description: "Ranged characters receive +10%.",
    kind: "TAG_BONUS",
    tag: "ranged",
    amount: 0.1,
    icon: "🎯",
  },
  {
    id: "war-of-attrition",
    name: "WAR OF ATTRITION",
    description: "Survival specialists receive +12%.",
    kind: "TAG_BONUS",
    tag: "survival",
    amount: 0.12,
    icon: "⏳",
  },
];

export const EVENTS_BY_ID: Record<string, EventCard> = Object.fromEntries(
  EVENT_CARDS.map((e) => [e.id, e]),
);
