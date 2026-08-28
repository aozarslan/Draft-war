"use client";

import type { StateResponse } from "./api";

/**
 * ---------------------------------------------------------------------------
 * WHO YOU FACE, AND WHY
 * ---------------------------------------------------------------------------
 * The reveal is the check on the whole matchmaking design.
 *
 * A scheduler that quietly pairs the leader against the strongest opponent
 * every round reads as punishment, and the way to keep it honest is to make it
 * say why out loud. If the true explanation for a matchup were ever *"because
 * you are winning"*, there would be no sentence to print — which is why the
 * five reasons the server can record are the five below, and none of them
 * mentions strength ranking.
 *
 * **The ratings are deliberately not exposed here.** They are stored so the
 * explanation can be audited after the fact, not so a player can be shown a
 * number that says how good they are. A rating on screen turns a schedule into
 * a scoreboard, and a scoreboard is the thing the design refuses to be.
 */

/** One matchup, as the round rail needs it. Note what is absent: any rating. */
export interface MatchupView {
  id: string;
  pairingIndex: number;
  /** The seat this view is written from. */
  playerId: string;
  playerName: string;
  /** Null when this is the odd seat's encounter. */
  opponentId: string | null;
  opponentName: string | null;
  kind: string;
  reason: string | null;
  /** True when this is the viewer's own matchup. */
  mine: boolean;
}

const NAME_FALLBACK = "—";

/**
 * Every matchup of a round, written from each seat's own side.
 *
 * The viewer's own matchup is marked rather than extracted, so a caller can
 * show it first without the list losing the rest — friends watching each
 * other's rounds is most of the appeal.
 */
export function matchupsForRound(
  snapshot: StateResponse,
  roundNo: number,
  meId: string | null,
): MatchupView[] {
  const match = snapshot.match;
  if (!match) return [];

  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    return snapshot.players.find((p) => p.id === id)?.nickname ?? NAME_FALLBACK;
  };

  return match.matchups
    .filter((m) => m.roundNo === roundNo)
    .sort((a, b) => a.pairingIndex - b.pairingIndex)
    .map((m) => {
      // Written from the viewer's side when they are in it, so "you haven't
      // faced Can yet" names the other person rather than whichever seat the
      // database happened to store first.
      const flip = meId !== null && m.playerB === meId;
      const playerId = flip ? m.playerB! : m.playerA;
      const opponentId = flip ? m.playerA : m.playerB;

      return {
        id: m.id,
        pairingIndex: m.pairingIndex,
        playerId,
        playerName: nameOf(playerId) ?? NAME_FALLBACK,
        opponentId,
        opponentName: nameOf(opponentId),
        kind: m.kind,
        reason: m.reason,
        mine: meId !== null && (m.playerA === meId || m.playerB === meId),
      };
    });
}

/** The viewer's own matchup this round, if they have one. */
export function myMatchup(
  snapshot: StateResponse,
  roundNo: number,
  meId: string | null,
): MatchupView | null {
  return matchupsForRound(snapshot, roundNo, meId).find((m) => m.mine) ?? null;
}

/**
 * One sentence a player can check against their own memory of the match.
 *
 * Deliberately short and deliberately concrete. "Closest board strength on the
 * table" is a fact about the pairing; "you are the strongest so you get the
 * hardest game" would be a confession, and the server cannot record that
 * reason because it is not one of the five.
 */
export function reasonSentence(reason: string | null, opponentName: string | null): string {
  switch (reason) {
    case "NEW_OPPONENT":
      return opponentName
        ? `You haven't faced ${opponentName} yet.`
        : "A new opponent.";
    case "CLOSEST_STRENGTH":
      return "Closest board strength on the table.";
    case "REMATCH_UNAVOIDABLE":
      return "You've played everyone — this one comes round again.";
    case "ONLY_PAIRING":
      return "Just the two of you.";
    case "ODD_SEAT":
      return "No opponent this round. The arena sends its own.";
    default:
      // A row written before 0032, or a reason this build does not know. Saying
      // nothing is better than guessing at somebody's schedule.
      return "";
  }
}

/** What to call this kind of fight on screen. */
export function kindLabel(kind: string): string {
  return kind === "ENCOUNTER" ? "Encounter" : "Duel";
}
