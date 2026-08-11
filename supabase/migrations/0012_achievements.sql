-- =============================================================================
-- DRAFT WAR V3 — Phase 9: achievements.
--
-- Every achievement is one metric against one threshold, and every metric is
-- computed here from data the server already owns: match history, the coin
-- ledger, the inventory. Nothing a client reports about itself is ever an
-- input, so "unlock everything" is not a request this system can receive.
--
-- Unlocking is idempotent through the primary key on profile_achievements: the
-- insert happens first and the rewards follow inside the same transaction, so
-- a second evaluation finds the row already there and pays nothing. Evaluation
-- is safe to run as often as we like — after a match, after a purchase, after
-- a daily claim — and that is exactly how it is called.
--
-- The catalog is seeded by 0013, generated from src/lib/game/achievements.ts.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Catalog and unlocks
-- ---------------------------------------------------------------------------

create table if not exists achievements (
  id           text primary key,
  name         text not null,
  description  text not null default '',
  category     text not null,
  tier         text not null default 'BRONZE',
  -- The key looked up in dw_profile_metrics(). Comparing a jsonb value against
  -- a threshold is the whole evaluation, which is why there is no per
  -- achievement logic anywhere in this file.
  metric       text not null,
  threshold    int  not null check (threshold > 0),
  reward_coins int  not null default 0 check (reward_coins >= 0),
  reward_xp    int  not null default 0 check (reward_xp >= 0),
  reward_item  text references catalog_items(id) on delete set null,
  hidden       boolean not null default false,
  is_active    boolean not null default true,
  sort         int not null default 0
);

create index if not exists idx_achievements_sort on achievements (category, sort);

create table if not exists profile_achievements (
  profile_id     uuid not null references profiles(id) on delete cascade,
  achievement_id text not null references achievements(id) on delete cascade,
  -- The metric's value at the moment it tipped over. Useful for bragging and
  -- for spotting a threshold that is too easy.
  value_at_unlock int not null default 0,
  unlocked_at    timestamptz not null default now(),
  primary key (profile_id, achievement_id)
);

create index if not exists idx_profile_achievements
  on profile_achievements (profile_id, unlocked_at desc);

alter table achievements         enable row level security;
alter table profile_achievements enable row level security;

-- The list of achievements is public: knowing what there is to chase is the
-- point. Who has unlocked what is not — no policy, so the browser cannot read
-- or invent an unlock.
drop policy if exists "achievements readable" on achievements;
create policy "achievements readable" on achievements for select using (true);

-- ---------------------------------------------------------------------------
-- 2. The level curve, in one place
--
-- dw_award_match grew its own copy of this loop. Now that a second caller
-- needs it, it lives here and mirrors xpForLevel() in progression.ts: each
-- level costs 100 XP more than the one before it.
-- ---------------------------------------------------------------------------

create or replace function dw_level_for_xp(p_xp bigint)
returns int language plpgsql immutable as $$
declare v_level int := 1;
begin
  while (select sum(400 + 100 * (i - 1)) from generate_series(2, v_level + 1) i) <= greatest(0, p_xp)
        and v_level < 200 loop
    v_level := v_level + 1;
  end loop;
  return v_level;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Metrics
--
-- One row of numbers describing a profile. Everything here is derived, so it
-- cannot disagree with the tables it came from, and adding an achievement
-- later usually means adding a key here rather than any new logic.
-- ---------------------------------------------------------------------------

