-- =============================================================================
-- 0035 — S8.5c: ghost rounds
--
-- Replaces the bye/encounter system with the ghost board: the odd seat fights
-- a deterministic copy of another live player's board rather than getting a
-- free round. Three changes:
--
--  1. `round_matchups.ghost_player_id` — which real player was ghosted.
--     Null for ordinary duels and for rows from before this migration.
--
--  2. `dw_resolve_matchup` — gains an optional `p_ghost_player_id` parameter.
--     Stored as-is: no foreign-key check, just "whose board was it?"
--     The ghost owner's HP and stats are never touched here.
--
--  3. `dw_match_snapshot` — exposes `ghostPlayerId` in the matchups array.
--
-- Additive: one column added (nullable, no default required), two functions
-- replaced at compatible signatures. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------

alter table round_matchups
  add column if not exists ghost_player_id uuid references players(id);

-- ---------------------------------------------------------------------------
-- 2. dw_resolve_matchup (add p_ghost_player_id parameter)
-- ---------------------------------------------------------------------------

create or replace function dw_resolve_matchup(
  p_room_id uuid,
  p_pairing_index int,
  p_result jsonb,
  p_winner_player_id uuid,
  p_loser_player_id uuid,
  p_damage int,
  p_ghost_player_id uuid default null
) returns jsonb language plpgsql security definer as $$
declare
  v_room  rooms%rowtype;
  m       matches%rowtype;
  r       round_matchups%rowtype;
  v_hp    int;
  v_floor int;
  v_out   int;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  select * into m from matches where id = v_room.current_match_id;
  if not found then return dw_err('NO_MATCH', 'This room is not playing a match.'); end if;
  if m.status <> 'ACTIVE' then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if m.phase not in ('COMBAT', 'FINAL_COMBAT') then
    return dw_err('WRONG_PHASE', 'The round is not at its combat.');
  end if;

  -- The matchup's own row, not the match's. Two matchups of one round can
  -- resolve at the same time without waiting on each other, and neither can
  -- resolve twice.
  select * into r from round_matchups
   where match_id = m.id and round_no = m.round_no and pairing_index = p_pairing_index
   for update;
  if not found then
    return dw_err('NO_MATCHUP', 'There is no such matchup in this round.');
  end if;

  -- Already fought. The second caller gets the first one's answer.
  if r.battle_result is not null then
    return jsonb_build_object('ok', true, 'noop', true, 'alreadyResolved', true,
      'matchupId', r.id, 'winnerPlayerId', r.winner_player_id, 'damage', r.damage);
  end if;

  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    return dw_err('BAD_RESULT', 'A matchup needs a battle result.');
  end if;

  -- Whoever is named has to be one of the two seats this matchup is between.
  if p_winner_player_id is not null
     and p_winner_player_id is distinct from r.player_a
     and p_winner_player_id is distinct from r.player_b then
    return dw_err('BAD_RESULT', 'That winner is not in this matchup.');
  end if;
  if p_loser_player_id is not null
     and p_loser_player_id is distinct from r.player_a
     and p_loser_player_id is distinct from r.player_b then
    return dw_err('BAD_RESULT', 'That loser is not in this matchup.');
  end if;
  if p_loser_player_id is not null and p_loser_player_id = p_winner_player_id then
    return dw_err('BAD_RESULT', 'One seat cannot be both.');
  end if;

  update round_matchups
     set battle_result    = p_result,
         winner_player_id = p_winner_player_id,
         ghost_player_id  = p_ghost_player_id,
         damage           = greatest(0, coalesce(p_damage, 0)),
         started_at       = coalesce(started_at, now()),
         settled_at       = now()
   where id = r.id;

  if p_winner_player_id is not null then
    update match_players
       set round_wins = round_wins + 1,
           streak     = streak + 1
     where match_id = m.id and player_id = p_winner_player_id;
  end if;

  if p_loser_player_id is not null then
    -- Nobody leaves the table in the first five rounds; before then a loss
    -- floors at one rather than killing.
    v_floor := case when m.round_no >= 6 then 0 else 1 end;

    update match_players
       set hp     = greatest(v_floor, hp - greatest(0, coalesce(p_damage, 0))),
           streak = 0
     where match_id = m.id and player_id = p_loser_player_id
    returning hp, eliminated_at into v_hp, v_out;

    -- Written once. A seat that is already out cannot be put out again, and a
    -- second resolution cannot reach here anyway.
    if v_hp <= 0 and v_out is null then
      update match_players
         set eliminated_at = m.round_no
       where match_id = m.id and player_id = p_loser_player_id
         and eliminated_at is null;
    end if;
  end if;

  perform dw_event(null, p_room_id, 'MATCHUP_RESOLVED', jsonb_build_object(
    'matchId', m.id, 'roundNo', m.round_no, 'pairingIndex', p_pairing_index,
    'winnerPlayerId', p_winner_player_id, 'loserPlayerId', p_loser_player_id,
    'damage', greatest(0, coalesce(p_damage, 0))));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'matchupId', r.id,
    'winnerPlayerId', p_winner_player_id, 'damage', greatest(0, coalesce(p_damage, 0)),
    'loserHp', v_hp);
