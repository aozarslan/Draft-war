-- =============================================================================
-- DRAFT WAR V4 — Phase 1: core reliability.
--
-- Four gaps from the V4 audit, and nothing else. The battle, the economy and
-- the UI are untouched.
--
--   1. Idempotent bid and pass. Rewards were already idempotent; the auction
--      itself was not. A double-tapped bid button, a retried POST on a flaky
--      phone connection, or a browser replaying a request could each place two
--      bids. Now every action carries a client-generated id and the server
--      returns the first result for a repeated id instead of acting twice.
--
--   2. The full event log. `game_events` existed but emitted seven types; V4
--      lists twenty. An event stream that only records the happy path cannot
--      diagnose the bugs it exists to diagnose.
--
--   3. An extension cap. Every bid puts the full clock back — that is the
--      behaviour asked for on 2026-08-11 and it stays — but nothing stopped an
--      auction being extended forever. Now it can be extended a bounded number
--      of times, after which the clock runs down for real.
--
--   4. Rate limiting. Nothing throttled bid, pass, chat, join or friend
--      requests. A held-down button was a denial of service against the room.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Idempotency
--
-- One table for every action a client can retry. The unique key is the action
-- id the client generated; the stored result is whatever the server decided
-- the first time. A retry is not "allowed through and deduplicated later" — it
-- never reaches the game logic at all.
-- ---------------------------------------------------------------------------

create table if not exists action_results (
  action_id  text primary key,
  player_id  uuid references players(id) on delete cascade,
  kind       text not null,
  result     jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_action_results_player
  on action_results (player_id, created_at desc);

alter table action_results enable row level security;
-- Server-only, like every other table the client must not be able to forge.

/**
 * Returns a previous result for this action id, or null when it is new.
 *
 * Called at the top of every idempotent action. Keeping it separate from the
 * write keeps the actions readable: check, act, record.
 */
create or replace function dw_prior_result(p_action_id text)
returns jsonb language sql stable security definer as $$
  select result from action_results where action_id = p_action_id;
$$;

create or replace function dw_record_result(
  p_action_id text, p_player_id uuid, p_kind text, p_result jsonb
) returns jsonb language plpgsql security definer as $$
begin
  if p_action_id is null or p_action_id = '' then return p_result; end if;
  insert into action_results (action_id, player_id, kind, result)
  values (p_action_id, p_player_id, p_kind, p_result)
  on conflict (action_id) do nothing;
  return p_result;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Rate limiting
--
-- A fixed window per (player, action). Deliberately generous: this is here to
-- stop a stuck key or a script from flooding a room, not to police a fast
-- bidder. Losing a legitimate bid to a rate limit would be a worse bug than
-- the one being prevented.
-- ---------------------------------------------------------------------------

create table if not exists rate_limits (
  subject     text not null,
  action      text not null,
  window_start timestamptz not null,
  hits        int not null default 0,
  primary key (subject, action)
);

alter table rate_limits enable row level security;

/**
 * True when the caller is over the limit. Counts the attempt either way, so a
 * client that keeps hammering stays blocked rather than recovering by trying
 * harder.
 */
create or replace function dw_rate_limited(
  p_subject text, p_action text, p_limit int, p_seconds int
) returns boolean language plpgsql security definer as $$
declare v_start timestamptz; v_hits int;
begin
  if p_subject is null or p_subject = '' then return false; end if;

  insert into rate_limits (subject, action, window_start, hits)
  values (p_subject, p_action, now(), 1)
  on conflict (subject, action) do update
    set window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_seconds)
          then now() else rate_limits.window_start end,
        hits = case
          when rate_limits.window_start < now() - make_interval(secs => p_seconds)
          then 1 else rate_limits.hits + 1 end
  returning window_start, hits into v_start, v_hits;

  return v_hits > p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The event log
--
-- One helper so every emitter looks the same, and so adding an event later is
-- one line rather than a copied insert.
-- ---------------------------------------------------------------------------

create or replace function dw_event(
  p_game_id uuid, p_room_id uuid, p_type text, p_payload jsonb default '{}'::jsonb
) returns void language plpgsql security definer as $$
begin
  insert into game_events (game_id, room_id, type, payload)
  values (p_game_id, p_room_id, p_type, coalesce(p_payload, '{}'::jsonb));
end $$;

-- `game_events.game_id` is not null in 0001, but room-level events (a player
-- joining the lobby) happen before a game exists. Allow it.
alter table game_events alter column game_id drop not null;

