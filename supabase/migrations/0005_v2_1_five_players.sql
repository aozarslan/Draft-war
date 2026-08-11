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
