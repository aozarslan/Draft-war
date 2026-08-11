/**
 * Regenerates `supabase/migrations/0015_seed_challenges.sql` from
 * `src/lib/game/challenges.ts`.
 *
 *   npm run seed:challenges
 *
 * Idempotent upsert, same as the other seeds. Retuning a target updates the
 * template in place; assignments already handed out keep their own baselines,
 * so nobody's half-finished task is disturbed. Retire a template with
 * `is_active = false` rather than deleting it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHALLENGES, CHALLENGE_SLOTS } from "../src/lib/game/challenges";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const seen = new Set<string>();
for (const c of CHALLENGES) {
  if (seen.has(c.id)) throw new Error(`Duplicate challenge id: ${c.id}`);
  seen.add(c.id);
}

for (const [scope, slots] of Object.entries(CHALLENGE_SLOTS)) {
  const available = CHALLENGES.filter((c) => c.scope === scope).length;
  if (available < slots) {
    throw new Error(`${scope} needs at least ${slots} templates, has ${available}`);
  }
}

const values = CHALLENGES.map(
  (c, index) =>
    `  (${q(c.id)}, ${q(c.scope)}, ${q(c.name)}, ${q(c.description)}, ` +
    `${q(c.metric)}, ${c.target}, ${c.coins}, ${c.xp}, ${index})`,
).join(",\n");

const counts = CHALLENGES.reduce<Record<string, number>>((acc, c) => {
  acc[c.scope] = (acc[c.scope] ?? 0) + 1;
  return acc;
}, {});

const sql = `-- =============================================================================
-- DRAFT WAR V3 — Phase 10: the challenge catalog.
--
-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/game/challenges.ts   Regenerate: npm run seed:challenges
--
-- ${counts.DAILY} daily templates (${CHALLENGE_SLOTS.DAILY} live at a time) and ${counts.WEEKLY} weekly (${CHALLENGE_SLOTS.WEEKLY} live).
--
-- Run after 0014_challenges.sql. Idempotent: existing templates are updated in
-- place, and assignments keep the baselines they were given.
-- =============================================================================

insert into challenge_templates (id, scope, name, description, metric, target, coins, xp, sort)
values
${values}
on conflict (id) do update set
  scope = excluded.scope,
  name = excluded.name,
  description = excluded.description,
  metric = excluded.metric,
  target = excluded.target,
  coins = excluded.coins,
  xp = excluded.xp,
  sort = excluded.sort,
  is_active = true;
`;

const out = join(process.cwd(), "supabase", "migrations", "0015_seed_challenges.sql");
writeFileSync(out, sql);
console.log(`Wrote ${CHALLENGES.length} challenge templates to ${out}`);
