-- =============================================================================
-- DRAFT WAR V3 — Phase 3/4/5: persistent profiles, XP and levels, ranks and
-- seasons.
--
-- Design rules carried over from the rest of the schema:
--   * The client is never trusted. XP, levels, rank points and season records
--     are only ever written by functions in here, called with the service role.
--   * Every award is idempotent. A battle that gets stored twice, or a tick
--     that races another client, must not pay out twice.
--   * Playing without an account keeps working exactly as it does today. A
--     profile is an optional attachment to a seat, not a requirement for one.
--
-- Additive and safe to re-run. No existing table is altered destructively.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id             uuid primary key default gen_random_uuid(),
  username       text not null,
  -- Case-insensitive uniqueness without depending on the citext extension.
  username_lower text not null unique,
  avatar         text not null default 'default',
  banner         text not null default 'default',
  title          text,
  level          int  not null default 1,
  xp             bigint not null default 0,
  coins          bigint not null default 0,
  is_guest       boolean not null default false,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  constraint profiles_username_shape check (username ~ '^[A-Za-z0-9_]{3,16}$')
);

-- The session secret lives apart from the profile, exactly like player_secrets,
-- so a leaked read of `profiles` can never be used to act as somebody.
create table if not exists profile_secrets (
  profile_id uuid primary key references profiles(id) on delete cascade,
  token      text not null
);

-- Lifetime statistics. Kept as a separate row so a season reset never touches
-- them and so the profile row stays small and hot.
create table if not exists profile_stats (
  profile_id            uuid primary key references profiles(id) on delete cascade,
  matches               int not null default 0,
  wins                  int not null default 0,
  losses                int not null default 0,
  top_three             int not null default 0,
  mvps                  int not null default 0,
  characters_drafted    int not null default 0,
  credits_spent         bigint not null default 0,
  most_expensive_price  int not null default 0,
  most_expensive_name   text,
  best_rank_points      int not null default 0,
  updated_at            timestamptz not null default now()
);

-- A seat in a room may belong to a profile. Null means a guest is playing.
alter table players add column if not exists profile_id uuid references profiles(id) on delete set null;
create index if not exists idx_players_profile on players (profile_id);

create index if not exists idx_profiles_active on profiles (last_active_at desc);

-- ---------------------------------------------------------------------------
-- 2. Seasons and competitive rank
-- ---------------------------------------------------------------------------

