import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import { CHARACTERS } from "../src/lib/game/characters";
import { MAPS } from "../src/lib/game/maps";
import { EVENT_CARDS } from "../src/lib/game/events";
import { toReplay, type Replay, type ReplayContext } from "../src/lib/game/replay";
import { highlightsOf } from "../src/lib/render/highlights";
import {
  activeCue,
  cueProgress,
  narrativeOf,
  NARRATIVE_PRIORITY,
  type NarrativeCue,
} from "../src/lib/render/narrative";
import { sceneAt } from "../src/lib/render/scene";
import type { BattleResult } from "../src/lib/game/types";

/**
 * ---------------------------------------------------------------------------
 * One slot, one occupant, at the engine's own timestamp.
 * ---------------------------------------------------------------------------
 * The narrative layer is where a renderer is most likely to start lying. It
 * has opinions about meaning, it writes sentences, and every mistake it can
 * make looks like a styling choice from the outside: a cue shown a beat late,
 * a card that outranks the moment underneath it, a "comeback" the engine never
 * reported.
 *
 * So these tests pin three things. The cues are a pure function of the replay.
 * Their timestamps are the engine's, never adjusted. And when two want the
 * screen, the louder one takes it and the quieter one is *gone* — not queued,
 * not deferred, not shown afterwards.
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
  battleId: "narrative",
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
const cuesOf = (replay: Replay) => narrativeOf(replay, highlightsOf(replay));

/** A real 5v5 that carries a turning point, for the priority rules. */
const WITH_TURNING_POINT = (() => {
  for (let i = 0; i < 200; i++) {
    const replay = replayOf(`n-tp-${i}`);
    if (replay.events.some((e) => e.kind === "TURNING_POINT")) return replay;
  }
  throw new Error("no turning point in 200 real battles");
})();

const ORDINARY = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`n-ord-${i}`);
    if (!replay.upset) return replay;
  }
  throw new Error("every one of 300 real battles was an upset");
})();

const WITH_UPSET = (() => {
  for (let i = 0; i < 300; i++) {
    const replay = replayOf(`n-up-${i}`);
    if (replay.upset) return replay;
  }
  throw new Error("no upset in 300 real battles");
})();

describe("it is a real 5v5 being narrated", () => {
  it("has ten combatants, five a side", () => {
    const replay = replayOf("n-1");
    expect(replay.combatants).toHaveLength(10);
    expect(replay.combatants.filter((c) => c.teamId === "player-a")).toHaveLength(5);
    expect(replay.combatants.filter((c) => c.teamId === "player-b")).toHaveLength(5);
  });
});

describe("determinism and purity", () => {
  const replay = replayOf("n-2");

  it("returns the same cues every time it is asked", () => {
    expect(cuesOf(replay)).toEqual(cuesOf(replay));
  });

  it("does not touch the replay", () => {
    const before = structuredClone(replay);
    cuesOf(replay);
    cuesOf(replay);
    expect(replay).toEqual(before);
  });

  it("has no dependence on a clock or on randomness", () => {
    const first = cuesOf(replay);
    for (let i = 0; i < 40; i++) cuesOf(replayOf(`n-noise-${i}`));
    expect(cuesOf(replay)).toEqual(first);
  });

  it("invents no probability: nothing tracks momentum over rounds", () => {
    // The audit established that per-round odds are not persisted. A cue that
    // needed them would have to reconstruct them, which is the second source
    // of truth this project refuses.
    const kinds = new Set(cuesOf(replay).map((c) => c.kind));
    expect(kinds.has("UNDERDOG_PRESSURE" as never)).toBe(false);
    const shifted = cuesOf({
      ...replay,
      teams: replay.teams.map((t) => ({ ...t, winProbability: 0.5 })),
    });
    expect(shifted).toEqual(cuesOf(replay));
  });
});

