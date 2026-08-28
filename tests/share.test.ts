import { describe, expect, it, vi } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { shareTextOf, summaryOf, type BattleSummary } from "../src/lib/render/summary";
import { shareOrCopy, type ShareTarget } from "../src/lib/client/share";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * Shared text is the copy that travels furthest.
 * ---------------------------------------------------------------------------
 * Every other surface in this product is read by someone who can look at the
 * match behind it. A share text is read by strangers, in another app, with no
 * way to check it — so a fabricated turning point or a re-derived probability
 * here is both the most damaging and the least likely to be noticed.
 *
 * The defence is that `shareTextOf` takes a `BattleSummary` and nothing else.
 * Every figure it can print has already been through `summaryOf`, and the
 * tests below hold it to that: sections vanish when their authoritative field
 * does, and no number appears that is not already in the summary.
 *
 * Validated on real 5v5 battles.
 */

const CHARACTERS_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const BANDS = computeAxisBands(CHARACTERS);

const ROSTER_A = [
  "animals-lion", "animals-tiger", "animals-wolf",
  "animals-leopard", "animals-spotted-hyena",
];
const ROSTER_B = [
  "animals-jaguar", "animals-cheetah", "animals-grizzly-bear",
  "animals-polar-bear", "animals-wild-boar",
];

const context: ReplayContext = {
  battleId: "share",
  players: [
    { playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE" },
    { playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE" },
  ],
};

function battle(seed: string): BattleResult {
  return simulateBattle({
    teams: [
      {
        playerId: "player-a", nickname: "Ege", formation: "AGGRESSIVE",
        characters: ROSTER_A.map((id, i) => ({ characterId: id, price: 4 + i * 3 })),
      },
      {
        playerId: "player-b", nickname: "Mikail", formation: "DEFENSIVE",
        characters: ROSTER_B.map((id, i) => ({ characterId: id, price: 6 + i * 2 })),
      },
    ],
    map: MAPS[0],
    event: EVENT_CARDS[0],
    charactersById: CHARACTERS_BY_ID,
    seed,
    categoryIds: ["animals"],
    bands: BANDS,
  });
}

const replayOf = (seed: string): Replay => toReplay(battle(seed), context);
const nameOf = (id: string) => CHARACTERS_BY_ID[id]?.name ?? id;

const URL = "https://draft-war.vercel.app/match/abc-123";
const ctx = {
  nameOf,
  mapName: MAPS[0].name,
  eventName: EVENT_CARDS[0].name,
  categoryNames: ["Animals"],
  url: URL,
};

/** A real 5v5 the engine called an upset, chosen by property. */
const WITH_UPSET = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`sh-up-${i}`);
    if (replay.upset) return replay;
  }
  throw new Error("no upset in 300 real battles");
})();

/** A real 5v5 the engine did *not* call an upset. */
const ORDINARY = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`sh-ord-${i}`);
    if (!replay.upset) return replay;
  }
  throw new Error("every one of 300 real battles was an upset");
})();

const WITH_TURNING_POINT = (() => {
  for (let i = 0; i < 200; i++) {
    const replay = replayOf(`sh-tp-${i}`);
    if (replay.turningPoint) return replay;
  }
  throw new Error("no turning point in 200 real battles");
})();

describe("the text says what the summary says", () => {
  const replay = replayOf("sh-1");
  const summary = summaryOf(replay);
  const text = shareTextOf(summary, ctx);

  it("leads with the game", () => {
    expect(text.split("\n")[0]).toBe("DRAFT WAR");
  });

  it("names the winner and the points the engine awarded", () => {
    expect(text).toContain(summary.winner!.nickname);
    expect(text).toContain(`+${summary.winner!.points} pts`);
  });

  it("names the runner-up the summary named", () => {
    expect(text).toContain(`beat ${summary.runnerUp!.nickname}`);
  });

  it("carries the MVP with the summary's own expectation figure", () => {
    expect(text).toContain(nameOf(summary.mvp!.characterId));
    expect(text).toContain(`${summary.mvp!.performance}% of expectation`);
  });

  it("carries the map, event and category context it was given", () => {
    expect(text).toContain(MAPS[0].name);
    expect(text).toContain(EVENT_CARDS[0].name);
    expect(text).toContain("Animals");
  });

  it("ends with the public match URL", () => {
    expect(text.trimEnd().endsWith(URL)).toBe(true);
  });

  it("is deterministic", () => {
    expect(shareTextOf(summary, ctx)).toBe(text);
  });
});

