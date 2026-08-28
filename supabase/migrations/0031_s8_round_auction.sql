-- =============================================================================
-- 0031 — S8.2: the round auction, and match economy
--
-- Two things, both of which had to happen together because the second is what
-- makes the first safe.
--
-- 1. MATCH ECONOMY (decision A′). A match's credits live in
--    `match_players.credits` and nowhere else. There is no synchronisation with
--    `players.credits`, no round-boundary transfer and no second ledger — the
--    project already learned that lesson with `profiles.coins`, which is
--    written inside one function under one row lock precisely so it cannot
--    drift from its ledger. Two balances that must agree are two balances that
--    eventually do not, and a stale one is a double spend.
--
--    The change is deliberately narrow: `dw_place_bid` and `dw_resolve_auction`
--    keep their exact logic, lock order and error codes, and only their credit
--    reads and writes go through two accessors. The branch lives in one place.
--
-- 2. THE CONCURRENCY FIX for `dw_advance_match_phase`. The S8.1 live test found
--    six simultaneous host advances moving a match three phases. The row lock
--    was never the problem — each request was individually correct, because
--    each read a *fresh* phase that the previous one had just written and
--    advanced from it. What was missing is a way to tell "the host tapped
--    twice" from "the host tapped, then tapped again later", and that needs a
--    clock. `phase_started_at` supplies it; the lock still does the serialising.
--
-- What is NOT touched, on purpose:
--
--   * `dw_open_next_auction` — the legacy draft's engine. A match round gets
--     its own `dw_open_next_round_auction` beside it rather than a branch
--     inside it, because that function ends by flipping the room to
--     TEAM_REVIEW and a match must not leave the MATCH phase.
--   * `dw_total_demand`, `dw_slots_remaining`, `dw_auction_is_dead`,
--     `dw_start_game`, `dw_tick`, `dw_return_to_lobby`, `dw_snapshot`.
--   * Every rule of the auction itself: the reserve rule, the full-clock reset
--     on each bid, the extension cap, the rate limit, the idempotency key, the
--     `FOR UPDATE` on the auction row.
--
-- Every replaced function keeps a `match_id is null` branch that is the
-- original body. `tests/round-auction.test.ts` holds that promise.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New state
-- ---------------------------------------------------------------------------

-- When the current phase began. The discriminator the concurrency fix needs:
-- a lock can serialise two advances but cannot tell you whether the second one
-- was a human decision or the same tap arriving twice.
alter table matches add column if not exists phase_started_at timestamptz not null default now();

-- Every character a match has consumed, and the record of how.
--
-- Two jobs in one table, and they are the same job. `unique (match_id,
-- character_id)` is what makes "the same character cannot be sold twice in a
-- match" a property of the database rather than of the queue builder that is
-- supposed to have excluded it — a pool filter is a good first line and a
-- terrible only line. The remaining columns are exactly the acquisition
-- metadata a replay needs, recorded at the moment the sale happens rather than
-- reconstructed later from three tables.
create table if not exists match_acquisitions (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references matches(id) on delete cascade,
  round_no       int  not null,
  game_id        uuid not null references games(id) on delete cascade,
  auction_id     uuid references auctions(id) on delete set null,
  player_id      uuid not null references players(id) on delete cascade,
  character_id   text not null references characters(id),
  final_price    int  not null,
  seed           text not null,
  acquired_at    timestamptz not null default now(),
  unique (match_id, character_id)
);

create index if not exists idx_match_acq_round  on match_acquisitions (match_id, round_no);
create index if not exists idx_match_acq_player on match_acquisitions (match_id, player_id);

alter table match_acquisitions enable row level security;

-- ---------------------------------------------------------------------------
-- 2. The credit accessors
--
-- The whole of decision A′. Everything else in this file that touches money
-- goes through these two, so "which balance is authoritative" is answered in
-- one place and can be tested in isolation.
--
-- The `coalesce(..., 0)` is not cosmetic. Without it a seat with no
-- `match_players` row returns NULL, and every comparison against NULL is NULL
-- rather than false — so `p_amount > v_credits` would not fire and the bid
-- would pass the affordability check *entirely*. An unknown balance has to
-- mean "no money", not "no check": the failure has to fall towards refusing.
--
-- That state is unreachable today, because `dw_join_room` refuses any room
-- outside LOBBY and a match is not LOBBY. It is guarded anyway, because the
-- thing being guarded against is a future path that creates a player without a
-- match row — and the symptom of that would be a character won for free.
-- ---------------------------------------------------------------------------

