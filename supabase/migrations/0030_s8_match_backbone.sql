-- =============================================================================
-- 0030 — S8.1: the match backbone
--
-- Adds the round/game-state spine an S8 match needs, and nothing else. There is
-- no combat, no damage, no elimination resolution, no event system and no
-- positioning maths in here; those are S8.5–S8.8 and each will bring its own
-- migration.
--
-- Three commitments this file keeps:
--
--  1. **Purely additive.** Four new tables, three new columns, one widened
--     check constraint. Nothing is dropped, nothing is rewritten, and every
--     statement is safe to run twice.
--
--  2. **Legacy is untouched.** `dw_snapshot`, `dw_tick`, `dw_start_game`,
--     `dw_place_bid`, `dw_store_battle` and every other existing function are
--     not replaced. A room that never starts a match behaves exactly as it did
--     yesterday, because the only thing that changes for it is a column it
--     leaves null. The new tick is a *separate* function (`dw_match_tick`)
--     called alongside the old one rather than inside it — replacing the one
--     function every client polls is the single highest-risk edit in this
--     codebase, and S8.1 does not need to make it.
--
--  3. **The state machine is the same state machine.** `dw_match_next_phase`
--     mirrors `PHASE_TRANSITIONS` in `src/lib/game/rounds.ts` edge for edge,
--     and `tests/migrations.test.ts` fails if the two ever disagree.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

alter table rooms add column if not exists current_match_id uuid;

-- A room in an S8 match sits in one phase, and the match owns the detail. The
-- constraint is widened rather than replaced with a different set, so every
-- value a live room might currently hold is still legal.
alter table rooms drop constraint if exists rooms_phase_check;
alter table rooms add constraint rooms_phase_check check (
  phase in ('LOBBY','CATEGORY','AUCTION','TEAM_REVIEW','MAP_SELECTION',
            'EVENT','BATTLE','RESULTS','FINISHED','MATCH')
);

-- A round's draft is an ordinary game row. Null on every legacy game.
alter table games add column if not exists match_id uuid;
alter table games add column if not exists round_no int;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists matches (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references rooms(id) on delete cascade,
  match_no           int  not null,
  status             text not null default 'ACTIVE'
                     check (status in ('ACTIVE','FINISHED','ABANDONED')),
  -- Mirrors MATCH_PHASES in src/lib/game/rounds.ts.
  phase              text not null default 'MATCH_INTRO'
                     check (phase in ('MATCH_INTRO','ROUND_START','AUCTION',
                                      'BOARD_UPDATE','POSITIONING','MATCHMAKING',
                                      'COMBAT','RESOLUTION','ROUND_END',
                                      'CHAMPIONSHIP','FINAL_COMBAT','MATCH_RESULTS')),
  -- 0 during MATCH_INTRO; 1..round_count once the match is running.
  round_no           int  not null default 0,
  round_count        int  not null,
  -- Every random draw the match will ever make derives from this one value, so
  -- a whole match is reproducible from a single string.
  seed               text not null,
  category_ids       text[] not null default '{}',
  phase_deadline     timestamptz,
  champion_player_id uuid references players(id) on delete set null,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz,
  unique (room_id, match_no)
);

-- Per-player match state. Deliberately NOT `players.credits`: that column is
-- reset by dw_start_game and dw_return_to_lobby, and a match owns its own
-- economy for eight rounds.
create table if not exists match_players (
  match_id      uuid not null references matches(id) on delete cascade,
  player_id     uuid not null references players(id) on delete cascade,
  hp            int  not null default 100,
  credits       int  not null,
  round_wins    int  not null default 0,
  streak        int  not null default 0,
  -- The round they went out in. Null while they are still playing. A player
  -- cannot be eliminated before round 6; HP is clamped at 1 until then.
  eliminated_at int,
  modifiers     jsonb not null default '[]'::jsonb,
  primary key (match_id, player_id)
);

