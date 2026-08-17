/**
 * ---------------------------------------------------------------------------
 * INTERACTION CUES
 * ---------------------------------------------------------------------------
 * Two kinds of relationship, held to very different standards.
 *
 * **Synergy is the engine's.** `computeSynergy` runs during the simulation,
 * caps at +10%, and its result is stored on `TeamResult.synergies` — a label
 * and a bonus per group. The replay copies those across untouched and this
 * file only decides where on screen to put them. Nothing here recomputes a
 * bonus, and nothing here could: the fight was over before the projection ran.
 *
 * **Rivalry is not the engine's, and is not pretended to be.** The simulation
 * has no notion of one character opposing another; there is no authoritative
 * rivalry to read. Rather than invent one — which would be a second source of
 * gameplay truth wearing a costume — the rivalry cue is defined as a plain
 * observation about data that already exists: *these two combatants on opposite
 * sides share a synergy tag*. That is true or false by inspection, it changes
 * nothing, and it is labelled as presentation everywhere it appears. If the
 * game ever gains a real rivalry mechanic, this is the seam it replaces.
 */

import { synergyLabelForTag } from "@/lib/game/battle";
import type { Replay } from "@/lib/game/replay";

/** What the draw layer needs to mark a shared allegiance. */
export interface SynergyCue {
  teamId: string;
  label: string;
  /** The engine's own bonus, for ordering. Never recomputed here. */
  bonus: number;
  /** The combatants that carry the tag, so the cue can point at them. */
  characterIds: string[];
}

/**
 * A pair of opposing combatants that share a tag.
 *
 * Presentation only. The name is a description of a coincidence in the data,
 * not a mechanic — neither combatant hits harder for being in one.
 */
export interface RivalryCue {
  tag: string;
  a: string;
  b: string;
  /** How many combatants in this battle carry the tag. Fewer is more telling. */
  rarity: number;
}

export interface InteractionInput {
  characterId: string;
  teamId: string;
  tags: string[];
}

export interface Interactions {
  synergies: SynergyCue[];
  rivalries: RivalryCue[];
}

/**
 * The relationships worth drawing in this battle.
 *
 * Deterministic and pure: same replay, same roster, same cues, in the same
 * order. Sorting is explicit rather than incidental so two devices agree even
 * though `Map` iteration order would already have matched.
 */
export function interactionsFor(
  replay: Replay,
  roster: InteractionInput[],
): Interactions {
  // Synergy: the engine said which groups fired; this finds who is in them.
  // The tag is matched through the game's own tag→label lookup rather than by
  // unpicking the label's wording — "Predators ×3" does not contain "predator".
  const synergies: SynergyCue[] = [];
  for (const team of replay.teams) {
    const members = roster.filter((r) => r.teamId === team.playerId);
    for (const group of team.synergies) {
      const name = group.label.replace(/\s*×\d+$/, "");
      const carriers = members.filter((m) =>
        m.tags.some((t) => synergyLabelForTag(t) === name),
      );
      synergies.push({
        teamId: team.playerId,
        label: group.label,
        bonus: group.bonus,
        characterIds: carriers.map((c) => c.characterId).sort(),
      });
    }
  }
  synergies.sort((a, b) => b.bonus - a.bonus || a.label.localeCompare(b.label));

  // Rivalry: opposing combatants sharing a tag.
  //
  // Ranked by how rare the tag is in *this* battle and then cut to a handful.
  // Drawing every shared tag put twenty dashed lines across the arena, which
  // is noise rather than information: when eight of ten combatants are
  // "predator", that they share it says nothing. Two characters who are the
  // only "big-cat" on the field is worth a line.
  const frequency = new Map<string, number>();
  for (const r of roster) {
    for (const tag of r.tags) frequency.set(tag, (frequency.get(tag) ?? 0) + 1);
  }

  const candidates: RivalryCue[] = [];
  for (const left of roster) {
    for (const right of roster) {
      if (left.teamId === right.teamId) continue;
      if (left.characterId >= right.characterId) continue;

      const shared = left.tags
        .filter((t) => right.tags.includes(t))
        .sort((a, b) => (frequency.get(a) ?? 0) - (frequency.get(b) ?? 0) || a.localeCompare(b));
      if (shared.length === 0) continue;

      const tag = shared[0];
      const rarity = frequency.get(tag) ?? 0;
      if (rarity > MAX_RIVALRY_CARRIERS) continue;
      candidates.push({ tag, a: left.characterId, b: right.characterId, rarity });
    }
  }

  candidates.sort(
    (x, y) =>
      x.rarity - y.rarity ||
      x.tag.localeCompare(y.tag) ||
      x.a.localeCompare(y.a) ||
      x.b.localeCompare(y.b),
  );
  const rivalries = candidates.slice(0, MAX_RIVALRIES);

  return { synergies, rivalries };
}

/**
 * When each cue is on screen.
 *
 * Both play in the opening seconds, before the first blow, and then never
 * again — a badge that persisted through the fight would compete with the
 * damage numbers for exactly the attention those need. The window is carved
 * out of the replay's own opening, so it adds no time.
 */
/**
 * A tag carried by more combatants than this says nothing about any pair of
 * them, so it never becomes a rivalry line.
 */
export const MAX_RIVALRY_CARRIERS = 4;
/** However interesting the roster, the arena only has room for a few lines. */
export const MAX_RIVALRIES = 3;

export const CUE_START_MS = 350;
export const CUE_END_MS = 2600;

/** 0..1 while the opening cues are showing, 0 once the fight is under way. */
export function cueIntensity(elapsedMs: number): number {
  if (elapsedMs <= CUE_START_MS || elapsedMs >= CUE_END_MS) return 0;
  const span = CUE_END_MS - CUE_START_MS;
  const t = (elapsedMs - CUE_START_MS) / span;
  // In over the first fifth, hold, out over the last third.
  if (t < 0.2) return t / 0.2;
  if (t > 0.7) return (1 - t) / 0.3;
  return 1;
}
