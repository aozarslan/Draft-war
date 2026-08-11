-- =============================================================================
-- DRAFT WAR V2.1 — five players, 50 credits, 25 characters.
--
-- Additive and safe to re-run. Nothing here changes an in-progress game: the
-- room's own config JSON still wins, and these fallbacks only apply to a key
-- that is missing entirely.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Host can resize the room from the lobby
-- ---------------------------------------------------------------------------
create or replace function dw_set_max_players(
  p_room_id uuid, p_player_id uuid, p_max int
) returns jsonb
language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
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
  if p_max < 2 or p_max > 5 then
    return dw_err('BAD_SIZE', 'A room holds between 2 and 5 players.');
  end if;

  -- Never shrink below the people already sitting down.
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

-- ---------------------------------------------------------------------------
-- 2. Defaults follow the new standard game
--
-- Every room our API creates carries these keys explicitly, so these coalesce
-- fallbacks only matter for a hand-made room. Keeping them in step avoids a
-- room that silently plays by V1 numbers.
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

  perform dw_bump(v_room.id);
  return jsonb_build_object('ok', true, 'roomId', v_room.id, 'playerId', v_player, 'code', v_room.code);
end $$;

create or replace function dw_place_bid(p_player_id uuid, p_auction_id uuid, p_amount int)
returns jsonb language plpgsql security definer as $$
declare
  a auctions%rowtype;
  pl players%rowtype;
  v_phase text;
  v_min_bid int;
  v_slots int;
  v_min_allowed int;
  v_max_allowed int;
  v_secs int;
begin
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

  update auctions
     set current_bid = p_amount,
         high_bidder_id = p_player_id,
         ends_at = now() + make_interval(secs => v_secs)
   where id = a.id;

  insert into bids (auction_id, room_id, player_id, amount) values (a.id, a.room_id, p_player_id, p_amount);

  if dw_auction_is_dead(a.id) then
    perform dw_resolve_auction(a.id);
  else
    perform dw_bump(a.room_id);
  end if;

  return jsonb_build_object('ok', true, 'amount', p_amount);
end $$;

create or replace function dw_open_next_auction(p_game_id uuid)
returns void language plpgsql as $$
declare
  v_game games%rowtype;
  v_idx int;
  v_char text;
  v_secs int;
  v_demand int;
begin
  select * into v_game from games where id = p_game_id;
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 10);
  v_idx := v_game.queue_index;

  loop
    v_idx := v_idx + 1;
    v_demand := dw_total_demand(p_game_id);

    if v_demand <= 0 or v_idx >= jsonb_array_length(v_game.queue) then
      update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds'
       where id = p_game_id;
      update rooms set phase = 'TEAM_REVIEW' where id = v_game.room_id;
      insert into game_events (game_id, room_id, type, payload)
      values (p_game_id, v_game.room_id, 'AUCTION_COMPLETE', '{}'::jsonb);
      return;
    end if;

    v_char := v_game.queue->>v_idx;
    exit when not exists (
      select 1 from team_characters where game_id = p_game_id and character_id = v_char
    );
  end loop;

  update games set queue_index = v_idx where id = p_game_id;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (p_game_id, v_game.room_id, v_char, v_idx, now() + make_interval(secs => v_secs));
end $$;

