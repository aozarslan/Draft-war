-- =============================================================================
-- DRAFT WAR V4 — Phase 4: character mastery, category mastery, collection.
--
-- Derived, not counted. `match_history.roster` already records every character
-- a profile has ever drafted, along with where they finished and whether they
-- were MVP; `games.queue` records every character that came up for auction in
-- the games they played. Mastery and collection are questions to ask of that.
--
-- A counter table would be faster to read and would eventually disagree with
-- the history it was meant to summarise — one missed increment, one replayed
-- match, and the number is quietly wrong forever with nothing to reconcile it
-- against. The scan below is bounded by one profile's own history.
--
-- Nothing here grants power. The rewards are a level, a badge and a
-- percentage, exactly as V4 requires.
--
-- Additive and safe to re-run.
-- =============================================================================

-- The mastery query unnests one profile's rosters. Without this it is a scan
-- of everybody's history to answer a question about one person.
create index if not exists idx_match_history_profile_roster
  on match_history (profile_id, created_at desc);

/**
 * Mastery points per character for one profile.
 *
 * Mirrors masteryForDraft() in src/lib/game/mastery.ts: one point for the
 * draft, one more for a win, one more for an MVP. The two must agree, so the
 * arithmetic is written the same way in both places rather than being derived
 * from a shared constant that neither side could check.
 */
create or replace function dw_character_mastery(p_profile_id uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer as $$
declare v_rows jsonb;
begin
  select coalesce(jsonb_agg(x order by (x->>'points')::int desc, x->>'characterId'), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
        'characterId', r->>'characterId',
        -- The category comes from the character table rather than being
        -- parsed out of the id. Prefix-matching an id works today and stops
        -- working the first time a category is renamed.
        'categoryId', max(c.category),
        'drafts', count(*),
        'wins', count(*) filter (where h.placement = 1),
        'mvps', count(*) filter (where h.is_mvp),
        'points', sum(1
                      + case when h.placement = 1 then 1 else 0 end
                      + case when h.is_mvp then 1 else 0 end),
        'lastAt', max(h.created_at)
      ) as x
      from match_history h,
           lateral jsonb_array_elements(h.roster) r
      join characters c on c.id = r->>'characterId'
     where h.profile_id = p_profile_id
       and r->>'characterId' is not null
     group by r->>'characterId'
     order by sum(1
                  + case when h.placement = 1 then 1 else 0 end
                  + case when h.is_mvp then 1 else 0 end) desc
     limit greatest(1, least(500, p_limit))
  ) t;

  return jsonb_build_object('ok', true, 'characters', v_rows);
end $$;

/**
 * Category mastery and the collection, in one pass.
 *
 * "Seen" is every character that came up for auction in a game this profile
 * played — luck of the draw. "Drafted" is every character they actually owned
 * — a decision. The two are reported separately because they mean different
 * things, and the percentage is the second one.
 */
create or replace function dw_collection(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare v_rows jsonb; v_totals jsonb;
begin
  with
  -- Every character in the pool of every game this profile played.
  seen as (
    select distinct c.category, q.character_id
      from match_history h
      join games g on g.id = h.game_id,
           lateral jsonb_array_elements_text(g.queue) as q(character_id)
      join characters c on c.id = q.character_id
     where h.profile_id = p_profile_id
  ),
  -- Every character this profile actually drafted.
  drafted as (
    select distinct c.category, r->>'characterId' as character_id
      from match_history h,
           lateral jsonb_array_elements(h.roster) r
      join characters c on c.id = r->>'characterId'
     where h.profile_id = p_profile_id
  ),
  -- Mastery points, rolled up per category.
  points as (
    select c.category, sum(1
                           + case when h.placement = 1 then 1 else 0 end
                           + case when h.is_mvp then 1 else 0 end) as pts
      from match_history h,
           lateral jsonb_array_elements(h.roster) r
      join characters c on c.id = r->>'characterId'
     where h.profile_id = p_profile_id
     group by c.category
  ),
  -- The size of each category, counting only what can actually be drafted.
  pool as (
    select category, count(*) as total
      from characters where enabled group by category
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', pool.category,
      'total', pool.total,
      'seen', coalesce((select count(*) from seen where seen.category = pool.category), 0),
      'drafted', coalesce((select count(*) from drafted where drafted.category = pool.category), 0),
      'points', coalesce((select pts from points where points.category = pool.category), 0)
    ) order by pool.category), '[]'::jsonb)
    into v_rows
  from pool;

  select jsonb_build_object(
      'total', (select count(*) from characters where enabled),
      'drafted', (select count(distinct r->>'characterId')
                    from match_history h, lateral jsonb_array_elements(h.roster) r
                   where h.profile_id = p_profile_id),
      'matches', (select count(*) from match_history where profile_id = p_profile_id)
    ) into v_totals;

  return jsonb_build_object('ok', true, 'categories', v_rows, 'totals', v_totals);
end $$;
