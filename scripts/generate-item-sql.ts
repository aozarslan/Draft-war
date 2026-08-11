/**
 * Regenerates `supabase/migrations/0010_seed_items.sql` from the cosmetic
 * catalog in `src/lib/game/items.ts`.
 *
 *   npm run seed:items
 *
 * Same contract as the character seed: the statement is an idempotent UPSERT,
 * so re-running it after adding or repricing an item updates the row in place
 * and never touches anybody's inventory. Items are retired by setting
 * `is_active = false`, never deleted — somebody may be wearing one.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ITEMS } from "../src/lib/game/items";

const q = (s: string | null | undefined) =>
  s === null || s === undefined ? "null" : `'${s.replace(/'/g, "''")}'`;
const json = (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;

const seen = new Set<string>();
for (const item of ITEMS) {
  if (seen.has(item.id)) throw new Error(`Duplicate item id: ${item.id}`);
  seen.add(item.id);
}

const values = ITEMS.map(
  (item, index) =>
    `  (${q(item.id)}, ${q(item.kind)}, ${q(item.name)}, ${q(item.description)}, ` +
    `${q(item.rarity)}, ${item.price}, ${q(item.source)}, ${q(item.requirement ?? null)}, ` +
    `${json(item.payload)}, ${index})`,
).join(",\n");

const counts = ITEMS.reduce<Record<string, number>>((acc, i) => {
  acc[i.kind] = (acc[i.kind] ?? 0) + 1;
  return acc;
}, {});

const sql = `-- =============================================================================
-- DRAFT WAR V3 — Phase 7: the cosmetic catalog.
--
-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/game/items.ts   Regenerate: npm run seed:items
--
-- ${ITEMS.length} items: ${Object.entries(counts)
  .map(([k, n]) => `${n} ${k.toLowerCase()}`)
  .join(", ")}.
--
-- Idempotent upsert. Run it after 0009_inventory.sql, and again whenever the
-- catalog changes — existing rows are updated in place and no inventory is
-- disturbed.
-- =============================================================================

insert into catalog_items (id, kind, name, description, rarity, price, source, requirement, payload, sort)
values
${values}
on conflict (id) do update set
  kind = excluded.kind,
  name = excluded.name,
  description = excluded.description,
  rarity = excluded.rarity,
  price = excluded.price,
  source = excluded.source,
  requirement = excluded.requirement,
  payload = excluded.payload,
  sort = excluded.sort,
  is_active = true;

-- ---------------------------------------------------------------------------
-- Backfill: dress the profiles that existed before the catalog did.
--
-- Every profile gets the free items, and a profile still storing a raw emoji
-- in \`avatar\` (the pre-inventory shape) is matched to the item that carries
-- that emoji. Anything unrecognised falls back to the house default rather
-- than being left pointing at nothing.
-- ---------------------------------------------------------------------------

insert into profile_items (profile_id, item_id, source)
select p.id, c.id, 'DEFAULT'
  from profiles p cross join catalog_items c
 where c.source = 'DEFAULT' and c.is_active
on conflict (profile_id, item_id) do nothing;

update profiles p
   set avatar = coalesce(
     (select c.id from catalog_items c
       where c.kind = 'AVATAR' and c.payload->>'emoji' = p.avatar limit 1),
     'avatar-target')
 where p.avatar is null
    or not exists (select 1 from catalog_items c where c.id = p.avatar and c.kind = 'AVATAR');

update profiles set frame = 'frame-default'
 where frame is null
    or not exists (select 1 from catalog_items c where c.id = profiles.frame and c.kind = 'FRAME');

update profiles set banner = 'banner-default'
 where banner is null
    or not exists (select 1 from catalog_items c where c.id = profiles.banner and c.kind = 'BANNER');

-- A legacy title was free text and nobody had one, so an unrecognised value is
-- simply cleared back to the starter title.
update profiles set title = 'title-rookie'
 where title is null
    or not exists (select 1 from catalog_items c where c.id = profiles.title and c.kind = 'TITLE');
`;

const out = join(process.cwd(), "supabase", "migrations", "0010_seed_items.sql");
writeFileSync(out, sql);
console.log(`Wrote ${ITEMS.length} items to ${out}`);
for (const [kind, n] of Object.entries(counts)) console.log(`  ${kind.padEnd(7)} ${n}`);
