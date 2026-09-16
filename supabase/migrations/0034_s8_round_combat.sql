-- =============================================================================
-- 0034 — S8.5b: round combat
--
-- The round loop finally has a fight in it. `round_matchups.battle_result`
-- stops being null, a loss costs life, and a life total that reaches zero puts
-- somebody out.
--
-- Four things, and one of them is a bug fix that is not optional:
--
--  1. `dw_resolve_matchup` — the battle result and the HP it costs, written in
--     ONE transaction under the matchup's own row lock. The invariant is
--     symmetric and absolute: a stored result implies the HP was applied, and
--     applied HP implies a stored result. There is no ordering of two RPCs that
--     can give you that, which is why this is a database function and not a
--     server sequence.
--
--  2. Board promotion. Until now the first five characters a player bought were
--     the only five that could ever fight: `dw_record_acquisition` wrote FRONT
--     for the first five and BENCH for the rest, and nothing ever moved a row
--     again. Rounds six to eight bought nothing. The strongest five now hold
--     the board and a stronger late pick displaces a weaker early one — a
--     deterministic stopgap that S8.4 replaces with the player's own choice.
--
--  3. A decided match stops. `ROUND_END` forks to `CHAMPIONSHIP` when fewer
--     than two seats remain, instead of walking empty rounds to round eight.
--
--  4. Starting life is 80, not 100. Measured against the real engine: at 100 a
--     five-player table loses one player all game and the final is four-handed;
--     at 60 one match in eight is over before round eight. At 80 the final has
--     about three players and eliminations spread across the last three rounds
--     rather than massing in the first round that allows them.
--
-- Additive: one function is new, four are replaced at their existing
-- signatures, no table or column is touched. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Starting life
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

  -- 80, measured. See the header: 100 leaves a five-player final four-handed,
  -- 60 ends one match in eight before the last round.
  insert into match_players (match_id, player_id, hp, credits)
  select v_match, p.id, 80, v_credits from players p where p.room_id = p_room_id;

  update players set is_ready = false where room_id = p_room_id;
  update rooms set phase = 'MATCH', current_match_id = v_match where id = p_room_id;

  perform dw_event(null, p_room_id, 'MATCH_STARTED', jsonb_build_object(
    'matchId', v_match, 'matchNo', v_no, 'players', v_players,
    'rounds', p_round_count, 'categoryIds', to_jsonb(coalesce(p_category_ids, '{}'::text[]))));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'matchId', v_match, 'roundCount', p_round_count);
end $$;

-- ---------------------------------------------------------------------------
-- 2. The strongest five hold the board
-- ---------------------------------------------------------------------------

create or replace function dw_record_acquisition(
  p_game_id uuid, p_auction_id uuid, p_player_id uuid, p_character_id text, p_price int
) returns void language plpgsql as $$
declare
  g     games%rowtype;
  v_own int;
begin
  select * into g from games where id = p_game_id;
  if g.match_id is null then return; end if;

  insert into match_acquisitions (match_id, round_no, game_id, auction_id,
                                  player_id, character_id, final_price, seed)
  values (g.match_id, g.round_no, p_game_id, p_auction_id,
          p_player_id, p_character_id, p_price, g.seed)
  on conflict (match_id, character_id) do nothing;

  select count(*) into v_own from board_slots
   where match_id = g.match_id and player_id = p_player_id;

  insert into board_slots (match_id, player_id, character_id, zone, slot)
  values (g.match_id, p_player_id, p_character_id,
          case when v_own < 5 then 'FRONT' else 'BENCH' end, v_own)
  on conflict (match_id, player_id, character_id) do nothing;

  -- The strongest five fight.
  --
  -- Before this, the first five bought were the only five that could ever
  -- fight and nothing moved them again, so a stronger character bought in
  -- round seven sat behind a weaker one bought in round two for the rest of
  -- the match — and the optional late rounds bought nothing at all.
  --
  -- Ordered by game power with the character id as the tie-break, so the same
  -- squad always produces the same board whatever order the rows come back in.
  -- Deliberately automatic and deliberately temporary: S8.4 turns this into the
  -- player's decision, and an automatic board is only better than a dead one.
  with ranked as (
    select b.character_id,
           row_number() over (
             order by coalesce(c.game_power, 0) desc, b.character_id asc
           ) as rn
      from board_slots b
      join characters c on c.id = b.character_id
     where b.match_id = g.match_id and b.player_id = p_player_id
  )
  update board_slots b
     set zone = case when r.rn <= 5 then 'FRONT' else 'BENCH' end,
         slot = r.rn - 1,
         updated_at = now()
    from ranked r
   where b.match_id = g.match_id
     and b.player_id = p_player_id
     and b.character_id = r.character_id;
