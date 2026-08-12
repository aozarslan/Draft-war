-- =============================================================================
-- DRAFT WAR V3 — Phase 13: analytics.
--
-- This migration adds no event table and no tracking calls, on purpose.
--
-- Everything worth knowing about this game is already recorded as a
-- consequence of playing it: rooms carry their creation time, games carry
-- their categories and status, bids carry every raise, match_history carries
-- every finish, and the coin ledger carries every purchase. A parallel stream
-- of "events" describing the same things would be a second source of truth
-- that can disagree with the first — and the first is the one the game
-- actually runs on.
--
-- So analytics here is a read model. It is derived, it cannot drift, and it
-- costs nothing on the hot path: no write happens because somebody looked at a
-- dashboard.
--
-- Nothing personal leaves this function. It reports counts, rates and
-- distributions; the only names in it are category and item ids.
--
-- Additive and safe to re-run.
-- =============================================================================

-- The dashboard slices by day across several tables. These are the two scans
-- that are not already indexed by an existing feature.
create index if not exists idx_rooms_created on rooms (created_at desc);
create index if not exists idx_games_created on games (created_at desc);

-- ---------------------------------------------------------------------------
-- The dashboard
--
-- One call, one JSON blob, one window. `p_days` is how far back to look;
-- lifetime figures that only make sense unbounded (retention cohorts, totals)
-- say so in their own section.
-- ---------------------------------------------------------------------------

create or replace function dw_analytics(p_days int default 30)
returns jsonb language plpgsql stable security definer as $$
declare
  v_from      timestamptz;
  v_funnel    jsonb;
  v_activity  jsonb;
  v_categories jsonb;
  v_auction   jsonb;
  v_economy   jsonb;
  v_retention jsonb;
  v_daily     jsonb;
