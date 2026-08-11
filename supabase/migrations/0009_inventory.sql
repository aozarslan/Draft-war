-- =============================================================================
-- DRAFT WAR V3 — Phase 7: inventory.
--
-- What a player owns and what they are wearing. Four slots — avatar, frame,
-- banner, title — and nothing in the catalog carries a stat, a credit or a bid
-- limit. There is no column here an item could use to affect a draft even if
-- somebody later wanted it to.
--
-- Ownership is a row in `profile_items`, written only by these functions on the
-- service role. Equipping checks that row first, so the worst a devtools user
-- can do is ask to wear something they do not own and be told no. What other
-- players see is read from the database, never from the wearer's browser.
--
-- The catalog itself is seeded by 0010, which is generated from
-- src/lib/game/items.ts so the two can never describe an item differently.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catalog and ownership
-- ---------------------------------------------------------------------------

create table if not exists catalog_items (
  id          text primary key,
  kind        text not null check (kind in ('AVATAR', 'FRAME', 'BANNER', 'TITLE')),
  name        text not null,
  description text not null default '',
  rarity      text not null default 'COMMON'
              check (rarity in ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')),
  -- Coin price. Zero means it is never sold: it is a default, or it is earned.
  price       int  not null default 0 check (price >= 0),
  source      text not null default 'SHOP'
              check (source in ('DEFAULT', 'SHOP', 'ACHIEVEMENT', 'SEASON', 'LEVEL')),
  requirement text,
  -- Presentation only: an emoji, a pair of gradient stops, a colour.
  payload     jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort        int not null default 0
);

create index if not exists idx_catalog_kind on catalog_items (kind, sort);

create table if not exists profile_items (
  profile_id  uuid not null references profiles(id) on delete cascade,
  item_id     text not null references catalog_items(id) on delete cascade,
  -- How it was obtained, and what obtained it (a purchase id, an achievement).
  source      text not null default 'SHOP',
  reference   text,
  acquired_at timestamptz not null default now(),
  primary key (profile_id, item_id)
);

create index if not exists idx_profile_items_profile
  on profile_items (profile_id, acquired_at desc);

-- The fourth slot. `avatar`, `banner` and `title` already exist on profiles.
alter table profiles add column if not exists frame text not null default 'frame-default';

alter table catalog_items enable row level security;
alter table profile_items enable row level security;

-- The catalog is public reference data, like `characters`: the shop has to be
-- readable before anything is bought. Ownership is not — no anon policy on
-- profile_items, so the browser cannot see or invent what it owns.
drop policy if exists "catalog readable" on catalog_items;
create policy "catalog readable" on catalog_items for select using (true);

-- ---------------------------------------------------------------------------
-- 2. Granting
--
-- The only way an item enters an inventory. Idempotent: granting the same item
-- twice is a no-op rather than an error, which is what lets a retried purchase
-- or a re-run achievement sweep be safe.
-- ---------------------------------------------------------------------------

create or replace function dw_grant_item(
  p_profile_id uuid,
  p_item_id    text,
  p_source     text default 'SHOP',
  p_reference  text default null
) returns jsonb language plpgsql security definer as $$
declare v_item catalog_items%rowtype; v_rows int := 0;
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest');
  end if;

  select * into v_item from catalog_items where id = p_item_id and is_active;
  if not found then
    return dw_err('ITEM_NOT_FOUND', 'That item does not exist.');
  end if;

  insert into profile_items (profile_id, item_id, source, reference)
  values (p_profile_id, p_item_id, coalesce(p_source, v_item.source), p_reference)
  on conflict (profile_id, item_id) do nothing;

  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok', true, 'granted', v_rows > 0,
                            'itemId', p_item_id, 'kind', v_item.kind);
end $$;

