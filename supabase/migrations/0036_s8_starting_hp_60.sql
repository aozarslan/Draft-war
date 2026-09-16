-- ---------------------------------------------------------------------------
-- 0036 — Starting HP 80 → 60
--
-- Balance sweep (S8.6b, 1600 matches) showed:
--   HP=80: winner keeps ~66-73% of starting HP; 3p has only 60% of matches
--          with any elimination; 2p has just 21%.
--   HP=60: ≥89% of matches have ≥1 elimination, first elimination falls on
--          R6.5-6.9 on average, winner finishes at ~48-64% of starting HP,
--          and <3% of 4-5p matches end early.
--
-- Only dw_start_match is touched. All other functions that read hp from
-- match_players are unaffected.
-- ---------------------------------------------------------------------------

create or replace function dw_start_match(
  p_room_id uuid, p_player_id uuid, p_seed text,
  p_round_count int, p_category_ids text[], p_intro_seconds int default 8
) returns jsonb language plpgsql security definer as $$
declare
  v_room    rooms%rowtype;
  v_players int;
  v_unready int;
  v_no      int;
  v_match   uuid;
  v_credits int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can start a match.');
  end if;
  if v_room.phase <> 'LOBBY' then
    return dw_err('WRONG_PHASE', 'A match can only start from the lobby.');
  end if;

  select count(*) into v_players from players where room_id = p_room_id;
  if v_players < coalesce((v_room.config->>'minPlayers')::int, 2) then
    return dw_err('NOT_ENOUGH_PLAYERS', 'Not enough players to start.');
  end if;

  select count(*) into v_unready from players where room_id = p_room_id and is_ready = false;
  if v_unready > 0 then return dw_err('NOT_ALL_READY', 'Everyone must be ready.'); end if;

  if p_round_count is null or p_round_count < 1 or p_round_count > 12 then
    return dw_err('BAD_ROUND_COUNT', 'A match runs between 1 and 12 rounds.');
  end if;

  v_credits := coalesce((v_room.config->>'startingCredits')::int, 50);
  select coalesce(max(match_no), 0) + 1 into v_no from matches where room_id = p_room_id;

  insert into matches (room_id, match_no, seed, round_count, category_ids,
                       phase, round_no, phase_deadline)
  values (p_room_id, v_no, p_seed, p_round_count, coalesce(p_category_ids, '{}'),
          'MATCH_INTRO', 0, now() + make_interval(secs => greatest(1, p_intro_seconds)))
  returning id into v_match;

  -- 60, measured. S8.6b balance sweep: at 80 winner keeps ~70% of HP and
  -- 3-player matches rarely eliminate anyone. At 60 the elimination rate
  -- reaches ≥89% across all formats with first elimination at R6-R7.
  insert into match_players (match_id, player_id, hp, credits)
  select v_match, p.id, 60, v_credits from players p where p.room_id = p_room_id;

  update players set is_ready = false where room_id = p_room_id;
  update rooms set phase = 'MATCH', current_match_id = v_match where id = p_room_id;

  perform dw_event(null, p_room_id, 'MATCH_STARTED', jsonb_build_object(
    'matchId', v_match, 'matchNo', v_no, 'players', v_players,
    'rounds', p_round_count, 'categoryIds', to_jsonb(coalesce(p_category_ids, '{}'::text[]))));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'matchId', v_match, 'roundCount', p_round_count);
end $$;