begin
  v_from := now() - make_interval(days => greatest(1, least(365, p_days)));

  -- --- Funnel: how many rooms become games, and how many games finish -------
  select jsonb_build_object(
    'roomsCreated', count(*),
    'roomsStarted', count(*) filter (where exists (
        select 1 from games g where g.room_id = r.id)),
    'gamesPlayed', (select count(*) from games where created_at >= v_from),
    'gamesFinished', (select count(*) from games
                       where created_at >= v_from and battle_result is not null),
    -- A room nobody else joined is the clearest sign of a broken invite link.
    'roomsAlone', count(*) filter (where (
        select count(*) from players p where p.room_id = r.id) <= 1)
  ) into v_funnel
  from rooms r where r.created_at >= v_from;

  -- --- Who is playing ------------------------------------------------------
  select jsonb_build_object(
    'profiles', (select count(*) from profiles),
    'newProfiles', (select count(*) from profiles where created_at >= v_from),
    'activeProfiles', (select count(*) from profiles where last_active_at >= v_from),
    'activeToday', (select count(*) from profiles
                     where last_active_at >= now() - interval '1 day'),
    'activeWeek', (select count(*) from profiles
                    where last_active_at >= now() - interval '7 days'),
    -- Guests are seats with no profile: the size of the "never signed up" pool.
    'guestSeats', (select count(*) from players p
                    join rooms r on r.id = p.room_id
                   where r.created_at >= v_from and p.profile_id is null),
    'profileSeats', (select count(*) from players p
                      join rooms r on r.id = p.room_id
                     where r.created_at >= v_from and p.profile_id is not null),
    'friendships', (select count(*) from friendships where status = 'ACCEPTED')
  ) into v_activity;

  -- --- What people play ----------------------------------------------------
  select coalesce(jsonb_agg(x order by (x->>'games')::int desc), '[]'::jsonb)
    into v_categories
  from (
    select jsonb_build_object('categoryId', c, 'games', count(*)) as x
      from games g, lateral unnest(g.category_ids) c
     where g.created_at >= v_from
     group by c
  ) t;

  -- --- The auction itself --------------------------------------------------
  select jsonb_build_object(
    'bids', (select count(*) from bids b
              where b.created_at >= v_from),
    'passes', (select count(*) from auction_passes ap
                where ap.created_at >= v_from),
    'avgWinningPrice', (select round(avg(price)::numeric, 1) from team_characters tc
                         where tc.acquired_at >= v_from),
    'maxWinningPrice', (select max(price) from team_characters tc
                         where tc.acquired_at >= v_from),
    -- A character nobody wanted: the auto-assign path in dw_resolve_auction.
    'unsold', (select count(*) from game_events
                where type = 'UNSOLD' and created_at >= v_from),
    'poolExtended', (select count(*) from game_events
                      where type = 'POOL_EXTENDED' and created_at >= v_from),
    'topPicks', (select coalesce(jsonb_agg(y order by (y->>'picks')::int desc), '[]'::jsonb)
                  from (select jsonb_build_object('characterId', character_id,
                                                  'picks', count(*),
                                                  'avgPrice', round(avg(price)::numeric, 1)) as y
                          from team_characters where acquired_at >= v_from
                         group by character_id order by count(*) desc limit 10) z)
  ) into v_auction;

  -- --- The economy ---------------------------------------------------------
  select jsonb_build_object(
    'coinsEarned', (select coalesce(sum(amount), 0) from coin_transactions
                     where amount > 0 and created_at >= v_from),
    'coinsSpent', (select coalesce(-sum(amount), 0) from coin_transactions
                    where amount < 0 and created_at >= v_from),
    'coinsHeld', (select coalesce(sum(coins), 0) from profiles),
    'buyers', (select count(distinct profile_id) from coin_transactions
                where kind = 'PURCHASE'),
    'purchases', (select count(*) from coin_transactions
                   where kind = 'PURCHASE' and created_at >= v_from),
    'dailyClaims', (select count(*) from coin_transactions
                     where kind = 'DAILY' and created_at >= v_from),
    'challengeClaims', (select count(*) from coin_transactions
                         where kind = 'CHALLENGE' and created_at >= v_from),
    'achievementsUnlocked', (select count(*) from profile_achievements
                              where unlocked_at >= v_from),
    'topSellers', (select coalesce(jsonb_agg(y order by (y->>'sales')::int desc), '[]'::jsonb)
                    from (select jsonb_build_object('itemId', reference,
                                                    'sales', count(*),
                                                    'coins', -sum(amount)) as y
                            from coin_transactions
                           where kind = 'PURCHASE' and reference is not null
                           group by reference order by count(*) desc limit 10) z)
  ) into v_economy;

  -- --- Do they come back ---------------------------------------------------
  -- Lifetime cohorts rather than windowed: a seven-day return rate computed
  -- over the last seven days would count nobody who has not had seven days.
  select jsonb_build_object(
    'cohort', count(*),
    'playedOnce', count(*) filter (where matches >= 1),
    'playedTwice', count(*) filter (where matches >= 2),
    'playedFive', count(*) filter (where matches >= 5),
    'returnedNextDay', count(*) filter (where last_active_at >= created_at + interval '1 day'),
    'returnedNextWeek', count(*) filter (where last_active_at >= created_at + interval '7 days')
  ) into v_retention
  from (
    select p.created_at, p.last_active_at, coalesce(s.matches, 0) as matches
      from profiles p left join profile_stats s on s.profile_id = p.id
     where p.created_at <= now() - interval '1 day'
  ) c;

  -- --- Day by day, for the sparkline ---------------------------------------
  select coalesce(jsonb_agg(jsonb_build_object(
      'day', d::date,
      'rooms', (select count(*) from rooms where created_at::date = d::date),
      'games', (select count(*) from games where created_at::date = d::date),
      'finished', (select count(*) from games
                    where created_at::date = d::date and battle_result is not null),
      'signups', (select count(*) from profiles where created_at::date = d::date)
    ) order by d), '[]'::jsonb) into v_daily
  from generate_series(v_from::date, now()::date, interval '1 day') d;

  return jsonb_build_object(
    'ok', true,
    'from', v_from,
    'days', greatest(1, least(365, p_days)),
    'funnel', v_funnel,
    'activity', v_activity,
    'categories', v_categories,
    'auction', v_auction,
    'economy', v_economy,
    'retention', v_retention,
    'daily', v_daily);
end $$;