end $$;
-- ---------------------------------------------------------------------------
-- 3. Resolving one matchup
--
-- The battle itself is computed in TypeScript, where the engine lives, where it
-- is pure and seeded, and where 31 mutations already hold its orchestration.
-- What arrives here is the finished result plus the two facts derived from it:
-- who lost, and what it costs them.
--
-- This function's whole job is to make that land exactly once, completely.
--
--   * the matchup row is locked, so two callers serialise on the row they are
--     both trying to write rather than on the match;
--   * `battle_result is not null` short-circuits to the stored result, so the
--     second caller gets the first caller's answer instead of a second fight;
--   * the result, the winner, the damage, the loser's HP, the streaks and the
--     elimination are one statement sequence in one transaction.
--
-- The invariant is symmetric: a stored result implies applied HP, and applied
-- HP implies a stored result. No ordering of two RPCs gives you that.
--
-- `p_winner_player_id` is null when the arena won an encounter; there is no
-- seat to credit. `p_loser_player_id` is null when a seat beat the arena;
-- nobody pays.
-- ---------------------------------------------------------------------------

create or replace function dw_resolve_matchup(
  p_room_id uuid,
  p_pairing_index int,
  p_result jsonb,
  p_winner_player_id uuid,
  p_loser_player_id uuid,
  p_damage int
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
     set battle_result = p_result,
         winner_player_id = p_winner_player_id,
         damage = greatest(0, coalesce(p_damage, 0)),
         started_at = coalesce(started_at, now()),
         settled_at = now()
   where id = r.id;

  if p_winner_player_id is not null then
    update match_players
       set round_wins = round_wins + 1,
           streak = streak + 1
     where match_id = m.id and player_id = p_winner_player_id;
  end if;

  if p_loser_player_id is not null then
    -- Nobody leaves the table in the first five rounds; before then a loss
    -- floors at one rather than killing.
    v_floor := case when m.round_no >= 6 then 0 else 1 end;

    update match_players
       set hp = greatest(v_floor, hp - greatest(0, coalesce(p_damage, 0))),
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
-- 4. A round is not over until every fight is
-- ---------------------------------------------------------------------------

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

  -- Every fight of the round has to have happened. `battle_result is null` is
  -- the status, so this is the same shape as the draft guard above it: a round
  -- that was never fought is not a round everybody drew.
  if m.phase in ('COMBAT', 'FINAL_COMBAT') then
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

  v_next := dw_match_next_phase(m.phase, m.round_no, m.round_count);

  -- A decided match does not play out its remaining rounds. With fewer than two
  -- seats left there is nobody to pair and nothing to fight, so the round loop
  -- hands straight over to the championship the machine already has.
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

-- ---------------------------------------------------------------------------
-- 5. The clock asks for the fights it is missing
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

  -- A round sitting at combat with a fight still to resolve. Reported rather
  -- than performed, because the battle is computed in TypeScript — the same
  -- division of labour the draft and the pairing already use.
  if m.phase in ('COMBAT', 'FINAL_COMBAT') then
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

  if m.phase_deadline is not null and now() >= m.phase_deadline then
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('MATCH_PHASE_EXPIRED'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reading a fight back
-- ---------------------------------------------------------------------------

create or replace function dw_match_snapshot(p_room_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_room     rooms%rowtype;
  m          matches%rowtype;
  g          games%rowtype;
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
