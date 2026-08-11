-- =============================================================================
-- DRAFT WAR V3 — Phase 7: the cosmetic catalog.
--
-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/game/items.ts   Regenerate: npm run seed:items
--
-- 47 items: 24 avatar, 7 frame, 7 banner, 9 title.
--
-- Idempotent upsert. Run it after 0009_inventory.sql, and again whenever the
-- catalog changes — existing rows are updated in place and no inventory is
-- disturbed.
-- =============================================================================

insert into catalog_items (id, kind, name, description, rarity, price, source, requirement, payload, sort)
values
  ('avatar-target', 'AVATAR', 'Bullseye', 'Bullseye avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🎯"}'::jsonb, 0),
  ('avatar-flame', 'AVATAR', 'Flame', 'Flame avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🔥"}'::jsonb, 1),
  ('avatar-skull', 'AVATAR', 'Skull', 'Skull avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"💀"}'::jsonb, 2),
  ('avatar-crown', 'AVATAR', 'Crown', 'Crown avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"👑"}'::jsonb, 3),
  ('avatar-fox', 'AVATAR', 'Fox', 'Fox avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🦊"}'::jsonb, 4),
  ('avatar-wolf', 'AVATAR', 'Wolf', 'Wolf avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🐺"}'::jsonb, 5),
  ('avatar-bolt', 'AVATAR', 'Bolt', 'Bolt avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"⚡"}'::jsonb, 6),
  ('avatar-mask', 'AVATAR', 'Mask', 'Mask avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🎭"}'::jsonb, 7),
  ('avatar-shield', 'AVATAR', 'Shield', 'Shield avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🛡"}'::jsonb, 8),
  ('avatar-blade', 'AVATAR', 'Blade', 'Blade avatar.', 'COMMON', 0, 'DEFAULT', null, '{"emoji":"🗡"}'::jsonb, 9),
  ('avatar-raven', 'AVATAR', 'Raven', 'Raven avatar.', 'RARE', 400, 'SHOP', null, '{"emoji":"🐦‍⬛"}'::jsonb, 10),
  ('avatar-octopus', 'AVATAR', 'Deep Thinker', 'Deep Thinker avatar.', 'RARE', 400, 'SHOP', null, '{"emoji":"🐙"}'::jsonb, 11),
  ('avatar-moth', 'AVATAR', 'Nightmoth', 'Nightmoth avatar.', 'RARE', 400, 'SHOP', null, '{"emoji":"🦋"}'::jsonb, 12),
  ('avatar-mushroom', 'AVATAR', 'Spore', 'Spore avatar.', 'RARE', 400, 'SHOP', null, '{"emoji":"🍄"}'::jsonb, 13),
  ('avatar-robot', 'AVATAR', 'Unit 7', 'Unit 7 avatar.', 'RARE', 500, 'SHOP', null, '{"emoji":"🤖"}'::jsonb, 14),
  ('avatar-alien', 'AVATAR', 'Visitor', 'Visitor avatar.', 'RARE', 500, 'SHOP', null, '{"emoji":"👽"}'::jsonb, 15),
  ('avatar-dragon', 'AVATAR', 'Wyrm', 'Wyrm avatar.', 'EPIC', 1200, 'SHOP', null, '{"emoji":"🐉"}'::jsonb, 16),
  ('avatar-comet', 'AVATAR', 'Comet', 'Comet avatar.', 'EPIC', 1200, 'SHOP', null, '{"emoji":"☄️"}'::jsonb, 17),
  ('avatar-volcano', 'AVATAR', 'Caldera', 'Caldera avatar.', 'EPIC', 1400, 'SHOP', null, '{"emoji":"🌋"}'::jsonb, 18),
  ('avatar-galaxy', 'AVATAR', 'Spiral', 'Spiral avatar.', 'EPIC', 1400, 'SHOP', null, '{"emoji":"🌌"}'::jsonb, 19),
  ('avatar-phoenix', 'AVATAR', 'Ashborn', 'Ashborn avatar.', 'LEGENDARY', 3000, 'SHOP', null, '{"emoji":"🕊"}'::jsonb, 20),
  ('avatar-eclipse', 'AVATAR', 'Eclipse', 'Eclipse avatar.', 'LEGENDARY', 3000, 'SHOP', null, '{"emoji":"🌑"}'::jsonb, 21),
  ('avatar-gavel', 'AVATAR', 'The Gavel', 'For a player who has closed a lot of auctions.', 'EPIC', 0, 'ACHIEVEMENT', 'Win 10 matches', '{"emoji":"🔨"}'::jsonb, 22),
  ('avatar-vault', 'AVATAR', 'The Vault', 'Awarded for reaching level 10.', 'EPIC', 0, 'LEVEL', 'Reach level 10', '{"emoji":"🏦"}'::jsonb, 23),
  ('frame-default', 'FRAME', 'Standard', 'The frame every player starts with.', 'COMMON', 0, 'DEFAULT', null, '{"colour":"#ffffff","glow":"0","style":"solid"}'::jsonb, 24),
  ('frame-copper', 'FRAME', 'Copper Bid', 'A warm ring for a patient bidder.', 'COMMON', 250, 'SHOP', null, '{"colour":"#b45309","glow":"0","style":"solid"}'::jsonb, 25),
  ('frame-circuit', 'FRAME', 'Circuit', 'Cyan trace, faintly lit.', 'RARE', 700, 'SHOP', null, '{"colour":"#22d3ee","glow":"10","style":"solid"}'::jsonb, 26),
  ('frame-orchid', 'FRAME', 'Orchid', 'Violet, and slightly too pleased with itself.', 'RARE', 700, 'SHOP', null, '{"colour":"#a78bfa","glow":"10","style":"double"}'::jsonb, 27),
  ('frame-emberline', 'FRAME', 'Emberline', 'Burns quietly at the edge of the card.', 'EPIC', 1600, 'SHOP', null, '{"colour":"#fb7185","glow":"18","style":"double"}'::jsonb, 28),
  ('frame-goldleaf', 'FRAME', 'Gold Leaf', 'Reserved for people who close the deal.', 'LEGENDARY', 3500, 'SHOP', null, '{"colour":"#fbbf24","glow":"24","style":"double"}'::jsonb, 29),
  ('frame-champion', 'FRAME', 'Champion''s Ring', 'Given for finishing a season at Champion.', 'LEGENDARY', 0, 'SEASON', 'Finish a season at Champion', '{"colour":"#f0abfc","glow":"28","style":"double"}'::jsonb, 30),
  ('banner-default', 'BANNER', 'Midnight', 'The house colours.', 'COMMON', 0, 'DEFAULT', null, '{"from":"#0b1020","to":"#05060c","angle":135}'::jsonb, 31),
  ('banner-dusk', 'BANNER', 'Dusk Market', 'The hour when the bidding gets silly.', 'COMMON', 300, 'SHOP', null, '{"from":"#7c2d12","to":"#1e1b4b","angle":120}'::jsonb, 32),
  ('banner-signal', 'BANNER', 'Signal', 'Cyan on deep blue.', 'RARE', 800, 'SHOP', null, '{"from":"#0e7490","to":"#0b1020","angle":145}'::jsonb, 33),
  ('banner-nocturne', 'BANNER', 'Nocturne', 'Violet fading into nothing.', 'RARE', 800, 'SHOP', null, '{"from":"#4c1d95","to":"#05060c","angle":160}'::jsonb, 34),
  ('banner-arena', 'BANNER', 'Arena Lights', 'Two floodlights and a lot of noise.', 'EPIC', 1800, 'SHOP', null, '{"from":"#be123c","to":"#0f172a","angle":110}'::jsonb, 35),
  ('banner-aurora', 'BANNER', 'Aurora', 'Green over blue over black.', 'EPIC', 1800, 'SHOP', null, '{"from":"#059669","to":"#1e1b4b","angle":150}'::jsonb, 36),
  ('banner-sovereign', 'BANNER', 'Sovereign', 'Gold, and unembarrassed about it.', 'LEGENDARY', 4000, 'SHOP', null, '{"from":"#b45309","to":"#1c1917","angle":130}'::jsonb, 37),
  ('title-rookie', 'TITLE', 'Rookie', 'Everyone starts here.', 'COMMON', 0, 'DEFAULT', null, '{"text":"Rookie","colour":"#94a3b8"}'::jsonb, 38),
  ('title-bidder', 'TITLE', 'Bidder', 'You raise, therefore you are.', 'COMMON', 200, 'SHOP', null, '{"text":"Bidder","colour":"#94a3b8"}'::jsonb, 39),
  ('title-collector', 'TITLE', 'Collector', 'One of everything, please.', 'RARE', 600, 'SHOP', null, '{"text":"Collector","colour":"#22d3ee"}'::jsonb, 40),
  ('title-tactician', 'TITLE', 'Tactician', 'The plan survived contact.', 'RARE', 600, 'SHOP', null, '{"text":"Tactician","colour":"#22d3ee"}'::jsonb, 41),
  ('title-highroller', 'TITLE', 'High Roller', 'Budget is a suggestion.', 'EPIC', 1500, 'SHOP', null, '{"text":"High Roller","colour":"#a78bfa"}'::jsonb, 42),
  ('title-closer', 'TITLE', 'The Closer', 'Last bid, every time.', 'EPIC', 1500, 'SHOP', null, '{"text":"The Closer","colour":"#a78bfa"}'::jsonb, 43),
  ('title-kingmaker', 'TITLE', 'Kingmaker', 'Decides who wins. Rarely wins.', 'LEGENDARY', 3200, 'SHOP', null, '{"text":"Kingmaker","colour":"#fbbf24"}'::jsonb, 44),
  ('title-undefeated', 'TITLE', 'Undefeated', 'Won three matches in a row.', 'LEGENDARY', 0, 'ACHIEVEMENT', 'Win 3 matches in a row', '{"text":"Undefeated","colour":"#f0abfc"}'::jsonb, 45),
  ('title-veteran', 'TITLE', 'Veteran', 'Fifty matches played.', 'EPIC', 0, 'ACHIEVEMENT', 'Play 50 matches', '{"text":"Veteran","colour":"#a78bfa"}'::jsonb, 46)
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
-- in `avatar` (the pre-inventory shape) is matched to the item that carries
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
