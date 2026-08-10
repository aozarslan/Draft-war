-- =============================================================================
-- DRAFT WAR V2 — categories, richer characters, Wikipedia provenance, and a
-- bidding clock that resets instead of nudging.
--
-- This migration is additive. Every V1 table, function and row survives:
--   * new character columns default sensibly, so old rows stay readable
--   * the 20 V1 characters are migrated into the new shape, tagged as legacy
--     and disabled for drafting rather than deleted
--   * a room created before V2 has no category and is treated as ACTION_MOVIES
-- Re-running it is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Characters gain a category and everything the new card needs
-- ---------------------------------------------------------------------------

alter table characters add column if not exists category      text not null default 'action-movies';
alter table characters add column if not exists version       text;
alter table characters add column if not exists description   text not null default '';
alter table characters add column if not exists actor         text;
alter table characters add column if not exists stats         jsonb not null default '{}'::jsonb;
alter table characters add column if not exists game_power    int  not null default 0;
alter table characters add column if not exists abilities     text[] not null default '{}';
alter table characters add column if not exists wiki_title    text;
alter table characters add column if not exists wiki_url      text;
alter table characters add column if not exists thumbnail_url text;
alter table characters add column if not exists image_source  text;
alter table characters add column if not exists image_license text;
alter table characters add column if not exists image_credit  text;
alter table characters add column if not exists metadata      jsonb not null default '{}'::jsonb;

create index if not exists idx_characters_category on characters (category) where enabled;
create index if not exists idx_characters_power    on characters (category, game_power desc);

-- V1 rows: project the five old columns onto the action-movie stat schema so
-- they still render, then retire them from drafting. Nothing is deleted —
-- finished games still reference these ids.
update characters
   set stats = jsonb_build_object(
         'combat',     power,
         'speed',      speed,
         'weapons',    special,
         'tactics',    tactics,
         'durability', defense,
         'special',    special),
       game_power = round((power + speed + defense + tactics + special) / 5.0),
       category   = 'action-movies',
       metadata   = metadata || '{"legacy": true}'::jsonb,
       enabled    = false
 where stats = '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Rooms and games learn about categories
-- ---------------------------------------------------------------------------

alter table rooms add column if not exists category_ids        text[] not null default '{}';
alter table rooms add column if not exists category_candidates jsonb;
alter table rooms add column if not exists category_deadline   timestamptz;
alter table rooms add column if not exists category_mode       text not null default 'HOST';

alter table games add column if not exists category_ids text[] not null default '{}';

-- The CATEGORY phase sits between the lobby and the auction.
alter table rooms drop constraint if exists rooms_phase_check;
alter table rooms add constraint rooms_phase_check check (
  phase in ('LOBBY','CATEGORY','AUCTION','TEAM_REVIEW','MAP_SELECTION',
            'EVENT','BATTLE','RESULTS','FINISHED'));

create table if not exists category_votes (
  room_id     uuid not null references rooms(id) on delete cascade,
  player_id   uuid not null references players(id) on delete cascade,
  category_id text not null,
  created_at  timestamptz not null default now(),
  primary key (room_id, player_id)
);

alter table category_votes enable row level security;

-- ---------------------------------------------------------------------------
-- 3. Category selection
-- ---------------------------------------------------------------------------

-- Opens the CATEGORY phase. Same start guards as dw_start_game, because this
-- is now the button the host actually presses.
create or replace function dw_begin_category(
  p_room_id uuid, p_player_id uuid, p_mode text,
  p_candidates jsonb, p_seconds int
) returns jsonb
language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  v_players int;
  v_unready int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.phase <> 'LOBBY' then return dw_err('WRONG_PHASE', 'Game has already started.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can start the game.');
  end if;

  select count(*) into v_players from players where room_id = p_room_id;
  if v_players < coalesce((v_room.config->>'minPlayers')::int, 2) then
    return dw_err('NOT_ENOUGH_PLAYERS', 'Not enough players to start.');
  end if;

  select count(*) into v_unready from players where room_id = p_room_id and is_ready = false;
  if v_unready > 0 then return dw_err('NOT_ALL_READY', 'Everyone must be ready.'); end if;

  delete from category_votes where room_id = p_room_id;

  update rooms
     set phase = 'CATEGORY',
         category_mode = p_mode,
         category_ids = '{}',
         category_candidates = p_candidates,
         category_deadline = case when p_seconds is null then null
                                  else now() + make_interval(secs => p_seconds) end
   where id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function dw_vote_category(p_player_id uuid, p_category_id text)
returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype; v_ok boolean;
begin
  select r.* into v_room from rooms r join players p on p.room_id = r.id where p.id = p_player_id;
  if not found then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;
  if v_room.phase <> 'CATEGORY' then
    return dw_err('WRONG_PHASE', 'That action is not available right now.');
  end if;
  if v_room.category_mode <> 'VOTE' then
    return dw_err('NOT_VOTING', 'The host is choosing the category.');
  end if;

  select (v_room.category_candidates ? p_category_id) into v_ok;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_CATEGORY', 'That category is not on the ballot.');
  end if;

  insert into category_votes (room_id, player_id, category_id)
  values (v_room.id, p_player_id, p_category_id)
  on conflict (room_id, player_id) do update set category_id = excluded.category_id;

  perform dw_bump(v_room.id);
  return jsonb_build_object('ok', true);
end $$;

-- Locks the selection in. Idempotent: the first writer wins so a vote deadline
-- and a host click racing each other cannot produce two different categories.
create or replace function dw_lock_category(p_room_id uuid, p_category_ids text[])
returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.phase <> 'CATEGORY' then
    return jsonb_build_object('ok', true, 'noop', true, 'categoryIds', v_room.category_ids);
  end if;
  if array_length(v_room.category_ids, 1) > 0 then
    return jsonb_build_object('ok', true, 'noop', true, 'categoryIds', v_room.category_ids);
  end if;
  if array_length(p_category_ids, 1) is null then
    return dw_err('INVALID_CATEGORY', 'Pick at least one category.');
  end if;

  -- Locking does not start the game. It sets a short deadline so every client
  -- gets the "CATEGORY SELECTED" beat before the first character appears —
  -- especially the point of the random mode.
  update rooms
     set category_ids = p_category_ids,
         category_deadline = now() + interval '4 seconds'
   where id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'categoryIds', p_category_ids);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Starting a game now records which categories are in play
-- ---------------------------------------------------------------------------

create or replace function dw_start_game(
  p_room_id uuid, p_player_id uuid, p_seed text, p_queue jsonb,
  p_per_player int, p_category_ids text[] default '{}'
) returns jsonb
language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  v_players int;
  v_unready int;
  v_game uuid;
  v_no int;
  v_first text;
  v_secs int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  -- V2: the game starts from the CATEGORY phase. LOBBY is still accepted so a
  -- host who skipped category selection (single-category config) still works.
  if v_room.phase not in ('LOBBY', 'CATEGORY') then
    return dw_err('WRONG_PHASE', 'Game has already started.');
  end if;
  -- p_player_id null means the system advanced this (a vote deadline expired).
  if p_player_id is not null and v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can start the game.');
  end if;

  select count(*) into v_players from players where room_id = p_room_id;
  if v_players < coalesce((v_room.config->>'minPlayers')::int, 2) then
    return dw_err('NOT_ENOUGH_PLAYERS', 'Not enough players to start.');
  end if;

  if v_room.phase = 'LOBBY' then
    select count(*) into v_unready from players where room_id = p_room_id and is_ready = false;
    if v_unready > 0 then return dw_err('NOT_ALL_READY', 'Everyone must be ready.'); end if;
  end if;

  if jsonb_array_length(p_queue) < v_players * p_per_player then
    return dw_err('POOL_TOO_SMALL', 'Not enough characters in this category for this many players.');
  end if;

  select coalesce(max(game_no), 0) + 1 into v_no from games where room_id = p_room_id;

  insert into games (room_id, game_no, seed, queue, characters_per_player, category_ids)
  values (p_room_id, v_no, p_seed, p_queue, p_per_player,
          case when array_length(p_category_ids, 1) is null
               then v_room.category_ids else p_category_ids end)
  returning id into v_game;

  update players
     set credits = coalesce((v_room.config->>'startingCredits')::int, 40),
         is_ready = false
   where room_id = p_room_id;

  v_secs := coalesce((v_room.config->>'auctionSeconds')::int, 30);
  v_first := p_queue->>0;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (v_game, p_room_id, v_first, 0, now() + make_interval(secs => v_secs));

  update rooms
     set phase = 'AUCTION', current_game_id = v_game,
         category_candidates = null, category_deadline = null
   where id = p_room_id;

  insert into game_events (game_id, room_id, type, payload)
  values (v_game, p_room_id, 'GAME_STARTED',
          jsonb_build_object('players', v_players, 'perPlayer', p_per_player,
                             'categories', to_jsonb(p_category_ids)));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'gameId', v_game);
