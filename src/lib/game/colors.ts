/**
 * Seat colours. Index 0..3 maps to player 1..4 and is used everywhere:
 * lobby list, bid bubbles, roster panels, battle log and results.
 */
export interface PlayerColor {
  key: string;
  label: string;
  hex: string;
  /** Tailwind-friendly rgb triple for arbitrary alpha usage. */
  rgb: string;
}

export const PLAYER_COLORS: PlayerColor[] = [
  { key: "blue", label: "Blue", hex: "#3b82f6", rgb: "59 130 246" },
  { key: "red", label: "Red", hex: "#ef4444", rgb: "239 68 68" },
  { key: "green", label: "Green", hex: "#22c55e", rgb: "34 197 94" },
  { key: "purple", label: "Purple", hex: "#a855f7", rgb: "168 85 247" },
  { key: "amber", label: "Amber", hex: "#f59e0b", rgb: "245 158 11" },
  { key: "cyan", label: "Cyan", hex: "#06b6d4", rgb: "6 182 212" },
  { key: "pink", label: "Pink", hex: "#ec4899", rgb: "236 72 153" },
  { key: "lime", label: "Lime", hex: "#84cc16", rgb: "132 204 22" },
];

export function playerColor(index: number): PlayerColor {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}
