-- =============================================================================
-- DRAFT WAR — schema, constraints and the authoritative game functions.
--
-- Design rules:
--   * The client is never trusted. Every mutation goes through a function here.
--   * Anything that two players can race on (bids) takes a row lock first.
--   * Timers live in the database as `ends_at` timestamps; expiry is applied by
--     `dw_tick`, which any connected client may call and which is idempotent.
--   * Row Level Security is on for every table. Only `rooms` and
--     `chat_messages` are readable by the anon key, because Realtime needs to
--     read them to deliver change events. Everything else is reachable only
--     through the service role (server-side API routes).
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists rooms (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text,
  host_player_id  uuid,
  phase           text not null default 'LOBBY'
                  check (phase in ('LOBBY','AUCTION','TEAM_REVIEW','MAP_SELECTION',
                                   'EVENT','BATTLE','RESULTS','FINISHED')),
  config          jsonb not null,
  state_version   bigint not null default 0,
  current_game_id uuid,
  games_played    int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists players (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms(id) on delete cascade,
  nickname     text not null,
  seat         int not null,
  color_index  int not null,
  is_ready     boolean not null default false,
  connected    boolean not null default true,
  credits      int not null default 0,
  wins         int not null default 0,
  losses       int not null default 0,
  points       int not null default 0,
  games_played int not null default 0,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (room_id, seat)
);

-- Player identity secret. Deliberately in its own table with no anon policy so
-- that a leaked snapshot of `players` can never be used to impersonate anyone.
create table if not exists player_secrets (
  player_id uuid primary key references players(id) on delete cascade,
  token     text not null
);

create table if not exists characters (
  id              text primary key,
  name            text not null,
  title           text not null default '',
  universe        text not null default 'ACTION',
  rarity          text not null default 'RARE',
  power           int  not null,
  speed           int  not null,
  defense         int  not null,
  tactics         int  not null,
  special         int  not null,
  special_ability text not null default '',
  tags            text[] not null default '{}',
  base_price      int  not null default 5,
  image_url       text,
  palette         text[] not null default '{"#7c3aed","#22d3ee"}',
  enabled         boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists games (
  id                     uuid primary key default gen_random_uuid(),
  room_id                uuid not null references rooms(id) on delete cascade,
  game_no                int not null,
  status                 text not null default 'ACTIVE' check (status in ('ACTIVE','FINISHED','ABANDONED')),
  seed                   text not null,
  queue                  jsonb not null default '[]'::jsonb,
  queue_index            int not null default 0,
  characters_per_player  int not null,
  map_id                 text,
  event_id               text,
  map_candidates         jsonb,
  phase_deadline         timestamptz,
  battle_started_at      timestamptz,
  battle_result          jsonb,
  created_at             timestamptz not null default now(),
  finished_at            timestamptz,
  unique (room_id, game_no)
);

create table if not exists auctions (
  id             uuid primary key default gen_random_uuid(),
  game_id        uuid not null references games(id) on delete cascade,
  room_id        uuid not null references rooms(id) on delete cascade,
  character_id   text not null references characters(id),
  order_index    int not null,
  status         text not null default 'ACTIVE' check (status in ('ACTIVE','SOLD','UNSOLD')),
  current_bid    int not null default 0,
  high_bidder_id uuid references players(id) on delete set null,
  ends_at        timestamptz not null,
  started_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  winner_id      uuid references players(id) on delete set null,
  final_price    int,
  unique (game_id, order_index)
);

create table if not exists bids (
  id         uuid primary key default gen_random_uuid(),
  auction_id uuid not null references auctions(id) on delete cascade,
  room_id    uuid not null references rooms(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  amount     int not null,
  created_at timestamptz not null default now()
);

create table if not exists auction_passes (
  auction_id uuid not null references auctions(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (auction_id, player_id)
);

create table if not exists team_characters (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references games(id) on delete cascade,
  room_id      uuid not null references rooms(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  character_id text not null references characters(id),
  price        int not null,
  acquired_at  timestamptz not null default now(),
  unique (game_id, character_id)
);

create table if not exists map_votes (
  game_id   uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  map_id    text not null,
  primary key (game_id, player_id)
);

create table if not exists chat_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  player_id  uuid references players(id) on delete set null,
  kind       text not null default 'CHAT' check (kind in ('CHAT','REACTION','SYSTEM')),
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists game_events (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid references games(id) on delete cascade,
  room_id    uuid not null references rooms(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists battle_results (
  game_id          uuid primary key references games(id) on delete cascade,
  room_id          uuid not null references rooms(id) on delete cascade,
  winner_player_id uuid references players(id) on delete set null,
  mvp_player_id    uuid references players(id) on delete set null,
  mvp_character_id text,
  map_id           text,
  event_id         text,
  standings        jsonb not null,
  combatants       jsonb not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_players_room       on players (room_id);
create index if not exists idx_games_room         on games (room_id, game_no desc);
create index if not exists idx_auctions_game      on auctions (game_id, order_index);
create index if not exists idx_auctions_active    on auctions (room_id) where status = 'ACTIVE';
create index if not exists idx_bids_auction       on bids (auction_id, created_at desc);
create index if not exists idx_team_chars_game    on team_characters (game_id, player_id);
create index if not exists idx_chat_room          on chat_messages (room_id, created_at desc);
create index if not exists idx_events_game        on game_events (game_id, created_at desc);
create index if not exists idx_rooms_code         on rooms (code);

-- Room-scoped season table, exposed as a view over the aggregate columns.
create or replace view leaderboard as
  select p.room_id, p.id as player_id, p.nickname, p.color_index,
         p.wins, p.losses, p.points, p.games_played
  from players p;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table rooms            enable row level security;
alter table players          enable row level security;
alter table player_secrets   enable row level security;
alter table characters       enable row level security;
alter table games            enable row level security;
alter table auctions         enable row level security;
alter table bids             enable row level security;
alter table auction_passes   enable row level security;
alter table team_characters  enable row level security;
alter table map_votes        enable row level security;
alter table chat_messages    enable row level security;
alter table game_events      enable row level security;
alter table battle_results   enable row level security;

-- Realtime change feed only. Neither table holds anything secret: the room row
-- is a code plus a version counter, chat is public to the room by definition.
drop policy if exists rooms_read on rooms;
create policy rooms_read on rooms for select to anon, authenticated using (true);

drop policy if exists chat_read on chat_messages;
create policy chat_read on chat_messages for select to anon, authenticated using (true);

-- Character pool is static reference data and safe to read.
drop policy if exists characters_read on characters;
create policy characters_read on characters for select to anon, authenticated using (true);

-- Realtime publication
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table rooms'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table chat_messages'; exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Every mutation bumps this counter; clients treat a change as "refetch state".
create or replace function dw_bump(p_room_id uuid)
returns void language sql as $$
  update rooms set state_version = state_version + 1, updated_at = now()
  where id = p_room_id;
$$;

create or replace function dw_err(p_code text, p_message text)
returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message);
$$;

create or replace function dw_config(p_room_id uuid)
returns jsonb language sql stable as $$
  select config from rooms where id = p_room_id;
$$;

-- ---------------------------------------------------------------------------
-- Room lifecycle
-- ---------------------------------------------------------------------------

create or replace function dw_create_room(
  p_code text, p_room_name text, p_nickname text, p_config jsonb, p_token text
) returns jsonb
language plpgsql security definer as $$
declare v_room uuid; v_player uuid;
begin
  insert into rooms (code, name, config) values (upper(p_code), nullif(p_room_name,''), p_config)
  returning id into v_room;

  insert into players (room_id, nickname, seat, color_index, credits)
  values (v_room, p_nickname, 1, 0, (p_config->>'startingCredits')::int)
  returning id into v_player;

  insert into player_secrets (player_id, token) values (v_player, p_token);
  update rooms set host_player_id = v_player where id = v_room;

  insert into chat_messages (room_id, kind, body)
  values (v_room, 'SYSTEM', p_nickname || ' created the room.');

  perform dw_bump(v_room);
  return jsonb_build_object('ok', true, 'roomId', v_room, 'playerId', v_player, 'code', upper(p_code));
end $$;

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

  v_max := coalesce((v_room.config->>'maxPlayers')::int, 4);
  select count(*) into v_count from players where room_id = v_room.id;
  if v_count >= v_max then return dw_err('ROOM_FULL', 'Room is full.'); end if;

  if exists (select 1 from players where room_id = v_room.id and lower(nickname) = lower(p_nickname)) then
    return dw_err('NICKNAME_TAKEN', 'That nickname is already used in this room.');
  end if;

  select coalesce(max(seat), 0) + 1 into v_seat from players where room_id = v_room.id;

  insert into players (room_id, nickname, seat, color_index, credits)
  values (v_room.id, p_nickname, v_seat, v_seat - 1, coalesce((v_room.config->>'startingCredits')::int, 40))
  returning id into v_player;

  insert into player_secrets (player_id, token) values (v_player, p_token);
  insert into chat_messages (room_id, kind, body)
  values (v_room.id, 'SYSTEM', p_nickname || ' joined.');

  perform dw_bump(v_room.id);
  return jsonb_build_object('ok', true, 'roomId', v_room.id, 'playerId', v_player, 'code', v_room.code);
end $$;

create or replace function dw_set_ready(p_player_id uuid, p_ready boolean)
returns jsonb language plpgsql security definer as $$
declare v_room uuid;
begin
  update players set is_ready = p_ready, last_seen_at = now()
  where id = p_player_id returning room_id into v_room;
  if v_room is null then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;
  if (select phase from rooms where id = v_room) <> 'LOBBY' then
    return dw_err('WRONG_PHASE', 'That action is not available right now.');
  end if;
  perform dw_bump(v_room);
  return jsonb_build_object('ok', true);
end $$;

-- Heartbeat + automatic host migration. A host that has not been seen for
-- 25 seconds hands the crown to the longest-connected remaining player.
create or replace function dw_heartbeat(p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_room uuid; v_host uuid; v_new_host uuid; v_changed boolean := false;
begin
  update players set connected = true, last_seen_at = now()
  where id = p_player_id returning room_id into v_room;
  if v_room is null then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;

  update players set connected = false
  where room_id = v_room and last_seen_at < now() - interval '25 seconds' and connected = true;

  select host_player_id into v_host from rooms where id = v_room;
  if v_host is null or not exists (
      select 1 from players where id = v_host and connected = true) then
    select id into v_new_host from players
    where room_id = v_room and connected = true
    order by seat asc limit 1;
    if v_new_host is not null and v_new_host is distinct from v_host then
      update rooms set host_player_id = v_new_host where id = v_room;
      insert into chat_messages (room_id, kind, body)
      values (v_room, 'SYSTEM',
              (select nickname from players where id = v_new_host) || ' is now the host.');
      v_changed := true;
    end if;
  end if;

  if v_changed then perform dw_bump(v_room); end if;
  return jsonb_build_object('ok', true, 'hostChanged', v_changed);
end $$;

-- ---------------------------------------------------------------------------
-- Starting a game
-- ---------------------------------------------------------------------------

create or replace function dw_start_game(
  p_room_id uuid, p_player_id uuid, p_seed text, p_queue jsonb, p_per_player int
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

  if jsonb_array_length(p_queue) < v_players * p_per_player then
    return dw_err('POOL_TOO_SMALL', 'Character pool is too small for this many players.');
  end if;

  select coalesce(max(game_no), 0) + 1 into v_no from games where room_id = p_room_id;

  insert into games (room_id, game_no, seed, queue, characters_per_player)
  values (p_room_id, v_no, p_seed, p_queue, p_per_player)
  returning id into v_game;

  update players
     set credits = coalesce((v_room.config->>'startingCredits')::int, 40),
         is_ready = false
   where room_id = p_room_id;

  v_secs := coalesce((v_room.config->>'auctionSeconds')::int, 20);
  v_first := p_queue->>0;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (v_game, p_room_id, v_first, 0, now() + make_interval(secs => v_secs));

  update rooms set phase = 'AUCTION', current_game_id = v_game where id = p_room_id;

  insert into game_events (game_id, room_id, type, payload)
  values (v_game, p_room_id, 'GAME_STARTED', jsonb_build_object('players', v_players, 'perPlayer', p_per_player));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'gameId', v_game);
end $$;

-- ---------------------------------------------------------------------------
-- Auction internals
-- ---------------------------------------------------------------------------

-- Remaining unfilled roster slots across every player in the game.
create or replace function dw_total_demand(p_game_id uuid)
returns int language sql stable as $$
  select coalesce(sum(greatest(0, g.characters_per_player - coalesce(t.owned, 0))), 0)::int
  from games g
  join players p on p.room_id = g.room_id
  left join (
    select player_id, count(*) as owned from team_characters where game_id = p_game_id group by player_id
  ) t on t.player_id = p.id
  where g.id = p_game_id;
$$;

create or replace function dw_slots_remaining(p_game_id uuid, p_player_id uuid)
returns int language sql stable as $$
  select greatest(0, g.characters_per_player -
    (select count(*) from team_characters where game_id = p_game_id and player_id = p_player_id))::int
  from games g where g.id = p_game_id;
$$;

-- Opens the next character, or ends the auction phase when every roster is full
-- (or the queue has run dry). Assumes the caller already holds the game row.
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
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 20);
  v_idx := v_game.queue_index;

  loop
    v_idx := v_idx + 1;
    v_demand := dw_total_demand(p_game_id);

    if v_demand <= 0 or v_idx >= jsonb_array_length(v_game.queue) then
      -- Team review gets a deadline so the game keeps moving even if the host
      -- never presses the button; `dw_tick` advances it when it expires.
      update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds'
       where id = p_game_id;
      update rooms set phase = 'TEAM_REVIEW' where id = v_game.room_id;
      insert into game_events (game_id, room_id, type, payload)
      values (p_game_id, v_game.room_id, 'AUCTION_COMPLETE', '{}'::jsonb);
      return;
    end if;

    v_char := v_game.queue->>v_idx;
    -- Skip anything already owned (defensive; queue entries are unique).
    exit when not exists (
      select 1 from team_characters where game_id = p_game_id and character_id = v_char
    );
  end loop;

  update games set queue_index = v_idx where id = p_game_id;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (p_game_id, v_game.room_id, v_char, v_idx, now() + make_interval(secs => v_secs));
end $$;

-- Closes an auction: awards or voids it, then opens the next one.
create or replace function dw_resolve_auction(p_auction_id uuid)
returns jsonb language plpgsql as $$
declare a auctions%rowtype;
begin
  select * into a from auctions where id = p_auction_id for update;
  if not found then return dw_err('NO_ACTIVE_AUCTION', 'There is no auction running.'); end if;
  if a.status <> 'ACTIVE' then
    return jsonb_build_object('ok', true, 'alreadyResolved', true);
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

-- True when nobody other than the current high bidder can still act.
create or replace function dw_auction_is_dead(p_auction_id uuid)
returns boolean language sql stable as $$
  select not exists (
    select 1
    from auctions a
    join players p on p.room_id = a.room_id
    where a.id = p_auction_id
      and p.id is distinct from a.high_bidder_id
      and dw_slots_remaining(a.game_id, p.id) > 0
      and not exists (select 1 from auction_passes ap where ap.auction_id = a.id and ap.player_id = p.id)
  );
$$;

-- ---------------------------------------------------------------------------
-- BID — the one place where two players genuinely race each other.
-- The auction row is locked FOR UPDATE, so the second transaction only sees a
-- fully applied first bid and is rejected with BID_TOO_LOW.
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
  v_window int;
  v_extend int;
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
         coalesce((config->>'antiSnipeWindowSeconds')::int, 5),
         coalesce((config->>'antiSnipeExtendSeconds')::int, 5)
    into v_min_bid, v_window, v_extend
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
         ends_at = case
           when ends_at - now() <= make_interval(secs => v_window)
             then ends_at + make_interval(secs => v_extend)
           else ends_at end
   where id = a.id;

  insert into bids (auction_id, room_id, player_id, amount) values (a.id, a.room_id, p_player_id, p_amount);

  if dw_auction_is_dead(a.id) then
    perform dw_resolve_auction(a.id);
  else
    perform dw_bump(a.room_id);
  end if;

  return jsonb_build_object('ok', true, 'amount', p_amount);
end $$;

create or replace function dw_pass_auction(p_player_id uuid, p_auction_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  a auctions%rowtype;
  pl players%rowtype;
  v_phase text;
  v_slots int;
  v_supply_after int;
  v_demand int;
  v_queue_len int;
  v_idx int;
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
  if a.high_bidder_id = p_player_id then
    return dw_err('ALREADY_HIGH_BIDDER', 'You are already the highest bidder.');
  end if;
  if exists (select 1 from auction_passes where auction_id = a.id and player_id = p_player_id) then
    return dw_err('ALREADY_PASSED', 'You already passed on this character.');
  end if;

  v_slots := dw_slots_remaining(a.game_id, p_player_id);
  if v_slots <= 0 then return dw_err('ROSTER_FULL', 'Your roster is full.'); end if;

  -- Passing must never make the draft unsolvable.
  select jsonb_array_length(queue), queue_index into v_queue_len, v_idx from games where id = a.game_id;
  v_supply_after := v_queue_len - v_idx - 1;
  v_demand := dw_total_demand(a.game_id);
  if v_supply_after < v_demand then
    return dw_err('MUST_BID', 'Too few characters left — you cannot pass on this one.');
  end if;

  insert into auction_passes (auction_id, player_id) values (a.id, p_player_id);

  if dw_auction_is_dead(a.id) then
    perform dw_resolve_auction(a.id);
  else
    perform dw_bump(a.room_id);
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Phase progression
-- ---------------------------------------------------------------------------

-- p_player_id = NULL means "the system did it" (a tick past a deadline) and
-- skips the host check. Anything else must be the current host.
create or replace function dw_advance_phase(
  p_room_id uuid, p_player_id uuid, p_from text, p_to text,
  p_deadline_seconds int default null, p_map_candidates jsonb default null
) returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if p_player_id is not null and v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.phase <> p_from then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  update rooms set phase = p_to where id = p_room_id;
  if v_room.current_game_id is not null then
    update games
       set phase_deadline = case
             when p_deadline_seconds is null then null
             else now() + make_interval(secs => p_deadline_seconds) end,
           map_candidates = coalesce(p_map_candidates, map_candidates)
     where id = v_room.current_game_id;
  end if;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function dw_vote_map(p_player_id uuid, p_map_id text)
returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype; v_game uuid; v_ok boolean;
begin
  select r.* into v_room from rooms r join players p on p.room_id = r.id where p.id = p_player_id;
  if not found then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;
  if v_room.phase <> 'MAP_SELECTION' then
    return dw_err('WRONG_PHASE', 'That action is not available right now.');
  end if;
  v_game := v_room.current_game_id;

  select (map_candidates ? p_map_id) into v_ok from games where id = v_game;
  if not coalesce(v_ok, false) then return dw_err('INVALID_MAP', 'That map is not on the ballot.'); end if;

  insert into map_votes (game_id, player_id, map_id) values (v_game, p_player_id, p_map_id)
  on conflict (game_id, player_id) do update set map_id = excluded.map_id;

  perform dw_bump(v_room.id);
  return jsonb_build_object('ok', true);
end $$;

-- Locks in map + event. Idempotent: the first caller wins, later callers no-op.
create or replace function dw_lock_battlefield(p_game_id uuid, p_map_id text, p_event_id text)
returns jsonb language plpgsql security definer as $$
declare g games%rowtype;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return dw_err('NOT_FOUND', 'Game not found.'); end if;
  if g.map_id is not null and g.event_id is not null then
    return jsonb_build_object('ok', true, 'noop', true, 'mapId', g.map_id, 'eventId', g.event_id);
  end if;

  update games set map_id = p_map_id, event_id = p_event_id,
                   phase_deadline = now() + interval '7 seconds'
   where id = p_game_id;
  update rooms set phase = 'EVENT' where id = g.room_id;

  insert into game_events (game_id, room_id, type, payload)
  values (p_game_id, g.room_id, 'BATTLEFIELD', jsonb_build_object('mapId', p_map_id, 'eventId', p_event_id));

  perform dw_bump(g.room_id);
  return jsonb_build_object('ok', true, 'mapId', p_map_id, 'eventId', p_event_id);
end $$;

-- Stores a computed battle. Guarded so that two clients racing the tick cannot
-- write two different battles for the same game.
create or replace function dw_store_battle(p_game_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer as $$
declare
  g games%rowtype;
  v_standing jsonb;
  v_winner uuid;
begin
  select * into g from games where id = p_game_id for update;
  if not found then return dw_err('NOT_FOUND', 'Game not found.'); end if;
  if g.battle_result is not null then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  v_winner := nullif(p_result->>'winnerPlayerId','')::uuid;

  update games
     set battle_result = p_result,
         battle_started_at = now(),
         phase_deadline = now() + make_interval(secs => ceil((p_result->>'durationMs')::numeric / 1000)::int)
   where id = p_game_id;

  update rooms set phase = 'BATTLE' where id = g.room_id;

  insert into battle_results (game_id, room_id, winner_player_id, mvp_player_id, mvp_character_id,
                              map_id, event_id, standings, combatants)
  values (p_game_id, g.room_id, v_winner,
          nullif(p_result#>>'{mvp,playerId}','')::uuid,
          p_result#>>'{mvp,characterId}',
          p_result->>'mapId', p_result->>'eventId',
          p_result->'teams', p_result->'combatants')
  on conflict (game_id) do nothing;

  -- Season standings.
  for v_standing in select * from jsonb_array_elements(p_result->'teams') loop
    update players
       set points = points + (v_standing->>'points')::int,
           wins = wins + case when (v_standing->>'rank')::int = 1 then 1 else 0 end,
           losses = losses + case when (v_standing->>'rank')::int = 1 then 0 else 1 end,
           games_played = games_played + 1
     where id = (v_standing->>'playerId')::uuid;
  end loop;

  update games set status = 'FINISHED', finished_at = now() where id = p_game_id;
  update rooms set games_played = games_played + 1 where id = g.room_id;

  perform dw_bump(g.room_id);
  return jsonb_build_object('ok', true);
end $$;

-- Back to the lobby for another round; season stats are preserved.
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
  update rooms set phase = 'LOBBY', current_game_id = null where id = p_room_id;
  update players set is_ready = false, credits = coalesce((v_room.config->>'startingCredits')::int, 40)
   where room_id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- TICK — applies everything the clock owes us. Safe to call from any client,
-- at any frequency, concurrently.
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
  if v_room.current_game_id is null then return jsonb_build_object('ok', true, 'actions', v_actions); end if;

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
-- SNAPSHOT — one round trip returns everything the UI needs.
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
      'endsAt', a.ends_at, 'winnerId', a.winner_id, 'finalPrice', a.final_price,
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
      'stateVersion', v_room.state_version, 'gamesPlayed', v_room.games_played
    ),
    'players', v_players,
    'game', case when g.id is null then null else jsonb_build_object(
      'id', g.id, 'gameNo', g.game_no, 'status', g.status, 'seed', g.seed,
      'queue', g.queue, 'queueIndex', g.queue_index,
      'charactersPerPlayer', g.characters_per_player,
      'mapId', g.map_id, 'eventId', g.event_id, 'mapCandidates', g.map_candidates,
      'phaseDeadline', g.phase_deadline, 'battleStartedAt', g.battle_started_at,
      'battleResult', g.battle_result
    ) end,
    'auction', v_auction,
    'mapVotes', coalesce(v_votes, '{}'::jsonb),
    'events', coalesce(v_events, '[]'::jsonb),
    'chat', v_chat
  );
end $$;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------
create or replace function dw_send_chat(p_player_id uuid, p_kind text, p_body text)
returns jsonb language plpgsql security definer as $$
declare v_room uuid;
begin
  select room_id into v_room from players where id = p_player_id;
  if v_room is null then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;

  -- Light rate limit: 5 messages per 5 seconds per player.
  if (select count(*) from chat_messages
      where player_id = p_player_id and created_at > now() - interval '5 seconds') >= 5 then
    return dw_err('RATE_LIMITED', 'Slow down a little.');
  end if;

  insert into chat_messages (room_id, player_id, kind, body)
  values (v_room, p_player_id, p_kind, left(p_body, 240));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Development helpers. Guarded by DRAFT_WAR_DEV_KEY on the API side; they are
-- unreachable in production unless that variable is deliberately set.
-- ---------------------------------------------------------------------------
create or replace function dw_dev_add_bot(p_room_id uuid, p_nickname text, p_token text)
returns jsonb language plpgsql security definer as $$
declare v_seat int; v_player uuid; v_credits int;
begin
  select coalesce(max(seat), 0) + 1 into v_seat from players where room_id = p_room_id;
  select coalesce((config->>'startingCredits')::int, 40) into v_credits from rooms where id = p_room_id;

  insert into players (room_id, nickname, seat, color_index, credits, is_ready)
  values (p_room_id, p_nickname, v_seat, v_seat - 1, v_credits, true)
  returning id into v_player;

  insert into player_secrets (player_id, token) values (v_player, p_token);
  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'playerId', v_player);
end $$;

create or replace function dw_dev_reset_room(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_credits int;
begin
  select coalesce((config->>'startingCredits')::int, 40) into v_credits from rooms where id = p_room_id;
  delete from games where room_id = p_room_id;
  update rooms set phase = 'LOBBY', current_game_id = null, games_played = 0 where id = p_room_id;
  update players set is_ready = false, credits = v_credits, wins = 0, losses = 0,
                     points = 0, games_played = 0
   where room_id = p_room_id;
  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;

-- Instantly hands out the remaining roster slots at the minimum price so the
-- later phases can be exercised without sitting through 20 auctions.
create or replace function dw_dev_skip_auction(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  g games%rowtype;
  v_char text;
  v_idx int;
  p record;
  v_min int;
begin
  select * into g from games g2 where g2.room_id = p_room_id and g2.status = 'ACTIVE' limit 1;
  if not found then return dw_err('NO_GAME', 'No active game.'); end if;
  select coalesce((config->>'minBid')::int, 1) into v_min from rooms where id = p_room_id;

  update auctions set status = 'UNSOLD', resolved_at = now()
   where game_id = g.id and status = 'ACTIVE';

  -- `queue_index` points at the character currently on the block, and the loop
  -- below increments before reading, so step back one to include it.
  v_idx := g.queue_index - 1;
  for p in select id from players where room_id = p_room_id order by seat loop
    while dw_slots_remaining(g.id, p.id) > 0 loop
      v_idx := v_idx + 1;
      exit when v_idx >= jsonb_array_length(g.queue);
      v_char := g.queue->>v_idx;
      continue when exists (select 1 from team_characters where game_id = g.id and character_id = v_char);
      insert into team_characters (game_id, room_id, player_id, character_id, price)
      values (g.id, p_room_id, p.id, v_char, v_min);
      update players set credits = credits - v_min where id = p.id;
    end loop;
  end loop;

  update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds' where id = g.id;
  update rooms set phase = 'TEAM_REVIEW' where id = p_room_id;
  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;