create or replace function dw_bid_credits(p_game_id uuid, p_player_id uuid)
returns int language sql stable as $$
  select coalesce((
    select case
      when g.match_id is null
        then (select p.credits from players p where p.id = p_player_id)
      else (select mp.credits from match_players mp
             where mp.match_id = g.match_id and mp.player_id = p_player_id)
    end
    from games g where g.id = p_game_id
  ), 0);
$$;

create or replace function dw_debit_credits(p_game_id uuid, p_player_id uuid, p_amount int)
returns void language plpgsql as $$
declare v_match uuid;
begin
  select match_id into v_match from games where id = p_game_id;
  if v_match is null then
    update players set credits = credits - p_amount where id = p_player_id;
  else
    update match_players set credits = credits - p_amount
     where match_id = v_match and player_id = p_player_id;
  end if;
end $$;

-- How long a phase must have been running before a person may advance it by
-- hand. A second is far below anything a human means to do twice and far above
-- the window six concurrent requests arrive in. Declared as a function so
-- TypeScript can assert the same number rather than guess at it.
create or replace function dw_min_phase_dwell() returns interval
language sql immutable as $$ select interval '1 second' $$;

-- Whether a round demands an acquisition. Rounds 1-5 fill the board and buying
-- is mandatory; from round 6 the board is full and a buy is an upgrade, so
-- passing is a real move. Mirrors `acquisitionRequired` in rounds.ts.
create or replace function dw_acquisition_required(p_round_no int)
returns boolean language sql immutable as $$
  select p_round_no >= 1 and p_round_no <= 5;
$$;

-- Players who still owe this round an acquisition. Unlike `dw_total_demand`
-- this counts only seats that are still in the match, so an eliminated player
-- cannot hold a round open.
create or replace function dw_round_demand(p_game_id uuid)
returns int language sql stable as $$
  select coalesce(count(*), 0)::int
  from games g
  join match_players mp on mp.match_id = g.match_id
  join players p on p.id = mp.player_id
  where g.id = p_game_id
    and mp.eliminated_at is null
    and not exists (
      select 1 from team_characters t
       where t.game_id = g.id and t.player_id = mp.player_id);
$$;

-- ---------------------------------------------------------------------------
-- 3. Advancing a phase — now with the concurrency guard
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
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if p_player_id is not null and v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  -- Everything from here to the commit happens under this lock.
  select * into m from matches where id = v_room.current_match_id for update;
  if not found then return dw_err('NO_MATCH', 'This room is not playing a match.'); end if;
  if m.status <> 'ACTIVE' then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;

  -- Somebody already applied this exact step.
  if m.phase <> p_from then
    return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
  end if;

  if p_player_id is null then
    -- The clock is driving. Two cases, and the difference is who owns the
    -- phase.
    --
    -- A phase the match itself times may only advance once its deadline has
    -- passed, which is what makes five phones reacting to the same deadline
    -- produce exactly one transition: the first writes a fresh deadline in the
    -- future and the rest find it unexpired.
    --
    -- A phase with no deadline belongs to a subsystem, and only AUCTION has
    -- one of those wired up — its completion is checked below. COMBAT and
    -- FINAL_COMBAT deliberately fall through to noop rather than being skipped
    -- silently; S8.5 replaces this branch with the battle's own clock.
    if m.phase_deadline is not null then
      if now() < m.phase_deadline then
        return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
      end if;
    elsif m.phase <> 'AUCTION' then
      return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
    end if;
  else
    -- A person is driving. The lock serialises them, but serialising is not
    -- the question — each request read a phase that was true when it read it.
    -- What separates a decision from a double tap is how long the phase has
    -- been on screen.
    if now() < m.phase_started_at + dw_min_phase_dwell() then
      return dw_err('CONCURRENT_PHASE_ADVANCE',
                    'That phase only just started — the screen may be out of date.');
    end if;
  end if;

  -- A round's draft is not something to walk out of. The auction closes itself
  -- when every quota is filled (or, in an optional round, when the queue runs
  -- out), and until it has, BOARD_UPDATE would be showing a board that is
  -- still being bid on.
  if m.phase = 'AUCTION' then
    select * into v_game from games
     where match_id = m.id and round_no = m.round_no
     order by created_at desc limit 1;
    if found and v_game.status = 'ACTIVE' then
      return dw_err('AUCTION_INCOMPLETE', 'The round auction is still running.');
    end if;
  end if;

  v_next := dw_match_next_phase(m.phase, m.round_no, m.round_count);
  if v_next is null then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if p_to is not null and p_to <> v_next then
    return dw_err('INVALID_TRANSITION', 'A match cannot go there from here.');
  end if;

  -- The round number has exactly one writer, and this is it: entering
  -- ROUND_START, whether from MATCH_INTRO or from the previous ROUND_END.
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
-- 4. Opening a round's draft
--
-- The queue arrives already built, exactly as `dw_start_game` receives one:
-- selection happens once, server-side, before the first lot opens, and is
-- persisted with the game so the client never sees the wider pool.
-- ---------------------------------------------------------------------------

