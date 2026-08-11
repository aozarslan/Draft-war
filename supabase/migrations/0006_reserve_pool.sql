-- =============================================================================
-- DRAFT WAR — reserve character pool, so PASS is a real move again.
--
-- The problem this fixes:
--   The draft queue was sized to exactly `players x roster` — 25 characters for
--   25 roster slots. Supply therefore equalled demand from the very first
--   character, and the rule that stops the draft becoming unsolvable ("you may
--   not pass while every remaining character is needed") rejected every single
--   PASS with MUST_BID. Pressing PASS looked broken because it was: there was
--   never a legal moment to use it.
--
-- The fix has two halves:
--   1. The queue now carries a RESERVE beyond the required allocations, so
--      early passing is legal and a character can genuinely go unsold.
--   2. The auction phase ends on ALLOCATIONS, not on queue position. It closes
--      only when every roster is full; if the queue somehow empties first, the
--      characters that went unsold are recycled back in.
--
-- Additive and safe to re-run.
-- =============================================================================

create or replace function dw_open_next_auction(p_game_id uuid)
returns void language plpgsql as $$
declare
  v_game games%rowtype;
  v_idx int;
  v_char text;
  v_secs int;
  v_demand int;
  v_recycled jsonb;
  v_guard int := 0;
begin
  select * into v_game from games where id = p_game_id;
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 10);
  v_idx := v_game.queue_index;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;

    v_idx := v_idx + 1;
    v_demand := dw_total_demand(p_game_id);

    -- Everybody is full: the draft is genuinely done.
    if v_demand <= 0 then
      update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds'
       where id = p_game_id;
      update rooms set phase = 'TEAM_REVIEW' where id = v_game.room_id;
      insert into game_events (game_id, room_id, type, payload)
      values (p_game_id, v_game.room_id, 'AUCTION_COMPLETE',
              jsonb_build_object('allocated', (select count(*) from team_characters where game_id = p_game_id)));
      return;
    end if;

    -- Out of queue but somebody still needs a character. Recycle whatever went
    -- unsold rather than sending an incomplete team to the battle.
    if v_idx >= jsonb_array_length(v_game.queue) then
      select coalesce(jsonb_agg(a.character_id), '[]'::jsonb) into v_recycled
        from auctions a
       where a.game_id = p_game_id
         and a.status = 'UNSOLD'
         and not exists (
           select 1 from team_characters t
            where t.game_id = p_game_id and t.character_id = a.character_id);

      if jsonb_array_length(v_recycled) > 0 then
        update games set queue = queue || v_recycled where id = p_game_id;
        select * into v_game from games where id = p_game_id;
        insert into game_events (game_id, room_id, type, payload)
        values (p_game_id, v_game.room_id, 'POOL_EXTENDED',
                jsonb_build_object('added', jsonb_array_length(v_recycled)));
        v_idx := v_idx - 1;  -- re-enter the loop on the first recycled entry
        continue;
      end if;

      -- Nothing left at all. Close the phase rather than hang; the auto-assign
      -- in dw_resolve_auction makes this unreachable in a normal game.
      update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds'
       where id = p_game_id;
      update rooms set phase = 'TEAM_REVIEW' where id = v_game.room_id;
      insert into game_events (game_id, room_id, type, payload)
      values (p_game_id, v_game.room_id, 'AUCTION_EXHAUSTED',
              jsonb_build_object('missing', v_demand));
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
-- The snapshot now reports the target allocation count explicitly, so the UI
-- can show "17 / 25" against real allocations instead of against the queue
-- length — which, with a reserve, is deliberately larger than 25.
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
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;

  if v_room.current_game_id is not null then
    select * into g from games where id = v_room.current_game_id;
  end if;

  select count(*) into v_player_count from players where room_id = p_room_id;

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
    from (select * from game_events where game_id = g.id order by created_at desc limit 60) ge;
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
      -- What "17 / 25" actually counts.
      'requiredAllocations', v_player_count * g.characters_per_player,
      'allocated', (select count(*) from team_characters where game_id = g.id),
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
-- Guard the phase transition itself. Even if something upstream miscounts, the
-- game must not reach TEAM_REVIEW with an unfinished roster.
-- ---------------------------------------------------------------------------
create or replace function dw_advance_phase(
  p_room_id uuid, p_player_id uuid, p_from text, p_to text,
  p_deadline_seconds int default null, p_map_candidates jsonb default null
) returns jsonb language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  v_missing int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if p_player_id is not null and v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.phase <> p_from then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  -- Leaving the auction requires every roster to be complete.
  if p_from = 'AUCTION' and v_room.current_game_id is not null then
    v_missing := dw_total_demand(v_room.current_game_id);
    if v_missing > 0 then
      return dw_err('DRAFT_INCOMPLETE',
        v_missing || ' roster slot(s) still need filling.');
    end if;
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