create or replace function dw_profile_metrics(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_profile profiles%rowtype;
  v_stats   profile_stats%rowtype;
  v_streak  int := 0;
  v_daily   int := 0;
  v_has     boolean;
  d         int;
  r         record;
begin
  select * into v_profile from profiles where id = p_profile_id;
  if not found then return '{}'::jsonb; end if;
  select * into v_stats from profile_stats where profile_id = p_profile_id;

  -- Current winning run: consecutive first places counting back from the most
  -- recent match.
  for r in select placement from match_history
            where profile_id = p_profile_id
            order by created_at desc limit 60 loop
    exit when r.placement <> 1;
    v_streak := v_streak + 1;
  end loop;

  -- Consecutive days claimed, counting back from today. Today being unclaimed
  -- is not a gap, exactly as in dw_claim_daily.
  for d in 0..60 loop
    select exists (
      select 1 from coin_transactions t
       where t.profile_id = p_profile_id and t.kind = 'DAILY'
         and t.reference = to_char((now() at time zone 'utc') - make_interval(days => d), 'YYYY-MM-DD')
    ) into v_has;
    if v_has then v_daily := v_daily + 1;
    elsif d > 0 then exit;
    end if;
  end loop;

  return jsonb_build_object(
    'matches',              coalesce(v_stats.matches, 0),
    'wins',                 coalesce(v_stats.wins, 0),
    'top_three',            coalesce(v_stats.top_three, 0),
    'mvps',                 coalesce(v_stats.mvps, 0),
    'characters_drafted',   coalesce(v_stats.characters_drafted, 0),
    'credits_spent',        coalesce(v_stats.credits_spent, 0),
    'most_expensive_price', coalesce(v_stats.most_expensive_price, 0),
    'best_rank_points',     coalesce(v_stats.best_rank_points, 0),
    'level',                coalesce(v_profile.level, 1),
    'items_owned',          (select count(*) from profile_items where profile_id = p_profile_id),
    -- Lifetime coins earned, not the balance: spending should never undo an
    -- achievement somebody already has.
    'coins_earned',         (select coalesce(sum(amount), 0) from coin_transactions
                              where profile_id = p_profile_id and amount > 0),
    'categories_played',    (select count(distinct c) from match_history mh,
                              lateral unnest(mh.category_ids) c
                              where mh.profile_id = p_profile_id),
    'daily_streak',         v_daily,
    'win_streak',           v_streak);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Evaluation
--
-- Unlocks everything now earned and pays for it. The insert into
-- profile_achievements is the lock: if it does nothing, the achievement was
-- already unlocked and no reward follows.
-- ---------------------------------------------------------------------------

create or replace function dw_evaluate_achievements(p_profile_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_metrics jsonb;
  v_new     jsonb := '[]'::jsonb;
  v_rows    int;
  v_value   bigint;
  v_xp      bigint;
  a         achievements%rowtype;
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'unlocked', '[]'::jsonb);
  end if;

  v_metrics := dw_profile_metrics(p_profile_id);
  if v_metrics = '{}'::jsonb then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  for a in
    select * from achievements
     where is_active
       and not exists (select 1 from profile_achievements pa
                        where pa.profile_id = p_profile_id and pa.achievement_id = achievements.id)
     order by sort
  loop
    v_value := coalesce((v_metrics->>a.metric)::bigint, 0);
    continue when v_value < a.threshold;

    insert into profile_achievements (profile_id, achievement_id, value_at_unlock)
    values (p_profile_id, a.id, least(v_value, 2147483647))
    on conflict do nothing;

    get diagnostics v_rows = row_count;
    continue when v_rows = 0;  -- somebody else unlocked it a moment ago

    if a.reward_coins > 0 then
      perform dw_award_coins(p_profile_id, a.reward_coins, 'ACHIEVEMENT', a.id,
                             jsonb_build_object('achievement', a.id, 'name', a.name));
    end if;

    if a.reward_xp > 0 then
      insert into xp_transactions (profile_id, amount, kind, detail)
      values (p_profile_id, a.reward_xp, 'ACHIEVEMENT',
              jsonb_build_object('achievement', a.id, 'name', a.name));
      update profiles set xp = xp + a.reward_xp where id = p_profile_id
        returning xp into v_xp;
      update profiles set level = dw_level_for_xp(v_xp) where id = p_profile_id;
    end if;

    if a.reward_item is not null then
      perform dw_grant_item(p_profile_id, a.reward_item, 'ACHIEVEMENT', 'achievement:' || a.id);
    end if;

    v_new := v_new || jsonb_build_object(
      'id', a.id, 'name', a.name, 'description', a.description,
      'tier', a.tier, 'category', a.category,
      'coins', a.reward_coins, 'xp', a.reward_xp, 'item', a.reward_item);
  end loop;

  return jsonb_build_object('ok', true, 'unlocked', v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Read
--
-- Progress for everything, unlocked or not, so the UI can show how close
-- somebody is rather than only what they have.
-- ---------------------------------------------------------------------------

create or replace function dw_achievements(p_profile_id uuid default null)
returns jsonb language plpgsql stable security definer as $$
declare v_metrics jsonb := '{}'::jsonb; v_rows jsonb;
begin
  if p_profile_id is not null then
    v_metrics := dw_profile_metrics(p_profile_id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'description', a.description,
      'category', a.category, 'tier', a.tier,
      'metric', a.metric, 'threshold', a.threshold,
      'coins', a.reward_coins, 'xp', a.reward_xp, 'item', a.reward_item,
      'value', least(coalesce((v_metrics->>a.metric)::bigint, 0), a.threshold),
      'unlocked', pa.profile_id is not null,
      'unlockedAt', pa.unlocked_at
    ) order by a.sort), '[]'::jsonb) into v_rows
  from achievements a
  left join profile_achievements pa
    on pa.achievement_id = a.id and pa.profile_id = p_profile_id
  where a.is_active and (not a.hidden or pa.profile_id is not null);

  return jsonb_build_object(
    'ok', true,
    'metrics', v_metrics,
    'achievements', v_rows,
    'unlockedCount', (select count(*) from profile_achievements where profile_id = p_profile_id),
    'total', (select count(*) from achievements where is_active));
