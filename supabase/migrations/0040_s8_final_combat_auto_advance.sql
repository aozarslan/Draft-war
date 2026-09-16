-- =============================================================================
-- 0040 — S8: auto-advance FINAL_COMBAT → MATCH_RESULTS
--
-- After 0038 the final fight is correctly paired, fought, and blocked from
-- skipping — but leaving the phase requires a host click ("Next · Results").
-- This leaves two gaps:
--
--  1. The 2-survivor path: once the fight settles, v_live drops to 1 and the
--     NEEDS_COMBAT block (v_live >= 2) no longer fires, so the tick returns
--     nothing and the match waits indefinitely for the host to click.
--
--  2. The 1 / 3+ survivor paths: pairFinalRound sets champion_player_id
--     without a fight.  v_live is never 2, so NEEDS_COMBAT also never fires
--     once the champion is set — the same infinite wait as gap 1.  Before the
--     champion is set, NEEDS_COMBAT does not fire either, so a failed
--     pairFinalRound call is never retried.
--
-- Fix:
--
--  `dw_match_tick` — rework the FINAL_COMBAT block so it:
--    • still fires NEEDS_COMBAT when the 2-survivor fight is pending (pair or
--      fight not done) — unchanged for that path;
--    • fires NEEDS_COMBAT for 1 / 3+ survivors if champion_player_id is null
--      (retries the pairFinalRound call that set it);
--    • fires FINAL_COMBAT_DONE when the round is fully resolved on any path.
--
--  `dw_advance_match_phase` — allow a null-player (tick-driven) advance out
--  of FINAL_COMBAT.  The existing guard already enforces that the fight must be
--  settled before the transition proceeds; this only removes the blanket
--  "tick cannot advance non-timed phases" check for this one phase.
--
-- Both functions are replaced at their existing signatures. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. dw_match_tick — FINAL_COMBAT_DONE action
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

  -- FINAL_COMBAT: three distinct states, handled in order.
  --
  --   2 survivors and fight pending  → NEEDS_COMBAT  (pair + resolve)
  --   1 / 3+ survivors, no champion → NEEDS_COMBAT  (retry pairFinalRound)
  --   any path, fully resolved      → FINAL_COMBAT_DONE (auto-advance)
  --
  -- The engine's NEEDS_COMBAT handler calls pairFinalRound (idempotent) then
  -- resolveRoundCombat.  For the 1 / 3+ paths resolveRoundCombat is a noop
  -- because there is no unsettled FINAL matchup.
  if m.phase = 'FINAL_COMBAT' then
    select count(*) into v_live from match_players
     where match_id = m.id and eliminated_at is null and hp > 0;

    if v_live = 2 then
      -- Pair or fight not done yet.
      if not exists (select 1 from round_matchups
                      where match_id = m.id and kind = 'FINAL')
         or exists (select 1 from round_matchups
                     where match_id = m.id and kind = 'FINAL'
                       and battle_result is null) then
        return jsonb_build_object('ok', true,
          'actions', jsonb_build_array('NEEDS_COMBAT'),
          'phase', m.phase, 'roundNo', m.round_no);
      end if;
      -- 2-survivor fight settled — ready to advance.
      return jsonb_build_object('ok', true,
        'actions', jsonb_build_array('FINAL_COMBAT_DONE'),
        'phase', m.phase, 'roundNo', m.round_no);
    end if;

    -- 1 or 3+ survivors: pairFinalRound crowns the champion without a fight.
    -- Retry if it has not run yet (or failed on the first attempt).
    if m.champion_player_id is null then
      return jsonb_build_object('ok', true,
        'actions', jsonb_build_array('NEEDS_COMBAT'),
        'phase', m.phase, 'roundNo', m.round_no);
    end if;
    -- Champion already set — ready to advance.
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('FINAL_COMBAT_DONE'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  if m.phase_deadline is not null and now() >= m.phase_deadline then
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('MATCH_PHASE_EXPIRED'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 2. dw_advance_match_phase — allow tick-driven advance for FINAL_COMBAT
--
-- The existing guard stops a null-player (tick-driven) call from advancing
-- any non-timed, non-AUCTION phase.  FINAL_COMBAT now has its own completion
-- signal (FINAL_COMBAT_DONE above), so it must be treated like AUCTION: the
-- tick drives it, not a deadline.
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
    -- AUCTION and FINAL_COMBAT are driven by their own completion signals, not
    -- a deadline.  All other non-timed phases must be advanced by the host.
    elsif m.phase not in ('AUCTION', 'FINAL_COMBAT') then
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
