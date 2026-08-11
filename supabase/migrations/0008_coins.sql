-- =============================================================================
-- DRAFT WAR V3 — Phase 6: the coin economy.
--
-- Coins are the persistent, cross-match currency. They are NOT auction credits:
-- credits are minted at the start of a match, spent inside it and thrown away
-- at the end, and nothing converts between the two in either direction. Keeping
-- them apart is what stops the shop from ever becoming pay-to-win.
--
-- Two rules shape everything below:
--
--   1. Every movement of coins writes an immutable ledger row. `profiles.coins`
--      is a cache of the ledger, never an independent source of truth, and the
--      two are written in the same statement pair inside one function so they
--      cannot drift.
--   2. A payout is idempotent. Awards carry a reference (a match id, a calendar
--      day, an achievement id) and a unique index refuses the second attempt.
--      Retried battle storage, a double-clicked claim and two clients ticking
--      the same room all end up paying once.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The ledger
-- ---------------------------------------------------------------------------

create table if not exists coin_transactions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  -- Positive for an award, negative for a spend. The sign is the direction;
  -- there is no separate debit/credit flag to get out of step with it.
  amount        bigint not null,
  balance_after bigint not null,
  kind          text not null,
  -- What this payment was for. Null only for one-off admin grants, which is
  -- also the only case where a repeat is allowed.
  reference     text,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint coin_transactions_amount_nonzero check (amount <> 0)
);

-- The idempotency guarantee. One payment per (profile, kind, reference).
create unique index if not exists uq_coins_once_per_reference
  on coin_transactions (profile_id, kind, reference)
  where reference is not null;

create index if not exists idx_coins_profile
  on coin_transactions (profile_id, created_at desc);

-- Match rewards are read back by the results screen the same way XP is, so the
-- payout needs somewhere to land on the match row.
alter table match_history add column if not exists coins_awarded int not null default 0;

-- The browser must not be able to read or write any of this. As with the rest
-- of the progression schema there are no anon policies at all — every read the
-- UI performs goes through our API on the service role.
alter table coin_transactions enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Awarding
--
-- The only way coins are ever created. Amounts come from the caller (our own
-- server, on the service role) and are clamped here as a second line of
-- defence; the browser has no path to this function at all.
-- ---------------------------------------------------------------------------

