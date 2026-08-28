import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  kindLabel,
  matchupsForRound,
  myMatchup,
  reasonSentence,
  type MatchupView,
} from "../src/lib/client/matchup";
import type { StateResponse } from "../src/lib/client/api";

/**
 * ---------------------------------------------------------------------------
 * The reveal is the check on the scheduler.
 * ---------------------------------------------------------------------------
 * A matchmaker that quietly pairs whoever is winning against the strongest
 * opponent available reads as punishment. The defence built into S8.3 is that
 * every pairing has to say *why* out loud — and the five reasons the server can
 * record are five statements of fact, none of which is "because you are
 * winning". If the honest explanation ever were that, there would be no
 * sentence to print.
 *
 * The other half is what is deliberately withheld. Ratings are stored so the
 * explanation can be audited afterwards, not so a player can be shown a number
 * that ranks them. A rating on screen turns a schedule into a scoreboard, and
 * these tests hold that line at the type, at the projection and at the
 * component.
 */

const ROOT = process.cwd();

function snapshot(over: Partial<StateResponse> = {}): StateResponse {
  return {
    players: [
      { id: "a", nickname: "Ali", colorIndex: 0 },
      { id: "b", nickname: "Can", colorIndex: 1 },
      { id: "c", nickname: "Mehmet", colorIndex: 2 },
      { id: "d", nickname: "Emre", colorIndex: 3 },
      { id: "e", nickname: "Ahmet", colorIndex: 4 },
    ],
    match: {
      roundNo: 2,
      matchups: [
        {
          id: "m1", roundNo: 2, pairingIndex: 0, playerA: "a", playerB: "b",
          kind: "DUEL", ratingA: 0.88, ratingB: 0.66, reason: "NEW_OPPONENT",
        },
        {
          id: "m2", roundNo: 2, pairingIndex: 1, playerA: "c", playerB: "d",
          kind: "DUEL", ratingA: 0.84, ratingB: 0.7, reason: "CLOSEST_STRENGTH",
        },
        {
          id: "m3", roundNo: 2, pairingIndex: 2, playerA: "e", playerB: null,
          kind: "ENCOUNTER", ratingA: 0.61, ratingB: null, reason: "ODD_SEAT",
        },
        {
          id: "m0", roundNo: 1, pairingIndex: 0, playerA: "a", playerB: "c",
          kind: "DUEL", ratingA: 0.8, ratingB: 0.8, reason: "NEW_OPPONENT",
        },
      ],
    },
    ...over,
  } as unknown as StateResponse;
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

describe("a round's matchups, from the viewer's side", () => {
  it("shows only this round", () => {
    const views = matchupsForRound(snapshot(), 2, "a");
    expect(views.map((v) => v.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps the server's pairing order", () => {
    const scrambled = snapshot();
    scrambled.match!.matchups.reverse();
    expect(matchupsForRound(scrambled, 2, "a").map((v) => v.pairingIndex)).toEqual([0, 1, 2]);
  });

  it("writes the viewer's own matchup from their side", () => {
    // The database stored `playerA: "a", playerB: "b"`. Can, looking at the
    // same row, must read "Can vs Ali" — otherwise the sentence names the
    // wrong person.
    const asCan = matchupsForRound(snapshot(), 2, "b").find((v) => v.mine)!;
    expect(asCan.playerName).toBe("Can");
    expect(asCan.opponentName).toBe("Ali");

    const asAli = matchupsForRound(snapshot(), 2, "a").find((v) => v.mine)!;
    expect(asAli.playerName).toBe("Ali");
    expect(asAli.opponentName).toBe("Can");
  });

  it("marks exactly one matchup as the viewer's", () => {
    for (const me of ["a", "b", "c", "d", "e"]) {
      expect(matchupsForRound(snapshot(), 2, me).filter((v) => v.mine)).toHaveLength(1);
    }
  });

  it("marks none for a spectator", () => {
    const views = matchupsForRound(snapshot(), 2, null);
    expect(views.filter((v) => v.mine)).toHaveLength(0);
    // And still shows everybody, because watching is the point.
    expect(views).toHaveLength(3);
  });

  it("leaves the odd seat without an opponent", () => {
    const odd = matchupsForRound(snapshot(), 2, "e").find((v) => v.mine)!;
    expect(odd.opponentId).toBeNull();
    expect(odd.opponentName).toBeNull();
    expect(odd.kind).toBe("ENCOUNTER");
  });

  it("returns nothing when there is no match or no such round", () => {
    expect(matchupsForRound(snapshot({ match: null }), 2, "a")).toEqual([]);
    expect(matchupsForRound(snapshot(), 7, "a")).toEqual([]);
    expect(myMatchup(snapshot(), 7, "a")).toBeNull();
  });

  it("names a player who has left rather than crashing", () => {
    const gone = snapshot({ players: [{ id: "a", nickname: "Ali", colorIndex: 0 }] as never });
    const view = matchupsForRound(gone, 2, "a").find((v) => v.mine)!;
    expect(view.opponentName).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// What is never shown
// ---------------------------------------------------------------------------

describe("the reveal is not a scoreboard", () => {
  it("carries no rating out of the projection", () => {
    const views = matchupsForRound(snapshot(), 2, "a");
    for (const view of views) {
      const keys = Object.keys(view);
      for (const banned of ["rating", "ratingA", "ratingB", "score", "rank", "strength"]) {
        expect(keys, `the view exposes ${banned}`).not.toContain(banned);
      }
      expect(JSON.stringify(view)).not.toContain("0.88");
    }
  });

  it("does not let the component reach for one either", () => {
    const source = readFileSync(join(ROOT, "src", "components", "MatchupReveal.tsx"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const banned of ["ratingA", "ratingB", "rating"]) {
      expect(code, `MatchupReveal renders ${banned}`).not.toContain(banned);
    }
  });

  it("does not rank the table anywhere in the presentation layer", () => {
    const source = readFileSync(join(ROOT, "src", "lib", "client", "matchup.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // No sorting by strength, no comparison of one player against another.
    expect(code).not.toMatch(/rating/i);
    expect(code).not.toMatch(/\bsort\(.*rating/i);
  });
});

// ---------------------------------------------------------------------------
// The sentence
// ---------------------------------------------------------------------------

describe("every matchup can say why it exists", () => {
  it("names the opponent when they are new", () => {
    expect(reasonSentence("NEW_OPPONENT", "Can")).toBe("You haven't faced Can yet.");
  });

  it("states a fact about the pairing, not about the player", () => {
    expect(reasonSentence("CLOSEST_STRENGTH", "Can")).toBe("Closest board strength on the table.");
  });

  it("admits a rematch instead of dressing it up", () => {
    expect(reasonSentence("REMATCH_UNAVOIDABLE", "Can"))
      .toBe("You've played everyone — this one comes round again.");
  });

  it("has a line for two players and for the odd seat", () => {
    expect(reasonSentence("ONLY_PAIRING", "Can")).toBe("Just the two of you.");
    expect(reasonSentence("ODD_SEAT", null)).toContain("No opponent this round");
  });

  it("says nothing rather than guessing", () => {
    // A row written before 0032 has no reason. Inventing one would be a
    // sentence about a schedule this build did not decide.
    expect(reasonSentence(null, "Can")).toBe("");
    expect(reasonSentence("SOMETHING_NEW", "Can")).toBe("");
  });

  it("never tells somebody they are being handicapped", () => {
    // Scanned over the strings the module can actually print, not over the
    // whole file. Prose explaining what the design refuses to say necessarily
    // contains the words it refuses to say — a whole-file scan fails on its own
    // documentation and teaches you to delete the documentation.
    const printable = [
      ...["NEW_OPPONENT", "CLOSEST_STRENGTH", "REMATCH_UNAVOIDABLE", "ONLY_PAIRING", "ODD_SEAT"]
        .map((r) => reasonSentence(r, "Can")),
      kindLabel("DUEL"),
      kindLabel("ENCOUNTER"),
    ].join(" ").toLowerCase();

    for (const banned of [
      "strongest", "weakest", "leader", "punish", "handicap",
      "you are winning", "easier", "harder", "rating", "score", "rank",
    ]) {
      expect(printable, `a sentence says "${banned}"`).not.toContain(banned);
    }
  });

  it("covers every reason the database can store", () => {
    // The check constraint in 0032 is the authority for which reasons exist.
    const sql = readFileSync(
      join(ROOT, "supabase", "migrations", "0032_s8_round_pairing.sql"), "utf8",
    );
    const allowed = [...(sql.match(/round_matchups_reason_valid[\s\S]*?\)\);/)?.[0] ?? "")
      .matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(allowed.length).toBeGreaterThan(0);
    for (const reason of allowed) {
      expect(reasonSentence(reason, "Can"), `${reason} has no sentence`).not.toBe("");
    }
  });

  it("labels an encounter as something other than a duel", () => {
    expect(kindLabel("ENCOUNTER")).toBe("Encounter");
    expect(kindLabel("DUEL")).toBe("Duel");
    expect(kindLabel("ENCOUNTER")).not.toBe(kindLabel("DUEL"));
  });
});

// ---------------------------------------------------------------------------
// The component's boundaries
// ---------------------------------------------------------------------------

describe("the reveal keeps its seams clean", () => {
  const source = readFileSync(join(ROOT, "src", "components", "MatchupReveal.tsx"), "utf8");

  it("keeps how a player is drawn in one replaceable place", () => {
    // The seam Visual 2.0 replaces in S8.11.
    expect(source).toMatch(/function MatchupSide\(/);
  });

  it("computes nothing about the match", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const forbidden of ["hp -", "credits -", "Math.random", "Date.now", "winner"]) {
      expect(code, `MatchupReveal computes ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("shows the round the caller asked for", () => {
    expect(source).toMatch(/matchupsForRound\(snapshot, roundNo, meId\)/);
  });

  it("is mounted only once the pairing exists", () => {
    const stage = readFileSync(join(ROOT, "src", "components", "MatchStage.tsx"), "utf8");
    const branch = stage.match(/phase === "MATCHMAKING"[\s\S]*?: null\}/)?.[0] ?? "";
    expect(branch).toContain("MatchupReveal");
    for (const early of ['"ROUND_START"', '"AUCTION"', '"BOARD_UPDATE"', '"POSITIONING"']) {
      expect(branch, `the reveal is mounted during ${early}`).not.toContain(early);
    }
  });
});