-- Where a character stands. Keyed by character rather than by slot index so a
-- fighter is in exactly one place by construction and a swap cannot duplicate
-- one. Written from S8.2 onward; S8.1 only reads it.
create table if not exists board_slots (
  match_id     uuid not null references matches(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  character_id text not null references characters(id),
  zone         text not null check (zone in ('FRONT','MID','BACK','BENCH')),
  slot         int  not null,
  updated_at   timestamptz not null default now(),
  primary key (match_id, player_id, character_id)
);

-- Who fights whom in a round, and what came of it. `battle_result` holds a
-- BattleResult in exactly the format `games.battle_result` already uses, so the
-- replay projection and the renderer need no change at all. Populated from
-- S8.3 (pairings) and S8.5 (results); S8.1 creates the shape.
create table if not exists round_matchups (
  id               uuid primary key default gen_random_uuid(),
  match_id         uuid not null references matches(id) on delete cascade,
  round_no         int  not null,
  pairing_index    int  not null,
  player_a         uuid not null references players(id) on delete cascade,
  player_b         uuid references players(id) on delete cascade,
  kind             text not null default 'DUEL'
                   check (kind in ('DUEL','BYE','ENCOUNTER','PLAY_IN','SEMIFINAL','FINAL')),
  battle_result    jsonb,
  started_at       timestamptz,
  settled_at       timestamptz,
  winner_player_id uuid references players(id) on delete set null,
  damage           int,
  unique (match_id, round_no, pairing_index)
);

create index if not exists idx_matches_room     on matches (room_id, match_no desc);
create index if not exists idx_match_players_m  on match_players (match_id);
create index if not exists idx_board_slots_mp   on board_slots (match_id, player_id);
create index if not exists idx_matchups_round   on round_matchups (match_id, round_no);
create index if not exists idx_games_match      on games (match_id, round_no);

-- ---------------------------------------------------------------------------
-- RLS — server only, exactly like team_characters
--
-- No anon policy on any of the four. The browser reads match state through
-- our own API on the service role, which is what stops a client from watching
-- another player's credits or board through Realtime.
-- ---------------------------------------------------------------------------

alter table matches        enable row level security;
alter table match_players  enable row level security;
alter table board_slots    enable row level security;
alter table round_matchups enable row level security;

-- ---------------------------------------------------------------------------
-- The state machine
--
-- One function, mirroring PHASE_TRANSITIONS in src/lib/game/rounds.ts. The
-- successor is DERIVED here, never supplied by a caller: a caller that could
-- choose between ROUND_START and CHAMPIONSHIP is a caller that can end a match
-- four rounds early, and the host's browser is a caller.
-- ---------------------------------------------------------------------------

create or replace function dw_match_next_phase(
  p_phase text, p_round int, p_total int
) returns text language sql immutable as $$
  select case p_phase
    when 'MATCH_INTRO'   then 'ROUND_START'
    when 'ROUND_START'   then 'AUCTION'
    when 'AUCTION'       then 'BOARD_UPDATE'
    when 'BOARD_UPDATE'  then 'POSITIONING'
    when 'POSITIONING'   then 'MATCHMAKING'
    when 'MATCHMAKING'   then 'COMBAT'
    when 'COMBAT'        then 'RESOLUTION'
    when 'RESOLUTION'    then 'ROUND_END'
    when 'ROUND_END'     then case when p_round >= p_total then 'CHAMPIONSHIP' else 'ROUND_START' end
    when 'CHAMPIONSHIP'  then 'FINAL_COMBAT'
    when 'FINAL_COMBAT'  then 'MATCH_RESULTS'
    when 'MATCH_RESULTS' then null
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Starting a match
-- ---------------------------------------------------------------------------

create or replace function dw_start_match(
  p_room_id uuid, p_player_id uuid, p_seed text,
  p_round_count int, p_category_ids text[], p_intro_seconds int default 8
) returns jsonb language plpgsql security definer as $$
declare
  v_room    rooms%rowtype;
  v_players int;
  v_unready int;
  v_no      int;
  v_match   uuid;
  v_credits int;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can start a match.');
  end if;
  if v_room.phase <> 'LOBBY' then
    return dw_err('WRONG_PHASE', 'A match can only start from the lobby.');
  end if;

  select count(*) into v_players from players where room_id = p_room_id;
  if v_players < coalesce((v_room.config->>'minPlayers')::int, 2) then
    return dw_err('NOT_ENOUGH_PLAYERS', 'Not enough players to start.');
  end if;

  select count(*) into v_unready from players where room_id = p_room_id and is_ready = false;
  if v_unready > 0 then return dw_err('NOT_ALL_READY', 'Everyone must be ready.'); end if;

  if p_round_count is null or p_round_count < 1 or p_round_count > 12 then
    return dw_err('BAD_ROUND_COUNT', 'A match runs between 1 and 12 rounds.');
  end if;

  v_credits := coalesce((v_room.config->>'startingCredits')::int, 50);
  select coalesce(max(match_no), 0) + 1 into v_no from matches where room_id = p_room_id;

  insert into matches (room_id, match_no, seed, round_count, category_ids,
                       phase, round_no, phase_deadline)
  values (p_room_id, v_no, p_seed, p_round_count, coalesce(p_category_ids, '{}'),
          'MATCH_INTRO', 0, now() + make_interval(secs => greatest(1, p_intro_seconds)))
  returning id into v_match;

  insert into match_players (match_id, player_id, hp, credits)
  select v_match, p.id, 100, v_credits from players p where p.room_id = p_room_id;

  update players set is_ready = false where room_id = p_room_id;
  update rooms set phase = 'MATCH', current_match_id = v_match where id = p_room_id;

  perform dw_event(null, p_room_id, 'MATCH_STARTED', jsonb_build_object(
    'matchId', v_match, 'matchNo', v_no, 'players', v_players,
    'rounds', p_round_count, 'categoryIds', to_jsonb(coalesce(p_category_ids, '{}'::text[]))));

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'matchId', v_match, 'roundCount', p_round_count);
end $$;