end $$;

-- ---------------------------------------------------------------------------
-- 5. BIDDING CLOCK — V2 behaviour
--
-- V1 nudged the deadline by 5 seconds only when a bid landed in the final 5.
-- V2 puts the whole clock back on every accepted bid: a character sells when
-- nobody has answered for a full `auctionSeconds`, which is easier to explain
-- out loud and keeps bidding wars alive.
-- ---------------------------------------------------------------------------
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
         coalesce((config->>'auctionSeconds')::int, 30)
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

-- Opening a character also uses the configured clock (default is now 30s).
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
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 30);
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

-- ---------------------------------------------------------------------------
-- 6. Tick learns about the category phase
-- ---------------------------------------------------------------------------
create or replace function dw_tick(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  g games%rowtype;
  a auctions%rowtype;
  v_actions text[] := '{}';
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;

  if v_room.phase = 'CATEGORY' then
    if array_length(v_room.category_ids, 1) > 0 then
      -- Category settled: start once the reveal beat has played.
      if v_room.category_deadline is null or now() >= v_room.category_deadline then
        v_actions := array_append(v_actions, 'NEEDS_GAME_START');
      end if;
    elsif v_room.category_deadline is not null and now() >= v_room.category_deadline then
      v_actions := array_append(v_actions, 'NEEDS_CATEGORY_LOCK');
    end if;
    return jsonb_build_object('ok', true, 'actions', to_jsonb(v_actions));
  end if;

  if v_room.current_game_id is null then
    return jsonb_build_object('ok', true, 'actions', to_jsonb(v_actions));
  end if;

  select * into g from games where id = v_room.current_game_id;

  if v_room.phase = 'AUCTION' then
    select * into a from auctions
     where game_id = g.id and status = 'ACTIVE'
     order by order_index desc limit 1;
    if found and now() >= a.ends_at then
      perform dw_resolve_auction(a.id);
      v_actions := array_append(v_actions, 'AUCTION_RESOLVED');
    end if;

  elsif v_room.phase = 'TEAM_REVIEW' then
    if g.phase_deadline is not null and now() >= g.phase_deadline then
      v_actions := array_append(v_actions, 'NEEDS_MAP_SELECTION');
    end if;

  elsif v_room.phase = 'MAP_SELECTION' then
    if g.phase_deadline is not null and now() >= g.phase_deadline and g.map_id is null then
      v_actions := array_append(v_actions, 'NEEDS_MAP_LOCK');
    end if;

  elsif v_room.phase = 'EVENT' then
    if g.phase_deadline is not null and now() >= g.phase_deadline and g.battle_result is null then
      v_actions := array_append(v_actions, 'NEEDS_BATTLE');
    end if;

  elsif v_room.phase = 'BATTLE' then
    if g.phase_deadline is not null and now() >= g.phase_deadline then
      update rooms set phase = 'RESULTS' where id = p_room_id and phase = 'BATTLE';
      perform dw_bump(p_room_id);
      v_actions := array_append(v_actions, 'RESULTS');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'actions', to_jsonb(v_actions));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Play again clears the category selection too
-- ---------------------------------------------------------------------------
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
  update players set is_ready = false, credits = coalesce((v_room.config->>'startingCredits')::int, 40)
   where room_id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Snapshot carries the category state and the richer character fields