create table if not exists seasons (
  id         uuid primary key default gen_random_uuid(),
  number     int not null unique,
  name       text not null,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists season_players (
  season_id        uuid not null references seasons(id) on delete cascade,
  profile_id       uuid not null references profiles(id) on delete cascade,
  rank_points      int not null default 0,
  best_rank_points int not null default 0,
  matches          int not null default 0,
  wins             int not null default 0,
  mvps             int not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (season_id, profile_id)
);

create index if not exists idx_season_players_board
  on season_players (season_id, rank_points desc, wins desc);

-- ---------------------------------------------------------------------------
-- 3. Ledgers
--
-- An immutable record of every award. This is what makes the economy
-- auditable, and the unique index on (profile_id, match_id, kind) is what makes
-- paying out twice impossible rather than merely unlikely.
-- ---------------------------------------------------------------------------

create table if not exists xp_transactions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  amount     int not null,
  kind       text not null,
  match_id   uuid references games(id) on delete set null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_xp_once_per_match
  on xp_transactions (profile_id, match_id, kind)
  where match_id is not null;

create index if not exists idx_xp_profile on xp_transactions (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Match history
-- ---------------------------------------------------------------------------

create table if not exists match_history (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  profile_id    uuid not null references profiles(id) on delete cascade,
  room_code     text,
  category_ids  text[] not null default '{}',
  map_id        text,
  event_id      text,
  placement     int not null,
  player_count  int not null,
  is_mvp        boolean not null default false,
  mvp_character text,
  team_rating   numeric,
  credits_spent int not null default 0,
  xp_awarded    int not null default 0,
  rank_delta    int not null default 0,
  ranked        boolean not null default false,
  roster        jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  unique (game_id, profile_id)
);

create index if not exists idx_match_history_profile
  on match_history (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Row Level Security — everything server-only
-- ---------------------------------------------------------------------------

alter table profiles         enable row level security;
alter table profile_secrets  enable row level security;
alter table profile_stats    enable row level security;
alter table seasons          enable row level security;
alter table season_players   enable row level security;
alter table xp_transactions  enable row level security;
alter table match_history    enable row level security;

-- No anon policies at all: the browser cannot read or write any of this. Every
-- read the UI needs comes back through our own API on the service role, which
-- is what stops "coins = 999999" from devtools.

-- ---------------------------------------------------------------------------
-- 6. Season helper
-- ---------------------------------------------------------------------------

create or replace function dw_current_season()
returns seasons language plpgsql as $$
declare s seasons%rowtype;
begin
  select * into s from seasons
   where is_active and now() between starts_at and ends_at
   order by number desc limit 1;

  if not found then
    insert into seasons (number, name, starts_at, ends_at)
    values (
      coalesce((select max(number) from seasons), 0) + 1,
      'Season ' || (coalesce((select max(number) from seasons), 0) + 1),
      now(), now() + interval '45 days')
    on conflict (number) do nothing
    returning * into s;

    if s.id is null then
      select * into s from seasons order by number desc limit 1;
    end if;
  end if;

  return s;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Profile lifecycle
-- ---------------------------------------------------------------------------

create or replace function dw_create_profile(p_username text, p_avatar text, p_token text)
returns jsonb language plpgsql security definer as $$
declare v_id uuid; v_name text;
begin
  v_name := trim(p_username);
  if v_name !~ '^[A-Za-z0-9_]{3,16}$' then
    return dw_err('INVALID_USERNAME',
      'Usernames are 3-16 characters: letters, numbers and underscores.');
  end if;
  if exists (select 1 from profiles where username_lower = lower(v_name)) then
    return dw_err('USERNAME_TAKEN', 'That username is already taken.');
  end if;

  insert into profiles (username, username_lower, avatar)
  values (v_name, lower(v_name), coalesce(nullif(p_avatar, ''), 'default'))
  returning id into v_id;

  insert into profile_secrets (profile_id, token) values (v_id, p_token);
  insert into profile_stats (profile_id) values (v_id);

  return jsonb_build_object('ok', true, 'profileId', v_id, 'username', v_name);
end $$;

create or replace function dw_touch_profile(p_profile_id uuid, p_token text)
returns jsonb language plpgsql security definer as $$
declare v_ok boolean;
begin
  select true into v_ok
    from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;
  update profiles set last_active_at = now() where id = p_profile_id;
  return jsonb_build_object('ok', true);
end $$;

/** Attaches a profile to the seat a player already holds in a room. */
create or replace function dw_link_player_profile(
  p_player_id uuid, p_profile_id uuid, p_token text
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;
  update players set profile_id = p_profile_id where id = p_player_id;
  update profiles set last_active_at = now() where id = p_profile_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Match rewards
--
-- Called once per finished battle. Idempotent twice over: the unique index on
-- xp_transactions rejects a repeat, and match_history has a unique
-- (game_id, profile_id).
-- ---------------------------------------------------------------------------
create or replace function dw_award_match(
  p_game_id uuid, p_profile_id uuid, p_xp int, p_rank_delta int,
  p_ranked boolean, p_summary jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_season seasons%rowtype;
  v_new_points int;
  v_before int := 0;
  v_level int;
  v_xp bigint;
  v_inserted boolean := false;
begin
  -- A guest seat has no profile; that is normal and not an error.
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest');
  end if;
  -- Rewards are always tied to a real match, which is what makes them
  -- idempotent. Refuse rather than write an unattributable row.
  if p_game_id is null then
    return dw_err('INVALID_MATCH', 'Rewards must reference a finished match.');
  end if;

  -- The ledger is the lock: a second call for the same match does nothing.
  begin
    insert into xp_transactions (profile_id, amount, kind, match_id, detail)
    values (p_profile_id, greatest(0, p_xp), 'MATCH', p_game_id, p_summary);
    v_inserted := true;
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'alreadyAwarded', true);
  end;

  update profiles
     set xp = xp + greatest(0, p_xp),
         last_active_at = now()
   where id = p_profile_id
  returning xp into v_xp;

  -- Level curve mirrors xpForLevel() in src/lib/game/progression.ts:
  -- each level costs 100 XP more than the one before it.
  v_level := 1;
  while (select sum(400 + 100 * (i - 1)) from generate_series(2, v_level + 1) i) <= v_xp
        and v_level < 200 loop
    v_level := v_level + 1;
  end loop;
  update profiles set level = v_level where id = p_profile_id;

  update profile_stats
     set matches = matches + 1,
         wins = wins + case when (p_summary->>'placement')::int = 1 then 1 else 0 end,
         losses = losses + case when (p_summary->>'placement')::int = 1 then 0 else 1 end,
         top_three = top_three + case when (p_summary->>'placement')::int <= 3 then 1 else 0 end,
         mvps = mvps + case when coalesce((p_summary->>'isMvp')::boolean, false) then 1 else 0 end,
         characters_drafted = characters_drafted + coalesce((p_summary->>'charactersDrafted')::int, 0),
         credits_spent = credits_spent + coalesce((p_summary->>'creditsSpent')::int, 0),
         most_expensive_price = greatest(most_expensive_price,
                                         coalesce((p_summary->>'mostExpensivePrice')::int, 0)),
         most_expensive_name = case
           when coalesce((p_summary->>'mostExpensivePrice')::int, 0) > most_expensive_price
             then p_summary->>'mostExpensiveName' else most_expensive_name end,
         updated_at = now()
   where profile_id = p_profile_id;

  if p_ranked then
    v_season := dw_current_season();

    insert into season_players (season_id, profile_id)
    values (v_season.id, p_profile_id)
    on conflict (season_id, profile_id) do nothing;

    select rank_points into v_before
      from season_players where season_id = v_season.id and profile_id = p_profile_id;

    v_new_points := greatest(0, coalesce(v_before, 0) + p_rank_delta);

    update season_players
       set rank_points = v_new_points,
           best_rank_points = greatest(best_rank_points, v_new_points),
           matches = matches + 1,
           wins = wins + case when (p_summary->>'placement')::int = 1 then 1 else 0 end,
           mvps = mvps + case when coalesce((p_summary->>'isMvp')::boolean, false) then 1 else 0 end,
           updated_at = now()
     where season_id = v_season.id and profile_id = p_profile_id;

    update profile_stats
       set best_rank_points = greatest(best_rank_points, v_new_points)
     where profile_id = p_profile_id;
  end if;

  insert into match_history (
    game_id, profile_id, room_code, category_ids, map_id, event_id,
    placement, player_count, is_mvp, mvp_character, team_rating,
    credits_spent, xp_awarded, rank_delta, ranked, roster
  ) values (
    p_game_id, p_profile_id,
    p_summary->>'roomCode',
    coalesce(array(select jsonb_array_elements_text(p_summary->'categoryIds')), '{}'),
    p_summary->>'mapId', p_summary->>'eventId',
    coalesce((p_summary->>'placement')::int, 0),
    coalesce((p_summary->>'playerCount')::int, 0),
    coalesce((p_summary->>'isMvp')::boolean, false),
    p_summary->>'mvpCharacter',
    (p_summary->>'teamRating')::numeric,
    coalesce((p_summary->>'creditsSpent')::int, 0),
    greatest(0, p_xp), p_rank_delta, p_ranked,
    coalesce(p_summary->'roster', '[]'::jsonb)
  ) on conflict (game_id, profile_id) do nothing;

  return jsonb_build_object(
    'ok', true, 'awarded', v_inserted,
    'xp', greatest(0, p_xp), 'totalXp', v_xp, 'level', v_level,
    'rankPointsBefore', coalesce(v_before, 0),
    'rankPointsAfter', coalesce(v_new_points, coalesce(v_before, 0)));
end $$;

-- ---------------------------------------------------------------------------
-- 9. Reads
-- ---------------------------------------------------------------------------

create or replace function dw_profile(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_profile profiles%rowtype;
  v_stats profile_stats%rowtype;
  v_season seasons%rowtype;
  v_sp season_players%rowtype;
  v_history jsonb;
begin
  select * into v_profile from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;

  select * into v_stats from profile_stats where profile_id = p_profile_id;
  select * into v_season from seasons where is_active order by number desc limit 1;
  if v_season.id is not null then
    select * into v_sp from season_players
     where season_id = v_season.id and profile_id = p_profile_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'gameId', h.game_id, 'roomCode', h.room_code, 'categoryIds', to_jsonb(h.category_ids),
      'mapId', h.map_id, 'eventId', h.event_id, 'placement', h.placement,
      'playerCount', h.player_count, 'isMvp', h.is_mvp, 'mvpCharacter', h.mvp_character,
      'creditsSpent', h.credits_spent, 'xp', h.xp_awarded, 'rankDelta', h.rank_delta,
      'ranked', h.ranked, 'roster', h.roster, 'at', h.created_at
    ) order by h.created_at desc), '[]'::jsonb) into v_history
  from (select * from match_history where profile_id = p_profile_id
        order by created_at desc limit 20) h;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', v_profile.id, 'username', v_profile.username, 'avatar', v_profile.avatar,
      'banner', v_profile.banner, 'title', v_profile.title,
      'level', v_profile.level, 'xp', v_profile.xp, 'coins', v_profile.coins,
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
      'level', p.level, 'title', p.title,
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