-- ---------------------------------------------------------------------------
-- Advancing a phase
--
-- `p_to` is an optimistic-concurrency guard, not a choice: it is checked
-- against the phase this function derives for itself, so a client that names
-- the wrong destination is rejected rather than obeyed. `p_from` makes a
-- repeated call (two tabs, a retry, four clients hitting the same deadline)
-- land on `noop` instead of skipping a phase.
-- ---------------------------------------------------------------------------

create or replace function dw_advance_match_phase(
  p_room_id uuid, p_player_id uuid, p_from text, p_to text,
  p_deadline_seconds int default null
) returns jsonb language plpgsql security definer as $$
declare
  v_room  rooms%rowtype;
  m       matches%rowtype;
  v_next  text;
  v_round int;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if p_player_id is not null and v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.current_match_id is null then
    return dw_err('NO_MATCH', 'This room is not playing a match.');
  end if;

  select * into m from matches where id = v_room.current_match_id for update;
  if not found then return dw_err('NO_MATCH', 'This room is not playing a match.'); end if;
  if m.status <> 'ACTIVE' then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;

  -- Somebody already applied this step.
  if m.phase <> p_from then
    return jsonb_build_object('ok', true, 'noop', true, 'phase', m.phase, 'roundNo', m.round_no);
  end if;

  v_next := dw_match_next_phase(m.phase, m.round_no, m.round_count);
  if v_next is null then
    return dw_err('MATCH_OVER', 'This match has already finished.');
  end if;
  if p_to is not null and p_to <> v_next then
    return dw_err('INVALID_TRANSITION', 'A match cannot go there from here.');
  end if;

  -- The round number has exactly one writer, and this is it: entering
  -- ROUND_START, whether from MATCH_INTRO or from the previous ROUND_END.
  -- Incrementing only on the loop back leaves the first round numbered zero.
  v_round := case when v_next = 'ROUND_START' then m.round_no + 1 else m.round_no end;

  update matches
     set phase = v_next,
         round_no = v_round,
         phase_deadline = case when p_deadline_seconds is null then null
                               else now() + make_interval(secs => p_deadline_seconds) end,
         status = case when v_next = 'MATCH_RESULTS' then 'FINISHED' else status end,
         finished_at = case when v_next = 'MATCH_RESULTS' then now() else finished_at end
   where id = m.id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true, 'phase', v_next, 'roundNo', v_round);
end $$;

-- ---------------------------------------------------------------------------
-- The match clock
--
-- A separate function from dw_tick on purpose (see the header). It reports
-- rather than acts, exactly like dw_tick's own action list, so the phase
-- deadline table lives in one place — TypeScript — instead of being duplicated
-- here where it could drift.
--
-- A phase the match does not own (AUCTION, COMBAT) simply has no deadline, so
-- this never fires for it.
-- ---------------------------------------------------------------------------