-- ---------------------------------------------------------------------------
create or replace function dw_snapshot(p_room_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_room rooms%rowtype;
  g games%rowtype;
  v_auction jsonb;
  v_players jsonb;
  v_chat jsonb;
  v_votes jsonb;
  v_cat_votes jsonb;
  v_events jsonb;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;

  if v_room.current_game_id is not null then
    select * into g from games where id = v_room.current_game_id;
  end if;

  select coalesce(jsonb_agg(x order by x->>'seat'), '[]'::jsonb) into v_players from (
    select jsonb_build_object(
      'id', p.id, 'nickname', p.nickname, 'seat', p.seat, 'colorIndex', p.color_index,
      'isHost', (p.id = v_room.host_player_id), 'isReady', p.is_ready,
      'connected', p.connected, 'credits', p.credits,
      'wins', p.wins, 'losses', p.losses, 'points', p.points, 'gamesPlayed', p.games_played,
      'roster', coalesce((
        select jsonb_agg(jsonb_build_object('characterId', tc.character_id, 'price', tc.price)
                         order by tc.acquired_at)
        from team_characters tc
        where tc.player_id = p.id and tc.game_id = v_room.current_game_id), '[]'::jsonb)
    ) as x
    from players p where p.room_id = p_room_id
  ) s;

  if g.id is not null then
    select jsonb_build_object(
      'id', a.id, 'characterId', a.character_id, 'orderIndex', a.order_index,
      'status', a.status, 'currentBid', a.current_bid, 'highBidderId', a.high_bidder_id,
      'endsAt', a.ends_at, 'startedAt', a.started_at,
      'winnerId', a.winner_id, 'finalPrice', a.final_price,
      'passedPlayerIds', coalesce((select jsonb_agg(ap.player_id) from auction_passes ap where ap.auction_id = a.id), '[]'::jsonb),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object('playerId', b.player_id, 'amount', b.amount, 'at', b.created_at)
               order by b.created_at desc)
        from (select * from bids where auction_id = a.id order by created_at desc limit 12) b), '[]'::jsonb)
    ) into v_auction
    from auctions a
    where a.game_id = g.id and a.status = 'ACTIVE'
    order by a.order_index desc limit 1;

    select coalesce(jsonb_object_agg(player_id, map_id), '{}'::jsonb) into v_votes
    from map_votes where game_id = g.id;

    select coalesce(jsonb_agg(jsonb_build_object('type', ge.type, 'payload', ge.payload, 'at', ge.created_at)
                              order by ge.created_at desc), '[]'::jsonb)
      into v_events
    from (select * from game_events where game_id = g.id order by created_at desc limit 40) ge;
  end if;

  select coalesce(jsonb_object_agg(player_id, category_id), '{}'::jsonb) into v_cat_votes
  from category_votes where room_id = p_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'playerId', c.player_id, 'kind', c.kind, 'body', c.body, 'at', c.created_at
    ) order by c.created_at), '[]'::jsonb) into v_chat
  from (select * from chat_messages where room_id = p_room_id order by created_at desc limit 60) c;

  return jsonb_build_object(
    'ok', true,
    'serverTime', now(),
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'name', v_room.name, 'phase', v_room.phase,
      'hostPlayerId', v_room.host_player_id, 'config', v_room.config,
      'stateVersion', v_room.state_version, 'gamesPlayed', v_room.games_played,
      'categoryIds', to_jsonb(v_room.category_ids),
      'categoryCandidates', v_room.category_candidates,
      'categoryDeadline', v_room.category_deadline,
      'categoryMode', v_room.category_mode
    ),
    'players', v_players,
    'game', case when g.id is null then null else jsonb_build_object(
      'id', g.id, 'gameNo', g.game_no, 'status', g.status, 'seed', g.seed,
      'queue', g.queue, 'queueIndex', g.queue_index,
      'charactersPerPlayer', g.characters_per_player,
      'categoryIds', to_jsonb(g.category_ids),
      'mapId', g.map_id, 'eventId', g.event_id, 'mapCandidates', g.map_candidates,
      'phaseDeadline', g.phase_deadline, 'battleStartedAt', g.battle_started_at,
      'battleResult', g.battle_result
    ) end,
    'auction', v_auction,
    'mapVotes', coalesce(v_votes, '{}'::jsonb),
    'categoryVotes', coalesce(v_cat_votes, '{}'::jsonb),
    'events', coalesce(v_events, '[]'::jsonb),
    'chat', v_chat
  );
