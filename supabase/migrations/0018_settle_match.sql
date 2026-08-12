-- =============================================================================
-- DRAFT WAR V3 — Phase 14: settling a match in one call.
--
-- The end of a battle used to be four round trips per player, run one player
-- after another: sync challenges, award XP and rank, award coins, evaluate
-- achievements. A five-player game meant twenty sequential trips to the
-- database on the tick that stores the battle, and every one of them was a
-- network hop the players waited through.
--
-- This is the same four steps in the same order, inside one function. The
-- server now makes one call per player and makes them in parallel, so a
-- five-player settlement is one round trip deep instead of twenty.
--
-- It is also one transaction, which is a correctness improvement and not only
-- a speed one: a crash between the XP award and the coin award used to leave a
-- match that had paid XP but no coins. Now either the whole settlement lands or
-- none of it does, and every step inside it is still independently idempotent,
-- so a retried battle pays exactly once.
--
-- Additive and safe to re-run.
-- =============================================================================

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
begin
  -- A guest seat: they played, they just have nowhere to bank it.
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'skipped', 'guest');
  end if;

  -- Challenges first, and deliberately so. Assignment snapshots the baseline
  -- it measures from, so doing it after the award would exclude the match that
  -- just finished — and a player who never opens the profile page would never
  -- get credit for playing.
  perform dw_sync_challenges(p_profile_id);

  v_match := dw_award_match(p_game_id, p_profile_id, p_xp, p_rank_delta, p_ranked, p_summary);
  if coalesce((v_match->>'ok')::boolean, false) is not true then
    return v_match;
  end if;

  -- Coins ride their own ledger, so they are paid after the match row exists
  -- and stay idempotent independently of the XP award.
  v_coins := dw_award_match_coins(p_game_id, p_profile_id, p_coins, p_coin_detail);

  return jsonb_build_object(
    'ok', true,
    'match', v_match,
    'coins', v_coins,
    -- Last, so a match that took somebody to their tenth win pays the match
    -- first and the medal second.
    'unlocked', coalesce(dw_evaluate_achievements(p_profile_id)->'unlocked', '[]'::jsonb));
end $$;
