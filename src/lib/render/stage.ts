/**
 * ---------------------------------------------------------------------------
 * STAGE
 * ---------------------------------------------------------------------------
 * Everything between "the room's snapshot" and "what the renderer needs",
 * with no React in it.
 *
 * The point of putting this here rather than inside `BattleStage` is that the
 * interesting parts — is there a replay yet, how far into it are we, which
 * identities collide in this roster — are exactly the parts worth testing, and
 * none of them need a DOM. `BattleStage` is left with mounting a canvas.
 *
 * Nothing here computes anything about the fight. The replay is a projection
 * of the stored result, the clock is the room's own server clock, and the
 * identities are a presentation detail.
 */

import { toReplay, type ProjectableResult, type Replay } from "@/lib/game/replay";
import type { Character } from "@/lib/game/types";
import { artFor } from "./archetypes";
import type { CharacterArt } from "./assets";
import { disambiguate } from "./identity";
import { interactionsFor, type Interactions } from "./interactions";

export interface StagePlayer {
  id: string;
  nickname: string;
  formation: string;
  colorHex: string;
}

export interface StageInput {
  battleId: string;
  /**
   * The stored result, or the subset of it a public payload carries.
   *
   * Typed structurally so a finished match served over `/api/match/:id` can be
   * staged by this same function. A live room passes the whole `BattleResult`;
   * a shared link passes fewer fields of the same authoritative record. There
   * is one stage builder, and therefore one place where a scene comes from.
   */
  result: ProjectableResult | null;
  players: StagePlayer[];
  charactersById: Record<string, Character>;
}

export interface Stage {
  replay: Replay;
  art: CharacterArt[];
  interactions: Interactions;
  teamColors: Record<string, string>;
  /** Milliseconds of the replay, for the caller's progress bar. */
  durationMs: number;
}

/**
 * Builds everything the canvas needs, or nothing at all.
 *
 * Returns null rather than a half-built stage when the battle has not been
 * simulated yet: a canvas drawing an empty replay is worse than the loading
 * state the game already shows.
 */
export function buildStage(input: StageInput): Stage | null {
  // Deliberately no clock here. Whether a battle has started is the caller's
  // question — a live room asks it of `battleStartedAt`, a finished match does
  // not need to ask it at all — and a stage that refused to build without a
  // server timestamp could not serve a shared replay.
  if (!input.result) return null;
  if (input.result.combatants.length === 0) return null;

  const replay = toReplay(input.result, {
    battleId: input.battleId,
    players: input.players.map((p) => ({
      playerId: p.id,
      nickname: p.nickname,
      formation: p.formation,
    })),
  });

  // Identity, then the per-match separation: two characters that resolve to
  // the same look are fine in a catalogue and not fine standing side by side.
  const roster = replay.combatants
    .map((c) => ({ combatant: c, character: input.charactersById[c.characterId] }))
    .filter((entry) => Boolean(entry.character));

  const base = roster.map(({ combatant, character }) => {
    const art = artFor(character);
    return {
      characterId: combatant.characterId,
      teamId: combatant.teamId,
      archetype: art.archetype,
      config: art.identity!,
    };
  });
  const separated = disambiguate(base);

  const art: CharacterArt[] = roster.map(({ character }) => {
    const resolved = artFor(character);
    const identity = separated.get(character.id);
    return identity ? { ...resolved, identity } : resolved;
  });

  const interactions = interactionsFor(
    replay,
    roster.map(({ combatant, character }) => ({
      characterId: combatant.characterId,
      teamId: combatant.teamId,
      tags: character.tags,
    })),
  );

  const teamColors: Record<string, string> = {};
  for (const player of input.players) teamColors[player.id] = player.colorHex;

  return { replay, art, interactions, teamColors, durationMs: replay.durationMs };
}

/**
 * How far into the battle we are, from the server's clock.
 *
 * The only arithmetic in the integration, and deliberately trivial: a late
 * joiner gets a large number and the renderer draws that moment directly.
 * Nothing replays the events up to it, because the scene is a function of
 * time rather than an accumulation of them.
 *
 * Clamped at both ends — below zero before the server's start stamp (a client
 * whose clock offset is a little ahead), and at the replay's own duration so a
 * viewer who sits on the results screen does not run the outro forever.
 */
export function elapsedFor(
  battleStartedAt: string | null,
  serverNowMs: number,
  durationMs: number,
): number {
  if (!battleStartedAt) return 0;
  const started = new Date(battleStartedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.min(durationMs, Math.max(0, serverNowMs - started));
}

/** Whether the replay has finished playing at this moment. */
export function isFinished(
  battleStartedAt: string | null,
  serverNowMs: number,
  durationMs: number,
): boolean {
  return elapsedFor(battleStartedAt, serverNowMs, durationMs) >= durationMs;
}
