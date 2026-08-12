-- =============================================================================
-- DRAFT WAR V4 — Phase 4: private leagues.
--
-- A named, long-running competition for one group of friends. "DRAFT NIGHT",
-- five members, a table that means something after twenty games.
--
-- The one design decision worth stating: **which matches count is derived, not
-- tagged.** A game counts for a league if at least two of its members played
-- in it and it finished inside the league's window. Nobody has to remember to
-- mark a room as a league game, there is no state to get wrong, and a match
-- played before somebody joined does not retroactively appear — because the
-- rule is evaluated against the games themselves, every time.
--
-- The alternative, a league_id on the room, would be one more thing to set
-- correctly at the exact moment everybody is trying to start playing.
--
-- Additive and safe to re-run.
-- =============================================================================

create table if not exists leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Short, shareable, and the only way in. No directory, same as friends.
  code        text not null unique,
  owner_id    uuid not null references profiles(id) on delete cascade,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint league_name_shape check (char_length(trim(name)) between 3 and 32)
);

create table if not exists league_members (
  league_id  uuid not null references leagues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (league_id, profile_id)
);

create index if not exists idx_league_members_profile on league_members (profile_id);

alter table leagues        enable row level security;
alter table league_members enable row level security;
-- Server-only. A league is private: who is in it and how they are doing comes
-- back through our API, never through the anon key.

/**
 * A short join code. Ambiguous characters are left out — these get read aloud
 * and typed on phones.
 */
create or replace function dw_league_code()
returns text language plpgsql as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  i int;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    end loop;
    exit when not exists (select 1 from leagues where code = v_code);
  end loop;
  return v_code;
end $$;

create or replace function dw_create_league(
  p_profile_id uuid, p_token text, p_name text
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean; v_id uuid; v_code text; v_name text; v_count int;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) < 3 or char_length(v_name) > 32 then
    return dw_err('BAD_NAME', 'A league name is 3 to 32 characters.');
  end if;

  -- A cap, so one account cannot fill the table with empty leagues.
  select count(*) into v_count from leagues where owner_id = p_profile_id;
  if v_count >= 10 then
    return dw_err('TOO_MANY_LEAGUES', 'You already run ten leagues.');
  end if;

  v_code := dw_league_code();
  insert into leagues (name, code, owner_id) values (v_name, v_code, p_profile_id)
  returning id into v_id;
  insert into league_members (league_id, profile_id) values (v_id, p_profile_id);

  return jsonb_build_object('ok', true, 'leagueId', v_id, 'code', v_code, 'name', v_name);
end $$;