end $$;

-- ---------------------------------------------------------------------------
-- 6. The daily claim now feeds the streak achievements
--
-- Same function as 0008 with an evaluation on the end of it, so a seven-day
-- run pays out the moment the seventh claim lands rather than at the next
-- match.
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
  v_unlocked jsonb := '[]'::jsonb;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  for d in 0..60 loop
    select exists (
      select 1 from coin_transactions t
       where t.profile_id = p_profile_id and t.kind = 'DAILY'
         and t.reference = to_char((now() at time zone 'utc') - make_interval(days => d), 'YYYY-MM-DD')
    ) into v_has;
    if v_has then v_streak := v_streak + 1;
    elsif d > 0 then exit;
    end if;
  end loop;

  v_result := dw_award_coins(p_profile_id, 100, 'DAILY', v_today,
                             jsonb_build_object('day', v_today));

  if coalesce((v_result->>'alreadyAwarded')::boolean, false) then
    return jsonb_build_object('ok', true, 'claimed', false, 'streak', v_streak,
                              'balance', v_result->'balance',
                              'unlocked', '[]'::jsonb,
                              'nextAt', (date_trunc('day', now() at time zone 'utc') + interval '1 day'));
  end if;

  v_unlocked := coalesce(dw_evaluate_achievements(p_profile_id)->'unlocked', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'claimed', true, 'amount', 100,
                            'streak', v_streak + 1,
                            'balance', v_result->'balance',
                            'unlocked', v_unlocked,
                            'nextAt', (date_trunc('day', now() at time zone 'utc') + interval '1 day'));
end $$;

-- ---------------------------------------------------------------------------
-- 7. A purchase can complete a collection
-- ---------------------------------------------------------------------------

create or replace function dw_buy_item(p_profile_id uuid, p_token text, p_item_id text)
returns jsonb language plpgsql security definer as $$
declare
  v_ok      boolean;
  v_item    catalog_items%rowtype;
  v_pricing jsonb;
  v_spend   jsonb;
  v_price   int;
  v_code    text := 'PURCHASE_FAILED';
  v_msg     text := 'The purchase could not be completed.';
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into v_item from catalog_items where id = p_item_id and is_active;
  if not found then return dw_err('ITEM_NOT_FOUND', 'That item does not exist.'); end if;

  if exists (select 1 from profile_items
              where profile_id = p_profile_id and item_id = p_item_id) then
    return dw_err('ALREADY_OWNED', 'You already own that.');
  end if;

  v_pricing := dw_item_price(p_item_id);
  if coalesce((v_pricing->>'ok')::boolean, false) is not true then
    return v_pricing;
  end if;
  v_price := (v_pricing->>'price')::int;

  begin
    v_spend := dw_spend_coins(
      p_profile_id, v_price, 'PURCHASE', p_item_id,
      jsonb_build_object('itemId', p_item_id, 'name', v_item.name,
                         'kind', v_item.kind,
                         'listPrice', (v_pricing->>'listPrice')::int,
                         'discount', (v_pricing->>'discount')::int));

    if coalesce((v_spend->>'ok')::boolean, false) is not true then
      v_code := coalesce(v_spend->>'code', 'PURCHASE_FAILED');
      v_msg  := coalesce(v_spend->>'message', v_msg);
      raise exception 'purchase aborted: %', v_msg using errcode = 'check_violation';
    end if;

    if coalesce((dw_grant_item(p_profile_id, p_item_id, 'SHOP',
                               'purchase:' || p_item_id)->>'granted')::boolean, false)
       is not true then
      v_code := 'ALREADY_OWNED';
      v_msg  := 'You already own that.';
      raise exception 'purchase aborted: already owned' using errcode = 'check_violation';
    end if;
  exception when others then
    return dw_err(v_code, v_msg);
  end;

  return jsonb_build_object(
    'ok', true, 'itemId', p_item_id, 'kind', v_item.kind, 'name', v_item.name,
    'paid', v_price, 'balance', (v_spend->>'balance')::bigint,
    -- Buying the twentieth cosmetic should say so on the spot.
    'unlocked', coalesce(dw_evaluate_achievements(p_profile_id)->'unlocked', '[]'::jsonb));
end $$;
