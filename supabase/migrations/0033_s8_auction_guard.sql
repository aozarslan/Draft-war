-- =============================================================================
-- 0033 — the round draft cannot be walked past
--
-- Found in production. A three-player match reached POSITIONING on round one
-- with zero acquisitions, no `games` row and nothing on screen: the round's
-- draft had never opened, and the host's "next" walked the match straight
-- through the auction phase.
--
-- The guard 0032 installed refused to leave an auction that was *running*:
--
--     if found and v_game.status = 'ACTIVE' then ... AUCTION_INCOMPLETE
--
-- `found` is false when no draft row exists at all, so the one case that
-- actually needed stopping — a draft that never started — was the one case it
-- let through. The pairing guard immediately below it in the same function got
-- this right, using `not exists`; the two were written two milestones apart and
-- never compared.
--
-- The recovery path was already there and is unchanged: `dw_match_tick` reports
-- NEEDS_ROUND_AUCTION for a round at AUCTION with no draft, and the engine
-- opens one. What was missing is that nothing stopped the host from outrunning
-- it.
--
-- Function replacement only. No table, no column, no data touched. Every other
-- guard 0032 established is carried over verbatim.
-- =============================================================================

create or replace function dw_advance_match_phase(
  p_room_id uuid, p_player_id uuid, p_from text, p_to text,
  p_deadline_seconds int default null
) returns jsonb language plpgsql security definer as $$
declare
  v_room   rooms%rowtype;
  m        matches%rowtype;
  v_next   text;
  v_round  int;
  v_game   games%rowtype;
  v_live   int;
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

    -- A round whose draft never opened is not a round with nothing to draft.
    -- 0032 only refused to leave a *running* auction, so when the draft failed
    -- to open there was no row, `found` was false, and the host walked straight
    -- past it: a match reached POSITIONING with zero acquisitions and nothing
    -- to show. The pairing guard below already had this right two migrations
    -- ago; this is the same shape, applied where it was missing.
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

  v_next := dw_match_next_phase(m.phase, m.round_no, m.round_count);
  if v_next is null then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if p_to is not null and p_to <> v_next then
    return dw_err('INVALID_TRANSITION', 'A match cannot go there from here.');
  end if;

  v_round := case when v_next = 'ROUND_START' then m.round_no + 1 else m.round_no end;

  update matches
     set phase = v_next,
         round_no = v_round,
         phase_started_at = now(),
         phase_deadline = case when p_deadline_seconds is null then null
                               else now() + make_interval(secs => p_deadline_seconds) end,
         status = case when v_next = 'MATCH_RESULTS' then 'FINISHED' else status end,
         finished_at = case when v_next = 'MATCH_RESULTS' then now() else finished_at end
   where id = m.id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'phase', v_next, 'roundNo', v_round);
end $$;
