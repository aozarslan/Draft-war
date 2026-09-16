-- =============================================================================
-- 0039 — S8: raise room capacity to six players
--
-- The existing `dw_set_max_players` rejects p_max > 5.  The host UI now shows
-- a sixth button; raising the SQL limit makes the call succeed.
--
-- `dw_join_room` reads `maxPlayers` from the room config JSON and never has an
-- explicit upper-bound check — the room's own config is the limit — so no
-- change is needed there.
--
-- One function replaced at its existing signature. Safe to re-run.
-- =============================================================================

create or replace function dw_set_max_players(
  p_room_id uuid, p_player_id uuid, p_max int
) returns jsonb
language plpgsql security definer as $$
declare
  v_room    rooms%rowtype;
  v_players int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can change the room size.');
  end if;
  if v_room.phase <> 'LOBBY' then
    return dw_err('WRONG_PHASE', 'The room size is locked once the game starts.');
  end if;
  if p_max < 2 or p_max > 6 then
    return dw_err('BAD_SIZE', 'A room holds between 2 and 6 players.');
  end if;

  select count(*) into v_players from players where room_id = p_room_id;
  if p_max < v_players then
    return dw_err('TOO_MANY_PLAYERS',
      'There are already ' || v_players || ' players in the room.');
  end if;

  update rooms
     set config = jsonb_set(config, '{maxPlayers}', to_jsonb(p_max), true)
   where id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'maxPlayers', p_max);
end $$;