create or replace function dw_award_coins(
  p_profile_id uuid,
  p_amount     int,
  p_kind       text,
  p_reference  text default null,
  p_detail     jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_balance bigint;
  v_amount  int;
begin
  if p_profile_id is null then
    -- A guest seat. Normal, not an error: they played, they just have nowhere
    -- to bank it.
    return jsonb_build_object('ok', true, 'skipped', 'guest', 'amount', 0);
  end if;

  v_amount := greatest(0, coalesce(p_amount, 0));
  if v_amount = 0 then
    return jsonb_build_object('ok', true, 'amount', 0, 'awarded', false);
  end if;
  -- Nothing legitimate in this game pays five figures at once. A bug upstream
  -- should fail loudly here rather than quietly minting a fortune.
  if v_amount > 100000 then
    return dw_err('AMOUNT_TOO_LARGE', 'That is not a plausible coin award.');
  end if;

  -- Lock the wallet so two simultaneous awards serialise instead of both
  -- reading the same starting balance.
  select coins into v_balance from profiles where id = p_profile_id for update;
  if not found then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  begin
    insert into coin_transactions (profile_id, amount, balance_after, kind, reference, detail)
    values (p_profile_id, v_amount, v_balance + v_amount, p_kind, p_reference, coalesce(p_detail, '{}'::jsonb));
  exception when unique_violation then
    -- Already paid for this reference. Report the real balance, not a second
    -- payout.
    return jsonb_build_object('ok', true, 'alreadyAwarded', true,
                              'amount', 0, 'balance', v_balance);
  end;

  update profiles
     set coins = v_balance + v_amount,
         last_active_at = now()
   where id = p_profile_id;

  return jsonb_build_object('ok', true, 'awarded', true,
                            'amount', v_amount, 'balance', v_balance + v_amount);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Spending
--
-- The counterpart, kept here so the shop (phase 8) has one audited way to take
-- coins away. The balance check and the deduction happen under the same row
-- lock, so a player cannot spend the same coins twice by firing two purchases
-- at once.
-- ---------------------------------------------------------------------------

create or replace function dw_spend_coins(
  p_profile_id uuid,
  p_amount     int,
  p_kind       text,
  p_reference  text default null,
  p_detail     jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_balance bigint;
  v_amount  int;
begin
  v_amount := coalesce(p_amount, 0);
  if v_amount <= 0 then
    return dw_err('INVALID_AMOUNT', 'A purchase must cost something.');
  end if;

  select coins into v_balance from profiles where id = p_profile_id for update;
  if not found then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  if v_balance < v_amount then
    return dw_err('INSUFFICIENT_COINS',
      'You need ' || (v_amount - v_balance) || ' more coins.');
  end if;

  begin
    insert into coin_transactions (profile_id, amount, balance_after, kind, reference, detail)
    values (p_profile_id, -v_amount, v_balance - v_amount, p_kind, p_reference, coalesce(p_detail, '{}'::jsonb));
  exception when unique_violation then
    return dw_err('ALREADY_SPENT', 'You have already paid for this.');
  end;

  update profiles set coins = v_balance - v_amount where id = p_profile_id;

  return jsonb_build_object('ok', true, 'spent', v_amount, 'balance', v_balance - v_amount);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Match payout
--
-- One call per profile per finished battle, mirroring dw_award_match. The
-- match id is the reference, so storing the same battle twice pays once.
-- ---------------------------------------------------------------------------

create or replace function dw_award_match_coins(
  p_game_id uuid, p_profile_id uuid, p_coins int, p_detail jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer as $$
declare v_result jsonb;
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest', 'amount', 0);
  end if;
  if p_game_id is null then
    return dw_err('INVALID_MATCH', 'Coins must reference a finished match.');
  end if;

  v_result := dw_award_coins(p_profile_id, p_coins, 'MATCH', p_game_id::text, p_detail);

  if coalesce((v_result->>'awarded')::boolean, false) then
    update match_history
       set coins_awarded = greatest(0, p_coins)
     where game_id = p_game_id and profile_id = p_profile_id;
  end if;

  return v_result;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Daily login
--
-- Keyed on the calendar day in UTC, which makes the claim self-limiting: the
-- reference for today already exists after the first claim, so the second one
-- is refused by the same unique index that protects match payouts. Streaks and
-- the seven-day ladder arrive with the challenges phase; this is the floor
-- they will build on.
-- ---------------------------------------------------------------------------

create or replace function dw_claim_daily(p_profile_id uuid, p_token text)
returns jsonb language plpgsql security definer as $$
declare
  v_ok      boolean;
  v_today   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_streak  int := 0;
  v_has     boolean;
  d         int;
  v_result  jsonb;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  -- Consecutive days already claimed, walking backwards from today. Today
  -- being unclaimed is not a gap — that is the whole point of the visit — so
  -- only a miss on an earlier day ends the run.
  for d in 0..60 loop
    select exists (
      select 1 from coin_transactions t
       where t.profile_id = p_profile_id and t.kind = 'DAILY'
         and t.reference = to_char((now() at time zone 'utc') - make_interval(days => d), 'YYYY-MM-DD')
    ) into v_has;
    if v_has then
      v_streak := v_streak + 1;
    elsif d > 0 then
      exit;
    end if;
  end loop;

  v_result := dw_award_coins(p_profile_id, 100, 'DAILY', v_today,
                             jsonb_build_object('day', v_today));

  if coalesce((v_result->>'alreadyAwarded')::boolean, false) then
    return jsonb_build_object('ok', true, 'claimed', false, 'streak', v_streak,
                              'balance', v_result->'balance',
                              'nextAt', (date_trunc('day', now() at time zone 'utc') + interval '1 day'));
  end if;

  return jsonb_build_object('ok', true, 'claimed', true, 'amount', 100,
                            'streak', v_streak + 1,
                            'balance', v_result->'balance',
                            'nextAt', (date_trunc('day', now() at time zone 'utc') + interval '1 day'));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reads
-- ---------------------------------------------------------------------------

-- The results screen reads its reward line out of match history, so the coin
-- payout has to travel with it. Same function as in 0007 with one extra field.
create or replace function dw_profile(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_profile profiles%rowtype;
  v_stats profile_stats%rowtype;
  v_season seasons%rowtype;
  v_sp season_players%rowtype;
  v_history jsonb;
begin
  select * into v_profile from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;

  select * into v_stats from profile_stats where profile_id = p_profile_id;
  select * into v_season from seasons where is_active order by number desc limit 1;
  if v_season.id is not null then
    select * into v_sp from season_players
     where season_id = v_season.id and profile_id = p_profile_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'gameId', h.game_id, 'roomCode', h.room_code, 'categoryIds', to_jsonb(h.category_ids),
      'mapId', h.map_id, 'eventId', h.event_id, 'placement', h.placement,
      'playerCount', h.player_count, 'isMvp', h.is_mvp, 'mvpCharacter', h.mvp_character,
      'creditsSpent', h.credits_spent, 'xp', h.xp_awarded, 'coins', h.coins_awarded,
      'rankDelta', h.rank_delta,
      'ranked', h.ranked, 'roster', h.roster, 'at', h.created_at
    ) order by h.created_at desc), '[]'::jsonb) into v_history
  from (select * from match_history where profile_id = p_profile_id
        order by created_at desc limit 20) h;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', v_profile.id, 'username', v_profile.username, 'avatar', v_profile.avatar,
      'banner', v_profile.banner, 'title', v_profile.title,
      'level', v_profile.level, 'xp', v_profile.xp, 'coins', v_profile.coins,
      'createdAt', v_profile.created_at, 'lastActiveAt', v_profile.last_active_at),
    'stats', jsonb_build_object(
      'matches', coalesce(v_stats.matches, 0), 'wins', coalesce(v_stats.wins, 0),
      'losses', coalesce(v_stats.losses, 0), 'topThree', coalesce(v_stats.top_three, 0),
      'mvps', coalesce(v_stats.mvps, 0),
      'charactersDrafted', coalesce(v_stats.characters_drafted, 0),
      'creditsSpent', coalesce(v_stats.credits_spent, 0),
      'mostExpensivePrice', coalesce(v_stats.most_expensive_price, 0),
      'mostExpensiveName', v_stats.most_expensive_name,
      'bestRankPoints', coalesce(v_stats.best_rank_points, 0)),
    'season', case when v_season.id is null then null else jsonb_build_object(
      'id', v_season.id, 'number', v_season.number, 'name', v_season.name,
      'endsAt', v_season.ends_at,
      'rankPoints', coalesce(v_sp.rank_points, 0),
      'bestRankPoints', coalesce(v_sp.best_rank_points, 0),
      'matches', coalesce(v_sp.matches, 0), 'wins', coalesce(v_sp.wins, 0),
      'mvps', coalesce(v_sp.mvps, 0)) end,
    'history', v_history);
end $$;

create or replace function dw_coin_ledger(p_profile_id uuid, p_limit int default 25)
returns jsonb language plpgsql stable security definer as $$
declare v_rows jsonb; v_balance bigint; v_claimed boolean;
begin
  select coins into v_balance from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;

  select exists (
    select 1 from coin_transactions
     where profile_id = p_profile_id and kind = 'DAILY'
       and reference = to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
    into v_claimed;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'amount', t.amount, 'balance', t.balance_after,
      'kind', t.kind, 'reference', t.reference, 'detail', t.detail, 'at', t.created_at
    ) order by t.created_at desc), '[]'::jsonb) into v_rows
  from (select * from coin_transactions where profile_id = p_profile_id
         order by created_at desc limit greatest(1, least(100, p_limit))) t;

  return jsonb_build_object('ok', true, 'balance', v_balance,
                            'dailyClaimed', v_claimed, 'entries', v_rows);
end $$;
