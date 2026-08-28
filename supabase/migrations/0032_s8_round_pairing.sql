-- =============================================================================
-- 0032 — S8.3b: writing a round's pairings
--
-- The pairing itself is decided in TypeScript (`src/lib/game/matchmaking.ts`),
-- for the same reason the round draft's queue is: it is a pure function over
-- state this layer already has, it is where the 26-mutation test suite lives,
-- and plpgsql is a poor place to enumerate perfect matchings. This migration is
-- the *persistence* half — the part that has to be atomic, idempotent and
-- impossible to talk into writing twice.
--
-- Three things, and nothing else:
--
--  1. `rating_a` / `rating_b` / `reason` on `round_matchups`. All three are
--     decision *outputs*, not derived state: a rating is computed from the
--     board as it stood when the pairing was made, and the board grows every
--     round, so round three's rating cannot be recovered from round eight's
--     squad. The same is true of the reason — "you haven't faced Can yet" stops
--     being true the moment they do. Recording them is what lets the game
--     answer *why did I get this opponent* honestly rather than plausibly.
--
--  2. A check constraint making a self-match impossible at the database. The
--     pairing function already cannot produce one; this is the second line,
--     and it is the line that holds if anything ever writes these rows without
--     going through that function.
--
--  3. `dw_pair_round`, which writes a round's pairings once. Under the match
--     row lock, guarded by the phase, and a no-op on the second caller — the
--     same shape `dw_start_round_auction` established in 0031, because the
--     failure it prevents is the same one: the phase advance and the tick can
--     both arrive here.
--
-- What is deliberately NOT added, because it would be a second copy of
-- something already true: `bye_player` (`player_b IS NULL` plus `kind` says
-- it), `seed` (derivable from the match), `rematch_count` (derivable from the
-- rows above it), `matchup_id` (`id` is the matchup id).
--
-- Additive and safe to re-run. Nothing is dropped, no legacy function is
-- touched, and a room that never plays a match never reaches any of it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table round_matchups add column if not exists rating_a numeric(6,4);
alter table round_matchups add column if not exists rating_b numeric(6,4);

-- Why this matchup exists, in the player's terms. Mirrors `MatchupReason`.
alter table round_matchups add column if not exists reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'round_matchups_reason_valid'
  ) then
    alter table round_matchups add constraint round_matchups_reason_valid
      check (reason is null or reason in
        ('ONLY_PAIRING','NEW_OPPONENT','CLOSEST_STRENGTH','REMATCH_UNAVOIDABLE','ODD_SEAT'));
  end if;
end $$;

-- A seat cannot fight itself. The pairing function removes both seats from the
-- pool when it forms a pair, so this cannot fire today — which is exactly when
-- a constraint is worth adding, rather than after something has already
-- written the row it would have caught.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'round_matchups_no_self'
  ) then
    alter table round_matchups add constraint round_matchups_no_self
      check (player_b is null or player_b <> player_a);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Writing a round's pairings
--
-- `p_pairings` arrives as the output of `pairRound`, already decided. This
-- function's whole job is to make sure it lands exactly once:
--
--   * the match row is locked, so two callers serialise;
--   * the phase must be MATCHMAKING, so it cannot be written out of turn;
--   * an existing row for the round makes it a no-op rather than a duplicate;
--   * `unique (match_id, round_no, pairing_index)` is the backstop if all of
--     that is somehow bypassed.
--
-- It validates rather than trusts: every seat named must be a live seat in this
-- match, and no seat may appear twice. The payload comes from our own server,
-- but "comes from our own server" is a property of today's call sites, not of
-- the function.
-- ---------------------------------------------------------------------------

