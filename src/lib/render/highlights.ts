/**
 * ---------------------------------------------------------------------------
 * HIGHLIGHTS (pure classification)
 * ---------------------------------------------------------------------------
 * Which moments of a battle deserve more of the viewer's attention.
 *
 * This file is **observational**. It reads a replay and returns labels; it
 * changes nothing, decides nothing and produces no value the game consults. A
 * highlight is a note in the margin of a fight that has already happened.
 *
 * The distinction matters because "importance" is exactly the sort of judgement
 * that drifts into authority. A classifier that started nudging damage to make
 * a crit feel bigger, or that named a winner it thought more interesting, would
 * be a second source of truth wearing a presentational costume. So the contract
 * is narrow on purpose: `Replay` in, `Highlight[]` out, every entry pointing at
 * an event that really exists, at the timestamp the engine really recorded.
 *
 * On a real 5v5 this promotes roughly fourteen of about seventy-five events —
 * a beat every two or three seconds, which is a cadence a viewer can follow.
 */

import { FINAL_PHASE_LABEL } from "@/lib/game/battle";
import type { Replay, ReplayEvent } from "@/lib/game/replay";

/**
 * How loudly a moment should be presented.
 *
 * Ordered, so a consumer can compare them without a lookup table.
 */
export const HIGHLIGHT_LEVELS = ["LOW", "NORMAL", "HIGH", "MAJOR", "CINEMATIC"] as const;
export type HighlightLevel = (typeof HIGHLIGHT_LEVELS)[number];

/** Rank of a level, for comparisons. Higher is louder. */
export function levelRank(level: HighlightLevel): number {
  return HIGHLIGHT_LEVELS.indexOf(level);
}

export interface Highlight {
  /** Index into `replay.events`. Always a real event. */
  index: number;
  /** The engine's own timestamp for that event. Never adjusted. */
  atMs: number;
  kind: ReplayEvent["kind"];
  level: HighlightLevel;
  /**
   * Why it was promoted, for tests and for a future narrative layer.
   * Presentational text; nothing branches on it.
   */
  reason: string;
}

/**
 * Classifies every event in a replay.
 *
 * Deterministic and side-effect free: same replay, same array, in the same
 * order, on every device and every call. No clock, no randomness, no
 * dependence on who won — except where the engine's own `upset` flag is the
 * thing being reported.
 */
export function highlightsOf(replay: Replay): Highlight[] {
  const medians = medianDamageByTeam(replay);
  const finalClashFrom = finalClashStart(replay);
  const comebacks = comebackKills(replay);

  const out: Highlight[] = [];

  replay.events.forEach((event, index) => {
    const level = classify(event, index, { medians, finalClashFrom, comebacks, replay });
    if (!level) return;
    out.push({ index, atMs: event.atMs, kind: event.kind, level: level.level, reason: level.reason });
  });

  return out;
}

interface Context {
  medians: Map<string, number>;
  finalClashFrom: number | null;
  comebacks: Set<number>;
  replay: Replay;
}

function classify(
  event: ReplayEvent,
  index: number,
  ctx: Context,
): { level: HighlightLevel; reason: string } | null {
  switch (event.kind) {
    case "TURNING_POINT":
      return { level: "CINEMATIC", reason: "the engine flagged the round that turned it" };

    case "END":
      // The only place a result is consulted, and only because the upset flag
      // *is* the thing being reported.
      return ctx.replay.upset
        ? { level: "CINEMATIC", reason: "an upset the engine called" }
        : { level: "MAJOR", reason: "the result" };

    case "ELIMINATION": {
      if (ctx.comebacks.has(index)) {
        return { level: "MAJOR", reason: "an elimination by the shorter-handed side" };
      }
      if (ctx.finalClashFrom !== null && event.atMs >= ctx.finalClashFrom) {
        return { level: "MAJOR", reason: "an elimination in the final clash" };
      }
      return { level: "MAJOR", reason: "an elimination" };
    }

    case "CRIT":
      return { level: "HIGH", reason: "a critical hit" };

    case "SPECIAL":
      return { level: "HIGH", reason: "a special" };

    case "BLOCK":
      return { level: "NORMAL", reason: "a blow that was blocked" };

    case "ATTACK": {
      const median = ctx.medians.get(event.actorTeamId ?? "") ?? 0;
      const damage = event.damage ?? 0;
      return damage > median
        ? { level: "NORMAL", reason: "a hit above that squad's median" }
        : { level: "LOW", reason: "a hit at or below that squad's median" };
    }

    default:
      // Phase dividers and spawns are structure, not moments.
      return null;
  }
}

/**
 * The median damage each squad dealt, over its own damaging events.
 *
 * A per-squad median rather than one across the battle, because a squad of
 * heavyweights and a squad of skirmishers would otherwise have every hit
 * classified the same way — all of the first "above", all of the second
 * "below", which tells a viewer nothing.
 *
 * This is a statistic *about* the presentation, not a combat value: no damage
 * is changed, and nothing downstream of the engine reads it.
 */
function medianDamageByTeam(replay: Replay): Map<string, number> {
  const byTeam = new Map<string, number[]>();

  for (const event of replay.events) {
    if (event.kind !== "ATTACK") continue;
    if (typeof event.damage !== "number" || !event.actorTeamId) continue;
    byTeam.set(event.actorTeamId, [...(byTeam.get(event.actorTeamId) ?? []), event.damage]);
  }

  const medians = new Map<string, number>();
  for (const [team, values] of byTeam) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    medians.set(
      team,
      sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    );
  }
  return medians;
}

/**
 * When the closing rounds begin, from the divider the engine already wrote.
 *
 * Matched against the engine's own label rather than a literal, so renaming
 * the phase cannot silently stop this working — the mistake the synergy labels
 * taught in M7.
 */
function finalClashStart(replay: Replay): number | null {
  const prefix = FINAL_PHASE_LABEL.toUpperCase();
  const divider = replay.events.find(
    (e) => e.kind === "PHASE" && e.text.toUpperCase().startsWith(prefix),
  );
  return divider ? divider.atMs : null;
}

/**
 * Eliminations landed by the side that was already down on bodies.
 *
 * Counted from the elimination history alone — the running survivor count is
 * just "five minus how many of yours have died so far", which the log states
 * outright. No engine state is introduced and no combat value is derived.
 */
function comebackKills(replay: Replay): Set<number> {
  const lost = new Map<string, number>();
  const squadSize = new Map<string, number>();
  for (const c of replay.combatants) {
    squadSize.set(c.teamId, (squadSize.get(c.teamId) ?? 0) + 1);
  }

  const out = new Set<number>();

  replay.events.forEach((event, index) => {
    if (event.kind !== "ELIMINATION" || !event.actorTeamId || !event.targetTeamId) return;

    const aliveOf = (team: string) => (squadSize.get(team) ?? 0) - (lost.get(team) ?? 0);
    // Measured *before* this kill lands: the question is whether the side that
    // threw it was behind at the moment it did.
    if (aliveOf(event.actorTeamId) < aliveOf(event.targetTeamId)) out.add(index);

    lost.set(event.targetTeamId, (lost.get(event.targetTeamId) ?? 0) + 1);
  });

  return out;
}
