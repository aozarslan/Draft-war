-- =============================================================================
-- DRAFT WAR — fixes from actually playing it.
--
-- Two problems found in a real game with real friends:
--
--   1. The bidding clock started before the character had finished appearing.
--      The reveal animation runs for 2.9 seconds and bidding is disabled while
--      it plays, so a "10 second" auction gave about seven seconds to think.
--      The clock now starts full *after* the reveal.
--
--   2. A profile lived in one browser and nothing else. Close the tab, open it
--      tomorrow, and the account — with its rank, coins and collection — was
--      unreachable. This adds a recovery code: one secret, shown once, that
--      restores the account anywhere.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The reveal no longer eats the clock
--
-- The allowance matches REVEAL_MS in src/components/AuctionStage.tsx. It is
-- added only when an auction *opens* — a bid mid-auction resets to the plain
-- bidding time, because by then everybody has already seen the character.
--
-- Identical to 0006 apart from that one interval. The recycling, the
-- auto-assign fallback and the completion checks are unchanged.
-- ---------------------------------------------------------------------------

create or replace function dw_open_next_auction(p_game_id uuid)
returns void language plpgsql as $$
declare
  v_game games%rowtype;
  v_idx int;
  v_char text;
  v_secs int;
  v_demand int;
  v_recycled jsonb;
  v_guard int := 0;
  -- How long the client spends revealing the character before bidding opens.
  v_reveal interval := interval '3 seconds';
begin
  select * into v_game from games where id = p_game_id;
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 10);
  v_idx := v_game.queue_index;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;

    v_idx := v_idx + 1;
    v_demand := dw_total_demand(p_game_id);

    if v_demand <= 0 then
      update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds'
       where id = p_game_id;
      update rooms set phase = 'TEAM_REVIEW' where id = v_game.room_id;
      insert into game_events (game_id, room_id, type, payload)
      values (p_game_id, v_game.room_id, 'AUCTION_COMPLETE',
              jsonb_build_object('allocated', (select count(*) from team_characters where game_id = p_game_id)));
      return;
    end if;

    if v_idx >= jsonb_array_length(v_game.queue) then
      select coalesce(jsonb_agg(a.character_id), '[]'::jsonb) into v_recycled
        from auctions a
       where a.game_id = p_game_id
         and a.status = 'UNSOLD'
         and not exists (
           select 1 from team_characters t
            where t.game_id = p_game_id and t.character_id = a.character_id);

      if jsonb_array_length(v_recycled) > 0 then
        update games set queue = queue || v_recycled where id = p_game_id;
        select * into v_game from games where id = p_game_id;
        insert into game_events (game_id, room_id, type, payload)
        values (p_game_id, v_game.room_id, 'POOL_EXTENDED',
                jsonb_build_object('added', jsonb_array_length(v_recycled)));
        v_idx := v_idx - 1;
        continue;
      end if;

      update games set queue_index = v_idx, phase_deadline = now() + interval '60 seconds'
       where id = p_game_id;
      update rooms set phase = 'TEAM_REVIEW' where id = v_game.room_id;
      insert into game_events (game_id, room_id, type, payload)
      values (p_game_id, v_game.room_id, 'AUCTION_EXHAUSTED',
              jsonb_build_object('missing', v_demand));
      return;
    end if;

    v_char := v_game.queue->>v_idx;
    exit when not exists (
      select 1 from team_characters where game_id = p_game_id and character_id = v_char
    );
  end loop;

  update games set queue_index = v_idx where id = p_game_id;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (p_game_id, v_game.room_id, v_char, v_idx,
          now() + v_reveal + make_interval(secs => v_secs));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Getting back into your account
--
-- A recovery code is a second secret for the same profile. It is stored
-- hashed, so a leaked read of the table cannot be used to take anybody's
-- account, and it is shown exactly once — at sign-up — because a code the
-- server can reprint is a code an attacker can ask it to reprint.
--
-- Using it mints a fresh session token and leaves the code itself alone, so
-- the same code works on a third device without invalidating the second.
-- ---------------------------------------------------------------------------

alter table profile_secrets add column if not exists recovery_hash text;

-- Pinned to public: this function is `security definer`, and an unqualified
-- `crypt` must resolve on the search path wherever it runs.
create extension if not exists pgcrypto with schema public;

/**
 * Sets a recovery code for a profile, returning the plaintext once.
 *
 * Refuses to overwrite an existing one: somebody who can already act as this
 * profile could otherwise silently rotate the code and lock the owner out.
 */
create or replace function dw_set_recovery(p_profile_id uuid, p_token text)
returns jsonb language plpgsql security definer as $$
declare
  v_ok boolean;
  v_existing text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  select true, recovery_hash into v_ok, v_existing from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;
  if v_existing is not null then
    return dw_err('ALREADY_SET', 'This account already has a recovery code.');
  end if;

  -- Twelve characters from an unambiguous alphabet, grouped for reading aloud.
  for i in 1..12 loop
    v_code := v_code || substr(v_alphabet, floor(random() * length(v_alphabet))::int + 1, 1);
    if i % 4 = 0 and i < 12 then v_code := v_code || '-'; end if;
  end loop;

  update profile_secrets
     set recovery_hash = crypt(v_code, gen_salt('bf'))
   where profile_id = p_profile_id;

  return jsonb_build_object('ok', true, 'recoveryCode', v_code);
end $$;

/**
 * Trades a username and recovery code for a fresh session token.
 *
 * Deliberately gives the same answer for "no such user" and "wrong code": the
 * difference would tell somebody which usernames are worth attacking. Rate
 * limited by username, because that is the field an attacker iterates.
 */
create or replace function dw_recover_profile(
  p_username text, p_code text, p_new_token text
) returns jsonb language plpgsql security definer as $$
declare v_profile profiles%rowtype; v_hash text;
begin
  if dw_rate_limited(lower(trim(coalesce(p_username, ''))), 'RECOVER', 5, 300) then
    return dw_err('TOO_FAST', 'Too many attempts. Try again in a few minutes.');
  end if;

  select * into v_profile from profiles
   where username_lower = lower(trim(coalesce(p_username, '')));
  if not found then
    return dw_err('BAD_RECOVERY', 'That name and code do not match.');
  end if;

  select recovery_hash into v_hash from profile_secrets where profile_id = v_profile.id;
  if v_hash is null or v_hash <> crypt(upper(trim(coalesce(p_code, ''))), v_hash) then
    return dw_err('BAD_RECOVERY', 'That name and code do not match.');
  end if;

  -- Recovering replaces the session token, which signs out any other device.
  -- That is the safer default and not only a consequence of one token per
  -- profile: if somebody else had your session, recovering takes it back.
  update profile_secrets set token = p_new_token where profile_id = v_profile.id;
  update profiles set last_active_at = now() where id = v_profile.id;

  return jsonb_build_object('ok', true, 'profileId', v_profile.id,
                            'username', v_profile.username, 'avatar', v_profile.avatar);
end $$;

/** Whether this profile has a recovery code yet, for the nag on the profile page. */
create or replace function dw_has_recovery(p_profile_id uuid)
returns jsonb language sql stable security definer as $$
  select jsonb_build_object('ok', true,
    'hasRecovery', exists (
      select 1 from profile_secrets
       where profile_id = p_profile_id and recovery_hash is not null));
$$;
