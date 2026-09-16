-- =============================================================================
-- 0038 — S8: final combat pairing + champion determination
--
-- BUG-1 (FINAL_COMBAT): after CHAMPIONSHIP the match entered FINAL_COMBAT, but
-- no matchup was ever created for the final fight, so `dw_advance_match_phase`
-- walked straight to MATCH_RESULTS with `champion_player_id` still null.
--
-- Root causes (three, all fixed here):
--
--  1. `dw_pair_round` refused any call outside MATCHMAKING phase, and its
--     idempotency check treated *any* existing row for the round as "already
--     done" — so R8 matchups would have blocked re-use even if the phase guard
--     were lifted. A new dedicated function handles the final.
--
--  2. The COMBAT guard in `dw_advance_match_phase` checked
--     `round_no = m.round_no` for both COMBAT and FINAL_COMBAT.  Because R8
--     matchups share the same round number, the guard saw "no unsettled
--     battles" and let the match leave FINAL_COMBAT immediately.  The guard is
--     split: regular COMBAT still uses `round_no`; FINAL_COMBAT uses the
--     dedicated `kind = 'FINAL'` column.
--
--  3. `champion_player_id` was never written.  The UPDATE in
--     `dw_advance_match_phase` now sets it when transitioning to MATCH_RESULTS,
--     reading the winner from the FINAL matchup (2-survivor case) or the value
--     written by `dw_pair_final_round` (1 / 3+ survivor cases).
--
-- Survivor rules:
--   1 alive  → direct champion, no matchup needed.
--   2 alive  → insert a FINAL matchup; fight resolves the champion.
--   3+ alive → highest HP wins; tiebreak: round_wins desc, player_id asc.
--              Champion is set directly, no matchup needed.
--
-- Three changes:
--  1. New `dw_pair_final_round` function.
--  2. `dw_advance_match_phase` — split COMBAT / FINAL_COMBAT guard; set
--     champion_player_id on MATCH_RESULTS.
--  3. `dw_match_tick` — separate FINAL_COMBAT recovery path.
--
-- Additive: one new function, two replaced at their existing signatures. Safe
-- to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. dw_pair_final_round — create the final matchup (or crown the champion)
-- ---------------------------------------------------------------------------

create or replace function dw_pair_final_round(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room     rooms%rowtype;
  m          matches%rowtype;
  v_live     int;
  v_champion uuid;
  v_a        uuid;
  v_b        uuid;
  v_idx      int;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  select * into m from matches where id = v_room.current_match_id for update;
  if not found then return dw_err('NO_MATCH', 'This room is not playing a match.'); end if;
  if m.status <> 'ACTIVE' then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if m.phase <> 'FINAL_COMBAT' then
    return dw_err('WRONG_PHASE', 'The match is not at its final combat.');
  end if;

  -- Idempotent: champion already set by a prior call (1 / 3+ survivor path),
  -- or the FINAL matchup was already inserted (2-survivor path).
  if m.champion_player_id is not null then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;
  if exists (select 1 from round_matchups where match_id = m.id and kind = 'FINAL') then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  select count(*) into v_live from match_players
   where match_id = m.id and eliminated_at is null and hp > 0;

  -- One survivor: they win outright, no fight needed.
  if v_live = 1 then
    select player_id into v_champion from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    update matches set champion_player_id = v_champion where id = m.id;
    perform dw_bump(p_room_id);
    return jsonb_build_object('ok', true, 'champion', v_champion, 'survivors', 1);
  end if;

  -- Three or more: highest HP wins. Tiebreak: round_wins desc, player_id asc.
  if v_live >= 3 then
    select player_id into v_champion from match_players
     where match_id = m.id and eliminated_at is null and hp > 0
     order by hp desc, round_wins desc, player_id asc
     limit 1;
    update matches set champion_player_id = v_champion where id = m.id;
    perform dw_bump(p_room_id);
    return jsonb_build_object('ok', true, 'champion', v_champion, 'survivors', v_live);
  end if;

  -- Exactly two survivors: insert a FINAL matchup; the fight decides the
  -- champion. pairing_index is the next available slot in this round so it
  -- cannot collide with any R-N regular matchup.
  select count(*) into v_idx from round_matchups
   where match_id = m.id and round_no = m.round_no;

  select player_id into v_a from match_players
   where match_id = m.id and eliminated_at is null and hp > 0
   order by player_id asc limit 1;

  select player_id into v_b from match_players
   where match_id = m.id and eliminated_at is null and hp > 0
     and player_id <> v_a
   limit 1;

  insert into round_matchups (match_id, round_no, pairing_index, player_a, player_b,
                              kind, round_live_count)
  values (m.id, m.round_no, v_idx, v_a, v_b, 'FINAL', 2);

  perform dw_event(null, p_room_id, 'FINAL_PAIRED', jsonb_build_object(
    'matchId', m.id, 'roundNo', m.round_no, 'playerA', v_a, 'playerB', v_b));
  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'playerA', v_a, 'playerB', v_b);
