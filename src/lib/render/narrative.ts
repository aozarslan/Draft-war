/**
 * ---------------------------------------------------------------------------
 * NARRATIVE (pure projection)
 * ---------------------------------------------------------------------------
 * The sentences a battle tells about itself, and when each one is on screen.
 *
 * `highlightsOf` says how loud a moment is. This says what to *call* it, and —
 * more importantly — which single one of several overlapping moments gets the
 * title card. There is exactly one narrative slot. When two cues want it, the
 * louder one takes it and the quieter one is **dropped**, never queued: a cue
 * shown after the moment it describes has passed is worse than no cue, because
 * it labels the wrong thing. That is the M6 stacked-band bug, prevented here
 * structurally rather than by remembering not to cause it.
 *
 * Everything is derived from data the engine already stored. No probabilities
 * are reconstructed, no combat value is computed, nothing is randomised and
 * nothing is timed off a clock. In particular there is deliberately **no
 * underdog-pressure cue**: momentum over time needs per-round odds, the engine
 * does not persist them, and inventing them here would be exactly the second
 * source of truth this project refuses. That belongs to an engine reporting
 * change in a later milestone, not to a renderer.
 */

import { FINAL_PHASE_LABEL } from "@/lib/game/battle";
import type { Replay } from "@/lib/game/replay";
import type { Highlight } from "./highlights";

export type NarrativeKind =
  | "PHASE"
  | "COMEBACK"
  | "LAST_STAND"
  | "FINAL_CLASH"
  | "TURNING_POINT"
  | "VICTORY"
  | "UPSET";

/**
 * Who wins the slot when two cues overlap.
 *
 * Ordered by how much of the battle the cue explains: a phase divider is
 * furniture, a turning point is the reason the match went the way it did.
 */
export const NARRATIVE_PRIORITY: Record<NarrativeKind, number> = {
  PHASE: 1,
  COMEBACK: 2,
  LAST_STAND: 3,
  FINAL_CLASH: 3,
  TURNING_POINT: 4,
  VICTORY: 5,
  UPSET: 5,
};

/**
 * How long each cue's entrance animation runs.
 *
 * Separate from how long the cue *owns* the slot, because the ending owns it
 * until playback stops while still sliding in over a beat and a half.
 */
const ANIMATION_MS: Record<NarrativeKind, number> = {
  PHASE: 1600,
  COMEBACK: 1200,
  LAST_STAND: 1200,
  FINAL_CLASH: 1600,
  TURNING_POINT: 1600,
  VICTORY: 1600,
  UPSET: 1600,
};

export interface NarrativeCue {
  kind: NarrativeKind;
  /** The engine's own timestamp for the moment. Never adjusted. */
  atMs: number;
  /**
   * How long this cue owns the narrative slot.
   *
   * `Infinity` for the ending: the victory band is the replay's final state
   * and has no natural expiry — `sceneAt` answers honestly for any time and
   * the *clock* is what stops. Giving it a finite window is how the band once
   * came to vanish before playback did.
   */
  durationMs: number;
  /** How long its entrance runs, which is not how long it stays. */
  animationMs: number;
  priority: number;
  /** The line drawn on the title card. */
  text: string;
  /**
   * A short label for a screen reader, distinct from `text` because a
   * spoken cue wants "Turning point", not the whole sentence.
   */
  label: string;
  /** Index into `replay.events`, when the cue came from one. */
  eventIndex: number | null;
}

/**
 * Every cue a battle produces, in timestamp order.
 *
 * Deterministic and side-effect free: same replay, same array, on every device.
 * Overlap is *not* resolved here — the list is the full set of things worth
 * saying, and `activeCue` decides which of them is on screen at a given
 * moment. Keeping those apart is what makes the slot rule testable.
 */
