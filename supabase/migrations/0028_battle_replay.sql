-- =============================================================================
-- DRAFT WAR V5 — Milestone 2: expose the battle log on shared matches.
--
-- One field. `dw_public_match` already returns the standings, the combatants,
-- the MVP, the turning point and the upset flag — everything except the event
-- stream that makes a replay watchable.
--
-- No schema change, no new table, and no second copy of the result:
-- `games.battle_result` stays the one immutable record and this reads out of
-- it. The replay stays a projection.
--
-- The function is otherwise byte-identical to 0022: it was copied from that
-- file rather than retyped, because rewriting a working function from memory
-- is how the host check nearly went missing from dw_return_to_lobby.
--
-- Security is unchanged. This is a read-only, `stable` function that still
-- refuses matches which have not finished, so an in-progress game cannot leak
-- a roster to somebody who is not playing.
--
-- Additive and safe to re-run.
-- =============================================================================

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
      'combatants', v_result->'combatants',
      -- The event log, so a shared match can be watched rather than only
      -- read. Already inside `battle_result`; this only stops withholding
      -- it. Nothing private travels with it: every entry is a character
      -- id, a player id and a number the players all saw live.
      'log', v_result->'log'),
    'moments', dw_auction_moments(g.id));
end $$;
