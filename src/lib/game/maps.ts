import type { BattleMap } from "./types";

/**
 * Battlefields. Each map hands a multiplicative bonus to characters carrying
 * the listed tag. Adding a map is a matter of appending to this array — the
 * simulator reads modifiers generically and ignores tags nobody has.
 */
export const MAPS: BattleMap[] = [
  {
    id: "city",
    name: "CITY",
    description: "Dense streets, endless sightlines, everything is cover.",
    modifiers: [
      { tag: "tactical", bonus: 0.05 },
      { tag: "marksman", bonus: 0.03 },
    ],
    palette: ["#1e293b", "#38bdf8"],
    icon: "🏙️",
  },
  {
    id: "forest",
    name: "FOREST",
    description: "Thick canopy. You never see the first move coming.",
    modifiers: [
      { tag: "stealth", bonus: 0.05 },
      { tag: "survival", bonus: 0.03 },
    ],
    palette: ["#14532d", "#4ade80"],
    icon: "🌲",
  },
  {
    id: "desert",
    name: "DESERT",
    description: "No cover, no mercy. Distance decides everything.",
    modifiers: [
      { tag: "ranged", bonus: 0.05 },
      { tag: "marksman", bonus: 0.04 },
    ],
    palette: ["#78350f", "#fbbf24"],
    icon: "🏜️",
  },
  {
    id: "snow",
    name: "SNOW",
    description: "Whiteout conditions. Endurance beats flash.",
    modifiers: [
      { tag: "survival", bonus: 0.05 },
      { tag: "veteran", bonus: 0.04 },
    ],
    palette: ["#0f172a", "#e0f2fe"],
    icon: "❄️",
  },
  {
    id: "industrial",
    name: "INDUSTRIAL AREA",
    description: "Machinery, catwalks and improvised weapons everywhere.",
    modifiers: [
      { tag: "environment", bonus: 0.06 },
      { tag: "brawler", bonus: 0.04 },
    ],
    palette: ["#3f3f46", "#f97316"],
    icon: "🏭",
  },
  {
    id: "night-city",
    name: "NIGHT CITY",
    description: "Neon glare and blind alleys. Tech runs the night.",
    modifiers: [
      { tag: "tech", bonus: 0.05 },
      { tag: "stealth", bonus: 0.04 },
    ],
    palette: ["#2e1065", "#e879f9"],
    icon: "🌃",
  },
  {
    id: "abandoned-building",
    name: "ABANDONED BUILDING",
    description: "Room-to-room. Nowhere to shoot from, everywhere to swing.",
    modifiers: [
      { tag: "melee", bonus: 0.05 },
      { tag: "brawler", bonus: 0.03 },
    ],
    palette: ["#292524", "#a8a29e"],
    icon: "🏚️",
  },
  {
    id: "harbor",
    name: "HARBOR",
    description: "Containers, cranes and water. Footwork wins.",
    modifiers: [
      { tag: "mobility", bonus: 0.05 },
      { tag: "leader", bonus: 0.03 },
    ],
    palette: ["#0c4a6e", "#67e8f9"],
    icon: "⚓",
  },
];

export const MAPS_BY_ID: Record<string, BattleMap> = Object.fromEntries(
  MAPS.map((m) => [m.id, m]),
);
