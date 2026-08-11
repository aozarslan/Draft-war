-- =============================================================================
-- DRAFT WAR V3 — Phase 10: challenges and the daily ladder.
--
-- A challenge is an achievement measured as a delta. When one is assigned, the
-- profile's current value for its metric is snapshotted as a baseline, and
-- progress is whatever has happened since. That is the whole mechanism, and it
-- is why "win 2 matches today" needs no new counter anywhere: the metrics are
-- the same ones dw_profile_metrics already derives for achievements.
--
-- Periods open themselves — a day, a week — exactly like the shop rotation and
-- the season, and which templates are live is a deterministic function of the
-- period, so everybody gets the same tasks and refreshing changes nothing.
--
-- Claiming pays through dw_award_coins with the period in the reference, so a
-- double-tapped Claim button pays once even if both requests arrive.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Templates, periods, assignments
-- ---------------------------------------------------------------------------

create table if not exists challenge_templates (
  id          text primary key,
  scope       text not null check (scope in ('DAILY', 'WEEKLY')),
  name        text not null,
  description text not null default '',
  metric      text not null,
  target      int  not null check (target > 0),
  coins       int  not null default 0 check (coins >= 0),
  xp          int  not null default 0 check (xp >= 0),
  is_active   boolean not null default true,
  sort        int not null default 0
);

create table if not exists challenge_periods (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('DAILY', 'WEEKLY')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  template_ids text[] not null default '{}',
  created_at   timestamptz not null default now(),
  unique (scope, starts_at)
);

create index if not exists idx_challenge_periods on challenge_periods (scope, starts_at desc);

create table if not exists profile_challenges (
  profile_id   uuid not null references profiles(id) on delete cascade,
  period_id    uuid not null references challenge_periods(id) on delete cascade,
  template_id  text not null references challenge_templates(id) on delete cascade,
  -- The metric's value when this was assigned. Progress is measured from here,
  -- which is what makes a lifetime counter usable as a daily task.
  baseline     bigint not null default 0,
  completed_at timestamptz,
  claimed_at   timestamptz,
  primary key (profile_id, period_id, template_id)
);

create index if not exists idx_profile_challenges
  on profile_challenges (profile_id, period_id);

alter table challenge_templates enable row level security;
alter table challenge_periods   enable row level security;
alter table profile_challenges  enable row level security;

-- The tasks are public, like the shop and the medal list. Who is how far
-- through them is not: no policy on profile_challenges.
drop policy if exists "challenge templates readable" on challenge_templates;
create policy "challenge templates readable" on challenge_templates for select using (true);
drop policy if exists "challenge periods readable" on challenge_periods;
create policy "challenge periods readable" on challenge_periods for select using (true);

-- ---------------------------------------------------------------------------
-- 2. The current period
--
-- Days start at midnight UTC; weeks start on Monday. Which templates are live
-- is decided by hashing each template id against the period's key, so it is
-- stable for everyone until the period turns over.
-- ---------------------------------------------------------------------------

create or replace function dw_current_period(p_scope text)
returns challenge_periods language plpgsql as $$
declare
  r        challenge_periods%rowtype;
  v_start  timestamptz;
  v_end    timestamptz;
  v_key    text;
  v_slots  int;
  v_ids    text[];
begin
  if p_scope = 'WEEKLY' then
    v_start := date_trunc('week', now() at time zone 'utc') at time zone 'utc';
    v_end   := v_start + interval '7 days';
    v_slots := 2;
  else
    v_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    v_end   := v_start + interval '1 day';
    v_slots := 3;
  end if;

  select * into r from challenge_periods
   where scope = p_scope and starts_at = v_start;
  if found then return r; end if;

  v_key := p_scope || ':' || to_char(v_start at time zone 'utc', 'YYYY-MM-DD');

  select array_agg(id) into v_ids from (
    select id from challenge_templates
     where scope = p_scope and is_active
     order by md5(id || v_key)
     limit v_slots
  ) picked;

  insert into challenge_periods (scope, starts_at, ends_at, template_ids)
  values (p_scope, v_start, v_end, coalesce(v_ids, '{}'))
  on conflict (scope, starts_at) do nothing
  returning * into r;

  if r.id is null then
    select * into r from challenge_periods where scope = p_scope and starts_at = v_start;
  end if;

  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Assignment and progress
