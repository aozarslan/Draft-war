-- =============================================================================
-- DRAFT WAR V4 — Phase 4: rematch, head to head, public match pages.
--
-- All three are read models or thin wrappers over data the game already
-- writes. `match_history` has every finish, `battle_results` has every battle,
-- `team_characters` has every roster — a rivalry record and a shareable match
-- page are questions to ask of that, not new things to store.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rematch
--
-- The same people, immediately again, with the category decided up front so
-- nobody has to negotiate it twice. Returns the room to the lobby exactly as
-- `dw_return_to_lobby` does — that function is the one that knows how to reset
-- a room, and duplicating it here would be two places to keep correct.
-- ---------------------------------------------------------------------------

create or replace function dw_rematch(
  p_room_id uuid, p_player_id uuid, p_mode text default 'SAME'
) returns jsonb language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  v_previous text[];
  v_next text[];
  v_reset jsonb;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can start a rematch.');
  end if;

  -- Remember what was just played before the reset clears it.
  v_previous := v_room.category_ids;

  v_reset := dw_return_to_lobby(p_room_id, p_player_id);
  if coalesce((v_reset->>'ok')::boolean, false) is not true then
    return v_reset;
  end if;

  if upper(coalesce(p_mode, 'SAME')) = 'SAME' and coalesce(array_length(v_previous, 1), 0) > 0 then
    -- Straight back in on the same category: the common case after a close
    -- game, and the one that should take the fewest taps.
    update rooms
       set category_ids = v_previous,
           config = jsonb_set(config, '{categoryMode}', '"HOST"', true)
     where id = p_room_id;
    v_next := v_previous;

  elsif upper(coalesce(p_mode, 'SAME')) = 'RANDOM' then
    update rooms
       set config = jsonb_set(config, '{categoryMode}', '"RANDOM"', true)
     where id = p_room_id;

  else
    -- NEW: leave it open so the lobby asks again.
    update rooms
       set config = jsonb_set(config, '{categoryMode}', '"HOST"', true)
     where id = p_room_id;
  end if;

  perform dw_event(null, p_room_id, 'REMATCH',
    jsonb_build_object('mode', upper(coalesce(p_mode, 'SAME')),
                       'categoryIds', to_jsonb(coalesce(v_next, '{}'::text[]))));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'mode', upper(coalesce(p_mode, 'SAME')),
                            'categoryIds', to_jsonb(coalesce(v_next, '{}'::text[])));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Head to head
--
-- Two players who keep meeting deserve a record of it. Derived from
-- match_history: every row already says who finished where in which game, so a
-- rivalry is a self-join over the games both of them were in.
-- ---------------------------------------------------------------------------

create index if not exists idx_match_history_game on match_history (game_id);

