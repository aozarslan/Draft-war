-- =============================================================================
-- DRAFT WAR V3 — Phase 10: the challenge catalog.
--
-- GENERATED FILE — do not edit by hand.
-- Source: src/lib/game/challenges.ts   Regenerate: npm run seed:challenges
--
-- 9 daily templates (3 live at a time) and 6 weekly (2 live).
--
-- Run after 0014_challenges.sql. Idempotent: existing templates are updated in
-- place, and assignments keep the baselines they were given.
-- =============================================================================

insert into challenge_templates (id, scope, name, description, metric, target, coins, xp, sort)
values
  ('d-play-2', 'DAILY', 'Turn up', 'Finish 2 matches.', 'matches', 2, 150, 100, 0),
  ('d-play-3', 'DAILY', 'Session', 'Finish 3 matches.', 'matches', 3, 250, 150, 1),
  ('d-win-1', 'DAILY', 'Take one', 'Win a match.', 'wins', 1, 200, 120, 2),
  ('d-win-2', 'DAILY', 'Double up', 'Win 2 matches.', 'wins', 2, 400, 250, 3),
  ('d-podium-2', 'DAILY', 'Consistent', 'Finish in the top three twice.', 'top_three', 2, 200, 120, 4),
  ('d-mvp-1', 'DAILY', 'Stand out', 'Be the MVP of a match.', 'mvps', 1, 250, 150, 5),
  ('d-draft-10', 'DAILY', 'Shopping list', 'Draft 10 characters.', 'characters_drafted', 10, 150, 100, 6),
  ('d-spend-60', 'DAILY', 'Open wallet', 'Spend 60 credits across your drafts.', 'credits_spent', 60, 150, 100, 7),
  ('d-earn-300', 'DAILY', 'Payday', 'Earn 300 coins.', 'coins_earned', 300, 200, 100, 8),
  ('w-play-10', 'WEEKLY', 'Fixture list', 'Finish 10 matches this week.', 'matches', 10, 800, 500, 9),
  ('w-win-5', 'WEEKLY', 'Good week', 'Win 5 matches this week.', 'wins', 5, 1200, 700, 10),
  ('w-mvp-3', 'WEEKLY', 'The difference', 'Be the MVP 3 times this week.', 'mvps', 3, 1000, 600, 11),
  ('w-draft-50', 'WEEKLY', 'Deep bench', 'Draft 50 characters this week.', 'characters_drafted', 50, 700, 400, 12),
  ('w-podium-8', 'WEEKLY', 'Always there', 'Finish in the top three 8 times this week.', 'top_three', 8, 900, 550, 13),
  ('w-spend-300', 'WEEKLY', 'Big week at the block', 'Spend 300 credits this week.', 'credits_spent', 300, 700, 400, 14)
on conflict (id) do update set
  scope = excluded.scope,
  name = excluded.name,
  description = excluded.description,
  metric = excluded.metric,
  target = excluded.target,
  coins = excluded.coins,
  xp = excluded.xp,
  sort = excluded.sort,
  is_active = true;
