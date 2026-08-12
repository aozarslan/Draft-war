-- =============================================================================
-- DRAFT WAR V4 — Phase 2: auction moments.
--
-- The auction already records everything these need: `bids` has every raise
-- with its timestamp, `team_characters` has who paid what, `auctions` has the
-- deadline each bid was racing. So this is a read model over data the game
-- already writes, in the same spirit as the analytics dashboard — no new
-- writes on the hot path, nothing that can drift.
--
-- What comes out is the story of the draft: who got a steal, who lost their
-- head, which character everybody wanted, and who won it on the buzzer.
--
-- Additive and safe to re-run.
-- =============================================================================

-- Bids are read back per auction and per game constantly now; without this the
-- moments query is a sequential scan over every bid ever placed.
create index if not exists idx_bids_auction on bids (auction_id, created_at);

create or replace function dw_auction_moments(p_game_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_avg     numeric;
  v_bargain jsonb;
  v_overpay jsonb;
  v_biggest jsonb;
  v_contested jsonb;
  v_buzzer  jsonb;
  v_passed  int;
  v_perfect jsonb;
begin
  -- The going rate for this game, used as the yardstick for value. Comparing
  -- against a global average would punish a game that happened to draw an
  -- expensive pool.
  select avg(price) into v_avg from team_characters where game_id = p_game_id;
  if v_avg is null then
    return jsonb_build_object('ok', true, 'moments', '[]'::jsonb);
  end if;

  -- Best bargain: the biggest gap between what a character is worth and what
  -- it went for. `game_power` is the game's own valuation, so this is "what
  -- did somebody get for well under the odds".
  select jsonb_build_object(
      'characterId', tc.character_id, 'playerId', tc.player_id,
      'nickname', p.nickname, 'price', tc.price, 'power', c.game_power)
    into v_bargain
  from team_characters tc
  join characters c on c.id = tc.character_id
  join players p on p.id = tc.player_id
  where tc.game_id = p_game_id and tc.price <= v_avg
  order by (c.game_power::numeric / greatest(tc.price, 1)) desc
  limit 1;

  -- Biggest overpay: the same ratio, upside down, and only counted when they
  -- actually paid over the going rate.
  select jsonb_build_object(
      'characterId', tc.character_id, 'playerId', tc.player_id,
      'nickname', p.nickname, 'price', tc.price, 'power', c.game_power)
    into v_overpay
  from team_characters tc
  join characters c on c.id = tc.character_id
  join players p on p.id = tc.player_id
  where tc.game_id = p_game_id and tc.price > v_avg
  order by (tc.price::numeric / greatest(c.game_power, 1)) desc
  limit 1;

  select jsonb_build_object(
      'characterId', tc.character_id, 'playerId', tc.player_id,
      'nickname', p.nickname, 'price', tc.price)
    into v_biggest
  from team_characters tc
  join players p on p.id = tc.player_id
  where tc.game_id = p_game_id
  order by tc.price desc limit 1;

  -- Most contested: the character with the most raises from the most people.
  -- Bid count alone would crown a character one person raised on repeatedly.
  select jsonb_build_object(
      'characterId', a.character_id, 'bids', count(b.id),
      'bidders', count(distinct b.player_id), 'finalPrice', a.final_price)
    into v_contested
  from auctions a join bids b on b.auction_id = a.id
  where a.game_id = p_game_id
  group by a.id, a.character_id, a.final_price
  order by count(distinct b.player_id) desc, count(b.id) desc
  limit 1;

  -- Won on the buzzer: the last bid of an auction, landing inside the final
  -- two seconds of the clock it was racing.
  select jsonb_build_object(
      'characterId', a.character_id, 'nickname', p.nickname,
      'price', b.amount,
      'secondsLeft', round(extract(epoch from (a.ends_at - b.created_at))::numeric, 1))
    into v_buzzer
  from auctions a
  join bids b on b.auction_id = a.id and b.player_id = a.winner_id
  join players p on p.id = b.player_id
  where a.game_id = p_game_id and a.status = 'SOLD'
    -- Bounded on both sides: an auction that was force-expired by a tick can
    -- have `ends_at` in the past relative to the winning bid, and "won with
    -- -1.0 seconds left" is not a thing to show a player.
    and b.created_at >= a.ends_at - interval '2 seconds'
    and b.created_at <= a.ends_at
  order by (a.ends_at - b.created_at) asc
  limit 1;

  select count(*) into v_passed from game_events
   where game_id = p_game_id and type = 'UNSOLD';

  -- Perfect budget: finished the draft with a full roster and nothing left.
  select jsonb_build_object('playerId', p.id, 'nickname', p.nickname, 'left', p.credits)
    into v_perfect
  from players p
  where p.room_id = (select room_id from games where id = p_game_id)
    and p.credits = 0
    and (select count(*) from team_characters tc
          where tc.game_id = p_game_id and tc.player_id = p.id) > 0
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'averagePrice', round(v_avg, 1),
    'bargain', v_bargain,
    'overpay', v_overpay,
    'biggestBid', v_biggest,
    'mostContested', v_contested,
    'buzzerBeater', v_buzzer,
    'unsoldCount', v_passed,
    'perfectBudget', v_perfect);
end $$;