create or replace function dw_head_to_head(p_profile_id uuid, p_rival_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_me profiles%rowtype;
  v_them profiles%rowtype;
  v_stats record;
  v_recent jsonb;
begin
  select * into v_me from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;
  select * into v_them from profiles where id = p_rival_id;
  if not found then return dw_err('NO_SUCH_PLAYER', 'Nobody plays under that name.'); end if;

  select
    count(*)                                                as matches,
    count(*) filter (where a.placement < b.placement)       as my_wins,
    count(*) filter (where b.placement < a.placement)       as their_wins,
    count(*) filter (where a.placement = 1)                 as my_firsts,
    count(*) filter (where b.placement = 1)                 as their_firsts,
    count(*) filter (where a.is_mvp)                        as my_mvps,
    count(*) filter (where b.is_mvp)                        as their_mvps,
    round(avg(a.team_rating), 0)                            as my_power,
    round(avg(b.team_rating), 0)                            as their_power
  into v_stats
  from match_history a
  join match_history b on b.game_id = a.game_id and b.profile_id = p_rival_id
  where a.profile_id = p_profile_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'gameId', a.game_id, 'at', a.created_at,
      'categoryIds', to_jsonb(a.category_ids),
      'mine', a.placement, 'theirs', b.placement,
      'winner', case when a.placement < b.placement then v_me.username else v_them.username end
    ) order by a.created_at desc), '[]'::jsonb) into v_recent
  from (select * from match_history where profile_id = p_profile_id
         order by created_at desc limit 200) a
  join match_history b on b.game_id = a.game_id and b.profile_id = p_rival_id
  limit 10;

  return jsonb_build_object(
    'ok', true,
    'me', jsonb_build_object('id', v_me.id, 'username', v_me.username,
                             'avatar', v_me.avatar, 'frame', v_me.frame),
    'rival', jsonb_build_object('id', v_them.id, 'username', v_them.username,
                                'avatar', v_them.avatar, 'frame', v_them.frame),
    'matches', coalesce(v_stats.matches, 0),
    'myWins', coalesce(v_stats.my_wins, 0),
    'theirWins', coalesce(v_stats.their_wins, 0),
    'myFirsts', coalesce(v_stats.my_firsts, 0),
    'theirFirsts', coalesce(v_stats.their_firsts, 0),
    'myMvps', coalesce(v_stats.my_mvps, 0),
    'theirMvps', coalesce(v_stats.their_mvps, 0),
    'myAveragePower', coalesce(v_stats.my_power, 0),
    'theirAveragePower', coalesce(v_stats.their_power, 0),
    'recent', v_recent);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Public match page
--
-- A finished game, readable by anybody with the link. Deliberately only
-- finished games: an in-progress match would leak rosters and credits to
-- somebody who is not playing.
--
-- Nothing private travels — usernames and nicknames the players chose, what
-- they drafted and what happened. No tokens, no profile ids beyond what the
-- public profile already shows.
-- ---------------------------------------------------------------------------

create or replace function dw_public_match(p_game_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  g games%rowtype;
  v_room rooms%rowtype;
  v_teams jsonb;
  v_result jsonb;
begin
  select * into g from games where id = p_game_id;
  if not found then return dw_err('MATCH_NOT_FOUND', 'No such match.'); end if;
  if g.battle_result is null then
    return dw_err('MATCH_UNFINISHED', 'That match has not finished yet.');
  end if;

  select * into v_room from rooms where id = g.room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', p.id, 'nickname', p.nickname, 'colorIndex', p.color_index,
      'formation', p.formation,
      -- The profile's public face, when the seat had one.
      'username', pr.username, 'avatar', pr.avatar, 'frame', pr.frame,
      'title', pr.title, 'level', pr.level,
      'roster', coalesce((
        select jsonb_agg(jsonb_build_object('characterId', tc.character_id, 'price', tc.price)
                         order by tc.price desc)
        from team_characters tc
        where tc.game_id = g.id and tc.player_id = p.id), '[]'::jsonb),
      'spent', coalesce((select sum(tc.price) from team_characters tc
                          where tc.game_id = g.id and tc.player_id = p.id), 0)
    ) order by p.seat), '[]'::jsonb) into v_teams
  from players p
  left join profiles pr on pr.id = p.profile_id
  where p.room_id = g.room_id;

  v_result := g.battle_result;

  return jsonb_build_object(
    'ok', true,
    'gameId', g.id,
    'roomCode', v_room.code,
    'playedAt', coalesce(g.finished_at, g.created_at),
    'categoryIds', to_jsonb(g.category_ids),
    'mapId', g.map_id,
    'eventId', g.event_id,
    'teams', v_teams,
    'result', jsonb_build_object(
      'winnerPlayerId', v_result->'winnerPlayerId',
      'upset', coalesce(v_result->'upset', 'false'::jsonb),
      'turningPoint', v_result->'turningPoint',
      'mvp', v_result->'mvp',
      'teams', v_result->'teams',
      'combatants', v_result->'combatants'),
    'moments', dw_auction_moments(g.id));
end $$;