create or replace function dw_match_tick(p_room_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  m      matches%rowtype;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
  end if;

  select * into m from matches where id = v_room.current_match_id;
  if not found or m.status <> 'ACTIVE' then
    return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
  end if;

  if m.phase_deadline is not null and now() >= m.phase_deadline then
    return jsonb_build_object('ok', true,
      'actions', jsonb_build_array('MATCH_PHASE_EXPIRED'),
      'phase', m.phase, 'roundNo', m.round_no);
  end if;

  return jsonb_build_object('ok', true, 'actions', '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Reading a match
--
-- A second RPC beside dw_snapshot rather than a replacement of it. Merging the
-- two is migration 0034's job, once the shape has stopped moving; replacing the
-- function every connected client polls, in the first milestone that touches
-- it, would put every live room behind one untested statement.
-- ---------------------------------------------------------------------------

create or replace function dw_match_snapshot(p_room_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare
  v_room     rooms%rowtype;
  m          matches%rowtype;
  v_players  jsonb;
  v_board    jsonb;
  v_matchups jsonb;
begin
  select * into v_room from rooms where id = p_room_id;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.current_match_id is null then
    return jsonb_build_object('ok', true, 'match', null);
  end if;

  select * into m from matches where id = v_room.current_match_id;
  if not found then return jsonb_build_object('ok', true, 'match', null); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', mp.player_id,
      'hp', mp.hp,
      'credits', mp.credits,
      'roundWins', mp.round_wins,
      'streak', mp.streak,
      'eliminatedAt', mp.eliminated_at,
      'modifiers', mp.modifiers
    ) order by p.seat), '[]'::jsonb) into v_players
  from match_players mp
  join players p on p.id = mp.player_id
  where mp.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', b.player_id, 'characterId', b.character_id,
      'zone', b.zone, 'slot', b.slot
    ) order by b.player_id, b.zone, b.slot), '[]'::jsonb) into v_board
  from board_slots b where b.match_id = m.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'roundNo', r.round_no, 'pairingIndex', r.pairing_index,
      'playerA', r.player_a, 'playerB', r.player_b, 'kind', r.kind,
      'startedAt', r.started_at, 'settledAt', r.settled_at,
      'winnerPlayerId', r.winner_player_id, 'damage', r.damage
    ) order by r.round_no, r.pairing_index), '[]'::jsonb) into v_matchups
  from round_matchups r where r.match_id = m.id;

  return jsonb_build_object('ok', true, 'match', jsonb_build_object(
    'id', m.id,
    'matchNo', m.match_no,
    'status', m.status,
    'phase', m.phase,
    'roundNo', m.round_no,
    'totalRounds', m.round_count,
    'seed', m.seed,
    'categoryIds', to_jsonb(m.category_ids),
    'phaseDeadline', m.phase_deadline,
    'championPlayerId', m.champion_player_id,
    'players', v_players,
    'board', v_board,
    'matchups', v_matchups
  ));
end $$;

-- ---------------------------------------------------------------------------
-- Leaving a match
--
-- Its own function rather than a change to dw_return_to_lobby, so the legacy
-- "play again" path keeps the exact behaviour it has today.
-- ---------------------------------------------------------------------------

create or replace function dw_abandon_match(p_room_id uuid, p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare v_room rooms%rowtype;
begin
  select * into v_room from rooms where id = p_room_id for update;
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;
  if v_room.host_player_id is distinct from p_player_id then
    return dw_err('NOT_HOST', 'Only the host can do that.');
  end if;
  if v_room.current_match_id is null then
    return jsonb_build_object('ok', true, 'noop', true);
  end if;

  update matches set status = 'ABANDONED', finished_at = now()
   where id = v_room.current_match_id and status = 'ACTIVE';
  update rooms set phase = 'LOBBY', current_match_id = null where id = p_room_id;
  update players set is_ready = false where room_id = p_room_id;

  perform dw_bump(p_room_id);
  return jsonb_build_object('ok', true);
end $$;
