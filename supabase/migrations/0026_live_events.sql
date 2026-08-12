-- =============================================================================
-- DRAFT WAR V4 — Phase 4: live events.
--
-- "Marvel Week". A window with a theme, a featured category and a reward
-- bonus — a reason to come back this week rather than next month.
--
-- The hard rule from V4 is that an event must not permanently damage normal
-- balance, and the way that rule is kept here is structural: **an event can
-- only touch rewards and presentation, never combat.** There is no column for
-- a stat modifier, no multiplier the battle engine reads, and nothing in
-- `dw_settle_match` consults an event before the fight — only after it, when
-- the coins are being counted. A player who ignores events entirely is exactly
-- as strong as one who plays every day of one.
--
-- Named `live_events` rather than `events`: `game_events` is the per-match
-- log and `EVENT_CARDS` are the battle modifiers. Three different things
-- called "event" is one too many already.
--
-- Additive and safe to re-run.
-- =============================================================================

create table if not exists live_events (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  tagline     text not null default '',
  icon        text not null default '🎉',
  colour      text not null default '#fbbf24',
  -- Categories this event is about. Playing one of them earns the bonus.
  category_ids text[] not null default '{}',
  -- Extra coins and XP, as a percentage. Capped by a check rather than by
  -- convention: a typo that pays 10000% should be impossible, not unlikely.
  coin_bonus  int not null default 50 check (coin_bonus between 0 and 200),
  xp_bonus    int not null default 50 check (xp_bonus between 0 and 200),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  constraint live_event_window check (ends_at > starts_at)
);

create index if not exists idx_live_events_window on live_events (starts_at, ends_at);

alter table live_events enable row level security;
-- Readable like the shop catalog: an event that nobody can see is not an
-- event. Writing one is server-only — there is no policy for it.
drop policy if exists "live events readable" on live_events;
create policy "live events readable" on live_events for select using (true);

/** The event running right now, or null. */
create or replace function dw_live_event()
returns live_events language sql stable as $$
  select * from live_events
   where now() >= starts_at and now() < ends_at
   order by starts_at desc
   limit 1;
$$;

/**
 * The reward multiplier for a set of categories, as a percentage of normal.
 *
 * 100 means "no event". Returns 100 when no event is running, when the event
 * has no categories (a themed week with no featured category still reads as an
 * event, it just pays normally), or when none of the categories played match.
 */
create or replace function dw_event_multiplier(p_category_ids text[])
returns jsonb language plpgsql stable as $$
declare e live_events%rowtype; v_match boolean;
begin
  e := dw_live_event();
  if e.id is null then
    return jsonb_build_object('coins', 100, 'xp', 100, 'eventId', null);
  end if;

  v_match := coalesce(array_length(e.category_ids, 1), 0) > 0
             and coalesce(p_category_ids, '{}') && e.category_ids;

  return jsonb_build_object(
    'coins', case when v_match then 100 + e.coin_bonus else 100 end,
    'xp',    case when v_match then 100 + e.xp_bonus   else 100 end,
    'eventId', e.id, 'slug', e.slug, 'name', e.name, 'matched', v_match);
end $$;

-- ---------------------------------------------------------------------------
-- Settlement applies the bonus
--
-- Same four steps in the same order as 0018. The only change is that the coins
-- and XP handed to them are scaled first, and the scaling is reported back so
-- the results screen can say *why* somebody was paid more.
--
-- It is applied here rather than in the client-facing server so that the
-- amount is decided in the same transaction that records it — a bonus computed
-- upstream and passed down would be a number the client's server chose.
-- ---------------------------------------------------------------------------

create or replace function dw_settle_match(
  p_game_id     uuid,
  p_profile_id  uuid,
  p_xp          int,
  p_rank_delta  int,
  p_ranked      boolean,
  p_summary     jsonb,
  p_coins       int,
  p_coin_detail jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_match jsonb;
  v_coins jsonb;
  v_mult  jsonb;
  v_xp    int;
  v_paid  int;
  v_cats  text[];
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest');
  end if;

  perform dw_sync_challenges(p_profile_id);

  select category_ids into v_cats from games where id = p_game_id;
  v_mult := dw_event_multiplier(coalesce(v_cats, '{}'));

  -- Rounded down, so an event can never turn a 0-coin result into a payout.
  v_xp   := (greatest(0, p_xp)   * (v_mult->>'xp')::int)    / 100;
  v_paid := (greatest(0, p_coins) * (v_mult->>'coins')::int) / 100;

  v_match := dw_award_match(p_game_id, p_profile_id, v_xp, p_rank_delta, p_ranked, p_summary);
  if coalesce((v_match->>'ok')::boolean, false) is not true then
    return v_match;
  end if;

  v_coins := dw_award_match_coins(p_game_id, p_profile_id, v_paid,
    coalesce(p_coin_detail, '{}'::jsonb) || jsonb_build_object('event', v_mult));

  return jsonb_build_object(
    'ok', true,
    'match', v_match,
    'coins', v_coins,
    'event', v_mult,
    'unlocked', coalesce(dw_evaluate_achievements(p_profile_id)->'unlocked', '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- One event to look at.
--
-- Runs for a week from whenever this migration is applied, so the feature can
-- be seen working rather than taken on trust. Delete the row to turn it off;
-- change the dates to schedule another.
-- ---------------------------------------------------------------------------

insert into live_events (slug, name, tagline, icon, colour, category_ids,
                         coin_bonus, xp_bonus, starts_at, ends_at)
values ('marvel-week', 'Marvel Week',
        'Draft Marvel this week and earn half again as much.',
        '🦸', '#e23636', array['marvel'],
        50, 50, now(), now() + interval '7 days')
on conflict (slug) do nothing;
