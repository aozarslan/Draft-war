-- =============================================================================
-- DRAFT WAR V5 — Milestone 11: let a shared match play back.
--
-- `dw_public_match` already returns the log and the combatants; what it never
-- returned was `durationMs`. A finished match plays on a *local* clock rather
-- than the room's server clock — there is no live battle to stay in step with
-- — and a local clock has to know where the end is.
--
-- Everything added here is already inside `games.battle_result`. Nothing is
-- computed, no column is added, no table is created and the result stays the
-- one immutable record. This function only stops withholding four of its
-- fields.
--
-- Otherwise byte-identical to 0028: copied from that file rather than retyped,
-- for the same reason 0028 was copied from 0022 — rewriting a working function
-- from memory is how the host check nearly went missing from
-- dw_return_to_lobby.
--
-- Security is unchanged: read-only, `stable`, `security definer`, and it still
-- refuses matches that have not finished. Nothing newly exposed is private —
-- a duration, a rules version, the seed the players' own battle ran on, and
-- two award picks every player saw on the results screen.
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
      'log', v_result->'log',
      -- Four more fields that already live inside `battle_result`. A finished
      -- match plays back on its own local clock, and a local clock needs to
      -- know how long the battle was: `durationMs` is the one field a public
      -- replay cannot do without and the one field this function was not
      -- forwarding. The rest come along because they are the same read, and
      -- fetching them later would mean a second migration for nothing.
      --
      -- `awards` is the engine's own pick of best performer and biggest
      -- surprise. Without it a shared result would have to work them out for
      -- itself, which is exactly the second source of truth this project
      -- refuses; with it, the summary is a copy.
      'durationMs', v_result->'durationMs',
      'rulesVersion', v_result->'rulesVersion',
      'seed', v_result->'seed',
      'awards', v_result->'awards'),
    'moments', dw_auction_moments(g.id));
end $$;