describe("it omits rather than invents", () => {
  it("includes the upset only when the engine called one", () => {
    const upsetText = shareTextOf(summaryOf(WITH_UPSET), ctx);
    expect(upsetText).toContain("Upset");
    // And the figure is the stored forecast, not a fresh one.
    expect(upsetText).toContain(`won at ${summaryOf(WITH_UPSET).upset!.wonAtProbability}%`);

    expect(ORDINARY.upset).toBe(false);
    expect(shareTextOf(summaryOf(ORDINARY), ctx)).not.toContain("Upset");
  });

  it("includes the turning point only when the engine found one", () => {
    const summary = summaryOf(WITH_TURNING_POINT);
    expect(shareTextOf(summary, ctx)).toContain(summary.turningPoint!.text);

    const without: BattleSummary = { ...summary, turningPoint: null };
    const text = shareTextOf(without, ctx);
    expect(text).not.toContain(summary.turningPoint!.text);
    // And the rest still reads.
    expect(text).toContain("DRAFT WAR");
    expect(text).toContain(summary.winner!.nickname);
  });

  it("drops the MVP line when the result had none", () => {
    const summary = { ...summaryOf(replayOf("sh-2")), mvp: null };
    const text = shareTextOf(summary, ctx);
    expect(text).not.toContain("MVP");
    expect(text).toContain(summary.winner!.nickname);
  });

  it("drops the winner line when no team matched", () => {
    const summary = { ...summaryOf(replayOf("sh-3")), winner: null, runnerUp: null };
    const text = shareTextOf(summary, ctx);
    expect(text).not.toContain("pts");
    expect(text).toContain("DRAFT WAR");
  });

  it("omits the context line entirely when nothing was supplied", () => {
    const summary = summaryOf(replayOf("sh-4"));
    const text = shareTextOf(summary, { nameOf });
    expect(text).toContain("DRAFT WAR");
    expect(text).not.toContain("·  ·");
    expect(text.trimEnd().endsWith(URL)).toBe(false);
  });

  it("survives a summary with every optional field missing", () => {
    const bare: BattleSummary = {
      winner: null, runnerUp: null, standings: [], mvp: null,
      turningPoint: null, upset: null, bestPerformer: null, biggestSurprise: null,
    };
    expect(shareTextOf(bare, { nameOf })).toBe("DRAFT WAR");
  });
});

describe("no number is invented", () => {
  const replay = replayOf("sh-5");
  const summary = summaryOf(replay);

  it("prints only figures that appear in the summary", () => {
    const text = shareTextOf(summary, ctx);
    // Every number in the text, minus the ones that came from the URL.
    const printed = text
      .replace(URL, "")
      .match(/\d+(\.\d+)?/g)!
      .map(Number);

    const allowed = new Set<number>([
      summary.winner!.points,
      summary.mvp!.performance,
      ...(summary.upset ? [summary.upset.wonAtProbability] : []),
      // The turning point is the engine's own sentence and may contain a round
      // number; it is quoted verbatim, so its figures are authoritative too.
      ...(summary.turningPoint?.text.match(/\d+(\.\d+)?/g) ?? []).map(Number),
    ]);

    for (const value of printed) expect(allowed).toContain(value);
  });

  it("quotes the stored forecast even when it contradicts the standings", () => {
    // The discriminating case, and it took a mutation to find: in a two-team
    // battle the forecasts sum to 100, so `100 - runnerUp` *equals* the
    // winner's stored figure and a re-derived number is indistinguishable
    // from a quoted one. Every earlier assertion here passed against odds
    // computed on the fly.
    //
    // So the summary is deliberately made inconsistent. Only an implementation
    // that reads `upset.wonAtProbability` can print 12.5.
    const contradictory: BattleSummary = {
      ...summary,
      winner: { ...summary.winner!, winProbability: 77 },
      runnerUp: { ...summary.runnerUp!, winProbability: 20 },
      upset: { wonAtProbability: 12.5 },
    };

    const text = shareTextOf(contradictory, ctx);
    expect(text).toContain("won at 12.5%");
    // Neither the winner's own forecast nor anything derived from the loser's.
    expect(text).not.toContain("77");
    expect(text).not.toContain("80");
  });

  it("changes only when the summary changes", () => {
    const before = shareTextOf(summary, ctx);
    const shifted = shareTextOf(
      { ...summary, winner: { ...summary.winner!, points: summary.winner!.points + 5 } },
      ctx,
    );
    expect(shifted).not.toBe(before);
    expect(shifted).toContain(`+${summary.winner!.points + 5} pts`);
  });

  it("does not touch the summary", () => {
    const copy = structuredClone(summary);
    shareTextOf(summary, ctx);
    expect(summary).toEqual(copy);
  });
});

