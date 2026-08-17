/**
 * ---------------------------------------------------------------------------
 * REPLAY (pure projection)
 * ---------------------------------------------------------------------------
 * Turns a stored `BattleResult` into something a renderer can draw.
 *
 * This is a **projection, not a second source of truth**. It decides nothing:
 * no damage, no HP, no winner, no MVP, no ordering. Every number it reports is
 * one the authoritative simulation already recorded, copied across. The only
 * things invented here are presentational — lanes and animation hints — and
 * they are marked as such, because a player will read a frontline sprite as
 * meaningful and it is not.
 *
 * Everything it does is deterministic and side-effect free: no clock, no
 * randomness, no I/O. `toReplay(x)` twice gives byte-identical output, and `x`
 * is unchanged afterwards. Both are asserted in tests/replay.test.ts.
 */

import type { BattleLogEntry, BattleResult } from "./types";
import type { FormationId } from "./formations";

/**
 * The shape of this file's output.
 *
 * Bumped when the *replay format* changes, independently of RULES_VERSION,
 * which tracks the simulation's behaviour. A renderer checks this one; a
 * balance historian checks the other.
 */
export const REPLAY_VERSION = 1;

/**
 * What a battle stored before V5 becomes.
 *
 * Those results carry no `maxHp`, so they can show damage and a timeline but
 * must not show health bars — there is no honest denominator, and inventing
 * one would be worse than omitting it.
 */
export const LEGACY_REPLAY_VERSION = 0;

/** Presentation only. The simulation has no coordinates of any kind. */
export type Lane = "FRONT" | "MID" | "BACK";

/** Broad animation category, resolved by the renderer to a sprite sheet. */
export type AnimationHint =
  | "IDLE"
  | "ATTACK"
  | "CAST"
  | "IMPACT"
  | "GUARD"
  | "DEATH"
  | "CHEER"
  | "NONE";

export interface ReplayCombatant {
  characterId: string;
  teamId: string;
  /** Absent on pre-V5 battles. The renderer must omit health bars when unset. */
  maxHp?: number;
  /** Presentation lane, derived from formation. Not a game coordinate. */
  lane: Lane;
  /** Index within the lane, so two front-liners do not overlap. */
  slot: number;
  price: number;
  survived: boolean;
}

export interface ReplayEvent {
  atMs: number;
  kind: BattleLogEntry["kind"] | "SPAWN";
  text: string;
  actorId?: string;
  actorTeamId?: string;
  targetId?: string;
  targetTeamId?: string;
  damage?: number;
  /** Copied from the engine. Absent when the engine did not report it. */
  hpAfter?: number;
  /** Which animation the actor should play. Presentation only. */
  animation: AnimationHint;
  /** Whether this beat deserves camera emphasis. Presentation only. */
  emphasis: boolean;
}

export interface ReplayTeam {
  playerId: string;
  nickname: string;
  formation: FormationId;
  rank: number;
  winProbability: number;
}

export interface Replay {
  battleId: string;
  replayVersion: number;
  /** Absent on pre-V5 battles, exactly as stored. Never guessed. */
  rulesVersion?: number;
  seed: string;
  mapId: string;
  eventId: string;
  categoryIds: string[];
  durationMs: number;
  teams: ReplayTeam[];
  combatants: ReplayCombatant[];
  events: ReplayEvent[];
  winnerPlayerId: string;
  upset: boolean;
  turningPoint: BattleResult["turningPoint"];
  mvp: BattleResult["mvp"];
}

export interface ReplayContext {
  battleId: string;
  /** Nickname and formation per player, from the snapshot or match payload. */
  players: { playerId: string; nickname: string; formation?: string }[];
}

/**
 * How a formation arranges five characters across three lanes.
 *
 * Purely a look. The simulation applied the formation to the axes long before
 * this file ran, and a character in FRONT is not attacked more often than one
 * in BACK — nothing here reaches the fight.
 */
const LANE_PLANS: Record<FormationId, Lane[]> = {
  BALANCED: ["FRONT", "FRONT", "MID", "MID", "BACK"],
  AGGRESSIVE: ["FRONT", "FRONT", "FRONT", "MID", "BACK"],
  DEFENSIVE: ["FRONT", "MID", "MID", "BACK", "BACK"],
  SPEED: ["FRONT", "FRONT", "MID", "MID", "MID"],
  CONTROL: ["FRONT", "MID", "BACK", "BACK", "BACK"],
};

function lanePlan(formation: string | undefined): Lane[] {
  return LANE_PLANS[(formation ?? "") as FormationId] ?? LANE_PLANS.BALANCED;
}

