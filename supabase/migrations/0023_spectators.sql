-- =============================================================================
-- DRAFT WAR V4 — Phase 4: spectators.
--
-- Watching a game needs almost nothing new. The state endpoint has always been
-- unauthenticated — anybody with the room code can read the snapshot, which is
-- exactly what a spectator is — so the only genuinely missing piece was
-- presence: the people playing should know somebody is watching.
--
-- On what a spectator may see: the snapshot they get is byte for byte the one
-- the players get. That satisfies V4's rule ("do not expose hidden information
-- that players themselves cannot see") by construction rather than by
-- filtering, which is the version that cannot drift. There is no separate
-- spectator payload to keep in step, and no way for one to accidentally grow a
-- field the players do not have.
--
-- What a spectator cannot do is act: every mutation goes through
-- `authenticate()`, which requires a (playerId, token) pair issued by joining.
-- A watcher has neither.
--
-- Additive and safe to re-run.
-- =============================================================================

create table if not exists spectators (
  room_id    uuid not null references rooms(id) on delete cascade,
  -- A per-browser id, not a player id. Watchers are anonymous by design: you
  -- do not need an account to be shown a game.
  watcher_id text not null,
  last_seen_at timestamptz not null default now(),
  primary key (room_id, watcher_id)
);

create index if not exists idx_spectators_room on spectators (room_id, last_seen_at desc);

alter table spectators enable row level security;
-- No anon policy: the count comes back through the snapshot on the service
-- role, so a watcher cannot inflate it or read who else is watching.

/**
 * Marks a watcher as present, and reports how many others are.
 *
 * Deliberately not a "join": there is no seat, no credits and no token. The
 * row exists only so the room can say "3 watching", and it ages out on its
 * own, so a closed tab stops counting without needing to tell us.
 */
create or replace function dw_watch(p_room_id uuid, p_watcher_id text)
returns jsonb language plpgsql security definer as $$
declare v_count int;
begin
  if p_watcher_id is null or length(p_watcher_id) < 8 then
    return dw_err('BAD_WATCHER', 'Invalid watcher.');
  end if;

  -- Cheap throttle: a watcher heartbeating faster than the poll interval is
  -- either broken or hostile, and either way should not write every time.
  if dw_rate_limited(p_watcher_id, 'WATCH', 30, 60) then
    return dw_err('TOO_FAST', 'Slow down a moment.');
  end if;

  insert into spectators (room_id, watcher_id, last_seen_at)
  values (p_room_id, left(p_watcher_id, 64), now())
  on conflict (room_id, watcher_id) do update set last_seen_at = now();

  -- Anybody quiet for a minute has closed the tab.
  delete from spectators
   where room_id = p_room_id and last_seen_at < now() - interval '60 seconds';

  select count(*) into v_count from spectators where room_id = p_room_id;
  return jsonb_build_object('ok', true, 'watching', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- The snapshot carries the count.
--
-- Same function as 0021 with one extra field on the room. Kept as a full
-- replacement rather than a patch because that is how `create or replace`
-- works — but it is a copy of the deployed body with two lines added, not a
-- rewrite from memory.
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
  v_player_count int;
  v_watching int;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;

  if v_room.current_game_id is not null then
    select * into g from games where id = v_room.current_game_id;
  end if;

  select count(*) into v_player_count from players where room_id = p_room_id;
  select count(*) into v_watching from spectators
   where room_id = p_room_id and last_seen_at > now() - interval '60 seconds';

  select coalesce(jsonb_agg(x order by x->>'seat'), '[]'::jsonb) into v_players from (
    select jsonb_build_object(
      'id', p.id, 'nickname', p.nickname, 'seat', p.seat, 'colorIndex', p.color_index,
      'isHost', (p.id = v_room.host_player_id), 'isReady', p.is_ready,
      'connected', p.connected, 'credits', p.credits,
      'formation', p.formation,
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
    from (select * from game_events where game_id = g.id order by created_at desc limit 60) ge;
  end if;

  select coalesce(jsonb_object_agg(player_id, category_id), '{}'::jsonb) into v_cat_votes
  from category_votes where room_id = p_room_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', cm.id, 'playerId', cm.player_id, 'kind', cm.kind,
      'body', cm.body, 'at', cm.created_at) order by cm.created_at), '[]'::jsonb)
    into v_chat
  from (select * from chat_messages where room_id = p_room_id
        order by created_at desc limit 60) cm;

  return jsonb_build_object(
    'ok', true,
    'serverTime', now(),
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.code, 'name', v_room.name, 'phase', v_room.phase,
      'hostPlayerId', v_room.host_player_id, 'config', v_room.config,
      'stateVersion', v_room.state_version, 'gamesPlayed', v_room.games_played,
      'watching', coalesce(v_watching, 0),
      'categoryIds', to_jsonb(v_room.category_ids),
      'categoryCandidates', to_jsonb(v_room.category_candidates),
      'categoryDeadline', v_room.category_deadline,
      'categoryMode', v_room.category_mode),
    'players', v_players,
    'game', case when g.id is null then null else jsonb_build_object(
      'id', g.id, 'gameNo', g.game_no, 'status', g.status, 'seed', g.seed,
      'queue', g.queue, 'queueIndex', g.queue_index,
      'charactersPerPlayer', g.characters_per_player,
      'requiredAllocations', v_player_count * g.characters_per_player,
      'allocated', (select count(*) from team_characters where game_id = g.id),
      'categoryIds', to_jsonb(g.category_ids),
      'mapId', g.map_id, 'eventId', g.event_id,
      'mapCandidates', to_jsonb(g.map_candidates),
      'phaseDeadline', g.phase_deadline,
      'battleStartedAt', g.battle_started_at,
      'battleResult', g.battle_result) end,
    'auction', v_auction,
    'mapVotes', coalesce(v_votes, '{}'::jsonb),
    'categoryVotes', coalesce(v_cat_votes, '{}'::jsonb),
    'events', coalesce(v_events, '[]'::jsonb),
    'chat', v_chat);
end $$;
