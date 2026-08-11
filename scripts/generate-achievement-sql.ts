/**
 * Regenerates `supabase/migrations/0013_seed_achievements.sql` from
 * `src/lib/game/achievements.ts`.
 *
 *   npm run seed:achievements
 *
 * Idempotent upsert, same as the character and item seeds: re-running it after
 * retuning a threshold updates the row in place and never revokes an unlock
 * somebody already has. Retire an achievement with `is_active = false` rather
 * than deleting it — people have it.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACHIEVEMENTS, validateRewards } from "../src/lib/game/achievements";

const q = (s: string | null | undefined) =>
  s === null || s === undefined ? "null" : `'${s.replace(/'/g, "''")}'`;

const problems = validateRewards();
if (problems.length > 0) {
  console.error("Refusing to generate — reward items are wrong:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const seen = new Set<string>();
for (const a of ACHIEVEMENTS) {
  if (seen.has(a.id)) throw new Error(`Duplicate achievement id: ${a.id}`);
  seen.add(a.id);
}

const values = ACHIEVEMENTS.map(
  (a, index) =>
    `  (${q(a.id)}, ${q(a.name)}, ${q(a.description)}, ${q(a.category)}, ${q(a.tier)}, ` +
    `${q(a.metric)}, ${a.threshold}, ${a.coins}, ${a.xp}, ${q(a.item ?? null)}, ` +
    `${a.hidden ? "true" : "false"}, ${index})`,
).join(",\n");

const totals = ACHIEVEMENTS.reduce(
  (acc, a) => ({ coins: acc.coins + a.coins, xp: acc.xp + a.xp }),
  { coins: 0, xp: 0 },
);

const sql = `-- =============================================================================
-- DRAFT WAR V3 — Phase 9: the achievement catalog.
--
-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/game/achievements.ts   Regenerate: npm run seed:achievements
--
-- ${ACHIEVEMENTS.length} achievements worth ${totals.coins.toLocaleString("en-US")} coins and ${totals.xp.toLocaleString("en-US")} XP in total.
--
-- Run after 0012_achievements.sql. Idempotent: existing rows are updated in
-- place and nobody's unlocks are touched.
-- =============================================================================

insert into achievements (id, name, description, category, tier, metric, threshold,
                          reward_coins, reward_xp, reward_item, hidden, sort)
values
${values}
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  tier = excluded.tier,
  metric = excluded.metric,
  threshold = excluded.threshold,
  reward_coins = excluded.reward_coins,
  reward_xp = excluded.reward_xp,
  reward_item = excluded.reward_item,
  hidden = excluded.hidden,
  sort = excluded.sort,
  is_active = true;

-- Everyone who has already been playing gets what they have already earned.
-- The evaluation is idempotent, so this is safe to run again.
select dw_evaluate_achievements(id) from profiles;
`;

const out = join(process.cwd(), "supabase", "migrations", "0013_seed_achievements.sql");
writeFileSync(out, sql);
console.log(`Wrote ${ACHIEVEMENTS.length} achievements to ${out}`);