create or replace function dw_start_round_auction(
  p_room_id uuid, p_seed text, p_queue jsonb, p_reveal_seconds int default 3
) returns jsonb language plpgsql security definer as $$
declare
  v_room  rooms%rowtype;
  m       matches%rowtype;
  v_game  uuid;
  v_no    int;
  v_secs  int;
  v_first text;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  select * into m from matches where id = v_room.current_match_id for update;
  if m.status <> 'ACTIVE' then return dw_err('MATCH_OVER', 'This match has finished.'); end if;
  if m.phase <> 'AUCTION' then
    return dw_err('WRONG_PHASE', 'The round is not at its auction.');
  end if;

  -- Idempotent: a second caller for the same round gets the same game.
  select id into v_game from games
   where match_id = m.id and round_no = m.round_no
   order by created_at desc limit 1;
  if v_game is not null then
    return jsonb_build_object('ok', true, 'noop', true, 'gameId', v_game);
  end if;

  if jsonb_array_length(p_queue) < 1 then
    return dw_err('POOL_TOO_SMALL', 'There are no characters left to draft.');
  end if;

  select coalesce(max(game_no), 0) + 1 into v_no from games where room_id = p_room_id;
  v_secs := coalesce((v_room.config->>'auctionSeconds')::int, 10);

  -- One acquisition per player per round. Everything the existing auction does
  -- about quotas — `dw_slots_remaining`, the reserve ceiling, ROSTER_FULL —
  -- follows from this single number, which is why a round needs no new rule
  -- about buying twice: after one purchase the player has no slot left.
  insert into games (room_id, game_no, seed, queue, characters_per_player,
                     category_ids, match_id, round_no)
  values (p_room_id, v_no, p_seed, p_queue, 1, m.category_ids, m.id, m.round_no)
  returning id into v_game;

  update rooms set current_game_id = v_game where id = p_room_id;

  v_first := p_queue->>0;
  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (v_game, p_room_id, v_first, 0,
          now() + make_interval(secs => greatest(0, p_reveal_seconds)) + make_interval(secs => v_secs));

  perform dw_event(v_game, p_room_id, 'ROUND_AUCTION_STARTED', jsonb_build_object(
    'matchId', m.id, 'roundNo', m.round_no, 'lots', jsonb_array_length(p_queue),
    'required', dw_acquisition_required(m.round_no)));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'gameId', v_game, 'roundNo', m.round_no);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Moving a round's draft along
--
-- Beside `dw_open_next_auction`, not inside it. The legacy function ends a
-- draft by setting the room to TEAM_REVIEW; a match must stay in MATCH, and
-- its phase is advanced by the Node layer so that the phase-deadline table
-- keeps living in exactly one place (src/lib/game/rounds.ts).
--
-- The other difference is recycling. The legacy draft recycles unsold
-- characters because every roster *must* be filled. A round from 6 onward has
-- nothing to guarantee — a player who wants nothing should be able to keep
-- their credits — so an optional round lets the queue run out and closes.
-- ---------------------------------------------------------------------------

