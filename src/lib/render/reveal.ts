/**
 * ---------------------------------------------------------------------------
 * REVEAL (pure projection)
 * ---------------------------------------------------------------------------
 * The head-to-head shown before the fighting starts: who is standing across
 * from whom, in what formation, with what the draft cost them.
 *
 * This is the single most dangerous screen in the renderer, because everything
 * it needs sits in the same object as everything it must not say. The replay
 * knows the winner, the ranks, the points, the MVP and whether the engine
 * called an upset — and the reveal is drawn *before* the viewer is allowed to
 * know any of it.
 *
 * Two rules, both enforced by construction rather than by care:
 *
 *  1. **Seating comes from `seat`, never from `teams` order.** `result.teams`
 *     is sorted by rank, so its first entry is the winner. Laying the screen
 *     out in that order puts the eventual winner on the left from the opening
 *     frame — a spoiler that also makes a squad change sides depending on how
 *     the fight ends. M5 shipped exactly that bug in the arena; the reveal is
 *     where it would be most visible.
 *
 *  2. **`RevealSide` has nowhere to put an outcome.** Not "we remember not to
 *     read rank" — the field does not exist, so a future edit that tries to
 *     show it has to change the type first, in a commit somebody reviews.
 *
 * The forecast is deliberately kept: it is what the engine computed *before*
 * the battle, it is the whole point of a head-to-head, and it is already on
 * screen throughout the fight. A prediction is not a result.
 */

import type { FormationId } from "@/lib/game/formations";
import type { Lane, Replay } from "@/lib/game/replay";

export interface RevealFighter {
  characterId: string;
  /** Presentation lane, from the formation. Not a game coordinate. */
  lane: Lane;
  slot: number;
  /** What the squad paid at auction. Public since the moment it was bid. */
  price: number;
}

export interface RevealSide {
  playerId: string;
  nickname: string;
  formation: FormationId;
  /** Draft order. The only thing that decides which side of the screen. */
  seat: number;
  /** The engine's pre-battle forecast, 0..100. Not an outcome. */
  winProbability: number;
  /** Synergy groups the squad triggered, exactly as the engine reported. */
  synergies: Replay["teams"][number]["synergies"];
  fighters: RevealFighter[];
  /** What the squad spent in total, from the prices already shown at auction. */
  spent: number;
}

export interface Reveal {
  sides: RevealSide[];
  /** Total fighters, so a caller can lay out a grid without counting. */
  squadSize: number;
}

/**
 * The pre-battle card, in seating order.
 *
 * Deterministic, side-effect free, and — the property that matters — a
 * function of the *draft*, not of the fight. Rewriting who won, who ranked
 * where or who was MVP produces a byte-identical reveal.
 */
export function revealOf(replay: Replay): Reveal {
  const byTeam = new Map<string, RevealFighter[]>();
  for (const c of replay.combatants) {
    const fighters = byTeam.get(c.teamId) ?? [];
    fighters.push({ characterId: c.characterId, lane: c.lane, slot: c.slot, price: c.price });
    byTeam.set(c.teamId, fighters);
  }

  const sides = [...replay.teams]
    // Copy before sorting: `replay.teams` is the caller's array, and the whole
    // projection chain promises not to touch the replay.
    .sort((a, b) => a.seat - b.seat)
    .map((team): RevealSide => {
      const fighters = (byTeam.get(team.playerId) ?? [])
        // Lane order, then slot: the reading order of the arena itself, so the
        // card and the battlefield agree about who is at the front.
        .sort((a, b) => LANE_ORDER[a.lane] - LANE_ORDER[b.lane] || a.slot - b.slot);

      return {
        playerId: team.playerId,
        nickname: team.nickname,
        formation: team.formation,
        seat: team.seat,
        winProbability: team.winProbability,
        synergies: team.synergies,
        fighters,
        spent: fighters.reduce((sum, f) => sum + f.price, 0),
      };
    });

  return {
    sides,
    squadSize: Math.max(0, ...sides.map((s) => s.fighters.length)),
  };
}

/** Front to back, matching how the arena is drawn. */
const LANE_ORDER: Record<Lane, number> = { FRONT: 0, MID: 1, BACK: 2 };
