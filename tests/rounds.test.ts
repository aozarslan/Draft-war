import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCH_CAPACITY,
  BOARD_CAPACITY,
  ELIMINATION_FROM_ROUND,
  MATCH_PHASES,
  PHASE_LABELS,
  PHASE_SECONDS,
  PHASE_TRANSITIONS,
  ROUND_PHASES,
  SHORT_MATCH_ROUNDS,
  STANDARD_MATCH_ROUNDS,
  STARTING_HP,
  acquisitionRequired,
  advanceMatch,
  boardTargetFor,
  canTransition,
  clampHp,
  eliminationAllowed,
  isAlive,
  isClockDriven,
  isMatchPhase,
  livePlayers,
  minimumPoolFor,
  nextPhaseOf,
  openingState,
  totalRoundsFor,
  type MatchPhase,
  type MatchState,
} from "../src/lib/game/rounds";
import { categoryCounts } from "../src/lib/game/characters";

/**
 * ---------------------------------------------------------------------------
 * A match cannot go somewhere it was not meant to go.
 * ---------------------------------------------------------------------------
 * The S8.1 backbone has one job and one failure mode. The job is to know which
 * round it is and which phase of it. The failure mode is a state machine that
 * accepts a transition nobody wrote down — because that is how a match ends
 * four rounds early, or skips a draft, or pays a reward twice.
 *
 * So the legal edges are declared as data and asserted here as data. Every
 * ordered pair of phases is enumerated below and checked; there is no way for
 * an illegal edge to be *absent* from this file, because the file iterates the
 * whole product rather than a list somebody remembered to extend.
 *
 * The same machine runs in Postgres. `dw_match_next_phase` is checked against
 * this table at the bottom of the file, so the two copies cannot drift.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(
  join(ROOT, "supabase", "migrations", "0030_s8_match_backbone.sql"),
  "utf8",
);

/** A match in a given phase and round, with nothing else that matters. */
function at(phase: MatchPhase, roundNo: number, totalRounds = 8): MatchState {
  return {
    matchId: "m",
    phase,
    roundNo,
    totalRounds,
    players: [
      { playerId: "a", hp: 100, credits: 50, roundWins: 0, streak: 0, eliminatedAt: null },
      { playerId: "b", hp: 100, credits: 50, roundWins: 0, streak: 0, eliminatedAt: null },
    ],
  };
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

describe("the phase machine is total and closed", () => {
  it("declares a transition list for every phase", () => {
    for (const phase of MATCH_PHASES) {
      expect(PHASE_TRANSITIONS[phase], `${phase} has no entry`).toBeDefined();
    }
    expect(Object.keys(PHASE_TRANSITIONS).sort()).toEqual([...MATCH_PHASES].sort());
  });

  it("never names a phase that does not exist", () => {
    for (const [from, tos] of Object.entries(PHASE_TRANSITIONS)) {
      for (const to of tos) {
        expect(isMatchPhase(to), `${from} → ${to} is not a phase`).toBe(true);
      }
    }
  });

  it("ends somewhere", () => {
    // Exactly one terminal phase. Two would mean a match can finish in a state
    // the results screen does not know about.
    const terminal = MATCH_PHASES.filter((p) => PHASE_TRANSITIONS[p].length === 0);
    expect(terminal).toEqual(["MATCH_RESULTS"]);
  });

  it("has exactly one fork, and the round decides it", () => {
    const forks = MATCH_PHASES.filter((p) => PHASE_TRANSITIONS[p].length > 1);
    expect(forks).toEqual(["ROUND_END"]);

    expect(nextPhaseOf("ROUND_END", { roundNo: 3, totalRounds: 8 })).toBe("ROUND_START");
    expect(nextPhaseOf("ROUND_END", { roundNo: 7, totalRounds: 8 })).toBe("ROUND_START");
    expect(nextPhaseOf("ROUND_END", { roundNo: 8, totalRounds: 8 })).toBe("CHAMPIONSHIP");
    // A short match forks four rounds earlier, from the same table.
    expect(nextPhaseOf("ROUND_END", { roundNo: 6, totalRounds: 6 })).toBe("CHAMPIONSHIP");
  });

  it("labels every phase", () => {
    for (const phase of MATCH_PHASES) {
      expect(PHASE_LABELS[phase], `${phase} has no label`).toBeTruthy();
    }
  });
});

describe("every illegal transition is rejected", () => {
  /**
   * The whole product of phases, not a list of the ones somebody thought of.
   * 12 × 12 = 144 ordered pairs, of which 12 are legal at any given round.
   */
  it("refuses every pair that is not the derived successor", () => {
    const state = { roundNo: 3, totalRounds: 8 };
    let allowed = 0;

    for (const from of MATCH_PHASES) {
      for (const to of MATCH_PHASES) {
        const result = canTransition(from, to, state);
        const expected = nextPhaseOf(from, state) === to;
        expect(result.ok, `${from} → ${to}`).toBe(expected);
        if (result.ok) allowed++;
      }
    }

    // One legal successor per non-terminal phase.
    expect(allowed).toBe(MATCH_PHASES.length - 1);
  });

  it("names the specific reasons rather than one blanket refusal", () => {
    const mid = { roundNo: 3, totalRounds: 8 };
    // The headline case from the brief: AUCTION → CHAMPIONSHIP.
    expect(canTransition("AUCTION", "CHAMPIONSHIP", mid).code).toBe("INVALID_TRANSITION");
    // The fork, on the wrong round. Structurally legal, situationally not —
    // and worth its own code, because this is the one that ends a match early.
    expect(canTransition("ROUND_END", "CHAMPIONSHIP", mid).code).toBe("WRONG_ROUND");
    expect(canTransition("ROUND_END", "ROUND_START", { roundNo: 8, totalRounds: 8 }).code)
      .toBe("WRONG_ROUND");
    expect(canTransition("MATCH_RESULTS", "ROUND_START", mid).code).toBe("MATCH_OVER");
    expect(canTransition("NOPE" as MatchPhase, "ROUND_START", mid).code).toBe("UNKNOWN_PHASE");
  });

  it("refuses to step backwards", () => {
    const state = { roundNo: 4, totalRounds: 8 };
    expect(canTransition("BOARD_UPDATE", "AUCTION", state).ok).toBe(false);
    expect(canTransition("COMBAT", "MATCHMAKING", state).ok).toBe(false);
    expect(canTransition("ROUND_START", "MATCH_INTRO", state).ok).toBe(false);
  });

  it("refuses to stand still", () => {
    for (const phase of MATCH_PHASES) {
      expect(canTransition(phase, phase, { roundNo: 2, totalRounds: 8 }).ok, phase).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

describe("a match walks its rounds", () => {
  /** Steps a match until it stops, recording every phase it visited. */
  function playOut(totalRounds: number) {
    let state = openingState({
      matchId: "m",
      totalRounds,
      players: [
        { playerId: "a", credits: 50 },
        { playerId: "b", credits: 50 },
      ],
    });
    const visited: { phase: MatchPhase; roundNo: number }[] = [
      { phase: state.phase, roundNo: state.roundNo },
    ];

    for (let guard = 0; guard < 500; guard++) {
      const step = advanceMatch(state);
      if (!step.ok) break;
      state = step.state;
      visited.push({ phase: state.phase, roundNo: state.roundNo });
    }
    return { state, visited };
  }

  it("plays exactly eight rounds and then the championship", () => {
    const { state, visited } = playOut(8);

    expect(state.phase).toBe("MATCH_RESULTS");
    expect(state.roundNo).toBe(8);

    const starts = visited.filter((v) => v.phase === "ROUND_START");
    expect(starts.map((v) => v.roundNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // The championship happens once, at the end, and only there.
    expect(visited.filter((v) => v.phase === "CHAMPIONSHIP")).toHaveLength(1);
    expect(visited.at(-2)?.phase).toBe("FINAL_COMBAT");
  });

  it("plays a two-player match in six", () => {
    const { state, visited } = playOut(6);
    expect(state.roundNo).toBe(6);
    expect(visited.filter((v) => v.phase === "ROUND_START").map((v) => v.roundNo))
      .toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("moves the round number in exactly one place", () => {
    // Entering ROUND_START is the only step that may increment it, and every
    // entry into ROUND_START must increment it. If a second writer ever
    // appears, or one entry stops counting, the round number stops meaning
    // anything — which is exactly how the first round came out numbered zero.
    const { visited } = playOut(8);
    for (let i = 1; i < visited.length; i++) {
      const before = visited[i - 1];
      const now = visited[i];
      const moved = now.roundNo !== before.roundNo;
      expect(moved, `round moved outside ROUND_START (${before.phase} → ${now.phase})`)
        .toBe(now.phase === "ROUND_START");
      if (moved) expect(now.roundNo, "round jumped by more than one").toBe(before.roundNo + 1);
    }
  });

  it("visits every round phase once per round", () => {
    const { visited } = playOut(8);
    for (let round = 1; round <= 7; round++) {
      const inRound = visited.filter((v) => v.roundNo === round && ROUND_PHASES.includes(v.phase));
      expect(inRound.map((v) => v.phase), `round ${round}`).toEqual([...ROUND_PHASES]);
    }
  });

  it("stops rather than looping once it is over", () => {
    const finished = at("MATCH_RESULTS", 8);
    const step = advanceMatch(finished);
    expect(step.ok).toBe(false);
    expect(step.ok === false && step.code).toBe("MATCH_OVER");
  });

  it("is a pure function of the state it was given", () => {
    const before = at("RESOLUTION", 4);
    const snapshot = JSON.stringify(before);
    advanceMatch(before);
    advanceMatch(before);
    expect(JSON.stringify(before), "advanceMatch mutated its input").toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Table sizes
// ---------------------------------------------------------------------------

describe("round count follows the table size", () => {
  it("gives two players a short match and everyone else the standard one", () => {
    expect(totalRoundsFor(2)).toBe(SHORT_MATCH_ROUNDS);
    expect(totalRoundsFor(3)).toBe(STANDARD_MATCH_ROUNDS);
    expect(totalRoundsFor(4)).toBe(STANDARD_MATCH_ROUNDS);
    expect(totalRoundsFor(5)).toBe(STANDARD_MATCH_ROUNDS);
  });

  it("does not hand a degenerate table a long match", () => {
    expect(totalRoundsFor(1)).toBe(SHORT_MATCH_ROUNDS);
    expect(totalRoundsFor(0)).toBe(SHORT_MATCH_ROUNDS);
  });

  it("opens every player on the same footing", () => {
    const state = openingState({
      matchId: "m",
      players: [
        { playerId: "a", credits: 50 },
        { playerId: "b", credits: 50 },
        { playerId: "c", credits: 50 },
        { playerId: "d", credits: 50 },
      ],
    });
    expect(state.phase).toBe("MATCH_INTRO");
    expect(state.roundNo).toBe(0);
    expect(state.totalRounds).toBe(8);
    for (const p of state.players) {
      expect(p.hp).toBe(STARTING_HP);
      expect(p.credits).toBe(50);
      expect(p.eliminatedAt).toBeNull();
      expect(isAlive(p)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------

describe("nobody leaves the table early", () => {
  it("puts the elimination floor where the rulebook says", () => {
    // Asserted as a literal, not read into the loops below. An earlier version
    // iterated `round < ELIMINATION_FROM_ROUND`, so lowering the constant to 1
    // emptied the loop and the test passed on a mutation that let a player be
    // knocked out in round one. A constant that defines the boundary cannot
    // also be the thing that decides how many cases are checked.
    expect(ELIMINATION_FROM_ROUND).toBe(6);
  });

  it("clamps HP at 1 for the first five rounds", () => {
    for (const round of [1, 2, 3, 4, 5]) {
      expect(eliminationAllowed(round), `round ${round}`).toBe(false);
      expect(clampHp(-40, round), `round ${round}`).toBe(1);
      expect(clampHp(0, round), `round ${round}`).toBe(1);
    }
  });

  it("lets a match actually end from round six", () => {
    for (const round of [6, 7, 8]) {
      expect(eliminationAllowed(round)).toBe(true);
      expect(clampHp(-12, round)).toBe(0);
      expect(clampHp(0, round)).toBe(0);
    }
  });

  it("does not touch a healthy total", () => {
    expect(clampHp(63, 2)).toBe(63);
    expect(clampHp(63, 8)).toBe(63);
  });

  it("counts a knocked-out player as out however it was recorded", () => {
    const state = at("RESOLUTION", 7);
    state.players[0].hp = 0;
    state.players[1].eliminatedAt = 6;
    expect(livePlayers(state)).toHaveLength(0);
    expect(isAlive(state.players[0])).toBe(false);
    expect(isAlive(state.players[1])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Acquisition and the pool
// ---------------------------------------------------------------------------

describe("acquisition fills the board and then becomes a choice", () => {
  it("is mandatory while the board is filling", () => {
    // Literal rounds, for the same reason as the elimination floor above.
    for (const round of [1, 2, 3, 4, 5]) {
      expect(acquisitionRequired(round), `round ${round}`).toBe(true);
      expect(boardTargetFor(round), `round ${round}`).toBe(round);
    }
  });

  it("is optional once the board is full", () => {
    for (const round of [6, 7, 8]) {
      expect(acquisitionRequired(round), `round ${round}`).toBe(false);
      expect(boardTargetFor(round)).toBe(BOARD_CAPACITY);
    }
  });

  it("sizes the pool off the board, not off the round count", () => {
    // The whole point of the R6–R8 rule. Off the round count, a five-player
    // match would need 40 characters plus reserve and no category is that big.
    expect(minimumPoolFor(5)).toBeLessThan(5 * STANDARD_MATCH_ROUNDS);
    expect(minimumPoolFor(2)).toBe(15);
    expect(minimumPoolFor(3)).toBe(21);
    expect(minimumPoolFor(4)).toBe(28);
    expect(minimumPoolFor(5)).toBe(35);
  });

  it("leaves room for a real match in the catalogue we actually have", () => {
    // Not a hypothetical: these are the draftable counts today. If a later
    // milestone changes the board rule, this is where a five-player match
    // quietly becomes impossible.
    const counts = categoryCounts();
    const roomFor = (players: number) =>
      Object.entries(counts).filter(([, n]) => n >= minimumPoolFor(players)).length;

    expect(roomFor(2), "two players should be able to play anything").toBe(10);
    expect(roomFor(4)).toBeGreaterThanOrEqual(3);
    expect(roomFor(5), "at least one single category must support five").toBeGreaterThanOrEqual(1);
  });

  it("keeps a bench worth having", () => {
    expect(BOARD_CAPACITY).toBe(5);
    expect(BENCH_CAPACITY).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Ownership of the clock
// ---------------------------------------------------------------------------

describe("the match owns its own clock and nothing else's", () => {
  it("declares a deadline for every phase it drives", () => {
    for (const phase of MATCH_PHASES) {
      expect(PHASE_SECONDS[phase], `${phase} has no entry`).not.toBeUndefined();
      const seconds = PHASE_SECONDS[phase];
      if (seconds !== null) expect(seconds).toBeGreaterThan(0);
    }
  });

  it("leaves exactly the two subsystem phases unowned", () => {
    // The auction ends when every quota is filled and combat ends when the
    // stored battle's durationMs elapses. Giving either a deadline here would
    // be a second clock that can cut the first one short.
    const unowned = MATCH_PHASES.filter((p) => !isClockDriven(p) && p !== "MATCH_RESULTS");
    expect(unowned.sort()).toEqual(["AUCTION", "COMBAT", "FINAL_COMBAT"]);
  });

  it("keeps a phase short enough to hold a phone's attention", () => {
    for (const phase of MATCH_PHASES) {
      const seconds = PHASE_SECONDS[phase];
      if (seconds !== null) expect(seconds, phase).toBeLessThanOrEqual(60);
    }
  });
});

// ---------------------------------------------------------------------------
// The other copy of these rules
// ---------------------------------------------------------------------------

describe("Postgres runs the same machine", () => {
  /**
   * The authoritative copy is `dw_match_next_phase`. Two copies of a rule is a
   * deliberate trade — the UI must be able to grey out a button without a round
   * trip — and the price of that trade is a tripwire that fails the moment they
   * disagree.
   */
  it("mirrors every edge of the transition table", () => {
    const body = MIGRATION.match(
      /create or replace function dw_match_next_phase[\s\S]*?\$\$;/,
    )?.[0];
    expect(body, "dw_match_next_phase is missing from 0030").toBeTruthy();

    for (const from of MATCH_PHASES) {
      const line = body!.match(new RegExp(`when '${from}'\\s+then (.+)`))?.[1];
      expect(line, `${from} is not handled in SQL`).toBeTruthy();

      if (from === "ROUND_END") {
        // The fork, expressed the same way round.
        expect(line).toContain("p_round >= p_total");
        expect(line).toContain("'CHAMPIONSHIP'");
        expect(line).toContain("'ROUND_START'");
        continue;
      }

      const successor = PHASE_TRANSITIONS[from][0];
      if (successor === undefined) {
        expect(line!.trim().startsWith("null")).toBe(true);
      } else {
        expect(line, `${from} → ${successor} disagrees with SQL`).toContain(`'${successor}'`);
      }
    }
  });

  it("constrains the phase column to exactly the phases that exist", () => {
    const check = MIGRATION.match(/phase\s+text not null default 'MATCH_INTRO'[\s\S]*?\)\),/)?.[0];
    expect(check, "matches.phase has no check constraint").toBeTruthy();
    for (const phase of MATCH_PHASES) {
      expect(check, `${phase} is not allowed by the constraint`).toContain(`'${phase}'`);
    }
    // And nothing else: every quoted value in the constraint is a real phase.
    for (const quoted of check!.matchAll(/'([A-Z_]+)'/g)) {
      expect(isMatchPhase(quoted[1]), `${quoted[1]} is not a phase`).toBe(true);
    }
  });

  it("derives the successor server-side instead of trusting the caller", () => {
    // p_to exists as an optimistic-concurrency guard. If it were ever used as
    // the destination, the host's browser would choose the phase.
    const fn = MIGRATION.match(
      /create or replace function dw_advance_match_phase[\s\S]*?\$\$;/,
    )?.[0];
    expect(fn).toBeTruthy();
    expect(fn, "the successor is not derived in SQL").toContain("dw_match_next_phase(");
    expect(fn, "a mismatched destination is not rejected").toMatch(/p_to\s*<>\s*v_next/);
    // And a repeated call lands on noop rather than skipping a phase.
    expect(fn).toMatch(/m\.phase\s*<>\s*p_from/);
    expect(fn).toContain("'noop', true");
    // The round number has one writer.
    expect(fn).toMatch(/v_next = 'ROUND_START'[\s\S]*?m\.round_no \+ 1/);
  });
});

// ---------------------------------------------------------------------------
// Server authority, checked where it can actually be broken
// ---------------------------------------------------------------------------

describe("the lobby says what it is about to start", () => {
  const lobby = readFileSync(join(ROOT, "src", "components", "Lobby.tsx"), "utf8");

  it("names the seat count the round count comes from", () => {
    // Reported from a live room: three people present, the button offering six
    // rounds. The code was right — only two of them had finished joining, and
    // six is correct for two. What was wrong is that the button stated a rule
    // it had derived from a number it did not show, so a host could not tell a
    // two-player match from a third player still typing their nickname.
    const label = lobby.match(/\{`⚔️ Start match[^`]*`\}/)?.[0];
    expect(label, "the start-match label is missing").toBeTruthy();
    expect(label).toContain("seatedPlayers");
    expect(label).toContain("matchRounds");
  });

  it("counts seats, not readiness or room capacity", () => {
    expect(lobby).toMatch(/const seatedPlayers = players\.length;/);
    expect(lobby).toMatch(/totalRoundsFor\(Math\.max\(seatedPlayers, 1\)\)/);
    // maxPlayers is what the room *could* hold; it must not decide the length.
    const derivation = lobby.match(/const matchRounds = [^;]+;/)?.[0] ?? "";
    expect(derivation).not.toContain("maxPlayers");
    expect(derivation).not.toContain("isReady");
  });
});

describe("the code can ship before the schema does", () => {
  /**
   * Vercel deploys the JavaScript; a person runs the migration. Between those
   * two moments the code is newer than the database, and `getSnapshot` is on
   * the path of every request a room makes — so a hard failure there takes down
   * rooms playing the legacy game too.
   */
  const engine = readFileSync(join(ROOT, "src", "lib", "server", "engine.ts"), "utf8");

  it("treats the match RPCs as absent rather than fatal", () => {
    expect(engine).toMatch(/rpcOptional\("dw_match_snapshot"/);
    expect(engine).toMatch(/rpcOptional\("dw_match_tick"/);
  });

  it("keeps that tolerance off every write", () => {
    // A missing function on a write must fail loudly. Only the two read paths
    // above may be optional.
    const optional = [...engine.matchAll(/rpcOptional\("(\w+)"/g)].map((m) => m[1]);
    expect(optional.sort()).toEqual(["dw_match_snapshot", "dw_match_tick"]);
    for (const write of ["dw_start_match", "dw_advance_match_phase", "dw_abandon_match"]) {
      expect(engine, `${write} must not be optional`).toContain(`rpcOrThrow("${write}"`);
    }
  });
});

describe("a client can ask, never decide", () => {
  const route = readFileSync(
    join(ROOT, "src", "app", "api", "rooms", "[code]", "action", "route.ts"),
    "utf8",
  );
  const stage = readFileSync(join(ROOT, "src", "components", "MatchStage.tsx"), "utf8");

  it("accepts no match action that carries state", () => {
    const actions = route.match(/\|\s*\{\s*type:\s*"(START_MATCH|ADVANCE_MATCH|ABANDON_MATCH)"[^}]*\}/g);
    expect(actions, "the S8 actions are missing").toHaveLength(3);
    for (const action of actions!) {
      // No phase, no round, no hp, no damage, no credits, no winner. The whole
      // guarantee of this milestone is that these three actions are verbs with
      // no arguments.
      expect(action.replace(/type:\s*"[A-Z_]+"/, ""), action).not.toMatch(
        /phase|round|hp|damage|credit|winner|matchup|reward/i,
      );
    }
  });

  it("gates all three on the host", () => {
    for (const action of ["START_MATCH", "ADVANCE_MATCH", "ABANDON_MATCH"]) {
      const branch = route.match(new RegExp(`case "${action}": \\{[\\s\\S]*?\\n      \\}`))?.[0];
      expect(branch, `${action} has no branch`).toBeTruthy();
      expect(branch, `${action} is not host-gated`).toContain("isHost");
    }
  });

  it("never sends a phase from the browser", () => {
    expect(stage).toContain('type: "ADVANCE_MATCH"');
    // `nextPhaseOf` is read in the UI to label the button. It must not be sent.
    const sends = stage.match(/act\(\{[\s\S]*?\}\)/g) ?? [];
    for (const send of sends) {
      expect(send).not.toMatch(/phase|roundNo|hp|credits/);
    }
  });
});