/** Everything marked DEFAULT, handed over in one go. Safe to call repeatedly. */
create or replace function dw_grant_defaults(p_profile_id uuid)
returns int language plpgsql security definer as $$
declare v_count int;
begin
  insert into profile_items (profile_id, item_id, source)
  select p_profile_id, id, 'DEFAULT' from catalog_items where source = 'DEFAULT' and is_active
  on conflict (profile_id, item_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Equipping
--
-- Ownership is checked here and nowhere else. The slot is decided by the
-- item's own kind, so a caller cannot put a banner in the avatar slot by
-- asking nicely.
-- ---------------------------------------------------------------------------

create or replace function dw_equip_item(
  p_profile_id uuid, p_token text, p_item_id text
) returns jsonb language plpgsql security definer as $$
declare v_item catalog_items%rowtype; v_ok boolean;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into v_item from catalog_items where id = p_item_id and is_active;
  if not found then
    return dw_err('ITEM_NOT_FOUND', 'That item does not exist.');
  end if;

  if not exists (
    select 1 from profile_items where profile_id = p_profile_id and item_id = p_item_id
  ) then
    return dw_err('NOT_OWNED', 'You do not own that yet.');
  end if;

  update profiles
     set avatar = case when v_item.kind = 'AVATAR' then p_item_id else avatar end,
         frame  = case when v_item.kind = 'FRAME'  then p_item_id else frame  end,
         banner = case when v_item.kind = 'BANNER' then p_item_id else banner end,
         title  = case when v_item.kind = 'TITLE'  then p_item_id else title  end,
         last_active_at = now()
   where id = p_profile_id;

  return jsonb_build_object('ok', true, 'slot', v_item.kind, 'itemId', p_item_id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Reads
-- ---------------------------------------------------------------------------

create or replace function dw_inventory(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare v_profile profiles%rowtype; v_owned jsonb;
begin
  select * into v_profile from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', pi.item_id, 'kind', c.kind, 'source', pi.source,
      'acquiredAt', pi.acquired_at
    ) order by pi.acquired_at desc), '[]'::jsonb) into v_owned
  from profile_items pi join catalog_items c on c.id = pi.item_id
  where pi.profile_id = p_profile_id;

  return jsonb_build_object(
    'ok', true,
    'owned', v_owned,
    'equipped', jsonb_build_object(
      'AVATAR', v_profile.avatar, 'FRAME', v_profile.frame,
      'BANNER', v_profile.banner, 'TITLE', v_profile.title));
end $$;

-- ---------------------------------------------------------------------------
-- 5. New profiles start dressed
--
-- Same function as 0007 with the loadout and the default grant added. The
-- avatar argument is now an item id; anything unrecognised falls back rather
-- than storing a value nothing can render.
-- ---------------------------------------------------------------------------

create or replace function dw_create_profile(p_username text, p_avatar text, p_token text)
returns jsonb language plpgsql security definer as $$
declare v_id uuid; v_name text; v_avatar text;
begin
  v_name := trim(p_username);
  if v_name !~ '^[A-Za-z0-9_]{3,16}$' then
    return dw_err('INVALID_USERNAME',
      'Usernames are 3-16 characters: letters, numbers and underscores.');
  end if;
  if exists (select 1 from profiles where username_lower = lower(v_name)) then
    return dw_err('USERNAME_TAKEN', 'That username is already taken.');
  end if;

  -- Only a real, free avatar may be chosen at sign-up. Anything else, and the
  -- catalog not being seeded yet, lands on the house default.
  select id into v_avatar from catalog_items
   where id = p_avatar and kind = 'AVATAR' and source = 'DEFAULT' and is_active;
  v_avatar := coalesce(v_avatar, 'avatar-target');

  insert into profiles (username, username_lower, avatar, frame, banner, title)
  values (v_name, lower(v_name), v_avatar, 'frame-default', 'banner-default', 'title-rookie')
  returning id into v_id;

  insert into profile_secrets (profile_id, token) values (v_id, p_token);
  insert into profile_stats (profile_id) values (v_id);
  perform dw_grant_defaults(v_id);

  return jsonb_build_object('ok', true, 'profileId', v_id, 'username', v_name,
                            'avatar', v_avatar);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The profile read carries the loadout
--
-- Same function as 0008 plus the frame slot, so the header, the profile page
-- and the results screen all dress a player from one source.
-- ---------------------------------------------------------------------------