end $$;

-- ---------------------------------------------------------------------------
-- 9. Character upsert used by the admin importer
-- ---------------------------------------------------------------------------
create or replace function dw_upsert_character(p_character jsonb)
returns jsonb language plpgsql security definer as $$
begin
  insert into characters (
    id, name, title, universe, rarity, category, version, description, actor,
    stats, game_power, abilities, tags, base_price,
    wiki_title, wiki_url, image_url, thumbnail_url,
    image_source, image_license, image_credit, palette, enabled,
    power, speed, defense, tactics, special, special_ability, metadata
  ) values (
    p_character->>'id',
    p_character->>'name',
    coalesce(p_character->>'title', ''),
    coalesce(p_character->>'universe', ''),
    coalesce(p_character->>'rarity', 'RARE'),
    coalesce(p_character->>'categoryId', 'action-movies'),
    p_character->>'version',
    coalesce(p_character->>'description', ''),
    p_character->>'actor',
    coalesce(p_character->'stats', '{}'::jsonb),
    coalesce((p_character->>'gamePower')::int, 0),
    coalesce(array(select jsonb_array_elements_text(p_character->'abilities')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_character->'tags')), '{}'),
    coalesce((p_character->>'basePrice')::int, 5),
    p_character->>'wikiTitle',
    p_character->>'wikiUrl',
    p_character->>'imageUrl',
    p_character->>'thumbnailUrl',
    p_character->>'imageSource',
    p_character->>'imageLicense',
    p_character->>'imageCredit',
    coalesce(array(select jsonb_array_elements_text(p_character->'palette')), array['#7c3aed','#22d3ee']),
    coalesce((p_character->>'enabled')::boolean, true),
    -- Legacy V1 columns kept in sync so nothing that still reads them breaks.
    coalesce((p_character->'stats'->>'power')::int, (p_character->>'gamePower')::int, 50),
    coalesce((p_character->'stats'->>'speed')::int, (p_character->>'gamePower')::int, 50),
    coalesce((p_character->'stats'->>'durability')::int, (p_character->'stats'->>'defense')::int, (p_character->>'gamePower')::int, 50),
    coalesce((p_character->'stats'->>'tactics')::int, (p_character->'stats'->>'intelligence')::int, (p_character->>'gamePower')::int, 50),
    coalesce((p_character->'stats'->>'special')::int, (p_character->>'gamePower')::int, 50),
    coalesce(p_character->'abilities'->>0, ''),
    coalesce(p_character->'metadata', '{}'::jsonb)
  )
  on conflict (id) do update set
    name = excluded.name, title = excluded.title, universe = excluded.universe,
    rarity = excluded.rarity, category = excluded.category, version = excluded.version,
    description = excluded.description, actor = excluded.actor,
    stats = excluded.stats, game_power = excluded.game_power,
    abilities = excluded.abilities, tags = excluded.tags, base_price = excluded.base_price,
    wiki_title = excluded.wiki_title, wiki_url = excluded.wiki_url,
    image_url = excluded.image_url, thumbnail_url = excluded.thumbnail_url,
    image_source = excluded.image_source, image_license = excluded.image_license,
    image_credit = excluded.image_credit, palette = excluded.palette,
    enabled = excluded.enabled,
    power = excluded.power, speed = excluded.speed, defense = excluded.defense,
    tactics = excluded.tactics, special = excluded.special,
    special_ability = excluded.special_ability, metadata = excluded.metadata;

  return jsonb_build_object('ok', true, 'id', p_character->>'id');
end $$;

-- Character counts per category, for the category picker.
create or replace function dw_category_counts()
returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_object_agg(category, n), '{}'::jsonb)
  from (select category, count(*) as n from characters where enabled group by category) t;
$$;
