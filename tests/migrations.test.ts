import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ITEMS } from "../src/lib/game/items";
import { ACHIEVEMENTS } from "../src/lib/game/achievements";
import { CHALLENGES } from "../src/lib/game/challenges";

/**
 * Three catalogs now live in TypeScript and are compiled into SQL seeds by
 * `npm run seed:*`. The failure mode that follows is obvious once it happens
 * and invisible until then: edit the TypeScript, forget to regenerate, and the
 * database quietly keeps describing the old thing.
 *
 * These tests are the tripwire. They do not re-implement the generators; they
 * check that every id the code knows about is in the SQL and nothing else is.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const read = (file: string) => readFileSync(join(MIGRATIONS, file), "utf8");

/** Ids as they appear in a generated VALUES row: `  ('some-id', 'KIND', …`. */
function idsIn(sql: string): Set<string> {
  const ids = new Set<string>();
  for (const m of sql.matchAll(/^\s{2}\('([a-z0-9-]+)',/gm)) ids.add(m[1]);
  return ids;
}

describe("migration files", () => {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("is numbered contiguously from 0001", () => {
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers[0]).toBe(1);
    for (let i = 1; i < numbers.length; i++) {
      // A gap means a migration was renamed or lost; a duplicate means two
      // people numbered the same step and one of them will not run.
      expect(numbers[i], `after ${files[i - 1]}`).toBe(numbers[i - 1] + 1);
    }
  });

  it("keeps every migration additive", () => {
    // The brief for V3 was explicit: no dropped tables, no lost data. A
    // `drop table` here would be a silent violation of that on somebody's
    // production database.
    for (const file of files) {
      const sql = read(file).toLowerCase();
      expect(sql, `${file} drops a table`).not.toMatch(/drop\s+table(?!\s+if\s+exists\s+temp)/);
      expect(sql, `${file} truncates`).not.toMatch(/truncate\s+/);
      // Dropping a policy immediately before recreating it is the documented
      // way to make a policy idempotent, so that one is allowed.
      expect(sql, `${file} drops a column`).not.toMatch(/drop\s+column/);
    }
  });
});

describe("generated seeds match their TypeScript source", () => {
  it("seeds every cosmetic and nothing more", () => {
    const sql = idsIn(read("0010_seed_items.sql"));
    const code = new Set(ITEMS.map((i) => i.id));
    expect([...code].filter((id) => !sql.has(id)), "missing from SQL — run npm run seed:items")
      .toEqual([]);
    expect([...sql].filter((id) => !code.has(id)), "stale in SQL — run npm run seed:items")
      .toEqual([]);
  });

  it("seeds every achievement and nothing more", () => {
    const sql = idsIn(read("0013_seed_achievements.sql"));
    const code = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect([...code].filter((id) => !sql.has(id)), "run npm run seed:achievements").toEqual([]);
    expect([...sql].filter((id) => !code.has(id)), "run npm run seed:achievements").toEqual([]);
  });

  it("seeds every challenge and nothing more", () => {
    const sql = idsIn(read("0015_seed_challenges.sql"));
    const code = new Set(CHALLENGES.map((c) => c.id));
    expect([...code].filter((id) => !sql.has(id)), "run npm run seed:challenges").toEqual([]);
    expect([...sql].filter((id) => !code.has(id)), "run npm run seed:challenges").toEqual([]);
  });

  it("carries the same prices into the database", () => {
    // A price that disagrees between the shop card and the charge is the one
    // drift that costs a player real coins.
    const sql = read("0010_seed_items.sql");
    for (const item of ITEMS.filter((i) => i.price > 0)) {
      const row = sql.match(new RegExp(`^\\s{2}\\('${item.id}',.*$`, "m"));
      expect(row, `${item.id} is not in the seed`).toBeTruthy();
      expect(row![0], `${item.id} price drifted`).toContain(`, ${item.price}, `);
    }
  });

  it("carries the same thresholds into the database", () => {
    const sql = read("0013_seed_achievements.sql");
    for (const a of ACHIEVEMENTS) {
      const row = sql.match(new RegExp(`^\\s{2}\\('${a.id}',.*$`, "m"));
      expect(row, `${a.id} is not in the seed`).toBeTruthy();
      expect(row![0], `${a.id} threshold drifted`).toContain(`, ${a.threshold}, `);
    }
  });
});