--
-- Assignment is lazy: the first time a profile looks at its challenges in a
-- period, the rows are created and the baselines taken. Progress is recomputed
-- from the metrics on every call, so there is no counter to drift.
-- ---------------------------------------------------------------------------

create or replace function dw_sync_challenges(p_profile_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_metrics jsonb;
  v_rows    jsonb := '[]'::jsonb;
  p         challenge_periods%rowtype;
  t         challenge_templates%rowtype;
  pc        profile_challenges%rowtype;
  v_scope   text;
  v_value   bigint;
  v_done    bigint;
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'challenges', '[]'::jsonb);
  end if;

  v_metrics := dw_profile_metrics(p_profile_id);
  if v_metrics = '{}'::jsonb then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  foreach v_scope in array array['DAILY', 'WEEKLY'] loop
    p := dw_current_period(v_scope);
    continue when p.id is null;

    for t in
      select * from challenge_templates
       where id = any(p.template_ids) and is_active
       order by sort
    loop
      v_value := coalesce((v_metrics->>t.metric)::bigint, 0);

      -- Assign on first sight, taking the baseline as it stands right now.
      insert into profile_challenges (profile_id, period_id, template_id, baseline)
      values (p_profile_id, p.id, t.id, v_value)
      on conflict (profile_id, period_id, template_id) do nothing;

      select * into pc from profile_challenges
       where profile_id = p_profile_id and period_id = p.id and template_id = t.id;

      v_done := greatest(0, v_value - pc.baseline);

      if v_done >= t.target and pc.completed_at is null then
        update profile_challenges set completed_at = now()
         where profile_id = p_profile_id and period_id = p.id and template_id = t.id;
        pc.completed_at := now();
      end if;

      v_rows := v_rows || jsonb_build_object(
        'id', t.id, 'scope', t.scope, 'name', t.name, 'description', t.description,
        'metric', t.metric, 'target', t.target,
        'coins', t.coins, 'xp', t.xp,
        'progress', least(v_done, t.target),
        'complete', pc.completed_at is not null,
        'claimed', pc.claimed_at is not null,
        'periodId', p.id, 'endsAt', p.ends_at);
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'challenges', v_rows);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Claiming
--
-- The claimed_at stamp and the coin ledger's unique reference both guard this,
-- so two taps of the same button pay once.
-- ---------------------------------------------------------------------------

create or replace function dw_claim_challenge(
  p_profile_id uuid, p_token text, p_template_id text
) returns jsonb language plpgsql security definer as $$
declare
  v_ok    boolean;
  t       challenge_templates%rowtype;
  p       challenge_periods%rowtype;
  pc      profile_challenges%rowtype;
  v_rows  int;
  v_xp    bigint;
  v_award jsonb;
  v_unlocked jsonb := '[]'::jsonb;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into t from challenge_templates where id = p_template_id and is_active;
  if not found then return dw_err('NO_CHALLENGE', 'That challenge does not exist.'); end if;

  -- Recompute before paying: the caller does not get to say it is done.
  perform dw_sync_challenges(p_profile_id);

  p := dw_current_period(t.scope);
  select * into pc from profile_challenges
   where profile_id = p_profile_id and period_id = p.id and template_id = t.id;

  if not found then return dw_err('NOT_ASSIGNED', 'That challenge is not live right now.'); end if;
  if pc.completed_at is null then return dw_err('NOT_COMPLETE', 'Not finished yet.'); end if;

  -- The stamp is the lock: only the update that actually sets it pays out.
  update profile_challenges set claimed_at = now()
   where profile_id = p_profile_id and period_id = p.id and template_id = t.id
     and claimed_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return dw_err('ALREADY_CLAIMED', 'You already claimed that one.'); end if;

  if t.coins > 0 then
    v_award := dw_award_coins(p_profile_id, t.coins, 'CHALLENGE',
                              p.id::text || ':' || t.id,
                              jsonb_build_object('challenge', t.id, 'name', t.name));
  end if;

  if t.xp > 0 then
    insert into xp_transactions (profile_id, amount, kind, detail)
    values (p_profile_id, t.xp, 'CHALLENGE',
            jsonb_build_object('challenge', t.id, 'periodId', p.id));
    update profiles set xp = xp + t.xp where id = p_profile_id returning xp into v_xp;
    update profiles set level = dw_level_for_xp(v_xp) where id = p_profile_id;
  end if;

  -- Finishing a challenge can finish an achievement, which pays again. Read
  -- the balance after that rather than before, or the header shows a number
  -- the wallet has already moved past.
  v_unlocked := coalesce(dw_evaluate_achievements(p_profile_id)->'unlocked', '[]'::jsonb);

  return jsonb_build_object(
    'ok', true, 'id', t.id, 'name', t.name,
    'coins', t.coins, 'xp', t.xp,
    'balance', (select coins from profiles where id = p_profile_id),
    'unlocked', v_unlocked);
