-- =============================================================================
-- DRAFT WAR V4 — Phase 3: formations.
--
-- The one decision between the draft and the battle. It lives on the player
-- row rather than in a table of its own: it is a single choice per player per
-- game, it is read on every snapshot, and a join for one short string would be
-- a join on the hottest read in the game.
--
-- Reset when a new game starts, so last round's Blitz does not quietly carry
-- into this one.
--
-- Additive and safe to re-run.
-- =============================================================================

alter table players add column if not exists formation text not null default 'BALANCED';

-- Mirrors FormationId in src/lib/game/formations.ts. A constraint rather than
-- a lookup table: five values that change only when the code changes.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'players_formation_valid'
  ) then
    alter table players add constraint players_formation_valid
      check (formation in ('BALANCED', 'AGGRESSIVE', 'DEFENSIVE', 'SPEED', 'CONTROL'));
  end if;
end $$;

/**
 * Chooses a formation.
 *
 * Only during team review — once the map is being voted on, the squads are
 * locked and a late change would let somebody react to the battlefield. The
 * value is validated against the same five names the check constraint allows,
 * so a forged request cannot write anything the engine would not understand.
 */
create or replace function dw_set_formation(
  p_player_id uuid, p_formation text
) returns jsonb language plpgsql security definer as $$
declare pl players%rowtype; v_phase text; v_value text;
begin
  select * into pl from players where id = p_player_id;
  if not found then return dw_err('NOT_IN_ROOM', 'You are not part of this room.'); end if;

  select phase into v_phase from rooms where id = pl.room_id;
  if v_phase <> 'TEAM_REVIEW' then
    return dw_err('WRONG_PHASE', 'Formations are locked once the battlefield is chosen.');
  end if;

  v_value := upper(trim(coalesce(p_formation, '')));
  if v_value not in ('BALANCED', 'AGGRESSIVE', 'DEFENSIVE', 'SPEED', 'CONTROL') then
    return dw_err('BAD_FORMATION', 'That is not a formation.');
  end if;

  update players set formation = v_value where id = p_player_id;

  perform dw_event((select current_game_id from rooms where id = pl.room_id), pl.room_id,
                   'FORMATION_SET',
                   jsonb_build_object('playerId', p_player_id, 'nickname', pl.nickname,
                                      'formation', v_value));

  perform dw_bump(pl.room_id);
  return jsonb_build_object('ok', true, 'formation', v_value);
end $$;

-- ---------------------------------------------------------------------------
-- The snapshot carries it, so the picker can show what everybody chose.
-- Same function as 0006 with one extra field on each player.
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

-- ---------------------------------------------------------------------------
-- A new game starts with everybody balanced again.
--
-- Faithful to 0001 apart from the one added column: the host check, the
-- abandonment of the running game and the category-vote cleanup all stay. An
-- earlier draft of this migration rewrote the function from memory and quietly
-- dropped all three.
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
  update players set is_ready = false,
                     formation = 'BALANCED',
                     credits = coalesce((v_room.config->>'startingCredits')::int, 50)
   where room_id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;