/** Which animation an event asks the actor to play. */
function animationFor(kind: ReplayEvent["kind"]): AnimationHint {
  switch (kind) {
    case "SPAWN":
      return "IDLE";
    case "ATTACK":
    case "CRIT":
      return "ATTACK";
    case "SPECIAL":
      return "CAST";
    case "BLOCK":
      return "GUARD";
    case "ELIMINATION":
      return "DEATH";
    case "END":
      return "CHEER";
    default:
      return "NONE";
  }
}

/** Which beats the camera should lean into. */
function isEmphatic(kind: ReplayEvent["kind"]): boolean {
  return (
    kind === "CRIT" ||
    kind === "SPECIAL" ||
    kind === "ELIMINATION" ||
    kind === "TURNING_POINT" ||
    kind === "END"
  );
}

/**
 * Projects a stored battle result into a replay.
 *
 * @param result  The authoritative result, exactly as `dw_store_battle` saved
 *                it. Not mutated.
 * @param context Names and formations, which live on the player rows rather
 *                than in the result.
 */
export function toReplay(result: BattleResult, context: ReplayContext): Replay {
  const byPlayer = new Map(context.players.map((p) => [p.playerId, p]));

  // A battle is renderable with health bars only if the engine reported the
  // denominator. Pre-V5 results have no maxHp anywhere, and this is the one
  // place that distinction is made.
  const hasMaxHp = result.combatants.every((c) => typeof c.maxHp === "number");
  const replayVersion = hasMaxHp ? REPLAY_VERSION : LEGACY_REPLAY_VERSION;

  // Lanes are assigned per team, in roster order, so the same result always
  // produces the same arrangement.
  const laneCursor = new Map<string, number>();
  const combatants: ReplayCombatant[] = result.combatants.map((c) => {
    const plan = lanePlan(byPlayer.get(c.playerId)?.formation);
    const index = laneCursor.get(c.playerId) ?? 0;
    laneCursor.set(c.playerId, index + 1);
    const lane = plan[Math.min(index, plan.length - 1)];

    return {
      characterId: c.characterId,
      teamId: c.playerId,
      ...(typeof c.maxHp === "number" ? { maxHp: c.maxHp } : {}),
      lane,
      slot: index,
      price: c.price,
      survived: c.survived,
    };
  });

  // SPAWN lives here rather than in the authoritative log, so the engine's
  // own event stream keeps the semantics everything else already relies on.
  // Every combatant gets one at zero, which is what gives the renderer a
  // deterministic initial state.
  const spawns: ReplayEvent[] = combatants.map((c) => ({
    atMs: 0,
    kind: "SPAWN" as const,
    text: c.characterId,
    actorId: c.characterId,
    actorTeamId: c.teamId,
    animation: "IDLE" as const,
    emphasis: false,
  }));

  const events: ReplayEvent[] = result.log.map((entry) => ({
    atMs: entry.atMs,
    kind: entry.kind,
    text: entry.text,
    ...(entry.actorId ? { actorId: entry.actorId } : {}),
    ...(entry.actorTeamId ? { actorTeamId: entry.actorTeamId } : {}),
    ...(entry.targetId ? { targetId: entry.targetId } : {}),
    ...(entry.targetTeamId ? { targetTeamId: entry.targetTeamId } : {}),
    ...(typeof entry.damage === "number" ? { damage: entry.damage } : {}),
    // Copied, never derived. Absent stays absent.
    ...(typeof entry.hpAfter === "number" ? { hpAfter: entry.hpAfter } : {}),
    animation: animationFor(entry.kind),
    emphasis: isEmphatic(entry.kind),
  }));

  const teams: ReplayTeam[] = result.teams.map((t) => ({
    playerId: t.playerId,
    nickname: byPlayer.get(t.playerId)?.nickname ?? "—",
    formation: ((byPlayer.get(t.playerId)?.formation ?? "BALANCED") as FormationId),
    rank: t.rank,
    winProbability: t.winProbability,
  }));

  return {
    battleId: context.battleId,
    replayVersion,
    ...(typeof result.rulesVersion === "number"
      ? { rulesVersion: result.rulesVersion }
      : {}),
    seed: result.seed,
    mapId: result.mapId,
    eventId: result.eventId,
    categoryIds: [...result.categoryIds],
    durationMs: result.durationMs,
    teams,
    combatants,
    // Spawns first, then the battle. Both at their own `atMs`, so playback
    // stays a pure function of elapsed time.
    events: [...spawns, ...events],
    winnerPlayerId: result.winnerPlayerId,
    upset: Boolean(result.upset),
    turningPoint: result.turningPoint,
    mvp: result.mvp,
  };
}

/** Whether this replay can show health bars honestly. */
export function canShowHealth(replay: Replay): boolean {
  return replay.replayVersion >= REPLAY_VERSION;
}
