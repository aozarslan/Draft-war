-- =============================================================================
-- 0043 — server-side tick via pg_cron
--
-- Rooms need periodic ticking to advance past deadlines (auction expiry, phase
-- timeouts, etc.). The client already drives this from useRoom.ts via a
-- setInterval, but a disconnected tab silently stalls a game. This migration
-- adds a server-side backup that fires every 15 seconds.
--
-- Architecture:
--   dw_server_tick()  — iterates non-terminal rooms active in the last 3 hours,
--                       calls dw_tick + dw_match_tick for each. Both functions
--                       are idempotent: they check deadlines before acting.
--   pg_cron job       — runs dw_server_tick() every 15 seconds.
--
-- The client tick is NOT removed. Server tick is the backstop; the client
-- tick keeps latency low for connected players.
--
-- Requires: pg_cron extension (Supabase Pro / Team plan).
-- Safe to re-run: CREATE OR REPLACE + cron unschedule/reschedule.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extension
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 2. dw_server_tick
-- ---------------------------------------------------------------------------

create or replace function dw_server_tick()
returns void language plpgsql security definer as $$
declare
  v_id uuid;
begin
  for v_id in
    select id
      from rooms
     where phase not in ('LOBBY', 'FINISHED')
       and updated_at > now() - interval '3 hours'
  loop
    perform dw_tick(v_id);
    perform dw_match_tick(v_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Schedule (idempotent: unschedule first, ignore if not yet registered)
-- ---------------------------------------------------------------------------

do $$
begin
  perform cron.unschedule('dw-room-tick');
exception when others then null;
end;
$$;

select cron.schedule(
  'dw-room-tick',
  '15 seconds',
  $$ select dw_server_tick() $$
);
