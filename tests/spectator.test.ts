import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { elapsedFor } from "../src/lib/render/stage";

/**
 * ---------------------------------------------------------------------------
 * A spectator watches the same battle, and can do nothing to it.
 * ---------------------------------------------------------------------------
 * `/watch` was built at M10 by handing the players' own `BattleStage` a store
 * with no seat. That is the right design — one battle screen, not two — but it
 * has a standing cost: every improvement to the battle screen lands on the
 * spectator page whether anyone checked or not, and so does every regression.
 *
 * These tests pin the inheritance rather than re-testing the screen. What must
 * stay true is narrow and checkable:
 *
 *  1. The spectator store overrides *only* seat and agency. Not the clock, not
 *     the snapshot — so a watcher and a player read the same battle at the
 *     same moment by construction, not by coincidence.
 *  2. The battle screen has exactly one definition of "how far in we are", so
 *     there is no second expression for a spectator to drift from.
 *  3. The heartbeat cannot write anything but presence.
 *
 * Source text is the right instrument for 1 and 2: the claim being made is
 * about which expressions exist in the file, and a runtime assertion would
 * pass just as happily with a second clock sitting beside the first.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const WATCH_CLIENT = read("src/app/watch/[code]/WatchClient.tsx");
const BATTLE_STAGE = read("src/components/BattleStage.tsx");
const WATCH_SQL = read("supabase/migrations/0023_spectators.sql");
const WATCH_ROUTE = read("src/app/api/rooms/[code]/watch/route.ts");

describe("the spectator inherits the battle screen", () => {
  it("renders the players' own BattleStage, not a copy", () => {
    expect(WATCH_CLIENT).toContain('from "@/components/BattleStage"');
    expect(WATCH_CLIENT).toContain("<BattleStage");
  });

  it("builds its store by spreading the room, so new fields arrive on their own", () => {
    // This is why the narration and the reveal needed no spectator wiring.
    expect(WATCH_CLIENT).toContain("...room");
  });

  it("overrides only the seat and the ability to act", () => {
    // The store literal, from the spread to its closing brace.
    const start = WATCH_CLIENT.indexOf("...room");
    const literal = WATCH_CLIENT.slice(start, WATCH_CLIENT.indexOf("}),", start));

    const overridden = [...literal.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(new Set(overridden)).toEqual(new Set(["session", "me", "act"]));
  });

  it("does not override the clock", () => {
    // A spectator reading a different `serverNow` would watch the same battle
    // at a different moment — the one failure that would look like lag rather
    // than like a bug.
    const start = WATCH_CLIENT.indexOf("...room");
    const literal = WATCH_CLIENT.slice(start, WATCH_CLIENT.indexOf("}),", start));
    expect(literal).not.toContain("serverNow");
    expect(literal).not.toContain("snapshot");
  });

  it("cannot act: the override refuses rather than throwing", () => {
    expect(WATCH_CLIENT).toMatch(/act:\s*async\s*\(\)\s*=>\s*false/);
  });
});

describe("there is one clock, and the spectator reads it", () => {
  it("defines elapsed once, and gives the same expression to canvas and narration", () => {
    // Both the arena and the spoken narration must sample the *same*
    // expression. Two expressions would agree until either was adjusted.
    const uses = [...BATTLE_STAGE.matchAll(/elapsedFor\(startedAt, serverNow\(\), duration\)/g)];
    expect(uses.length).toBeGreaterThanOrEqual(3); // HUD, canvas, narration.

    // And no other way of computing it exists in the file.
    const allElapsed = [...BATTLE_STAGE.matchAll(/elapsedFor\(/g)];
    expect(allElapsed).toHaveLength(uses.length);
  });

  it("takes elapsed from the server timestamp, never from the client", () => {
    expect(BATTLE_STAGE).toContain("snapshot?.game?.battleStartedAt");
    // No local start time, no accumulating counter.
    expect(BATTLE_STAGE).not.toMatch(/Date\.now\(\)/);
    expect(BATTLE_STAGE).not.toMatch(/performance\.now\(\)/);
  });

  it("is a pure function of the timestamps it is given", () => {
    // So "the spectator's elapsed" is not a thing that exists: feed the same
    // server timestamp and the same clock reading, get the same answer.
    const started = "2026-01-01T00:00:00.000Z";
    const now = Date.parse(started) + 4_000;
    expect(elapsedFor(started, now, 30_000)).toBe(4_000);
    expect(elapsedFor(started, now, 30_000)).toBe(elapsedFor(started, now, 30_000));
  });

  it("clamps to the recording rather than running past it", () => {
    const started = "2026-01-01T00:00:00.000Z";
    expect(elapsedFor(started, Date.parse(started) + 99_000, 30_000)).toBe(30_000);
    expect(elapsedFor(started, Date.parse(started) - 5_000, 30_000)).toBe(0);
  });
});

describe("the heartbeat marks presence and nothing else", () => {
  const body = WATCH_SQL.slice(
    WATCH_SQL.indexOf("create or replace function dw_watch"),
    WATCH_SQL.indexOf("create or replace function dw_snapshot"),
  );

  it("writes only to the spectators table", () => {
    // `(?<!do )` skips the `on conflict … do update set` clause, whose
    // "table" is the word `set` and whose target is the row being inserted.
    const writes = [...body.matchAll(/(insert into|(?<!do )update|delete from)\s+(\w+)/gi)]
      .map((m) => m[2].toLowerCase());
    expect(writes.length).toBeGreaterThan(0);
    expect(new Set(writes)).toEqual(new Set(["spectators"]));
  });

  it("never touches the battle, the result or the phase", () => {
    for (const field of [
      "battle_result",
      "battle_started_at",
      "phase_deadline",
      "winner_player_id",
      "mvp",
      "damage",
      "hp",
    ]) {
      expect(body.toLowerCase()).not.toContain(field);
    }
    expect(body).not.toContain("games");
    expect(body).not.toContain("rooms set");
  });

  it("returns a count, not any part of the game state", () => {
    const returned = body.slice(body.lastIndexOf("return jsonb_build_object"));
    expect(returned).toContain("'watching'");
    expect(returned).not.toContain("result");
    expect(returned).not.toContain("phase");
  });

  it("is rate limited, so presence cannot be used as a write channel", () => {
    expect(body).toContain("dw_rate_limited");
  });
});

describe("the watch endpoint accepts a watcher id and nothing else", () => {
  it("reads only watcherId from the request", () => {
    expect(WATCH_ROUTE).toContain("watcherId?: string");
    // No elapsed, no winner, no state of any kind arriving from a client.
    for (const field of ["elapsed", "winner", "damage", "hp", "mvp", "phase", "result"]) {
      expect(WATCH_ROUTE.toLowerCase()).not.toContain(`body.${field}`);
    }
  });

  it("calls only dw_watch", () => {
    const calls = [...WATCH_ROUTE.matchAll(/rpc\("(\w+)"/g)].map((m) => m[1]);
    expect(calls).toEqual(["dw_watch"]);
  });

  it("validates the id before it reaches the database", () => {
    expect(WATCH_ROUTE).toContain("/^[A-Za-z0-9_-]{8,64}$/");
  });
});