end $$;

-- ---------------------------------------------------------------------------
-- 2. dw_advance_match_phase — split guard; set champion on MATCH_RESULTS
-- ---------------------------------------------------------------------------

create or replace function dw_advance_match_phase(
  p_room_id uuid, p_player_id uuid, p_from text, p_to text,
  p_deadline_seconds int default null
) returns jsonb language plpgsql security definer as $$
declare
  v_room      rooms%rowtype;
  m           matches%rowtype;
  v_next      text;
  v_round     int;
  v_game      games%rowtype;
  v_live      int;
  v_champion  uuid;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if p_player_id is not null and v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  select * into m from matches where id = v_room.current_match_id for update;
  if not found then return dw_err('NO_MATCH', 'This room is not playing a match.'); end if;
  if m.status <> 'ACTIVE' then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;

  if m.phase <> p_from then
    return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
  end if;

  if p_player_id is null then
    if m.phase_deadline is not null then
      if now() < m.phase_deadline then
        return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
      end if;
    elsif m.phase <> 'AUCTION' then
      return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
    end if;
  else
    if now() < m.phase_started_at + dw_min_phase_dwell() then
      return dw_err('CONCURRENT_PHASE_ADVANCE',
                    'That phase only just started — the screen may be out of date.');
    end if;
  end if;

  if m.phase = 'AUCTION' then
    select * into v_game from games
     where match_id = m.id and round_no = m.round_no
     order by created_at desc limit 1;
    if not found then
      return dw_err('AUCTION_INCOMPLETE', 'The round draft has not opened yet.');
    end if;
    if v_game.status = 'ACTIVE' then
      return dw_err('AUCTION_INCOMPLETE', 'The round auction is still running.');
    end if;
  end if;

  if m.phase = 'MATCHMAKING' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live >= 2 and not exists (
      select 1 from round_matchups where match_id = m.id and round_no = m.round_no
    ) then
      return dw_err('NOT_PAIRED', 'This round has no matchups yet.');
    end if;
  end if;

  -- Regular COMBAT: every matchup of this round must be settled.
  if m.phase = 'COMBAT' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live >= 2 then
      if not exists (select 1 from round_matchups
                      where match_id = m.id and round_no = m.round_no) then
        return dw_err('COMBAT_INCOMPLETE', 'This round has no fights yet.');
      end if;
      if exists (select 1 from round_matchups
                  where match_id = m.id and round_no = m.round_no
                    and battle_result is null) then
        return dw_err('COMBAT_INCOMPLETE', 'Not every fight has finished.');
      end if;
    end if;
  end if;

  -- FINAL_COMBAT: for 2 survivors the FINAL matchup must be settled;
  -- for 3+ survivors the champion must already be set by dw_pair_final_round.
  -- 0 or 1 survivor: no fight was needed, let the transition through.
  if m.phase = 'FINAL_COMBAT' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live = 2 then
      if not exists (select 1 from round_matchups
                      where match_id = m.id and kind = 'FINAL') then
        return dw_err('COMBAT_INCOMPLETE', 'The final round has not been paired yet.');
      end if;
      if exists (select 1 from round_matchups
                  where match_id = m.id and kind = 'FINAL'
                    and battle_result is null) then
        return dw_err('COMBAT_INCOMPLETE', 'The final fight has not finished yet.');
      end if;
    elsif v_live >= 3 then
      if m.champion_player_id is null then
        return dw_err('COMBAT_INCOMPLETE', 'The champion has not been determined yet.');
      end if;
    end if;
  end if;

  v_next := dw_match_next_phase(m.phase, m.round_no, m.round_count);

  if m.phase = 'ROUND_END' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live < 2 then v_next := 'CHAMPIONSHIP'; end if;
  end if;
  if v_next is null then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if p_to is not null and p_to <> v_next then
    return dw_err('INVALID_TRANSITION', 'A match cannot go there from here.');
  end if;

  v_round := case when v_next = 'ROUND_START' then m.round_no + 1 else m.round_no end;

  -- On finishing: resolve champion from the FINAL fight winner (2-survivor path)
  -- or read the value dw_pair_final_round already set (1 / 3+ path).
  if v_next = 'MATCH_RESULTS' then
    select winner_player_id into v_champion
      from round_matchups where match_id = m.id and kind = 'FINAL' limit 1;
    v_champion := coalesce(v_champion, m.champion_player_id);
  end if;

  update matches
     set phase = v_next,
         round_no = v_round,
         phase_started_at = now(),
         phase_deadline = case when p_deadline_seconds is null then null
                               else now() + make_interval(secs => p_deadline_seconds) end,
         status = case when v_next = 'MATCH_RESULTS' then 'FINISHED' else status end,
         finished_at = case when v_next = 'MATCH_RESULTS' then now() else finished_at end,
         champion_player_id = case when v_next = 'MATCH_RESULTS'
                                   then v_champion
                                   else champion_player_id end
   where id = m.id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'phase', v_next, 'roundNo', v_round);
