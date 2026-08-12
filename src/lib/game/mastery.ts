/**
 * ---------------------------------------------------------------------------
 * MASTERY AND COLLECTION (pure)
 * ---------------------------------------------------------------------------
 * The long game. Everything here is a *record of what you have done*, never a
 * thing that makes you stronger — V4 is explicit that mastery must never
 * unlock competitive power, and the shape of this module enforces it: mastery
 * produces a level, a label and a colour, and there is nowhere for a stat to
 * live even if somebody later wanted one.
 *
 * Both are derived from data the game already writes. Drafting a character is
 * recorded in `match_history.roster`; the characters you have *seen* are the
 * pools of the games you played. Neither needs a counter to keep in step, and
 * a counter is the thing that would eventually disagree with the history.
 */

/**
 * Mastery points for one draft of one character.
 *
 * Drafting is the act being rewarded, so every draft counts. Winning with a
 * character counts double and an MVP performance counts triple — not because
 * winning should gate mastery, but because "the games that mattered" is a
 * better story than "the games you sat through".
 */
export function masteryForDraft(outcome: {
  placement: number;
  playerCount: number;
  wasMvp: boolean;
}): number {
  let points = 1;
  if (outcome.placement === 1) points += 1;
  if (outcome.wasMvp) points += 1;
  return points;
}

/**
 * Total points needed to reach a mastery level.
 *
 *   1 -> 0, 2 -> 3, 3 -> 8, 4 -> 15, 5 -> 24 …
 *
 * Each level costs two more than the last, so the first few arrive inside an
 * evening with a favourite character and the later ones are a genuine mark of
 * having played them for a long time.
 */
export function masteryForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  let total = 0;
  for (let i = 2; i <= n; i++) total += 1 + 2 * (i - 1);
  return total;
}

export interface MasteryProgress {
  level: number;
  points: number;
  intoLevel: number;
  levelSpan: number;
  toNext: number;
  progress: number;
}

export function masteryFromPoints(points: number): MasteryProgress {
  const total = Math.max(0, Math.floor(points));
  let level = 1;
  while (masteryForLevel(level + 1) <= total && level < 50) level++;

  const floor = masteryForLevel(level);
  const ceiling = masteryForLevel(level + 1);
  const span = ceiling - floor;
  const into = total - floor;

  return {
    level,
    points: total,
    intoLevel: into,
    levelSpan: span,
    toNext: Math.max(0, ceiling - total),
    progress: span > 0 ? into / span : 0,
  };
}

/**
 * The badge a mastery level earns. Cosmetic by construction — a label and a
 * colour, and nothing else this type could carry.
 */
export interface MasteryBadge {
  label: string;
  colour: string;
  icon: string;
}

const MASTERY_TIERS: { from: number; badge: MasteryBadge }[] = [
  { from: 1, badge: { label: "Novice", colour: "#94a3b8", icon: "○" } },
  { from: 3, badge: { label: "Familiar", colour: "#22d3ee", icon: "◔" } },
  { from: 5, badge: { label: "Practised", colour: "#34d399", icon: "◑" } },
  { from: 8, badge: { label: "Expert", colour: "#a78bfa", icon: "◕" } },
  { from: 12, badge: { label: "Master", colour: "#fbbf24", icon: "●" } },
  { from: 18, badge: { label: "Signature", colour: "#f0abfc", icon: "★" } },
];

export function masteryBadge(level: number): MasteryBadge {
  let badge = MASTERY_TIERS[0].badge;
  for (const tier of MASTERY_TIERS) if (level >= tier.from) badge = tier.badge;
  return badge;
}

// ---------------------------------------------------------------------------
// Category mastery
// ---------------------------------------------------------------------------

/**
 * A category's mastery is the sum of its characters' points, on a slower
 * curve: it should take many games with many different characters, not one
 * favourite played to death.
 */
export function categoryMasteryForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  let total = 0;
  for (let i = 2; i <= n; i++) total += 10 + 10 * (i - 1);
  return total;
}

export function categoryMasteryFromPoints(points: number): MasteryProgress {
  const total = Math.max(0, Math.floor(points));
  let level = 1;
  while (categoryMasteryForLevel(level + 1) <= total && level < 50) level++;

  const floor = categoryMasteryForLevel(level);
  const ceiling = categoryMasteryForLevel(level + 1);
  const span = ceiling - floor;

  return {
    level,
    points: total,
    intoLevel: total - floor,
    levelSpan: span,
    toNext: Math.max(0, ceiling - total),
    progress: span > 0 ? (total - floor) / span : 0,
  };
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export interface CollectionSlice {
  /** How many distinct characters exist in this category. */
  total: number;
  /** How many the player has seen come up for auction. */
  seen: number;
  /** How many they have actually owned. */
  drafted: number;
}

export function collectionPercent(slice: CollectionSlice): number {
  if (slice.total <= 0) return 0;
  return Math.round((slice.drafted / slice.total) * 100);
}

/**
 * A one-line read on a collection slice.
 *
 * Deliberately talks about drafting rather than seeing: "seen" is luck of the
 * draw, "drafted" is a decision somebody made.
 */
export function collectionLabel(slice: CollectionSlice): string {
  const percent = collectionPercent(slice);
  if (percent >= 100) return "Complete";
  if (percent >= 75) return "Nearly there";
  if (percent >= 50) return "Halfway";
  if (percent >= 25) return "Coming along";
  if (percent > 0) return "Started";
  return "Untouched";
}