end $$;

-- ---------------------------------------------------------------------------
-- 5. The daily ladder replaces the flat daily reward
--
-- Seven days of showing up, climbing to 600 on the seventh, then starting
-- again. The lifetime streak keeps counting for the achievements even though
-- the reward cycles. Mirrors DAILY_LADDER in src/lib/game/challenges.ts.
-- ---------------------------------------------------------------------------

create or replace function dw_daily_ladder(p_streak int)
returns int language sql immutable as $$
  select (array[100, 125, 150, 200, 250, 325, 600])[((greatest(1, p_streak) - 1) % 7) + 1];
$$;

-- The wallet needs the streak to draw the ladder, so the ledger read carries
-- it. Same function as 0008 plus `streak` and `nextAmount`.
create or replace function dw_coin_ledger(p_profile_id uuid, p_limit int default 25)
returns jsonb language plpgsql stable security definer as $$
declare
  v_rows jsonb; v_balance bigint; v_claimed boolean;
  v_streak int := 0; v_has boolean; d int;
begin
  select coins into v_balance from profiles where id = p_profile_id;
  if not found then return dw_err('PROFILE_NOT_FOUND', 'Profile not found.'); end if;

  select exists (
    select 1 from coin_transactions
     where profile_id = p_profile_id and kind = 'DAILY'
       and reference = to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
    into v_claimed;

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

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'amount', t.amount, 'balance', t.balance_after,
      'kind', t.kind, 'reference', t.reference, 'detail', t.detail, 'at', t.created_at
    ) order by t.created_at desc), '[]'::jsonb) into v_rows
  from (select * from coin_transactions where profile_id = p_profile_id
         order by created_at desc limit greatest(1, least(100, p_limit))) t;

  return jsonb_build_object('ok', true, 'balance', v_balance,
                            'dailyClaimed', v_claimed,
                            'streak', v_streak,
                            -- The next claim is always one further along,
                            -- whether that is today or tomorrow: when today is
                            -- already claimed the streak includes it.
                            'nextAmount', dw_daily_ladder(v_streak + 1),
                            'entries', v_rows);
end $$;

create or replace function dw_claim_daily(p_profile_id uuid, p_token text)
returns jsonb language plpgsql security definer as $$
declare
  v_ok       boolean;
  v_today    text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_streak   int := 0;
  v_has      boolean;
  d          int;
  v_amount   int;
  v_result   jsonb;
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

  -- Already claimed today: report the ladder, pay nothing.
  if exists (select 1 from coin_transactions
              where profile_id = p_profile_id and kind = 'DAILY' and reference = v_today) then
    return jsonb_build_object('ok', true, 'claimed', false, 'streak', v_streak,
                              'ladderDay', ((greatest(1, v_streak) - 1) % 7) + 1,
                              'nextAmount', dw_daily_ladder(v_streak + 1),
                              'balance', (select coins from profiles where id = p_profile_id),
                              'unlocked', '[]'::jsonb,
                              'nextAt', (date_trunc('day', now() at time zone 'utc') + interval '1 day'));
  end if;

  v_streak := v_streak + 1;                 -- today makes it one longer
  v_amount := dw_daily_ladder(v_streak);

  v_result := dw_award_coins(p_profile_id, v_amount, 'DAILY', v_today,
                             jsonb_build_object('day', v_today, 'streak', v_streak,
                                                'ladderDay', ((v_streak - 1) % 7) + 1));

  v_unlocked := coalesce(dw_evaluate_achievements(p_profile_id)->'unlocked', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'claimed', true, 'amount', v_amount,
                            'streak', v_streak,
                            'ladderDay', ((v_streak - 1) % 7) + 1,
                            'nextAmount', dw_daily_ladder(v_streak + 1),
                            'balance', (select coins from profiles where id = p_profile_id),
                            'unlocked', v_unlocked,
                            'nextAt', (date_trunc('day', now() at time zone 'utc') + interval '1 day'));
end $$;