describe("a battle recorded before V5 still shares", () => {
  it("produces the same text from a legacy replay", () => {
    const raw = replayOf("sh-legacy");
    const legacy: Replay = {
      ...raw,
      replayVersion: 0,
      combatants: raw.combatants.map(({ maxHp: _drop, ...rest }) => rest),
      events: raw.events.map(({ hpAfter: _drop, ...rest }) => rest),
    };

    const text = shareTextOf(summaryOf(legacy), ctx);
    expect(text).toContain("DRAFT WAR");
    expect(text).toContain(summaryOf(legacy).winner!.nickname);
    expect(text).toContain(URL);
    // Health was never recorded, and nothing here needed it.
    expect(text).toBe(shareTextOf(summaryOf(raw), ctx));
  });

  it("shares a payload with no awards forwarded", () => {
    const replay = replayOf("sh-6");
    const withoutAwards: Replay = { ...replay };
    delete (withoutAwards as { awards?: unknown }).awards;

    const text = shareTextOf(summaryOf(withoutAwards), ctx);
    expect(text).toContain(summaryOf(withoutAwards).winner!.nickname);
  });
});

describe("the share sheet, when the browser has one", () => {
  const content = { title: "DRAFT WAR", text: "DRAFT WAR\n🏆 Ege", url: URL };

  it("uses navigator.share and does not touch the clipboard", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const target: ShareTarget = { share, clipboard: { writeText } };

    expect(await shareOrCopy(target, content)).toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "DRAFT WAR",
      text: content.text,
      url: URL,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("passes the URL as its own field, so links render as links", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await shareOrCopy({ share }, content);
    expect(share.mock.calls[0][0].url).toBe(URL);
  });

  it("stays quiet when the person dismisses the sheet", async () => {
    // A cancelled share rejects exactly like a broken one. Copying something
    // somebody just declined to send would be worse than doing nothing.
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const writeText = vi.fn().mockResolvedValue(undefined);

    const outcome = await shareOrCopy(
      { share: vi.fn().mockRejectedValue(abort), clipboard: { writeText } },
      content,
    );

    expect(outcome).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard when the sheet itself breaks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const outcome = await shareOrCopy(
      { share: vi.fn().mockRejectedValue(new Error("not allowed")), clipboard: { writeText } },
      content,
    );
    expect(outcome).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(content.text);
  });
});

describe("the clipboard fallback, when the browser has no sheet", () => {
  const content = { title: "DRAFT WAR", text: "DRAFT WAR\n🏆 Ege", url: URL };

  it("copies the whole text, URL included", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrCopy({ clipboard: { writeText } }, content)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(content.text);
  });

  it("reports failure when neither route exists", async () => {
    expect(await shareOrCopy({}, content)).toBe("failed");
    expect(await shareOrCopy(undefined, content)).toBe("failed");
  });

  it("reports failure when the clipboard is blocked", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(await shareOrCopy({ clipboard: { writeText } }, content)).toBe("failed");
  });

  it("omits an empty URL rather than sharing an empty string", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    await shareOrCopy({ share }, { text: "x", url: "" });
    expect(share.mock.calls[0][0].url).toBeUndefined();
  });
});

describe("the shared link is the public match page", () => {
  it("is the match URL the results screen builds, not the room URL", async () => {
    // A room code is reused by the next rematch; the match page outlives it.
    // Sharing the room link would send a stranger to whatever is being played
    // now, which is the one thing the share is not about.
    const RESULTS = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "src/components/ResultsStage.tsx"),
      "utf8",
    );

    expect(RESULTS).toContain("${window.location.origin}/match/${snapshot.game.id}");
    // The share action sends `matchUrl`, and never `shareUrl` (the room).
    const action = RESULTS.slice(
      RESULTS.indexOf("async function shareResult"),
      RESULTS.indexOf("async function copy("),
    );
    expect(action).toContain("url: matchUrl");
    expect(action).not.toContain("shareUrl");
  });

  it("builds its text from the summary projection, not from the raw result", async () => {
    const RESULTS = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(process.cwd(), "src/components/ResultsStage.tsx"),
      "utf8",
    );
    const action = RESULTS.slice(
      RESULTS.indexOf("async function shareResult"),
      RESULTS.indexOf("async function copy("),
    );
    expect(action).toContain("shareTextOf(battleSummary");
    // No reaching into the authoritative result for figures.
    expect(action).not.toContain("result.teams");
    expect(action).not.toContain("result.mvp");
    expect(action).not.toContain("winProbability");
  });
});
