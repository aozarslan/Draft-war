import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The definition of a SQL function that is actually live.
 *
 * Migrations replace each other: `dw_advance_match_phase` is written in 0030,
 * replaced in 0031 and replaced again in 0032, and only the last one runs. A
 * test that reads the file it *remembers* is a test that silently stops
 * checking anything the first time a later migration supersedes it — which has
 * now happened twice in S8, once to a round-increment assertion and once to the
 * auction guard.
 *
 * So the question "which file defines this" is asked of the directory rather
 * than hard-coded: scan every migration in order and return the last body.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** How many parameters a `create or replace function` header declares. */
function arityOf(sql: string): number {
  const args = sql.match(/create or replace function \w+\s*\(([^)]*)\)/)?.[1] ?? "";
  return args.split(",").filter((a) => a.trim().length > 0).length;
}

/**
 * @param arity Which overload to read. Defaults to the widest one.
 *
 * The default matters because two functions in this schema exist at two
 * arities: `dw_place_bid` and `dw_pass_auction` each have a narrow legacy
 * signature that 0031 reduced to a one-line delegator. The widest is always the
 * implementation — a delegator, by construction, has fewer parameters than the
 * function it forwards to — so reading the last definition by name alone would
 * return the forwarder and check nothing.
 */
export function liveDefinitionOf(
  name: string,
  arity?: number,
): { sql: string; file: string; arity: number } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const byArity = new Map<number, { sql: string; file: string }>();

  for (const file of files) {
    const src = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const m of src.matchAll(
      new RegExp(`create or replace function ${name}\\s*\\([\\s\\S]*?\\$\\$;`, "g"),
    )) {
      // Later files replace earlier ones at the same signature.
      byArity.set(arityOf(m[0]), { sql: m[0], file });
    }
  }

  if (byArity.size === 0) throw new Error(`no migration defines ${name}`);
  const wanted = arity ?? Math.max(...byArity.keys());
  const found = byArity.get(wanted);
  if (!found) {
    throw new Error(
      `${name} has no ${wanted}-argument definition (found ${[...byArity.keys()].join(", ")})`,
    );
  }
  return { ...found, arity: wanted };
}
