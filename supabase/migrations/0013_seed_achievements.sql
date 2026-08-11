-- =============================================================================
-- DRAFT WAR V3 — Phase 9: the achievement catalog.
--
-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/game/achievements.ts   Regenerate: npm run seed:achievements
--
-- 27 achievements worth 24,150 coins and 11,050 XP in total.
--
-- Run after 0012_achievements.sql. Idempotent: existing rows are updated in
-- place and nobody's unlocks are touched.
-- =============================================================================

insert into achievements (id, name, description, category, tier, metric, threshold,
                          reward_coins, reward_xp, reward_item, hidden, sort)
values
  ('first-blood', 'First Blood', 'Finish your first match.', 'BATTLE', 'BRONZE', 'matches', 1, 100, 50, null, false, 0),
  ('regular', 'Regular', 'Play 10 matches.', 'BATTLE', 'BRONZE', 'matches', 10, 250, 150, null, false, 1),
  ('veteran', 'Veteran', 'Play 50 matches.', 'BATTLE', 'GOLD', 'matches', 50, 1000, 600, 'title-veteran', false, 2),
  ('winner', 'Winner', 'Win a match.', 'BATTLE', 'BRONZE', 'wins', 1, 150, 100, null, false, 3),
  ('the-gavel', 'The Gavel', 'Win 10 matches.', 'BATTLE', 'GOLD', 'wins', 10, 800, 500, 'avatar-gavel', false, 4),
  ('dynasty', 'Dynasty', 'Win 25 matches.', 'BATTLE', 'PLATINUM', 'wins', 25, 2000, 1200, null, false, 5),
  ('undefeated', 'Undefeated', 'Win three matches in a row.', 'BATTLE', 'PLATINUM', 'win_streak', 3, 1200, 700, 'title-undefeated', false, 6),
  ('podium', 'Podium', 'Finish in the top three 10 times.', 'BATTLE', 'SILVER', 'top_three', 10, 400, 250, null, false, 7),
  ('most-valuable', 'Most Valuable', 'Be the MVP of a match.', 'BATTLE', 'SILVER', 'mvps', 1, 200, 150, null, false, 8),
  ('carried', 'Carried', 'Be the MVP 10 times.', 'BATTLE', 'GOLD', 'mvps', 10, 900, 550, null, false, 9),
  ('opening-bid', 'Opening Bid', 'Draft 5 characters.', 'AUCTION', 'BRONZE', 'characters_drafted', 5, 100, 50, null, false, 10),
  ('collector-of-talent', 'Talent Scout', 'Draft 100 characters.', 'AUCTION', 'SILVER', 'characters_drafted', 100, 500, 300, null, false, 11),
  ('big-spender', 'Big Spender', 'Spend 500 credits across your drafts.', 'AUCTION', 'SILVER', 'credits_spent', 500, 400, 250, null, false, 12),
  ('blank-cheque', 'Blank Cheque', 'Win a single character for 30 credits or more.', 'AUCTION', 'GOLD', 'most_expensive_price', 30, 600, 350, null, false, 13),
  ('one-of-each', 'Well Travelled', 'Play a match in five different categories.', 'AUCTION', 'GOLD', 'categories_played', 5, 700, 400, null, false, 14),
  ('level-5', 'Getting Somewhere', 'Reach level 5.', 'PROGRESS', 'BRONZE', 'level', 5, 300, 0, null, false, 15),
  ('level-10', 'The Vault', 'Reach level 10.', 'PROGRESS', 'GOLD', 'level', 10, 800, 0, 'avatar-vault', false, 16),
  ('level-25', 'Institution', 'Reach level 25.', 'PROGRESS', 'PLATINUM', 'level', 25, 2500, 0, null, false, 17),
  ('climbing', 'Climbing', 'Reach 300 rank points in a season.', 'PROGRESS', 'SILVER', 'best_rank_points', 300, 500, 300, null, false, 18),
  ('champion', 'Champion', 'Reach Champion rank.', 'PROGRESS', 'PLATINUM', 'best_rank_points', 1800, 3000, 1500, 'frame-champion', false, 19),
  ('dressed-up', 'Dressed Up', 'Own 20 cosmetics.', 'COLLECTION', 'BRONZE', 'items_owned', 20, 200, 100, null, false, 20),
  ('wardrobe', 'Wardrobe', 'Own 30 cosmetics.', 'COLLECTION', 'SILVER', 'items_owned', 30, 600, 300, null, false, 21),
  ('earner', 'Earner', 'Earn 5,000 coins in total.', 'COLLECTION', 'SILVER', 'coins_earned', 5000, 500, 250, null, false, 22),
  ('tycoon', 'Tycoon', 'Earn 25,000 coins in total.', 'COLLECTION', 'PLATINUM', 'coins_earned', 25000, 2500, 1000, null, false, 23),
  ('showing-up', 'Showing Up', 'Claim the daily reward three days in a row.', 'DEDICATION', 'BRONZE', 'daily_streak', 3, 200, 100, null, false, 24),
  ('seven-days', 'Seven Days', 'Claim the daily reward seven days in a row.', 'DEDICATION', 'GOLD', 'daily_streak', 7, 750, 400, null, false, 25),
  ('thirty-days', 'Fixture', 'Claim the daily reward thirty days in a row.', 'DEDICATION', 'PLATINUM', 'daily_streak', 30, 3000, 1500, null, false, 26)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  tier = excluded.tier,
  metric = excluded.metric,
  threshold = excluded.threshold,
  reward_coins = excluded.reward_coins,
  reward_xp = excluded.reward_xp,
  reward_item = excluded.reward_item,
  hidden = excluded.hidden,
  sort = excluded.sort,
  is_active = true;

-- Everyone who has already been playing gets what they have already earned.
-- The evaluation is idempotent, so this is safe to run again.
select dw_evaluate_achievements(id) from profiles;