create or replace function dw_open_next_round_auction(p_game_id uuid)
returns void language plpgsql as $$
declare
  v_game     games%rowtype;
  m          matches%rowtype;
  v_idx      int;
  v_char     text;
  v_secs     int;
  v_demand   int;
  v_required boolean;
  v_recycled jsonb;
  v_guard    int := 0;
  v_reveal   interval := interval '3 seconds';
begin
  select * into v_game from games where id = p_game_id;
  select * into m from matches where id = v_game.match_id;
  v_required := dw_acquisition_required(v_game.round_no);
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 10);
  v_idx := v_game.queue_index;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;

    v_idx := v_idx + 1;
    v_demand := dw_round_demand(p_game_id);

    -- Everybody has their character for this round.
    if v_demand <= 0 then
      update games set queue_index = v_idx, status = 'FINISHED', finished_at = now()
       where id = p_game_id;
      perform dw_event(p_game_id, v_game.room_id, 'ROUND_AUCTION_COMPLETE',
        jsonb_build_object('matchId', m.id, 'roundNo', v_game.round_no,
                           'acquired', (select count(*) from team_characters where game_id = p_game_id)));
      perform dw_bump(v_game.room_id);
      return;
    end if;

    if v_idx >= jsonb_array_length(v_game.queue) then
      if v_required then
        -- Mandatory round: an unsold character goes back on the queue rather
        -- than leaving somebody short, exactly as the legacy draft does.
        select coalesce(jsonb_agg(a.character_id), '[]'::jsonb) into v_recycled
          from auctions a
         where a.game_id = p_game_id
           and a.status = 'UNSOLD'
           and not exists (select 1 from team_characters t
                            where t.game_id = p_game_id and t.character_id = a.character_id);

        if jsonb_array_length(v_recycled) > 0 then
          update games set queue = queue || v_recycled where id = p_game_id;
          select * into v_game from games where id = p_game_id;
          v_idx := v_idx - 1;
          continue;
        end if;
      end if;

      -- Optional round, or a mandatory one with nothing left to offer. A match
      -- must not stall on an empty pool, so the round closes and the shortfall
      -- is recorded rather than retried forever.
      update games set queue_index = v_idx, status = 'FINISHED', finished_at = now()
       where id = p_game_id;
      perform dw_event(p_game_id, v_game.room_id, 'ROUND_AUCTION_COMPLETE',
        jsonb_build_object('matchId', m.id, 'roundNo', v_game.round_no,
                           'exhausted', true, 'unfilled', v_demand,
                           'required', v_required));
      perform dw_bump(v_game.room_id);
      return;
    end if;

    v_char := v_game.queue->>v_idx;
    -- Never offer a character this match has already sold.
    exit when not exists (
      select 1 from match_acquisitions
       where match_id = m.id and character_id = v_char);
  end loop;

  update games set queue_index = v_idx where id = p_game_id;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (p_game_id, v_game.room_id, v_char, v_idx,
          now() + v_reveal + make_interval(secs => v_secs));

  perform dw_bump(v_game.room_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Bidding
--
-- The 0019 body, with three changes and no others:
--   * the phase check accepts a room in MATCH whose match is at its AUCTION,
--   * the two credit reads go through `dw_bid_credits`,
--   * resolution dispatches to the round opener for a match game.
-- Lock order, rate limit, idempotency key, clock reset, extension cap, error
-- codes and messages are untouched.
-- ---------------------------------------------------------------------------

create or replace function dw_place_bid(
  p_player_id uuid, p_auction_id uuid, p_amount int, p_action_id text default null
) returns jsonb language plpgsql security definer as $$
declare
  a auctions%rowtype;
  pl players%rowtype;
  v_phase text;
  v_match uuid;
  v_match_phase text;
  v_credits int;
  v_min_bid int;
  v_slots int;
  v_min_allowed int;
  v_max_allowed int;
  v_secs int;
  v_prior jsonb;
  v_result jsonb;
  v_max_ext int := 20;
begin
  v_prior := dw_prior_result(p_action_id);
  if v_prior is not null then return v_prior; end if;

  if dw_rate_limited(p_player_id::text, 'BID', 30, 10) then
    return dw_err('TOO_FAST', 'Slow down a moment.');
  end if;

  select * into a from auctions where id = p_auction_id for update;
  if not found then return dw_err('NO_ACTIVE_AUCTION', 'There is no auction running.'); end if;

  select * into pl from players where id = p_player_id;
  if not found or pl.room_id <> a.room_id then
    return dw_err('NOT_IN_ROOM', 'You are not part of this room.');
  end if;

  select phase into v_phase from rooms where id = a.room_id;
  select match_id into v_match from games where id = a.game_id;

  if v_match is null then
    if v_phase <> 'AUCTION' then return dw_err('WRONG_PHASE', 'That action is not available right now.'); end if;
  else
    select phase into v_match_phase from matches where id = v_match;
    if v_phase <> 'MATCH' or v_match_phase <> 'AUCTION' then
      return dw_err('WRONG_PHASE', 'That action is not available right now.');
    end if;
  end if;

  if a.status <> 'ACTIVE' then return dw_err('AUCTION_CLOSED', 'This auction has already ended.'); end if;
  if now() >= a.ends_at then return dw_err('AUCTION_CLOSED', 'This auction has already ended.'); end if;

  if exists (select 1 from auction_passes where auction_id = a.id and player_id = p_player_id) then
    return dw_err('ALREADY_PASSED', 'You already passed on this character.');
  end if;
  if a.high_bidder_id = p_player_id then
    return dw_err('ALREADY_HIGH_BIDDER', 'You are already the highest bidder.');
  end if;

  -- A seat that is not in the match has no wallet to bid from. Stated rather
  -- than left to the accessor's zero, so the answer is the true reason.
  if v_match is not null and not exists (
       select 1 from match_players mp
        where mp.match_id = v_match and mp.player_id = p_player_id) then
    return dw_err('NOT_IN_MATCH', 'You are not part of this match.');
  end if;

  -- One acquisition per player per round falls straight out of this: a round
  -- game has characters_per_player = 1, so a player who has bought is full.
  v_slots := dw_slots_remaining(a.game_id, p_player_id);
  if v_slots <= 0 then return dw_err('ROSTER_FULL', 'Your roster is full.'); end if;

  select coalesce((config->>'minBid')::int, 1),
         coalesce((config->>'auctionSeconds')::int, 10)
    into v_min_bid, v_secs
    from rooms where id = a.room_id;

  v_credits := dw_bid_credits(a.game_id, p_player_id);

  v_min_allowed := case when a.high_bidder_id is null then v_min_bid else a.current_bid + 1 end;
  if p_amount < v_min_allowed then
    return dw_err('BID_TOO_LOW', 'Someone else placed a higher bid.');
  end if;
  if p_amount > v_credits then
    return dw_err('NOT_ENOUGH_CREDITS', 'Not enough credits.');
  end if;

  v_max_allowed := v_credits - (v_slots - 1) * v_min_bid;
  if p_amount > v_max_allowed then
    return dw_err('RESERVE_REQUIRED', 'You must keep credits to fill your remaining slots.');
  end if;

  update auctions
     set current_bid = p_amount,
         high_bidder_id = p_player_id,
         extensions = a.extensions + 1,
         ends_at = case
           when a.extensions < v_max_ext then now() + make_interval(secs => v_secs)
           else a.ends_at end
   where id = a.id;

  insert into bids (auction_id, room_id, player_id, amount)
  values (a.id, a.room_id, p_player_id, p_amount);

  perform dw_event(a.game_id, a.room_id, 'BID_PLACED', jsonb_build_object(
    'auctionId', a.id, 'characterId', a.character_id,
    'playerId', p_player_id, 'nickname', pl.nickname,
    'amount', p_amount, 'extension', a.extensions + 1,
    'capped', a.extensions >= v_max_ext));

  v_result := jsonb_build_object('ok', true, 'amount', p_amount,
                                 'extensionsLeft', greatest(0, v_max_ext - a.extensions - 1));

  if dw_auction_is_dead(a.id) then
    perform dw_resolve_auction(a.id);
  else
    perform dw_bump(a.room_id);
  end if;

  return dw_record_result(p_action_id, p_player_id, 'BID', v_result);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Passing
--
-- The 0019 body with two changes: the phase check as above, and the pass rule
-- is skipped in an optional round. That rule exists to stop a draft becoming
-- unsolvable — from round 6 there is nothing to solve, and a player who keeps
-- their credits has made a decision rather than a mistake.
-- ---------------------------------------------------------------------------

create or replace function dw_pass_auction(
  p_player_id uuid, p_auction_id uuid, p_action_id text default null
) returns jsonb language plpgsql security definer as $$
declare
  a auctions%rowtype;
  pl players%rowtype;
  g games%rowtype;
  v_phase text;
  v_match_phase text;
  v_supply int;
  v_demand int;
  v_queue_len int;
  v_idx int;
  v_prior jsonb;
  v_result jsonb;
begin
  v_prior := dw_prior_result(p_action_id);
  if v_prior is not null then return v_prior; end if;

  if dw_rate_limited(p_player_id::text, 'PASS', 20, 10) then
    return dw_err('TOO_FAST', 'Slow down a moment.');
  end if;

  select * into a from auctions where id = p_auction_id for update;
  if not found then return dw_err('NO_ACTIVE_AUCTION', 'There is no auction running.'); end if;

  select * into pl from players where id = p_player_id;
  if not found or pl.room_id <> a.room_id then
    return dw_err('NOT_IN_ROOM', 'You are not part of this room.');
  end if;

  select phase into v_phase from rooms where id = a.room_id;
  select * into g from games where id = a.game_id;

  if g.match_id is null then
    if v_phase <> 'AUCTION' then return dw_err('WRONG_PHASE', 'That action is not available right now.'); end if;
  else
    select phase into v_match_phase from matches where id = g.match_id;
    if v_phase <> 'MATCH' or v_match_phase <> 'AUCTION' then
      return dw_err('WRONG_PHASE', 'That action is not available right now.');
    end if;
  end if;

  if a.status <> 'ACTIVE' then return dw_err('AUCTION_CLOSED', 'This auction has already ended.'); end if;

  if exists (select 1 from auction_passes where auction_id = a.id and player_id = p_player_id) then
    return dw_record_result(p_action_id, p_player_id, 'PASS',
                            jsonb_build_object('ok', true, 'alreadyPassed', true));
  end if;

  if a.high_bidder_id = p_player_id then
    return dw_err('ALREADY_HIGH_BIDDER', 'You are already the highest bidder.');
  end if;

  if dw_slots_remaining(a.game_id, p_player_id) <= 0 then
    return dw_err('ROSTER_FULL', 'Your roster is full.');
  end if;

  -- The pass rule, unchanged for legacy drafts and for mandatory rounds.
  if g.match_id is null or dw_acquisition_required(g.round_no) then
    select jsonb_array_length(queue), queue_index into v_queue_len, v_idx
      from games where id = a.game_id;
    v_supply := v_queue_len - v_idx - 1;
    v_demand := case when g.match_id is null
                     then dw_total_demand(a.game_id)
                     else dw_round_demand(a.game_id) end;
    if v_supply < v_demand then
      return dw_err('MUST_BID', 'Too few characters left — you cannot pass on this one.');
    end if;
  end if;

  insert into auction_passes (auction_id, player_id)
  values (a.id, p_player_id)
  on conflict do nothing;

  perform dw_event(a.game_id, a.room_id, 'PLAYER_PASSED', jsonb_build_object(
    'auctionId', a.id, 'characterId', a.character_id,
    'playerId', p_player_id, 'nickname', pl.nickname));

  v_result := jsonb_build_object('ok', true, 'passed', true);

  if dw_auction_is_dead(a.id) then
    perform dw_resolve_auction(a.id);
  else
    perform dw_bump(a.room_id);
  end if;

  return dw_record_result(p_action_id, p_player_id, 'PASS', v_result);
end $$;

-- ---------------------------------------------------------------------------
-- 8. The match's record of a sale
--
-- Called from inside `dw_resolve_auction`, under the auction row lock and in
-- the same transaction as the debit, so a character, its price and the credits
-- that paid for it cannot end up disagreeing. A no-op for a legacy draft.
--
-- The board row is written here too. Where a character *stands* is S8.4's
-- question; that it is on the board at all is this one's, and a board assembled
-- later from three tables is a board that can be assembled wrongly.
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

  -- Existing squad size decides where the newcomer lands: the first five fill
  -- the board, the rest sit on the bench. S8.4 hands that choice to the player.
  select count(*) into v_own from board_slots
   where match_id = g.match_id and player_id = p_player_id;

  insert into board_slots (match_id, player_id, character_id, zone, slot)
  values (g.match_id, p_player_id, p_character_id,
          case when v_own < 5 then 'FRONT' else 'BENCH' end, v_own)
  on conflict (match_id, player_id, character_id) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Resolving a lot
--
-- The 0005 body with the credit reads and writes behind the accessors, the
-- match's own bookkeeping written inside the same transaction and the same
-- auction row lock, and the "open the next lot" call dispatched by game kind.
-- ---------------------------------------------------------------------------

create or replace function dw_resolve_auction(p_auction_id uuid)
returns jsonb language plpgsql as $$
declare
  a auctions%rowtype;
  g games%rowtype;
  v_min int;
  v_len int;
  v_idx int;
  v_supply_after int;
  v_demand int;
  v_forced uuid;
  v_winner uuid;
  v_price int;
begin
  select * into a from auctions where id = p_auction_id for update;
  if not found then return dw_err('NO_ACTIVE_AUCTION', 'There is no auction running.'); end if;
  if a.status <> 'ACTIVE' then
    return jsonb_build_object('ok', true, 'alreadyResolved', true);
  end if;

  select * into g from games where id = a.game_id;
  select coalesce((config->>'minBid')::int, 1) into v_min from rooms where id = a.room_id;

  -- Nobody bid: decide whether the draft can afford to lose this character.
  if a.high_bidder_id is null then
    select jsonb_array_length(queue), queue_index into v_len, v_idx
      from games where id = a.game_id;
    v_supply_after := v_len - v_idx - 1;
    v_demand := case when g.match_id is null
                     then dw_total_demand(a.game_id)
                     else dw_round_demand(a.game_id) end;

    -- An optional round never forces a sale: passing on everything is the
    -- point of it.
    if v_supply_after < v_demand
       and (g.match_id is null or dw_acquisition_required(g.round_no)) then
      select p.id into v_forced
        from players p
       where p.room_id = a.room_id
         and dw_slots_remaining(a.game_id, p.id) > 0
         and dw_bid_credits(a.game_id, p.id) >= v_min
         and (g.match_id is null or exists (
               select 1 from match_players mp
                where mp.match_id = g.match_id and mp.player_id = p.id
                  and mp.eliminated_at is null))
       order by dw_slots_remaining(a.game_id, p.id) desc,
                dw_bid_credits(a.game_id, p.id) desc, p.seat asc
       limit 1;

      if v_forced is not null then
        update auctions
           set status = 'SOLD', winner_id = v_forced, final_price = v_min,
               current_bid = v_min, high_bidder_id = v_forced, resolved_at = now()
         where id = a.id;

        perform dw_debit_credits(a.game_id, v_forced, v_min);

        insert into team_characters (game_id, room_id, player_id, character_id, price)
        values (a.game_id, a.room_id, v_forced, a.character_id, v_min)
        on conflict (game_id, character_id) do nothing;

        perform dw_record_acquisition(a.game_id, a.id, v_forced, a.character_id, v_min);

        insert into game_events (game_id, room_id, type, payload)
        values (a.game_id, a.room_id, 'AUTO_ASSIGNED', jsonb_build_object(
          'characterId', a.character_id, 'playerId', v_forced, 'price', v_min));

        if g.match_id is null then perform dw_open_next_auction(a.game_id);
        else perform dw_open_next_round_auction(a.game_id); end if;
        perform dw_bump(a.room_id);
        return jsonb_build_object('ok', true, 'resolved', true, 'autoAssigned', true);
      end if;
    end if;
  end if;

  if a.high_bidder_id is not null then
    v_winner := a.high_bidder_id;
    v_price := a.current_bid;

    update auctions
       set status = 'SOLD', winner_id = v_winner, final_price = v_price,
           resolved_at = now()
     where id = a.id;

    perform dw_debit_credits(a.game_id, v_winner, v_price);

    insert into team_characters (game_id, room_id, player_id, character_id, price)
    values (a.game_id, a.room_id, v_winner, a.character_id, v_price)
    on conflict (game_id, character_id) do nothing;

    perform dw_record_acquisition(a.game_id, a.id, v_winner, a.character_id, v_price);

    insert into game_events (game_id, room_id, type, payload)
    values (a.game_id, a.room_id, 'SOLD', jsonb_build_object(
      'characterId', a.character_id, 'playerId', v_winner, 'price', v_price));
  else
    update auctions set status = 'UNSOLD', resolved_at = now() where id = a.id;
    insert into game_events (game_id, room_id, type, payload)
    values (a.game_id, a.room_id, 'UNSOLD', jsonb_build_object('characterId', a.character_id));
  end if;

  if g.match_id is null then perform dw_open_next_auction(a.game_id);
  else perform dw_open_next_round_auction(a.game_id); end if;
  perform dw_bump(a.room_id);
  return jsonb_build_object('ok', true, 'resolved', true);
end $$;

-- ---------------------------------------------------------------------------
-- 10. The match clock, now that a round has an auction in it
--
-- Still a reporter rather than an actor for phase changes — the phase-deadline
-- table lives in TypeScript and this function must not grow a second copy of
-- it. It does resolve an expired lot itself, exactly as `dw_tick` does for a
-- legacy draft, because that is the auction's own clock rather than the
-- match's.
-- ---------------------------------------------------------------------------

create or replace function dw_match_tick(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  m      matches%rowtype;
  g      games%rowtype;
  a      auctions%rowtype;
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

    -- The round has reached its draft but nobody has opened it yet.
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

    -- The draft closed itself. The phase move is the Node layer's to make.
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('ROUND_AUCTION_COMPLETE'),
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
-- 11. Reading a match
--
-- Extended, not replaced in spirit: the same shape as 0030 plus what a round
-- needs. Every derived answer — who still owes this round a character, whether
-- the round demands one at all — is computed here rather than in the browser,
-- because a client that works out "you still need to buy" for itself is a
-- client that can be wrong about it.
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

  -- Who this round is still waiting on. Empty in an optional round once the
  -- draft has closed, which is exactly the difference the UI has to show.
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

-- ---------------------------------------------------------------------------
-- 12. Leaving a match
--
-- Unchanged from 0030 except for one line, and that line is the point: a match
-- ending must not write its economy back onto `players.credits`. There is no
-- transfer in either direction, ever — that is what "authoritative" means.
-- ---------------------------------------------------------------------------

create or replace function dw_abandon_match(p_room_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.current_match_id is null then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  update matches set status = 'ABANDONED', finished_at = now()
   where id = v_room.current_match_id and status = 'ACTIVE';
  update games set status = 'ABANDONED'
   where match_id = v_room.current_match_id and status = 'ACTIVE';
  update rooms set phase = 'LOBBY', current_match_id = null, current_game_id = null
   where id = p_room_id;
  update players set is_ready = false where room_id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 13. The arities nobody calls any more
--
-- Found by auditing 0031 rather than by writing it. `dw_place_bid` has existed
-- at two arities since 0019 added an idempotency key: the four-argument version
-- the application calls, and a three-argument one left behind from 0005. Both
-- are live functions. PostgREST resolves by the named arguments in the request
-- and the client always sends `p_action_id`, so the old one is unreachable
-- through the app — but it still contains the pre-S8 body, which reads
-- `players.credits` directly.
--
-- Before this migration that was merely old. After it, it is *wrong*: a bid in
-- a match checked against the legacy wallet. The same applies to the
-- two-argument `dw_pass_auction` from 0001, which carries the pass rule without
-- the optional-round branch and would force a purchase in round seven.
--
-- Rather than drop them — a drop is the one operation this project's migrations
-- never perform — each is replaced by a delegator. There is now exactly one
-- implementation of each rule, whichever arity is called.
-- ---------------------------------------------------------------------------

create or replace function dw_place_bid(
  p_player_id uuid, p_auction_id uuid, p_amount int
) returns jsonb language sql security definer as $$
  select dw_place_bid(p_player_id, p_auction_id, p_amount, null::text);
$$;

create or replace function dw_pass_auction(
  p_player_id uuid, p_auction_id uuid
) returns jsonb language sql security definer as $$
  select dw_pass_auction(p_player_id, p_auction_id, null::text);
$$;