end $$;

-- ---------------------------------------------------------------------------
-- 3. dw_match_tick — separate FINAL_COMBAT recovery path
--
-- Regular COMBAT: fires NEEDS_COMBAT when round matchups are missing or
-- unsettled (existing behaviour, now explicitly COMBAT-only).
--
-- FINAL_COMBAT: fires NEEDS_COMBAT when the FINAL matchup is missing (pair
-- not yet done) or unsettled (fight not yet done).  The engine handles both
-- by calling pairFinalRound (idempotent) then resolveRoundCombat.
-- ---------------------------------------------------------------------------

create or replace function dw_match_tick(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  m      matches%rowtype;
  g      games%rowtype;
  a      auctions%rowtype;
  v_live int;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
  end if;

  select * into m from matches where id = v_room.current_match_id;
  if not found or m.status <> 'ACTIVE' then
    return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
  end if;

  if m.phase = 'AUCTION' then
    select * into g from games
     where match_id = m.id and round_no = m.round_no
     order by created_at desc limit 1;

    if not found then
      return jsonb_build_object('ok', true,
        'actions', jsonb_build_array('NEEDS_ROUND_AUCTION'),
        'phase', m.phase, 'roundNo', m.round_no);
    end if;

    if g.status = 'ACTIVE' then
      select * into a from auctions
       where game_id = g.id and status = 'ACTIVE'
       order by order_index desc limit 1;
      if found and now() >= a.ends_at then
        perform dw_resolve_auction(a.id);
        return jsonb_build_object('ok', true,
          'actions', jsonb_build_array('AUCTION_RESOLVED'),
          'phase', m.phase, 'roundNo', m.round_no);
      end if;
      return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
    end if;

    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('ROUND_AUCTION_COMPLETE'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  if m.phase = 'MATCHMAKING' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live >= 2 and not exists (
      select 1 from round_matchups where match_id = m.id and round_no = m.round_no
    ) then
      return jsonb_build_object('ok', true,
        'actions', jsonb_build_array('NEEDS_ROUND_PAIRING'),
        'phase', m.phase, 'roundNo', m.round_no);
    end if;
  end if;

  -- Regular COMBAT: a round with missing or unsettled matchups needs fights.
  if m.phase = 'COMBAT' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live >= 2 and (
      not exists (select 1 from round_matchups
                   where match_id = m.id and round_no = m.round_no)
      or exists (select 1 from round_matchups
                  where match_id = m.id and round_no = m.round_no
                    and battle_result is null)
    ) then
      return jsonb_build_object('ok', true,
        'actions', jsonb_build_array('NEEDS_COMBAT'),
        'phase', m.phase, 'roundNo', m.round_no);
    end if;
  end if;

  -- FINAL_COMBAT: fire NEEDS_COMBAT when the FINAL matchup is absent (pair
  -- needed) or present but unsettled (fight needed). The engine calls
  -- pairFinalRound (idempotent) then resolveRoundCombat.
  if m.phase = 'FINAL_COMBAT' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;
    if v_live >= 2 then
      if not exists (select 1 from round_matchups
                      where match_id = m.id and kind = 'FINAL')
         or exists (select 1 from round_matchups
                     where match_id = m.id and kind = 'FINAL'
                       and battle_result is null) then
        return jsonb_build_object('ok', true,
          'actions', jsonb_build_array('NEEDS_COMBAT'),
          'phase', m.phase, 'roundNo', m.round_no);
      end if;
    end if;
  end if;

  if m.phase_deadline is not null and now() >= m.phase_deadline then
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('MATCH_PHASE_EXPIRED'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
end $$;