create or replace function dw_pair_round(p_room_id uuid, p_pairings jsonb)
returns jsonb language plpgsql security definer as $$
declare
  v_room    rooms%rowtype;
  m         matches%rowtype;
  v_pair    jsonb;
  v_seen    uuid[] := '{}';
  v_a       uuid;
  v_b       uuid;
  v_count   int := 0;
  v_live    int;
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
  if m.phase <> 'MATCHMAKING' then
    return dw_err('WRONG_PHASE', 'The round is not at its matchmaking.');
  end if;

  -- Already paired. The second caller gets the same answer as the first.
  if exists (select 1 from round_matchups where match_id = m.id and round_no = m.round_no) then
    return jsonb_build_object('ok', true, 'noop', true, 'roundNo', m.round_no,
      'pairings', (select count(*) from round_matchups
                    where match_id = m.id and round_no = m.round_no));
  end if;

  select count(*) into v_live from match_players
   where match_id = m.id and eliminated_at is null and hp > 0;

  -- Fewer than two seats left is not a round to pair; the state machine forks
  -- to the championship on its own.
  if v_live < 2 then
    return jsonb_build_object('ok', true, 'noop', true, 'roundNo', m.round_no, 'pairings', 0);
  end if;

  for v_pair in select * from jsonb_array_elements(p_pairings) loop
    v_a := nullif(v_pair->>'playerA', '')::uuid;
    v_b := nullif(v_pair->>'playerB', '')::uuid;

    if v_a is null then
      return dw_err('BAD_PAIRING', 'A matchup must name a player.');
    end if;
    if v_b is not null and v_b = v_a then
      return dw_err('BAD_PAIRING', 'A player cannot face themselves.');
    end if;
    if v_a = any(v_seen) or (v_b is not null and v_b = any(v_seen)) then
      return dw_err('BAD_PAIRING', 'A player appears in two matchups.');
    end if;

    if not exists (select 1 from match_players mp
                    where mp.match_id = m.id and mp.player_id = v_a
                      and mp.eliminated_at is null and mp.hp > 0) then
      return dw_err('BAD_PAIRING', 'That player is not in this match.');
    end if;
    if v_b is not null and not exists (select 1 from match_players mp
                    where mp.match_id = m.id and mp.player_id = v_b
                      and mp.eliminated_at is null and mp.hp > 0) then
      return dw_err('BAD_PAIRING', 'That player is not in this match.');
    end if;

    v_seen := v_seen || v_a;
    if v_b is not null then v_seen := v_seen || v_b; end if;

    insert into round_matchups (match_id, round_no, pairing_index, player_a, player_b,
                                kind, rating_a, rating_b, reason)
    values (m.id, m.round_no, v_count, v_a, v_b,
            coalesce(v_pair->>'kind', 'DUEL'),
            (v_pair->>'ratingA')::numeric,
            (v_pair->>'ratingB')::numeric,
            v_pair->>'reason');
    v_count := v_count + 1;
  end loop;

  -- Every live seat has to be somewhere. A round that pairs four of five people
  -- leaves somebody with no round at all, which is worse than not pairing.
  if array_length(v_seen, 1) is distinct from v_live then
    return dw_err('BAD_PAIRING', 'Every player must appear in exactly one matchup.');
  end if;

  perform dw_event(null, p_room_id, 'ROUND_PAIRED', jsonb_build_object(
    'matchId', m.id, 'roundNo', m.round_no, 'pairings', v_count));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'roundNo', m.round_no, 'pairings', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- 3. The phase guard
--
-- The 0031 body with one addition: MATCHMAKING cannot be left until the round
-- actually has pairings. Combat with no matchups is not a shorter round, it is
-- a round nobody played — and unlike the auction, this phase has a deadline, so
-- without the guard the clock would walk straight past a failed pairing.
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
    if found and v_game.status = 'ACTIVE' then
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

-- ---------------------------------------------------------------------------
-- 4. The match clock
--
-- The 0031 body plus one report: a round sitting at MATCHMAKING with no rows
-- needs pairing. Reported rather than performed, because the pairing is decided
-- in TypeScript — the same division of labour the round auction uses.
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

  if m.phase_deadline is not null and now() >= m.phase_deadline then
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('MATCH_PHASE_EXPIRED'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reading a match
--
-- The 0031 body with three fields added to each matchup. They are what lets the
-- reveal say *why* rather than only *who* — and saying why is the check on the
-- whole matchmaking design: if the honest explanation for a matchup were "you
-- are winning", the scheduler would be a handicap system.
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
