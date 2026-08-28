/**
 * ---------------------------------------------------------------------------
 * BATTLE SUMMARY (pure projection)
 * ---------------------------------------------------------------------------
 * The five questions a player has the moment a battle ends — who won, why it
 * mattered, who the MVP was, whether it was an upset, and where it turned —
 * answered in one pass over the replay.
 *
 * **Every number here is copied.** The engine decided all of them during the
 * simulation and stored them in `battle_result`; this file's entire job is to
 * pick them up and put them next to each other. The only arithmetic permitted
 * is rounding for display, and even that is confined to `pct()` below so it is
 * obvious at a glance that nothing else computes.
 *
 * That restraint is the point. A "summary" is exactly where a second source of
 * truth would appear most naturally and least visibly: a plausible-looking
 * `totalDamage / rounds` here, a re-derived win probability there, and within
 * two milestones the results screen disagrees with the match it describes.
 * Where an authoritative field is missing the corresponding section is
 * **omitted**, never reconstructed.
 */

import type { Replay } from "@/lib/game/replay";

export interface SummaryTeam {
  playerId: string;
  nickname: string;
  /** The engine's finishing position. 1 is the winner. */
  rank: number;
  points: number;
  /** The pre-battle forecast, as the engine reported it (0–100). */
  winProbability: number;
}

export interface SummaryMvp {
  characterId: string;
  playerId: string;
  /** Share of the team's damage the forecast expected, 0–100. */
  expected: number;
  /** Share actually delivered, 0–100. */
  actual: number;
  /** actual / expected as a percentage. 139 means "139% of expectation". */
  performance: number;
}

export interface SummaryAward {
  characterId: string;
  playerId: string;
  performance: number;
  price: number;
}

export interface BattleSummary {
  /** Null only if the result named a winner no team matches. */
  winner: SummaryTeam | null;
  runnerUp: SummaryTeam | null;
  /** Every team in finishing order, for a compact standings line. */
  standings: SummaryTeam[];
  mvp: SummaryMvp | null;
  /**
   * Present only when the engine flagged one. The text is the engine's own
   * sentence — there is no reason to write a worse one over the top of it.
   */
  turningPoint: { text: string } | null;
  /**
   * Present only when the engine called it an upset, carrying the forecast the
   * winner actually beat.
   */
  upset: { wonAtProbability: number } | null;
  /** The engine's own picks, when the source forwarded them. */
  bestPerformer: SummaryAward | null;
  biggestSurprise: SummaryAward | null;
}

/** The only arithmetic in this file: one decimal place, for display. */
const pct = (value: number) => Math.round(value * 10) / 10;

export function summaryOf(replay: Replay): BattleSummary {
  const standings: SummaryTeam[] = [...replay.teams]
    .sort((a, b) => a.rank - b.rank)
    .map((team) => ({
      playerId: team.playerId,
      nickname: team.nickname,
      rank: team.rank,
      points: team.points,
      winProbability: pct(team.winProbability),
    }));

  const winner = standings.find((t) => t.playerId === replay.winnerPlayerId) ?? null;
  const runnerUp = standings.find((t) => t !== winner) ?? null;

  const mvp = replay.mvp
    ? {
        characterId: replay.mvp.characterId,
        playerId: replay.mvp.playerId,
        expected: replay.mvp.expected,
        actual: replay.mvp.actual,
        performance: replay.mvp.performance,
      }
    : null;

  return {
    winner,
    runnerUp,
    standings,
    mvp,
    turningPoint: replay.turningPoint ? { text: replay.turningPoint.text } : null,
    // The winner's own forecast is the number that makes an upset legible:
    // "won at 34.6%" says more than the word does.
    upset:
      replay.upset && winner ? { wonAtProbability: winner.winProbability } : null,
    bestPerformer: award(replay, "bestPerformer"),
    biggestSurprise: award(replay, "biggestSurprise"),
  };
}

/**
 * One of the engine's award picks, if the source carried them.
 *
 * `awards` lives in `battle_result` but a projection may not have been given
 * it. Omitting the section is the honest answer; recomputing "who performed
 * best" from the combatant list would be this file deciding something.
 */
function award(
  replay: Replay,
  key: "bestPerformer" | "biggestSurprise",
): SummaryAward | null {
  const pick = replay.awards?.[key];
  if (!pick) return null;
  return {
    characterId: pick.characterId,
    playerId: pick.playerId,
    performance: pick.performance,
    price: pick.price,
  };
}

/**
 * The context a share line needs that the replay does not carry.
 *
 * Names, not ids: the battlefield fields are stored as identifiers and the
 * caller already has the lookup tables, so resolving them here would mean
 * importing the catalogues into a projection that has no other use for them.
 */
export interface ShareContext {
  /** Resolves a character id to its display name. */
  nameOf: (characterId: string) => string;
  mapName?: string | null;
  eventName?: string | null;
  categoryNames?: string[];
  /** The public match page for this battle. */
  url?: string | null;
}

/**
 * The battle as a few lines of shareable text.
 *
 * Built from `BattleSummary` and nothing else, which is what keeps it honest:
 * every figure it prints has already been through `summaryOf`, so the shared
 * text and the results screen cannot disagree. There is no arithmetic in this
 * function — no totals, no averages, and above all no re-derived odds. An
 * upset line quotes `upset.wonAtProbability`, the forecast the engine stored;
 * a turning point quotes the engine's own sentence.
 *
 * Sections whose authoritative field is missing are **left out**. A share text
 * that invented a turning point for a battle that did not have one would be a
 * small lie that travels further than any other text in the product.
 */
export function shareTextOf(summary: BattleSummary, context: ShareContext): string {
  const lines: string[] = ["DRAFT WAR"];

  if (summary.winner) {
    // The same sentence the results card shows, in the same order.
    const beaten = summary.runnerUp ? ` beat ${summary.runnerUp.nickname}` : "";
    lines.push(`🏆 ${summary.winner.nickname}${beaten} · +${summary.winner.points} pts`);
  }

  if (summary.mvp) {
    lines.push(
      `⭐ MVP ${context.nameOf(summary.mvp.characterId)} — ` +
        `${summary.mvp.performance}% of expectation`,
    );
  }

  // Only when the engine flagged it, and quoting the forecast it stored.
  if (summary.upset) {
    lines.push(`🔥 Upset · won at ${summary.upset.wonAtProbability}%`);
  }

  // Only when the engine found one, in the engine's own words.
  if (summary.turningPoint) {
    lines.push(`🔥 ${summary.turningPoint.text}`);
  }

  const context_ = [
    (context.categoryNames ?? []).join(" + "),
    context.mapName ?? "",
    context.eventName ?? "",
  ].filter((part) => part.length > 0);
  if (context_.length > 0) lines.push(context_.join(" · "));

  if (context.url) lines.push("", context.url);

  return lines.join("\n");
}