create or replace function dw_profile(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_profile profiles%rowtype;
  v_stats profile_stats%rowtype;
  v_season seasons%rowtype;
  v_sp season_players%rowtype;
  v_history jsonb;
  v_items int;
begin
  select * into v_profile from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;

  select * into v_stats from profile_stats where profile_id = p_profile_id;
  select * into v_season from seasons where is_active order by number desc limit 1;
  if v_season.id is not null then
    select * into v_sp from season_players
     where season_id = v_season.id and profile_id = p_profile_id;
  end if;
  select count(*) into v_items from profile_items where profile_id = p_profile_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'gameId', h.game_id, 'roomCode', h.room_code, 'categoryIds', to_jsonb(h.category_ids),
      'mapId', h.map_id, 'eventId', h.event_id, 'placement', h.placement,
      'playerCount', h.player_count, 'isMvp', h.is_mvp, 'mvpCharacter', h.mvp_character,
      'creditsSpent', h.credits_spent, 'xp', h.xp_awarded, 'coins', h.coins_awarded,
      'rankDelta', h.rank_delta,
      'ranked', h.ranked, 'roster', h.roster, 'at', h.created_at
    ) order by h.created_at desc), '[]'::jsonb) into v_history
  from (select * from match_history where profile_id = p_profile_id
        order by created_at desc limit 20) h;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', v_profile.id, 'username', v_profile.username, 'avatar', v_profile.avatar,
      'frame', v_profile.frame, 'banner', v_profile.banner, 'title', v_profile.title,
      'level', v_profile.level, 'xp', v_profile.xp, 'coins', v_profile.coins,
      'items', v_items,
      'createdAt', v_profile.created_at, 'lastActiveAt', v_profile.last_active_at),
    'stats', jsonb_build_object(
      'matches', coalesce(v_stats.matches, 0), 'wins', coalesce(v_stats.wins, 0),
      'losses', coalesce(v_stats.losses, 0), 'topThree', coalesce(v_stats.top_three, 0),
      'mvps', coalesce(v_stats.mvps, 0),
      'charactersDrafted', coalesce(v_stats.characters_drafted, 0),
      'creditsSpent', coalesce(v_stats.credits_spent, 0),
      'mostExpensivePrice', coalesce(v_stats.most_expensive_price, 0),
      'mostExpensiveName', v_stats.most_expensive_name,
      'bestRankPoints', coalesce(v_stats.best_rank_points, 0)),
    'season', case when v_season.id is null then null else jsonb_build_object(
      'id', v_season.id, 'number', v_season.number, 'name', v_season.name,
      'endsAt', v_season.ends_at,
      'rankPoints', coalesce(v_sp.rank_points, 0),
      'bestRankPoints', coalesce(v_sp.best_rank_points, 0),
      'matches', coalesce(v_sp.matches, 0), 'wins', coalesce(v_sp.wins, 0),
      'mvps', coalesce(v_sp.mvps, 0)) end,
    'history', v_history);
end $$;

-- The leaderboard shows a player as they dress themselves.
create or replace function dw_leaderboard(p_limit int default 50)
returns jsonb language plpgsql stable security definer as $$
declare v_season seasons%rowtype; v_rows jsonb;
begin
  select * into v_season from seasons where is_active order by number desc limit 1;
  if v_season.id is null then
    return jsonb_build_object('ok', true, 'season', null, 'entries', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'profileId', p.id, 'username', p.username, 'avatar', p.avatar,
      'frame', p.frame, 'level', p.level, 'title', p.title,
      'rankPoints', sp.rank_points, 'wins', sp.wins,
      'matches', sp.matches, 'mvps', sp.mvps
    ) order by sp.rank_points desc, sp.wins desc, p.username), '[]'::jsonb)
    into v_rows
  from (select * from season_players
         where season_id = v_season.id and matches > 0
         order by rank_points desc, wins desc
         limit greatest(1, least(200, p_limit))) sp
  join profiles p on p.id = sp.profile_id;

  return jsonb_build_object(
    'ok', true,
    'season', jsonb_build_object('number', v_season.number, 'name', v_season.name,
                                 'endsAt', v_season.ends_at),
    'entries', v_rows);
end $$;
