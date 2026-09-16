-- =============================================================================
-- 0037 — S8: live-count damage scaling
--
-- Adds a per-seat damage multiplier that depends on how many players were alive
-- at the START of each round (fixed before any fights resolve).
--
-- Problem: with ghost active every player fights once per round regardless of
-- player count, so raw damage accumulation is the same across formats. But the
-- number of eliminations needed before a match ends is 1 for 2p and 4 for 5p,
-- which makes 2p finish very fast and 5p very slowly at the same HP setting.
--
-- Solution: scale damage down when few players are alive. As the field thins,
-- fights hurt less — matches slow down naturally near the endgame.
--
-- Scale table (mirrors LIVE_COUNT_SCALE in src/lib/game/combat.ts — the pin
-- test in tests/round-combat.test.ts keeps the two in sync):
--
--   live_count 2  →  0.75
--   live_count 3  →  0.90
--   live_count 4+ →  1.00  (no reduction, reference point)
--
-- Architecture note: damage is computed in TypeScript (`damageFor`) and passed
-- to `dw_resolve_matchup` as `p_damage`. The SQL function stores and applies
-- whatever it is given — it does not recompute. `round_live_count` is stored
-- in each matchup row for auditability, not for re-derivation.
--
-- Two changes:
--  1. `round_matchups.round_live_count` — live count at the round's start,
--     written by `dw_pair_round` (which already computes it) and stored once.
--  2. `dw_pair_round` — populate the new column; otherwise identical.
--
-- Additive: one nullable column added, one function replaced at its existing
-- signature. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------

alter table round_matchups
  add column if not exists round_live_count int;

-- ---------------------------------------------------------------------------
-- 2. dw_pair_round — store v_live into round_live_count
-- ---------------------------------------------------------------------------

create or replace function dw_pair_round(p_room_id uuid, p_pairings jsonb)
returns jsonb language plpgsql security definer as $$
declare
  v_room    rooms%rowtype;
  m         matches%rowtype;
  v_pair    jsonb;
  v_seen    uuid[] := '{}';
  v_a       uuid;
  v_b       uuid;
  v_count   int := 0;
  v_live    int;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  select * into m from matches where id = v_room.current_match_id for update;
  if not found then return dw_err('NO_MATCH', 'This room is not playing a match.'); end if;
  if m.status <> 'ACTIVE' then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if m.phase <> 'MATCHMAKING' then
    return dw_err('WRONG_PHASE', 'The round is not at its matchmaking.');
  end if;

  -- Already paired. The second caller gets the same answer as the first.
  if exists (select 1 from round_matchups where match_id = m.id and round_no = m.round_no) then
    return jsonb_build_object('ok', true, 'noop', true, 'roundNo', m.round_no,
      'pairings', (select count(*) from round_matchups
                    where match_id = m.id and round_no = m.round_no));
  end if;

  -- Live-count scale (mirrors LIVE_COUNT_SCALE in src/lib/game/combat.ts):
  --   live_count 2 → 0.75, live_count 3 → 0.90, live_count 4+ → 1.00
  -- Damage is computed in TypeScript and passed as p_damage; the scale is applied there.
  -- This column stores the round's liveCount so dw_resolve_matchup never calls count(*).

  -- Count live players once, at the start of the round, before any fight.
  -- This value is stored on every matchup row so dw_resolve_matchup never
  -- needs to re-count; all fights in the round share the same multiplier.
  select count(*) into v_live from match_players
   where match_id = m.id and eliminated_at is null and hp > 0;

  -- Fewer than two seats left is not a round to pair; the state machine forks
  -- to the championship on its own.
  if v_live < 2 then
    return jsonb_build_object('ok', true, 'noop', true, 'roundNo', m.round_no, 'pairings', 0);
  end if;

  for v_pair in select * from jsonb_array_elements(p_pairings) loop
    v_a := nullif(v_pair->>'playerA', '')::uuid;
    v_b := nullif(v_pair->>'playerB', '')::uuid;

    if v_a is null then
      return dw_err('BAD_PAIRING', 'A matchup must name a player.');
    end if;
    if v_b is not null and v_b = v_a then
      return dw_err('BAD_PAIRING', 'A player cannot face themselves.');
    end if;
    if v_a = any(v_seen) or (v_b is not null and v_b = any(v_seen)) then
      return dw_err('BAD_PAIRING', 'A player appears in two matchups.');
    end if;

    if not exists (select 1 from match_players mp
                    where mp.match_id = m.id and mp.player_id = v_a
                      and mp.eliminated_at is null and mp.hp > 0) then
      return dw_err('BAD_PAIRING', 'That player is not in this match.');
    end if;
    if v_b is not null and not exists (select 1 from match_players mp
                    where mp.match_id = m.id and mp.player_id = v_b
                      and mp.eliminated_at is null and mp.hp > 0) then
      return dw_err('BAD_PAIRING', 'That player is not in this match.');
    end if;

    v_seen := v_seen || v_a;
    if v_b is not null then v_seen := v_seen || v_b; end if;

    insert into round_matchups (match_id, round_no, pairing_index, player_a, player_b,
                                kind, rating_a, rating_b, reason, round_live_count)
    values (m.id, m.round_no, v_count, v_a, v_b,
            coalesce(v_pair->>'kind', 'DUEL'),
            (v_pair->>'ratingA')::numeric,
            (v_pair->>'ratingB')::numeric,
            v_pair->>'reason',
            v_live);
    v_count := v_count + 1;
  end loop;

  -- Every live seat has to be somewhere. A round that pairs four of five people
  -- leaves somebody with no round at all, which is worse than not pairing.
  if array_length(v_seen, 1) is distinct from v_live then
    return dw_err('BAD_PAIRING', 'Every player must appear in exactly one matchup.');
  end if;

  perform dw_event(null, p_room_id, 'ROUND_PAIRED', jsonb_build_object(
    'matchId', m.id, 'roundNo', m.round_no, 'pairings', v_count));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'roundNo', m.round_no, 'pairings', v_count);
end $$;