create or replace function dw_join_league(
  p_profile_id uuid, p_token text, p_code text
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean; l leagues%rowtype; v_size int;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into l from leagues where code = upper(trim(coalesce(p_code, '')));
  if not found then return dw_err('NO_SUCH_LEAGUE', 'No league with that code.'); end if;

  if exists (select 1 from league_members
              where league_id = l.id and profile_id = p_profile_id) then
    return jsonb_build_object('ok', true, 'leagueId', l.id, 'alreadyIn', true);
  end if;

  select count(*) into v_size from league_members where league_id = l.id;
  if v_size >= 50 then return dw_err('LEAGUE_FULL', 'That league is full.'); end if;

  insert into league_members (league_id, profile_id) values (l.id, p_profile_id);

  perform dw_notify(l.owner_id, 'LEAGUE_JOINED',
    (select username from profiles where id = p_profile_id) || ' joined ' || l.name || '.',
    '', jsonb_build_object('leagueId', l.id));

  return jsonb_build_object('ok', true, 'leagueId', l.id, 'name', l.name);
end $$;

create or replace function dw_leave_league(
  p_profile_id uuid, p_token text, p_league_id uuid
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean; l leagues%rowtype;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into l from leagues where id = p_league_id;
  if not found then return dw_err('NO_SUCH_LEAGUE', 'No such league.'); end if;

  -- The owner leaving takes the league with them; leaving it ownerless would
  -- be a table nobody can administer.
  if l.owner_id = p_profile_id then
    delete from leagues where id = p_league_id;
    return jsonb_build_object('ok', true, 'deleted', true);
  end if;

  delete from league_members where league_id = p_league_id and profile_id = p_profile_id;
  return jsonb_build_object('ok', true, 'left', true);
end $$;

-- ---------------------------------------------------------------------------
-- Standings
--
-- Derived from match_history. A game counts when at least two members played
-- in it and it finished inside the league's window — so the table is always
-- the truth about the games that actually happened, and joining late does not
-- award anybody points for matches they were not in.
-- ---------------------------------------------------------------------------

create or replace function dw_league_standings(p_league_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare l leagues%rowtype; v_rows jsonb; v_games int;
begin
  select * into l from leagues where id = p_league_id;
  if not found then return dw_err('NO_SUCH_LEAGUE', 'No such league.'); end if;

  with members as (
    select profile_id, joined_at from league_members where league_id = p_league_id
  ),
  -- Games with at least two members in them, inside the window.
  counted as (
    select h.game_id
      from match_history h join members m on m.profile_id = h.profile_id
     where h.created_at >= l.starts_at
       and (l.ends_at is null or h.created_at <= l.ends_at)
     group by h.game_id
    having count(*) >= 2
  ),
  rows as (
    select
      p.id, p.username, p.avatar, p.frame, p.title, p.level,
      count(*)                                          as matches,
      count(*) filter (where h.placement = 1)           as wins,
      count(*) filter (where h.is_mvp)                  as mvps,
      -- The same 3/2/1/0 the battle already awards, so a league table and a
      -- room's season table cannot disagree about what a result was worth.
      sum(case h.placement when 1 then 3 when 2 then 2 when 3 then 1 else 0 end) as points,
      round(avg(h.team_rating), 0)                      as avg_power,
      round(avg(case when h.credits_spent > 0
                     then h.team_rating / h.credits_spent end)::numeric, 2) as avg_efficiency
      from match_history h
      join counted c on c.game_id = h.game_id
      join members m on m.profile_id = h.profile_id
      join profiles p on p.id = h.profile_id
     group by p.id, p.username, p.avatar, p.frame, p.title, p.level
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'profileId', id, 'username', username, 'avatar', avatar, 'frame', frame,
      'title', title, 'level', level,
      'matches', matches, 'wins', wins, 'mvps', mvps, 'points', points,
      'averagePower', avg_power, 'draftEfficiency', avg_efficiency
    ) order by points desc, wins desc, mvps desc, username), '[]'::jsonb)
    into v_rows
  from rows;

  select count(*) into v_games from (
    select h.game_id from match_history h
      join league_members m on m.profile_id = h.profile_id and m.league_id = p_league_id
     where h.created_at >= l.starts_at
       and (l.ends_at is null or h.created_at <= l.ends_at)
     group by h.game_id having count(*) >= 2
  ) t;

  return jsonb_build_object(
    'ok', true,
    'league', jsonb_build_object(
      'id', l.id, 'name', l.name, 'code', l.code, 'ownerId', l.owner_id,
      'startsAt', l.starts_at, 'endsAt', l.ends_at),
    'members', (select count(*) from league_members where league_id = p_league_id),
    'games', coalesce(v_games, 0),
    'standings', v_rows);
end $$;

/** Every league this profile belongs to, with a one-line summary. */
create or replace function dw_my_leagues(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'code', l.code,
      'isOwner', l.owner_id = p_profile_id,
      'members', (select count(*) from league_members lm where lm.league_id = l.id),
      'joinedAt', m.joined_at
    ) order by m.joined_at), '[]'::jsonb) into v_rows
  from league_members m join leagues l on l.id = m.league_id
  where m.profile_id = p_profile_id;

  return jsonb_build_object('ok', true, 'leagues', v_rows);
end $$;