describe("every cue is anchored to something that happened", () => {
  const replay = replayOf("n-3");
  const cues = cuesOf(replay);

  it("produces a handful of cues, not one per event", () => {
    expect(cues.length).toBeGreaterThan(5);
    expect(cues.length).toBeLessThan(replay.events.length / 2);
  });

  it("carries the engine's own timestamp, never an adjusted one", () => {
    // The mutation this catches: nudging `atMs` by a lead-in so a card appears
    // "just before" its moment. Every cue drawn from an event must sit exactly
    // on that event.
    for (const cue of cues) {
      if (cue.eventIndex === null) continue;
      expect(cue.atMs).toBe(replay.events[cue.eventIndex].atMs);
    }
  });

  it("indexes only real events", () => {
    for (const cue of cues) {
      if (cue.eventIndex === null) continue;
      expect(cue.eventIndex).toBeGreaterThanOrEqual(0);
      expect(cue.eventIndex).toBeLessThan(replay.events.length);
    }
  });

  it("gives every cue a line to draw and a label to speak", () => {
    for (const cue of cues) {
      expect(cue.text.length).toBeGreaterThan(0);
      expect(cue.label.length).toBeGreaterThan(0);
    }
  });

  it("orders them by time", () => {
    const times = cues.map((c) => c.atMs);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("the cues say what the engine said", () => {
  it("names the final clash from the engine's own divider", () => {
    const replay = replayOf("n-4");
    const finalCues = cuesOf(replay).filter((c) => c.kind === "FINAL_CLASH");
    expect(finalCues.length).toBeGreaterThan(0);
    for (const cue of finalCues) {
      expect(replay.events[cue.eventIndex!].text.toUpperCase()).toContain("FINAL CLASH");
    }
  });

  it("quotes the turning-point sentence rather than writing one", () => {
    const cue = cuesOf(WITH_TURNING_POINT).find((c) => c.kind === "TURNING_POINT")!;
    expect(cue).toBeTruthy();
    expect(cue.text).toBe(WITH_TURNING_POINT.events[cue.eventIndex!].text);
  });

  it("calls the ending an upset when, and only when, the engine did", () => {
    expect(cuesOf(WITH_UPSET).some((c) => c.kind === "UPSET")).toBe(true);
    expect(cuesOf(WITH_UPSET).some((c) => c.kind === "VICTORY")).toBe(false);
    expect(cuesOf(ORDINARY).some((c) => c.kind === "VICTORY")).toBe(true);
    expect(cuesOf(ORDINARY).some((c) => c.kind === "UPSET")).toBe(false);
  });

  it("puts one cue at the ending, not two", () => {
    // Victory and upset describe the same instant. Modelled as two cues they
    // would both want a slot that holds one.
    for (const replay of [ORDINARY, WITH_UPSET]) {
      const end = replay.events.findIndex((e) => e.kind === "END");
      expect(cuesOf(replay).filter((c) => c.eventIndex === end)).toHaveLength(1);
    }
  });

  it("takes comebacks from the highlight layer's classification", () => {
    // Not re-derived here: if the classifier reports none, the narrative says
    // nothing about one.
    const replay = replayOf("n-5");
    expect(narrativeOf(replay, []).some((c) => c.kind === "COMEBACK")).toBe(false);
  });

  it("calls a last stand only when a squad is down to one", () => {
    let checked = 0;
    for (let i = 0; i < 40 && checked < 3; i++) {
      const replay = replayOf(`n-ls-${i}`);
      for (const cue of cuesOf(replay).filter((c) => c.kind === "LAST_STAND")) {
        // Count the dead on the losing side at that moment, from the log.
        const size = new Map<string, number>();
        for (const c of replay.combatants) {
          size.set(c.teamId, (size.get(c.teamId) ?? 0) + 1);
        }
        const event = replay.events[cue.eventIndex!];
        const team = event.targetTeamId!;
        const lost = replay.events.filter(
          (e, i2) =>
            e.kind === "ELIMINATION" && e.targetTeamId === team && i2 <= cue.eventIndex!,
        ).length;
        expect(size.get(team)! - lost).toBe(1);
        checked++;
      }
    }
    expect(checked, "no last stand in 40 real battles").toBeGreaterThan(0);
  });

  it("announces a last stand once per team, not once per later kill", () => {
    for (let i = 0; i < 20; i++) {
      const replay = replayOf(`n-ls2-${i}`);
      const stands = cuesOf(replay).filter((c) => c.kind === "LAST_STAND");
      expect(stands.length).toBeLessThanOrEqual(replay.teams.length);
    }
  });
});

describe("the single slot", () => {
  it("shows at most one cue at any moment of any battle", () => {
    // The property the whole design exists for, checked densely across real
    // battles rather than at hand-picked instants.
    for (let i = 0; i < 12; i++) {
      const replay = replayOf(`n-slot-${i}`);
      const cues = cuesOf(replay);
      for (let t = 0; t <= replay.durationMs; t += 50) {
        const active = activeCue(cues, t);
        if (!active) continue;
        expect(sceneAt(replay, t).banner).toBeTruthy();
      }
    }
  });

  it("gives the slot to the higher priority when two overlap", () => {
    const cues: NarrativeCue[] = [
      cue("PHASE", 1_000, 1_600),
      cue("TURNING_POINT", 1_200, 1_600),
    ];
    expect(activeCue(cues, 1_300)!.kind).toBe("TURNING_POINT");
  });

  it("drops the loser rather than showing it late", () => {
    // The mutation this catches: queueing a displaced cue so it plays after
    // the winner finishes. A phase divider that arrives 1.6s after its round
    // began is labelling the wrong part of the fight.
    const phase = cue("PHASE", 1_000, 1_600);
    const turn = cue("TURNING_POINT", 1_000, 1_600);
    const cues = [phase, turn];

    for (let t = 1_000; t < 6_000; t += 50) {
      const active = activeCue(cues, t);
      expect(active === phase).toBe(false);
    }
    // And the winner leaves the screen at its own natural end, not later.
    expect(activeCue(cues, 2_599)!.kind).toBe("TURNING_POINT");
    expect(activeCue(cues, 2_600)).toBeNull();
  });

  it("never resurrects a cue whose window has passed", () => {
    const cues = [cue("PHASE", 0, 1_600)];
    expect(activeCue(cues, 800)).toBeTruthy();
    expect(activeCue(cues, 1_600)).toBeNull();
    expect(activeCue(cues, 50_000)).toBeNull();
  });

  it("breaks a tie on the later moment", () => {
    const early = cue("LAST_STAND", 1_000, 1_600);
    const late = cue("FINAL_CLASH", 1_400, 1_600);
    expect(NARRATIVE_PRIORITY.LAST_STAND).toBe(NARRATIVE_PRIORITY.FINAL_CLASH);
    expect(activeCue([early, late], 1_500)).toBe(late);
    expect(activeCue([late, early], 1_500)).toBe(late);
  });

  it("ranks the vocabulary the way the design says", () => {
    const p = NARRATIVE_PRIORITY;
    expect(p.PHASE).toBeLessThan(p.COMEBACK);
    expect(p.COMEBACK).toBeLessThan(p.LAST_STAND);
    expect(p.LAST_STAND).toBe(p.FINAL_CLASH);
    expect(p.FINAL_CLASH).toBeLessThan(p.TURNING_POINT);
    expect(p.TURNING_POINT).toBeLessThan(p.VICTORY);
    expect(p.VICTORY).toBe(p.UPSET);
  });

  it("puts the ending above everything it could collide with", () => {
    // A last kill, the final clash divider and the result can land within a
    // second of each other. The result is what the viewer must be left with.
    const ending = cue("UPSET", 30_000, Number.POSITIVE_INFINITY);
    const others = (["PHASE", "COMEBACK", "LAST_STAND", "FINAL_CLASH", "TURNING_POINT"] as const)
      .map((k) => cue(k, 30_100, 1_600));
    expect(activeCue([...others, ending], 30_500)).toBe(ending);
  });
});

describe("the ending holds until playback stops", () => {
  const replay = replayOf("n-end");

  it("stays on screen past its own animation, to the end of the recording", () => {
    // M5's bug, prevented structurally: the victory band used to expire on a
    // fixed window and leave the viewer looking at an empty arena.
    const cues = cuesOf(replay);
    const end = cues.find((c) => c.kind === "VICTORY" || c.kind === "UPSET")!;
    expect(end.atMs).toBeLessThan(replay.durationMs);
    expect(activeCue(cues, replay.durationMs)).toBe(end);
    expect(sceneAt(replay, replay.durationMs).banner?.kind).toBe("VICTORY");
  });

  it("arrives over its animation rather than snapping on", () => {
    const end = cuesOf(replay).find((c) => c.kind === "VICTORY" || c.kind === "UPSET")!;
    expect(cueProgress(end, end.atMs)).toBe(0);
    expect(cueProgress(end, end.atMs + end.animationMs / 2)).toBeCloseTo(0.5, 5);
    expect(cueProgress(end, end.atMs + end.animationMs)).toBe(1);
    // And then holds, rather than running past 1 into a fade-out.
    expect(cueProgress(end, end.atMs + 600_000)).toBe(1);
  });
});

describe("the scene draws the cue, and the cue only", () => {
  const replay = replayOf("n-6");

  it("shows a banner exactly when a cue is active", () => {
    const cues = cuesOf(replay);
    for (let t = 0; t <= replay.durationMs; t += 100) {
      const active = activeCue(cues, t);
      const scene = sceneAt(replay, t);
      expect(Boolean(scene.banner)).toBe(Boolean(active));
      if (active) expect(scene.banner!.text).toBe(active.text);
    }
  });

  it("exposes the same cue as text for a screen reader", () => {
    // The canvas is aria-hidden, so the spoken representation cannot be
    // derived from pixels. Same object, drawn twice.
    for (let t = 0; t <= replay.durationMs; t += 250) {
      const scene = sceneAt(replay, t);
      if (!scene.banner) {
        expect(scene.narrative).toBeNull();
        continue;
      }
      expect(scene.narrative!.text).toBe(scene.banner.text);
      expect(scene.narrative!.label.length).toBeGreaterThan(0);
    }
  });

  it("stays deterministic under seeking", () => {
    const at = sceneAt(replay, 11_111);
    sceneAt(replay, 31_000);
    sceneAt(replay, 400);
    expect(sceneAt(replay, 11_111)).toEqual(at);
  });

  it("changes nothing about the fight", () => {
    // The narrative layer is observational. Running it must not move a
    // combatant, a number or the clock.
    const before = sceneAt(replay, 9_000);
    cuesOf(replay);
    narrativeOf(replay, highlightsOf(replay));
    const after = sceneAt(replay, 9_000);
    expect(after.combatants).toEqual(before.combatants);
    expect(after.effects).toEqual(before.effects);
    expect(after.elapsedMs).toBe(before.elapsedMs);
  });
});

describe("reduced motion removes movement, not meaning", () => {
  const replay = replayOf("n-calm");
  const CANVAS = readFileSync(
    resolve(process.cwd(), "src/lib/render/canvas.ts"),
    "utf8",
  );

  it("keeps the words out of the draw layer's reach entirely", () => {
    // `sceneAt` takes a replay and a time. There is no third argument, so no
    // accessibility preference can change what the battle says — only how it
    // moves while saying it.
    expect(sceneAt.length).toBe(2);
  });

  it("gates exactly one thing on the preference, and it is decoration", () => {
    // Every other use of the flag is arithmetic — a distance, an easing, an
    // alpha. Only the sparks are skipped outright, and a spark carries no
    // information the damage number does not already state.
    const skipped = [...CANVAS.matchAll(/if \([^)]*reducedMotion[^)]*\)\s*(?:{|this\.(\w+))/g)];
    expect(skipped).toHaveLength(1);
    expect(skipped[0][1]).toBe("drawParticles");
  });

  it("draws the banner unconditionally", () => {
    // The narrative is the one thing a calm-motion viewer most needs, since
    // they have given up the shake and the pan that would otherwise mark a
    // big moment.
    const drawBanner = CANVAS.slice(
      CANVAS.indexOf("private drawBanner"),
      CANVAS.indexOf("private drawBanner") + 900,
    );
    expect(drawBanner).toContain("if (!scene.banner) return;");
    expect(drawBanner).not.toMatch(/if \([^)]*reducedMotion[^)]*\)\s*return/);
  });

  it("says the same thing to a screen reader either way", () => {
    // The narration component takes no motion preference at all: same cues,
    // same labels, same text.
    const NARRATION = readFileSync(
      resolve(process.cwd(), "src/components/BattleNarration.tsx"),
      "utf8",
    );
    expect(NARRATION).not.toContain("reducedMotion");
    expect(NARRATION).toContain('aria-live="polite"');
  });

  it("never reads a cue out twice over", () => {
    // A phase divider's label is its line: the engine writes "ENGAGEMENT ·
    // ROUND 3", which is already what you would want spoken. Prefixing it
    // with itself produced "Engagement round 3: engagement round 3" on the
    // first real match this region was pointed at.
    const NARRATION = readFileSync(
      resolve(process.cwd(), "src/components/BattleNarration.tsx"),
      "utf8",
    );
    expect(NARRATION).toContain("cue.text.toUpperCase().startsWith(cue.label.toUpperCase())");

    // Across every cue of several real battles, no line opens by saying the
    // same words twice. Both echoes found here were found by *reading the
    // live region on a real match*, not by a test: "Engagement round 3:
    // engagement round 3" first, then "Last stand: LAST STAND" past a
    // case-sensitive fix, then "Final clash: FINAL CLASH · ROUND 8".
    for (let i = 0; i < 12; i++) {
      for (const cue of cuesOf(replayOf(`n-echo-${i}`))) {
        const line = spokenLine(cue);
        const split = line.indexOf(": ");
        if (split === -1) continue;
        const head = line.slice(0, split).toUpperCase();
        expect(line.slice(split + 2).toUpperCase().startsWith(head)).toBe(false);
      }
    }
  });

  it("carries a label and a line for every cue in a real battle", () => {
    // What the spoken region actually reads out, over a whole match.
    const cues = cuesOf(replay);
    const spoken = cues.map(spokenLine);
    expect(spoken.length).toBeGreaterThan(5);
    for (const line of spoken) expect(line.trim().length).toBeGreaterThan(3);
  });
});

/** What the live region reads out. Mirrors `spoken` in BattleNarration. */
function spokenLine(cue: NarrativeCue): string {
  return cue.text.toUpperCase().startsWith(cue.label.toUpperCase())
    ? cue.text
    : `${cue.label}: ${cue.text}`;
}

/** A bare cue, for the slot rules that are about ordering rather than battles. */
function cue(
  kind: NarrativeCue["kind"],
  atMs: number,
  durationMs: number,
): NarrativeCue {
  return {
    kind,
    atMs,
    durationMs,
    animationMs: 1_600,
    priority: NARRATIVE_PRIORITY[kind],
    text: kind,
    label: kind,
    eventIndex: null,
  };
}