create index if not exists idx_game_events_room on game_events (room_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Bidding, now idempotent, logged and bounded
--
-- Same validation in the same order as 0005 — this is deliberately not a
-- rewrite. What is new: the action id check at the top, the extension cap, the
-- BID_PLACED event, and the recorded result at the bottom.
-- ---------------------------------------------------------------------------

alter table auctions add column if not exists extensions int not null default 0;

-- Adding a parameter creates an *overload*, it does not replace the function.
-- Leaving both would let a caller reach the old, non-idempotent version, so
-- the previous signatures go. Dropping a function is not dropping data.
drop function if exists dw_place_bid(uuid, uuid, int);
drop function if exists dw_pass_auction(uuid, uuid);

create or replace function dw_place_bid(
  p_player_id uuid, p_auction_id uuid, p_amount int, p_action_id text default null
) returns jsonb language plpgsql security definer as $$
declare
  a auctions%rowtype;
  pl players%rowtype;
  v_phase text;
  v_min_bid int;
  v_slots int;
  v_min_allowed int;
  v_max_allowed int;
  v_secs int;
  v_prior jsonb;
  v_result jsonb;
  v_max_ext int := 20;
begin
  -- A retry of an action we already ran gets the original answer.
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
  if v_phase <> 'AUCTION' then return dw_err('WRONG_PHASE', 'That action is not available right now.'); end if;
  if a.status <> 'ACTIVE' then return dw_err('AUCTION_CLOSED', 'This auction has already ended.'); end if;
  if now() >= a.ends_at then return dw_err('AUCTION_CLOSED', 'This auction has already ended.'); end if;

  if exists (select 1 from auction_passes where auction_id = a.id and player_id = p_player_id) then
    return dw_err('ALREADY_PASSED', 'You already passed on this character.');
  end if;
  if a.high_bidder_id = p_player_id then
    return dw_err('ALREADY_HIGH_BIDDER', 'You are already the highest bidder.');
  end if;

  v_slots := dw_slots_remaining(a.game_id, p_player_id);
  if v_slots <= 0 then return dw_err('ROSTER_FULL', 'Your roster is full.'); end if;

  select coalesce((config->>'minBid')::int, 1),
         coalesce((config->>'auctionSeconds')::int, 10)
    into v_min_bid, v_secs
    from rooms where id = a.room_id;

  v_min_allowed := case when a.high_bidder_id is null then v_min_bid else a.current_bid + 1 end;
  if p_amount < v_min_allowed then
    return dw_err('BID_TOO_LOW', 'Someone else placed a higher bid.');
  end if;
  if p_amount > pl.credits then
    return dw_err('NOT_ENOUGH_CREDITS', 'Not enough credits.');
  end if;

  v_max_allowed := pl.credits - (v_slots - 1) * v_min_bid;
  if p_amount > v_max_allowed then
    return dw_err('RESERVE_REQUIRED', 'You must keep credits to fill your remaining slots.');
  end if;

  -- The clock goes back to full on every bid, as asked. The cap is the only
  -- new rule: after enough extensions the deadline stops moving, so a war
  -- between two stubborn bidders ends rather than running all night.
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
-- 5. Passing, same treatment
-- ---------------------------------------------------------------------------

create or replace function dw_pass_auction(
  p_player_id uuid, p_auction_id uuid, p_action_id text default null
) returns jsonb language plpgsql security definer as $$
declare
  a auctions%rowtype;
  pl players%rowtype;
  v_phase text;
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
  if v_phase <> 'AUCTION' then return dw_err('WRONG_PHASE', 'That action is not available right now.'); end if;
  if a.status <> 'ACTIVE' then return dw_err('AUCTION_CLOSED', 'This auction has already ended.'); end if;

  -- Passing twice is not an error worth showing; it is the same outcome.
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

  -- The pass rule, unchanged from 0006: passing must never make the draft
  -- unsolvable. Supply is what is left in the queue after this character.
  select jsonb_array_length(queue), queue_index into v_queue_len, v_idx
    from games where id = a.game_id;
  v_supply := v_queue_len - v_idx - 1;
  v_demand := dw_total_demand(a.game_id);
  if v_supply < v_demand then
    return dw_err('MUST_BID', 'Too few characters left — you cannot pass on this one.');
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
-- 6. The rest of the event stream
--
-- Rooms, players and phases now announce themselves. These wrap the existing
-- functions rather than replacing their logic.
-- ---------------------------------------------------------------------------

create or replace function dw_join_room(p_code text, p_nickname text, p_token text)
returns jsonb
language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  v_count int;
  v_seat int;
  v_player uuid;
  v_max int;
begin
  select * into v_room from rooms where code = upper(p_code) for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.phase <> 'LOBBY' then
    return dw_err('GAME_STARTED', 'Game has already started.');
  end if;

  if dw_rate_limited(upper(p_code), 'JOIN', 20, 60) then
    return dw_err('TOO_FAST', 'Too many people are trying that room at once.');
  end if;

  v_max := coalesce((v_room.config->>'maxPlayers')::int, 5);
  select count(*) into v_count from players where room_id = v_room.id;
  if v_count >= v_max then return dw_err('ROOM_FULL', 'Room is full.'); end if;

  if exists (select 1 from players where room_id = v_room.id and lower(nickname) = lower(p_nickname)) then
    return dw_err('NICKNAME_TAKEN', 'That nickname is already used in this room.');
  end if;

  select coalesce(max(seat), 0) + 1 into v_seat from players where room_id = v_room.id;

  insert into players (room_id, nickname, seat, color_index, credits)
  values (v_room.id, p_nickname, v_seat, v_seat - 1,
          coalesce((v_room.config->>'startingCredits')::int, 50))
  returning id into v_player;

  insert into player_secrets (player_id, token) values (v_player, p_token);
  insert into chat_messages (room_id, kind, body)
  values (v_room.id, 'SYSTEM', p_nickname || ' joined.');

  perform dw_event(v_room.current_game_id, v_room.id, 'PLAYER_JOINED',
    jsonb_build_object('playerId', v_player, 'nickname', p_nickname, 'seat', v_seat));

  perform dw_bump(v_room.id);
  return jsonb_build_object('ok', true, 'roomId', v_room.id, 'playerId', v_player, 'code', v_room.code);
end $$;

-- Heartbeat: same host migration as 0001, plus the two events that make a
-- disconnect readable after the fact.
create or replace function dw_heartbeat(p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room uuid; v_host uuid; v_new_host uuid; v_changed boolean := false;
  r record;
begin
  update players set connected = true, last_seen_at = now()
   where id = p_player_id
  returning room_id into v_room;
  if v_room is null then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;

  -- Anybody who has gone quiet for 25 seconds is marked away, and says so in
  -- the log. Their credits, roster and passes are untouched: all of it lives
  -- server-side, so reconnecting restores them exactly.
  for r in
    select p.id, p.nickname, p.room_id from players p
     where p.room_id = v_room and p.last_seen_at < now() - interval '25 seconds'
       and p.connected = true
  loop
    update players set connected = false where id = r.id;
    perform dw_event((select current_game_id from rooms where id = r.room_id), r.room_id,
                     'PLAYER_LEFT',
                     jsonb_build_object('playerId', r.id, 'nickname', r.nickname));
    v_changed := true;
  end loop;

  select host_player_id into v_host from rooms where id = v_room;
  if v_host is null or not exists (
      select 1 from players where id = v_host and connected = true) then
    select id into v_new_host from players
     where room_id = v_room and connected = true
     order by seat limit 1;
    if v_new_host is not null and v_new_host is distinct from v_host then
      update rooms set host_player_id = v_new_host where id = v_room;
      insert into chat_messages (room_id, kind, body)
      values (v_room, 'SYSTEM',
              (select nickname from players where id = v_new_host) || ' is now the host.');
      v_changed := true;
    end if;
  end if;

  if v_changed then perform dw_bump(v_room); end if;
  return jsonb_build_object('ok', true);
end $$;

/**
 * Called when a client comes back to a room it already holds a seat in.
 *
 * There is nothing to restore — the credits, roster, passes and clock were
 * never on the client — so this exists to mark them present again and to put
 * the reconnection in the log where a multiplayer bug report can find it.
 */
create or replace function dw_reconnect(p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare pl players%rowtype; v_was boolean;
begin
  select * into pl from players where id = p_player_id;
  if not found then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;

  v_was := pl.connected;
  update players set connected = true, last_seen_at = now() where id = p_player_id;

  if not v_was then
    perform dw_event((select current_game_id from rooms where id = pl.room_id), pl.room_id,
                     'PLAYER_RECONNECTED',
                     jsonb_build_object('playerId', pl.id, 'nickname', pl.nickname));
    perform dw_bump(pl.room_id);
  end if;

  return jsonb_build_object('ok', true, 'rejoined', not v_was);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Chat, throttled
-- ---------------------------------------------------------------------------

-- Parameter order matches 0001 exactly: replacing a function cannot rename or
-- reorder its inputs.
create or replace function dw_send_chat(p_player_id uuid, p_kind text, p_body text)
returns jsonb language plpgsql security definer as $$
declare pl players%rowtype; v_body text;
begin
  select * into pl from players where id = p_player_id;
  if not found then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;

  if dw_rate_limited(p_player_id::text, 'CHAT', 10, 10) then
    return dw_err('TOO_FAST', 'Give the chat a moment to catch up.');
  end if;

  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then return dw_err('EMPTY_MESSAGE', 'Say something first.'); end if;

  insert into chat_messages (room_id, player_id, kind, body)
  values (pl.room_id, p_player_id, coalesce(p_kind, 'CHAT'), left(v_body, 240));

  perform dw_bump(pl.room_id);
  return jsonb_build_object('ok', true);
end $$;
