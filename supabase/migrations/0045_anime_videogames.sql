-- =============================================================================
-- 0045 — IP-free archetypes: ANIME (22) + VIDEO GAMES (22)
-- =============================================================================
-- Replaces all 44 original character names, titles, abilities, universe labels,
-- palettes and metadata with IP-free archetypes. DB IDs and game_power are
-- unchanged. All wiki/image provenance columns are cleared.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ANIME (22)
-- ─────────────────────────────────────────────────────────────────────────────

WITH anime_updates(id, new_name, new_title, new_abilities, new_palette, new_meta) AS (
  VALUES
    ('anime-goku',               'The Boundless Paragon',   'He hits the ceiling and immediately builds a new one.',                                        ARRAY['Ascendant Surge','Limitless Threshold'],    ARRAY['#791040','#ef1a75'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"TOWERING","prop":"NONE","scale":1.14}}'::jsonb),
    ('anime-vegeta',             'The Crowned Rival',       'Second place is not a rank he recognises.',                                                    ARRAY['Royal Volley','Surge of Pride'],             ARRAY['#8a1848','#f24498'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"NONE","scale":1.06}}'::jsonb),
    ('anime-frieza',             'The Gilded Emperor',      'His cruelty is precise and his smile is genuine.',                                             ARRAY['Precision Ray','Final Form Surge'],          ARRAY['#961858','#f44a9e'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SLIGHT","prop":"NONE","scale":0.94}}'::jsonb),
    ('anime-naruto-uzumaki',     'The Blazing Outcast',     'He ran toward the village that used to look away.',                                            ARRAY['Clone Swarm','Spiral Force'],                ARRAY['#7a1040','#ef1475'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"HAMMER","scale":1.00}}'::jsonb),
    ('anime-sasuke-uchiha',      'The Dark Prodigy',        'Talent given a grievance is the most dangerous combination.',                                  ARRAY['Eye Technique','Black Lightning Arc'],       ARRAY['#6e0e2c','#e81256'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SLIGHT","prop":"BLADE","scale":0.95}}'::jsonb),
    ('anime-madara-uchiha',      'The Eternal Warlord',     'Legends are written about him, not by him.',                                                  ARRAY['Warrior''s Colossus','Reality Veil'],        ARRAY['#82144a','#ef2a92'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"CAPE","marking":"PLAIN","build":"HEAVY","prop":"BLADE","scale":1.10}}'::jsonb),
    ('anime-kakashi-hatake',     'The Silver Copyist',      'He has seen every technique once, which is all he needs.',                                    ARRAY['Mirror Strike','Pursuit Arc'],               ARRAY['#8b2060','#f45aac'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":0.97}}'::jsonb),
    ('anime-monkey-d-luffy',     'The Wild Captain',        'He doesn''t calculate the odds — he ignores them and wins.',                                  ARRAY['Elastic Barrage','Giant Form Strike'],       ARRAY['#7a1438','#ef2a70'], '{"i":{"head":"PLAIN","back":"SPINES","marking":"PLAIN","build":"NORMAL","prop":"NONE","scale":0.98}}'::jsonb),
    ('anime-roronoa-zoro',       'The Stoic Bladesman',     'Three swords, one direction, no need to explain further.',                                    ARRAY['Three-Edge Assault','Oni Cleave'],           ARRAY['#831843','#f472b6'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"BLADE","scale":1.02}}'::jsonb),
    ('anime-ichigo-kurosaki',    'The Relentless Reaper',   'He fights for the living because something inside him remembers what that means.',            ARRAY['Black Wave Release','Masked Transformation'],ARRAY['#791038','#ef1466'], '{"i":{"head":"PLAIN","back":"SPINES","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":1.00}}'::jsonb),
    ('anime-eren-yeager',        'The Vengeful Titan',      'Freedom was the word and he rewrote everything around it.',                                   ARRAY['Giant Shift','Armored Shell'],               ARRAY['#6e0e28','#e81252'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"TOWERING","prop":"BLADE","scale":1.16}}'::jsonb),
    ('anime-levi-ackerman',      'The Rapid Blade',         'Where others swing once, he has already finished.',                                           ARRAY['Spinning Blade Rush','Controlled Descent'],  ARRAY['#8a1a50','#f044a0'], '{"i":{"head":"PLAIN","back":"SHELL","marking":"PLAIN","build":"SLIGHT","prop":"BLADE","scale":0.90}}'::jsonb),
    ('anime-saitama',            'The Absolute Champion',   'He found the ceiling and was disappointed by it.',                                            ARRAY['Consecutive Rush','World-Ending Strike'],    ARRAY['#751038','#ef1462'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"NONE","scale":0.97}}'::jsonb),
    ('anime-tanjiro-kamado',     'The Kind Slayer',         'He learned to grieve without letting it stop the blade.',                                     ARRAY['Flowing Strike Pattern','Sun-Cycle Slash'],  ARRAY['#7a1444','#ef2e90'], '{"i":{"head":"PLAIN","back":"CAPE","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":0.96}}'::jsonb),
    ('anime-satoru-gojo',        'The Unseen Sovereign',    'He sees everything because nothing can reach him first.',                                     ARRAY['Absolute Barrier','Hollow Convergence'],     ARRAY['#791846','#ef2890'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"ORB","scale":1.00}}'::jsonb),
    ('anime-killua-zoldyck',     'The Electric Heir',       'He was born into the kill and chose something else — for a while.',                          ARRAY['Lightning Burst','Nerve-Cut Strike'],        ARRAY['#821848','#f03090'], '{"i":{"head":"PLAIN","back":"MANE","marking":"PLAIN","build":"SLIGHT","prop":"NONE","scale":0.89}}'::jsonb),
    ('anime-gon-freecss',        'The Bright Hunter',       'He doesn''t have a ceiling because he never thought to look for one.',                       ARRAY['Impact Throw','Wild Overdrive'],             ARRAY['#7c1444','#ef3080'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SQUAT","prop":"NONE","scale":0.94}}'::jsonb),
    ('anime-hisoka-morow',       'The Crimson Jester',      'He is not hunting you specifically — you just happened to be interesting.',                  ARRAY['Elastic Snare','Illusory Surface'],          ARRAY['#961838','#f43a72'], '{"i":{"head":"PLAIN","back":"FIN","marking":"STRIPES","build":"NORMAL","prop":"BLADE","scale":0.97}}'::jsonb),
    ('anime-edward-elric',       'The Forged Alchemist',    'He traded an arm to learn the hard lesson and immediately used it.',                         ARRAY['Matter Reshape','Living Metal Strike'],      ARRAY['#8a1a4c','#f2519a'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SQUAT","prop":"BLADE","scale":0.90}}'::jsonb),
    ('anime-guts',               'The Scarred Berserker',   'The sword is too big, the enemies too many, and he hasn''t stopped yet.',                    ARRAY['Colossal Sweep','Rage Armour'],              ARRAY['#741038','#ef1a66'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"BLADE","scale":1.08}}'::jsonb),
    ('anime-all-might',          'The Shining Symbol',      'He showed up so completely that people forgot what fear felt like.',                          ARRAY['Overwhelming Smash','Last Stand'],           ARRAY['#7c1440','#ef2880'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"CAPE","marking":"PLAIN","build":"TOWERING","prop":"NONE","scale":1.18}}'::jsonb),
    ('anime-shoto-todoroki',     'The Fractured Duelist',   'Two powers, one wound, and a choice he keeps making every time.',                            ARRAY['Glacial Pulse','Heat Flare'],                ARRAY['#92186a','#f460b0'], '{"i":{"head":"PLAIN","back":"SPINES","marking":"STRIPES","build":"NORMAL","prop":"ORB","scale":0.97}}'::jsonb)
)
UPDATE characters c SET
  name          = u.new_name,
  title         = u.new_title,
  universe      = 'Anime',
  version       = NULL,
  description   = '',
  actor         = NULL,
  abilities     = u.new_abilities,
  palette       = u.new_palette,
  metadata      = u.new_meta,
  category      = 'anime',
  image_url     = NULL,
  thumbnail_url = NULL,
  image_source  = NULL,
  image_license = NULL,
  image_credit  = NULL,
  wiki_title    = NULL,
  wiki_url      = NULL
FROM anime_updates u
WHERE c.id = u.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. VIDEO GAMES (22)
-- ─────────────────────────────────────────────────────────────────────────────

WITH vg_updates(id, new_name, new_title, new_abilities, new_palette, new_meta) AS (
  VALUES
    ('video-games-mario',              'The Radiant Everyman',    'He is unremarkable until he needs to save a world, which is often.',                            ARRAY['Power Stomp','Growth Boost'],                ARRAY['#093d5c','#1fc8e0'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SQUAT","prop":"NONE","scale":0.88}}'::jsonb),
    ('video-games-link',               'The Chosen Wanderer',     'He is chosen repeatedly, which suggests the world runs out of better options.',                 ARRAY['Sacred Blade Slash','Guardian Parry'],       ARRAY['#0a4060','#1ec8e8'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"SHIELD","scale":0.97}}'::jsonb),
    ('video-games-samus-aran',         'The Armored Hunter',      'The suit is the plan. The plan is thorough.',                                                   ARRAY['Charge Blast','Sphere Dive'],                ARRAY['#0d4a6e','#20d8f0'], '{"i":{"head":"HELM","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"ORB","scale":1.00}}'::jsonb),
    ('video-games-master-chief',       'The Iron Spartan',        'He was made to be the last resort and kept ending up the first call.',                          ARRAY['Energy Shield','Suppression Fire'],          ARRAY['#0e4a6e','#22d3ee'], '{"va":"humanoid_large","i":{"head":"HELM","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"NONE","scale":1.06}}'::jsonb),
    ('video-games-kratos',             'The Raging Godslayer',    'He did not stop at the first god and had no reason to stop at any of them.',                    ARRAY['Infernal Chain Slash','Wrath Surge'],        ARRAY['#083050','#19b2d4'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"NONE","marking":"STRIPES","build":"TOWERING","prop":"BLADE","scale":1.14}}'::jsonb),
    ('video-games-lara-croft',         'The Relentless Explorer', 'Every tomb was a trap and she walked out of every one.',                                        ARRAY['Dual Fire','Vault and Drop'],                ARRAY['#104e72','#25d0e8'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SLIGHT","prop":"NONE","scale":0.93}}'::jsonb),
    ('video-games-solid-snake',        'The Shadow Operative',    'The mission was impossible and he had already started.',                                        ARRAY['Field Concealment','Close Combat Takedown'], ARRAY['#0b4060','#1cc4e0'], '{"i":{"head":"PLAIN","back":"SHELL","marking":"PLAIN","build":"NORMAL","prop":"NONE","scale":0.97}}'::jsonb),
    ('video-games-sonic-the-hedgehog', 'The Blinding Streak',     'He solved every obstacle by arriving before it could form.',                                    ARRAY['Rolling Blitz','Barrier Dash'],              ARRAY['#084060','#18c8e8'], '{"i":{"head":"PLAIN","back":"SPINES","marking":"PLAIN","build":"SLIGHT","prop":"NONE","scale":0.88}}'::jsonb),
    ('video-games-pikachu',            'The Sparking Bolt',       'Small, fast, and conducting a charge the enemy never sees coming.',                             ARRAY['Static Shock','Rapid Dodge'],                ARRAY['#0a4870','#22d3ee'], '{"va":"quadruped_small","i":{"head":"PLAIN","back":"NONE","marking":"STRIPES","build":"NORMAL","prop":"NONE","scale":0.75}}'::jsonb),
    ('video-games-doomguy',            'The Unyielding Slayer',   'He was sent to deal with the problem and kept finding more problems.',                          ARRAY['Heavy Scatter Shot','Finishing Strike'],     ARRAY['#0c4060','#20d0f0'], '{"va":"humanoid_large","i":{"head":"HELM","back":"SHELL","marking":"PLAIN","build":"HEAVY","prop":"NONE","scale":1.06}}'::jsonb),
    ('video-games-ryu',                'The Wandering Warrior',   'He travels to find a fight worthy of the form he has already mastered.',                        ARRAY['Energy Wave','Rising Uppercut'],             ARRAY['#123a5c','#1abce0'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"NONE","scale":1.00}}'::jsonb),
    ('video-games-scorpion',           'The Infernal Revenant',   'Death did not stop him. It just gave him a forwarding address.',                                ARRAY['Chain Snare','Underworld Blaze'],            ARRAY['#0a3a5c','#18c4e0'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":0.99}}'::jsonb),
    ('video-games-sub-zero',           'The Glacial Templar',     'He freezes the field before the fight begins, which is a form of mercy.',                      ARRAY['Frost Clone','Cryo Burst'],                  ARRAY['#102a54','#16b8da'], '{"i":{"head":"PLAIN","back":"MANE","marking":"PLAIN","build":"NORMAL","prop":"NONE","scale":0.98}}'::jsonb),
    ('video-games-cloud-strife',       'The Brooding Swordsman',  'He carries more than the sword and fewer people notice the weight.',                            ARRAY['Heavy Blade Strike','Limit Surge'],          ARRAY['#0c3a60','#18c0e0'], '{"i":{"head":"PLAIN","back":"MANE","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":1.00}}'::jsonb),
    ('video-games-sephiroth',          'The Exiled Sovereign',    'He was the best of his generation until he found something that made that irrelevant.',         ARRAY['World Cleave','Celestial Blade'],            ARRAY['#083662','#17b8e0'], '{"va":"winged","i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":1.02}}'::jsonb),
    ('video-games-bowser',             'The Brutal King',         'He has tried to win the same way every time and has not stopped trying.',                       ARRAY['Flame Breath','Ground Shatter'],             ARRAY['#0e3a64','#1cc8e0'], '{"va":"humanoid_large","i":{"head":"HORNS","back":"SPINES","marking":"PLAIN","build":"TOWERING","prop":"NONE","scale":1.18}}'::jsonb),
    ('video-games-donkey-kong',        'The Wild Titan',          'He is not the biggest threat in the jungle by a technical standard — just a practical one.',   ARRAY['Overhead Smash','Barrel Launch'],            ARRAY['#123c62','#1cc8e4'], '{"va":"humanoid_large","i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"HAMMER","scale":1.14}}'::jsonb),
    ('video-games-ezio-auditore',      'The Cloaked Assassin',    'He learned the creed, broke it, and found that what he built was better.',                     ARRAY['Concealed Strike','Freefall Escape'],        ARRAY['#0e4870','#22cce8'], '{"i":{"head":"PLAIN","back":"CAPE","marking":"PLAIN","build":"SLIGHT","prop":"BLADE","scale":0.97}}'::jsonb),
    ('video-games-nathan-drake',       'The Fortunate Rover',     'Every trap he escaped was technically a near miss, but he stopped counting.',                   ARRAY['Lucky Escape','Cover Burst'],                ARRAY['#0c4462','#1ed0ea'], '{"i":{"head":"PLAIN","back":"FIN","marking":"PLAIN","build":"NORMAL","prop":"NONE","scale":0.96}}'::jsonb),
    ('video-games-arthur-morgan',      'The Weathered Outlaw',    'He drew a line in dust and kept it when the world tried to erase it.',                         ARRAY['Precision Aim','Rope Catch'],                ARRAY['#0a3460','#18b4de'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"HEAVY","prop":"NONE","scale":0.99}}'::jsonb),
    ('video-games-aloy',               'The Agile Tracker',       'She mapped the machines before the world knew they needed mapping.',                            ARRAY['Target Scan','Proximity Snare'],             ARRAY['#103c64','#20c8e4'], '{"i":{"head":"PLAIN","back":"NONE","marking":"PLAIN","build":"SLIGHT","prop":"BOW","scale":0.95}}'::jsonb),
    ('video-games-dante',              'The Raucous Slayer',      'Half demon, fully committed, and enjoying every moment of both.',                               ARRAY['Demonic Surge','Style Switch'],              ARRAY['#0e3868','#1ec0e0'], '{"i":{"head":"PLAIN","back":"SPINES","marking":"PLAIN","build":"NORMAL","prop":"BLADE","scale":1.00}}'::jsonb)
)
UPDATE characters c SET
  name          = u.new_name,
  title         = u.new_title,
  universe      = 'Games',
  version       = NULL,
  description   = '',
  actor         = NULL,
  abilities     = u.new_abilities,
  palette       = u.new_palette,
  metadata      = u.new_meta,
  category      = 'video-games',
  image_url     = NULL,
  thumbnail_url = NULL,
  image_source  = NULL,
  image_license = NULL,
  image_credit  = NULL,
  wiki_title    = NULL,
  wiki_url      = NULL
FROM vg_updates u
WHERE c.id = u.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. VERIFY
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_count int;
BEGIN
  -- anime: all 22 rows renamed to archetype format
  SELECT count(*) INTO v_count FROM characters
  WHERE category = 'anime' AND name LIKE 'The %';
  ASSERT v_count = 22, 'Expected 22 anime archetype rows, got ' || v_count;

  -- video-games: all 22 rows renamed
  SELECT count(*) INTO v_count FROM characters
  WHERE category = 'video-games' AND name LIKE 'The %';
  ASSERT v_count = 22, 'Expected 22 video-games archetype rows, got ' || v_count;

  -- no original IP names remain
  SELECT count(*) INTO v_count FROM characters
  WHERE category IN ('anime','video-games')
    AND name IN (
      'Goku','Vegeta','Frieza','Naruto Uzumaki','Sasuke Uchiha',
      'Madara Uchiha','Kakashi Hatake','Monkey D. Luffy','Roronoa Zoro',
      'Ichigo Kurosaki','Eren Yeager','Levi Ackerman','Saitama',
      'Tanjiro Kamado','Satoru Gojo','Killua Zoldyck','Gon Freecss',
      'Hisoka Morow','Edward Elric','Guts','All Might','Shoto Todoroki',
      'Mario','Link','Samus Aran','Master Chief','Kratos','Lara Croft',
      'Solid Snake','Sonic the Hedgehog','Pikachu','Doomguy','Ryu',
      'Scorpion','Sub-Zero','Cloud Strife','Sephiroth','Bowser',
      'Donkey Kong','Ezio Auditore','Nathan Drake','Arthur Morgan',
      'Aloy','Dante'
    );
  ASSERT v_count = 0, 'IP names still present: ' || v_count;

  -- image_url cleared for all 44
  SELECT count(*) INTO v_count FROM characters
  WHERE category IN ('anime','video-games') AND image_url IS NULL;
  ASSERT v_count = 44, 'Expected 44 NULL image_url rows, got ' || v_count;

  RAISE NOTICE 'All 4 assertions passed — anime/video-games archetypes applied.';
END;
$$;