export function narrativeOf(replay: Replay, highlights: Highlight[]): NarrativeCue[] {
  const cues: NarrativeCue[] = [];
  const finalClashPrefix = FINAL_PHASE_LABEL.toUpperCase();

  const push = (
    kind: NarrativeKind,
    atMs: number,
    text: string,
    label: string,
    eventIndex: number | null,
    over: { durationMs?: number } = {},
  ) => {
    cues.push({
      kind,
      atMs,
      durationMs: over.durationMs ?? ANIMATION_MS[kind],
      animationMs: ANIMATION_MS[kind],
      priority: NARRATIVE_PRIORITY[kind],
      text,
      label,
      eventIndex,
    });
  };

  // Phase dividers and the closing rounds, from the engine's own text. The
  // final clash is recognised by the label the engine wrote, not by a literal,
  // so renaming the phase cannot silently stop this working.
  replay.events.forEach((event, index) => {
    if (event.kind !== "PHASE") return;
    const isFinalClash = event.text.toUpperCase().startsWith(finalClashPrefix);
    if (isFinalClash) {
      push("FINAL_CLASH", event.atMs, event.text, "Final clash", index);
    } else {
      push("PHASE", event.atMs, event.text, event.text, index);
    }
  });

  // The turning point and the ending, exactly as the engine reported them.
  replay.events.forEach((event, index) => {
    if (event.kind === "TURNING_POINT") {
      push("TURNING_POINT", event.atMs, event.text, "Turning point", index);
    }
    if (event.kind === "END") {
      // One cue, not two: at the end the band says who won and the stamp says
      // it was an upset. Modelling them as separate slot occupants would put
      // two of them in a slot that holds one.
      const kind: NarrativeKind = replay.upset ? "UPSET" : "VICTORY";
      push(kind, event.atMs, event.text, replay.upset ? "Upset" : "Victory", index, {
        durationMs: Number.POSITIVE_INFINITY,
      });
    }
  });

  // A kill thrown by the side that was already down on bodies. The
  // classification is the highlight layer's; this only names it.
  for (const highlight of highlights) {
    if (highlight.kind !== "ELIMINATION") continue;
    if (!highlight.reason.includes("shorter-handed")) continue;
    push("COMEBACK", highlight.atMs, "AGAINST THE ODDS", "Comeback kill", highlight.index);
  }

  for (const stand of lastStands(replay)) {
    push("LAST_STAND", stand.atMs, "LAST STAND", "Last stand", stand.eventIndex);
  }

  cues.sort((a, b) => a.atMs - b.atMs || b.priority - a.priority);
  return cues;
}

/**
 * The cue on screen at a given moment, or none.
 *
 * The whole slot rule, in one place: among the cues whose window contains this
 * moment, the highest priority wins and the rest are simply not shown. A
 * dropped cue is not remembered, not deferred and not shown late.
 *
 * Ties break on the later timestamp — of two equally important things, the one
 * that just happened is the one being described.
 */
export function activeCue(cues: NarrativeCue[], elapsedMs: number): NarrativeCue | null {
  let best: NarrativeCue | null = null;

  for (const cue of cues) {
    const age = elapsedMs - cue.atMs;
    if (age < 0 || age >= cue.durationMs) continue;
    if (
      !best ||
      cue.priority > best.priority ||
      (cue.priority === best.priority && cue.atMs > best.atMs)
    ) {
      best = cue;
    }
  }

  return best;
}

/** 0..1 through a cue's entrance, holding at 1 once it has arrived. */
export function cueProgress(cue: NarrativeCue, elapsedMs: number): number {
  const t = (elapsedMs - cue.atMs) / cue.animationMs;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * The moment a squad is reduced to its last fighter.
 *
 * Counted from the elimination log alone — "how many of yours have died" is
 * something the log states outright — and reported once per team, at the kill
 * that did it. No engine state is introduced.
 */
function lastStands(replay: Replay): { atMs: number; eventIndex: number }[] {
  const squadSize = new Map<string, number>();
  for (const c of replay.combatants) {
    squadSize.set(c.teamId, (squadSize.get(c.teamId) ?? 0) + 1);
  }

  const lost = new Map<string, number>();
  const announced = new Set<string>();
  const out: { atMs: number; eventIndex: number }[] = [];

  replay.events.forEach((event, index) => {
    if (event.kind !== "ELIMINATION" || !event.targetTeamId) return;
    const team = event.targetTeamId;
    lost.set(team, (lost.get(team) ?? 0) + 1);

    const alive = (squadSize.get(team) ?? 0) - (lost.get(team) ?? 0);
    if (alive === 1 && !announced.has(team)) {
      announced.add(team);
      out.push({ atMs: event.atMs, eventIndex: index });
    }
  });

  return out;
}