end $$;

-- ---------------------------------------------------------------------------
-- 3. dw_match_snapshot (expose ghostPlayerId)
-- ---------------------------------------------------------------------------

create or replace function dw_match_snapshot(
  p_room_id uuid
) returns jsonb language plpgsql security definer as $$
declare
  v_room  rooms%rowtype;
  m       matches%rowtype;
  g       games%rowtype;
  v_players  jsonb;
  v_board    jsonb;
  v_matchups jsonb;
  v_acq      jsonb;
  v_pending  jsonb;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return jsonb_build_object('ok', true, 'match', null);
  end if;

  select * into m from matches where id = v_room.current_match_id;
  if not found then return jsonb_build_object('ok', true, 'match', null); end if;

  select * into g from games
   where match_id = m.id and round_no = m.round_no
   order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', mp.player_id,
      'hp', mp.hp,
      'credits', mp.credits,
      'roundWins', mp.round_wins,
      'streak', mp.streak,
      'eliminatedAt', mp.eliminated_at,
      'modifiers', mp.modifiers
    ) order by p.seat), '[]'::jsonb) into v_players
  from match_players mp
  join players p on p.id = mp.player_id
  where mp.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', b.player_id, 'characterId', b.character_id,
      'zone', b.zone, 'slot', b.slot
    ) order by b.player_id, b.slot), '[]'::jsonb) into v_board
  from board_slots b where b.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'roundNo', r.round_no, 'pairingIndex', r.pairing_index,
      'playerA', r.player_a, 'playerB', r.player_b, 'kind', r.kind,
      'ratingA', r.rating_a, 'ratingB', r.rating_b, 'reason', r.reason,
      'ghostPlayerId', r.ghost_player_id,
      -- The whole stored result, so the replay reads the fight that happened
      -- rather than running one of its own.
      'battleResult', r.battle_result,
      'startedAt', r.started_at, 'settledAt', r.settled_at,
      'winnerPlayerId', r.winner_player_id, 'damage', r.damage
    ) order by r.round_no, r.pairing_index), '[]'::jsonb) into v_matchups
  from round_matchups r where r.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'roundNo', ma.round_no, 'playerId', ma.player_id,
      'characterId', ma.character_id, 'price', ma.final_price,
      'acquiredAt', ma.acquired_at
    ) order by ma.round_no, ma.acquired_at), '[]'::jsonb) into v_acq
  from match_acquisitions ma where ma.match_id = m.id;

  select coalesce(jsonb_agg(mp.player_id), '[]'::jsonb) into v_pending
  from match_players mp
  where mp.match_id = m.id
    and mp.eliminated_at is null
    and g.id is not null
    and not exists (select 1 from team_characters t
                     where t.game_id = g.id and t.player_id = mp.player_id);

  return jsonb_build_object('ok', true, 'match', jsonb_build_object(
    'id', m.id,
    'matchNo', m.match_no,
    'status', m.status,
    'phase', m.phase,
    'roundNo', m.round_no,
    'totalRounds', m.round_count,
    'seed', m.seed,
    'categoryIds', to_jsonb(m.category_ids),
    'phaseDeadline', m.phase_deadline,
    'phaseStartedAt', m.phase_started_at,
    'championPlayerId', m.champion_player_id,
    'roundGameId', g.id,
    'roundAuctionStatus', g.status,
    'acquisitionRequired', dw_acquisition_required(m.round_no),
    'pendingPlayerIds', coalesce(v_pending, '[]'::jsonb),
    'acquisitions', v_acq,
    'players', v_players,
    'board', v_board,
    'matchups', v_matchups
  ));
end $$;