-- Starting credits fallback for the remaining functions that hand them out.
create or replace function dw_return_to_lobby(p_room_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;

  update games set status = 'ABANDONED' where room_id = p_room_id and status = 'ACTIVE';
  delete from category_votes where room_id = p_room_id;
  update rooms
     set phase = 'LOBBY', current_game_id = null,
         category_ids = '{}', category_candidates = null, category_deadline = null
   where id = p_room_id;
  update players set is_ready = false,
                     credits = coalesce((v_room.config->>'startingCredits')::int, 50)
   where room_id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 3. A character nobody bid on must not shrink the draft
--
-- The draft holds exactly `players x roster` characters, so every one of them
-- has to find an owner. Passing is already blocked while supply is tight, but
-- an auction can still expire with no bids at all — everyone distracted, or a
-- player briefly disconnected — and the character was going UNSOLD. The draft
-- then ended short and a team went into battle with 3 of 5 characters, which
-- the game is not supposed to allow.
--
-- When that happens and the remaining characters can no longer fill every
-- roster, the character is handed at the floor price to whoever needs it most:
-- most empty slots, then most credits, then seat order. Deterministic, cheap
-- for the receiver, and it keeps the draft at 25/25.
-- ---------------------------------------------------------------------------
create or replace function dw_resolve_auction(p_auction_id uuid)
returns jsonb language plpgsql as $$
declare
  a auctions%rowtype;
  v_min int;
  v_len int;
  v_idx int;
  v_supply_after int;
  v_demand int;
  v_forced uuid;
begin
  select * into a from auctions where id = p_auction_id for update;
  if not found then return dw_err('NO_ACTIVE_AUCTION', 'There is no auction running.'); end if;
  if a.status <> 'ACTIVE' then
    return jsonb_build_object('ok', true, 'alreadyResolved', true);
  end if;

  select coalesce((config->>'minBid')::int, 1) into v_min from rooms where id = a.room_id;

  -- Nobody bid: decide whether the draft can afford to lose this character.
  if a.high_bidder_id is null then
    select jsonb_array_length(queue), queue_index into v_len, v_idx
      from games where id = a.game_id;
    v_supply_after := v_len - v_idx - 1;
    v_demand := dw_total_demand(a.game_id);

    if v_supply_after < v_demand then
      select p.id into v_forced
        from players p
       where p.room_id = a.room_id
         and dw_slots_remaining(a.game_id, p.id) > 0
         and p.credits >= v_min
       order by dw_slots_remaining(a.game_id, p.id) desc, p.credits desc, p.seat asc
       limit 1;

      if v_forced is not null then
        update auctions
           set status = 'SOLD', winner_id = v_forced, final_price = v_min,
               current_bid = v_min, high_bidder_id = v_forced, resolved_at = now()
         where id = a.id;

        update players set credits = credits - v_min where id = v_forced;

        insert into team_characters (game_id, room_id, player_id, character_id, price)
        values (a.game_id, a.room_id, v_forced, a.character_id, v_min)
        on conflict (game_id, character_id) do nothing;

        insert into game_events (game_id, room_id, type, payload)
        values (a.game_id, a.room_id, 'AUTO_ASSIGNED', jsonb_build_object(
          'characterId', a.character_id, 'playerId', v_forced, 'price', v_min));

        perform dw_open_next_auction(a.game_id);
        perform dw_bump(a.room_id);
        return jsonb_build_object('ok', true, 'resolved', true, 'autoAssigned', true);
      end if;
    end if;
  end if;

  if a.high_bidder_id is not null then
    update auctions
       set status = 'SOLD', winner_id = a.high_bidder_id, final_price = a.current_bid,
           resolved_at = now()
     where id = a.id;

    update players set credits = credits - a.current_bid where id = a.high_bidder_id;

    insert into team_characters (game_id, room_id, player_id, character_id, price)
    values (a.game_id, a.room_id, a.high_bidder_id, a.character_id, a.current_bid)
    on conflict (game_id, character_id) do nothing;

    insert into game_events (game_id, room_id, type, payload)
    values (a.game_id, a.room_id, 'SOLD', jsonb_build_object(
      'characterId', a.character_id, 'playerId', a.high_bidder_id, 'price', a.current_bid));
  else
    update auctions set status = 'UNSOLD', resolved_at = now() where id = a.id;
    insert into game_events (game_id, room_id, type, payload)
    values (a.game_id, a.room_id, 'UNSOLD', jsonb_build_object('characterId', a.character_id));
  end if;

  perform dw_open_next_auction(a.game_id);
  perform dw_bump(a.room_id);
  return jsonb_build_object('ok', true, 'resolved', true);
end $$;
