-- =============================================================================
-- DRAFT WAR V3 — Phase 11: friends and notifications.
--
-- Two people, one row. A friendship is stored once with a generated pair key,
-- so "A asked B" and "B asked A" cannot both exist and every query reads the
-- same row from either side.
--
-- Nothing here is discoverable by browsing. There is no endpoint that lists
-- profiles: you add somebody by typing their exact username, which is the same
-- privacy floor as a friend code. Blocking is one-sided and silent — a blocked
-- requester is told the request went nowhere, not that they were blocked.
--
-- Notifications are written only by these functions, and only ever to the
-- profile they concern. The browser can mark its own as read and nothing else.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Friendships
-- ---------------------------------------------------------------------------

create table if not exists friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status       text not null default 'PENDING'
               check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'BLOCKED')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  -- One row per pair, whichever way round the request went.
  pair_key     text generated always as (
                 least(requester_id::text, addressee_id::text) || ':' ||
                 greatest(requester_id::text, addressee_id::text)
               ) stored,
  constraint friendship_not_self check (requester_id <> addressee_id)
);

create unique index if not exists uq_friendship_pair on friendships (pair_key);
create index if not exists idx_friendship_requester on friendships (requester_id, status);
create index if not exists idx_friendship_addressee on friendships (addressee_id, status);

-- ---------------------------------------------------------------------------
-- 2. Notifications
-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  -- Whatever the UI needs to act on it: a room code, a friendship id, an
  -- achievement. Never anything the recipient should not see.
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_inbox
  on notifications (profile_id, created_at desc);
create index if not exists idx_notifications_unread
  on notifications (profile_id) where read_at is null;

alter table friendships   enable row level security;
alter table notifications enable row level security;
-- No policies at all: who is friends with whom, and what they have been told,
-- is server-only. Every read the UI performs comes back through our API.

-- ---------------------------------------------------------------------------
-- 3. Sending a notification
-- ---------------------------------------------------------------------------

create or replace function dw_notify(
  p_profile_id uuid, p_kind text, p_title text, p_body text default '',
  p_data jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  if p_profile_id is null then return null; end if;
  insert into notifications (profile_id, kind, title, body, data)
  values (p_profile_id, p_kind, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Finding somebody
--
-- Exact username only, and only the handful of fields needed to recognise a
-- person. There is deliberately no search, no prefix match and no listing.
-- ---------------------------------------------------------------------------

create or replace function dw_find_profile(p_username text)
returns jsonb language plpgsql stable security definer as $$
declare v profiles%rowtype;
begin
  select * into v from profiles where username_lower = lower(trim(coalesce(p_username, '')));
  if not found then
    return dw_err('NO_SUCH_PLAYER', 'Nobody plays under that name.');
  end if;
  return jsonb_build_object('ok', true, 'profile', jsonb_build_object(
    'id', v.id, 'username', v.username, 'avatar', v.avatar,
    'frame', v.frame, 'title', v.title, 'level', v.level));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Requests
-- ---------------------------------------------------------------------------

create or replace function dw_send_friend_request(
  p_profile_id uuid, p_token text, p_username text
) returns jsonb language plpgsql security definer as $$
declare
  v_ok      boolean;
  v_me      profiles%rowtype;
  v_them    profiles%rowtype;
  v_link    friendships%rowtype;
  v_id      uuid;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into v_me from profiles where id = p_profile_id;
  select * into v_them from profiles where username_lower = lower(trim(coalesce(p_username, '')));
  if not found then return dw_err('NO_SUCH_PLAYER', 'Nobody plays under that name.'); end if;
  if v_them.id = p_profile_id then
    return dw_err('THAT_IS_YOU', 'You are already your own best friend.');
  end if;

  select * into v_link from friendships
   where pair_key = least(p_profile_id::text, v_them.id::text) || ':' ||
                    greatest(p_profile_id::text, v_them.id::text);

  if found then
    if v_link.status = 'ACCEPTED' then
      return dw_err('ALREADY_FRIENDS', 'You are already friends.');
    end if;
    if v_link.status = 'BLOCKED' then
      -- Say nothing useful. A block that announces itself is not a block.
      return jsonb_build_object('ok', true, 'status', 'PENDING');
    end if;
    if v_link.status = 'PENDING' then
      if v_link.requester_id = p_profile_id then
        return dw_err('ALREADY_ASKED', 'You already sent them a request.');
      end if;
      -- They asked us first: asking back accepts.
      update friendships set status = 'ACCEPTED', responded_at = now() where id = v_link.id;
      perform dw_notify(v_link.requester_id, 'FRIEND_ACCEPTED',
        v_me.username || ' accepted your friend request.', '',
        jsonb_build_object('profileId', p_profile_id, 'username', v_me.username));
      return jsonb_build_object('ok', true, 'status', 'ACCEPTED');
    end if;
    -- Previously declined: allow another go.
    update friendships
       set requester_id = p_profile_id, addressee_id = v_them.id,
           status = 'PENDING', created_at = now(), responded_at = null
     where id = v_link.id;
    v_id := v_link.id;
  else
    insert into friendships (requester_id, addressee_id)
    values (p_profile_id, v_them.id)
    returning id into v_id;
  end if;

  perform dw_notify(v_them.id, 'FRIEND_REQUEST',
    v_me.username || ' wants to be friends.', '',
    jsonb_build_object('friendshipId', v_id, 'profileId', p_profile_id,
                       'username', v_me.username, 'avatar', v_me.avatar));

  return jsonb_build_object('ok', true, 'status', 'PENDING', 'friendshipId', v_id);
end $$;

create or replace function dw_respond_friend_request(
  p_profile_id uuid, p_token text, p_friendship_id uuid, p_accept boolean
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean; v_link friendships%rowtype; v_me profiles%rowtype;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into v_link from friendships where id = p_friendship_id for update;
  if not found then return dw_err('NO_REQUEST', 'That request no longer exists.'); end if;

  -- Only the person who was asked may answer.
  if v_link.addressee_id <> p_profile_id then
    return dw_err('NOT_YOURS', 'That request is not yours to answer.');
  end if;
  if v_link.status <> 'PENDING' then
    return dw_err('ALREADY_ANSWERED', 'You already answered that one.');
  end if;

  select * into v_me from profiles where id = p_profile_id;

  update friendships
     set status = case when p_accept then 'ACCEPTED' else 'DECLINED' end,
         responded_at = now()
   where id = p_friendship_id;

  -- A decline is silent: the requester is not told they were turned down.
  if p_accept then
    perform dw_notify(v_link.requester_id, 'FRIEND_ACCEPTED',
      v_me.username || ' accepted your friend request.', '',
      jsonb_build_object('profileId', p_profile_id, 'username', v_me.username));
  end if;

  -- The request notification has been dealt with.
  update notifications set read_at = coalesce(read_at, now())
   where profile_id = p_profile_id and kind = 'FRIEND_REQUEST'
     and data->>'friendshipId' = p_friendship_id::text;

  return jsonb_build_object('ok', true,
    'status', case when p_accept then 'ACCEPTED' else 'DECLINED' end);
end $$;

create or replace function dw_remove_friend(
  p_profile_id uuid, p_token text, p_friend_id uuid, p_block boolean default false
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean; v_key text;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  v_key := least(p_profile_id::text, p_friend_id::text) || ':' ||
           greatest(p_profile_id::text, p_friend_id::text);

  if p_block then
    -- The blocker becomes the requester so the row records who did it.
    update friendships
       set status = 'BLOCKED', requester_id = p_profile_id,
           addressee_id = p_friend_id, responded_at = now()
     where pair_key = v_key;
    if not found then
      insert into friendships (requester_id, addressee_id, status, responded_at)
      values (p_profile_id, p_friend_id, 'BLOCKED', now())
      on conflict (pair_key) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'status', 'BLOCKED');
  end if;

  delete from friendships where pair_key = v_key and status <> 'BLOCKED';
  return jsonb_build_object('ok', true, 'status', 'REMOVED');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Inviting a friend into a room
--
-- The inviter has to actually be sitting in the room they are inviting to, and
-- the invitee has to actually be a friend. Otherwise this would be a way to
-- send arbitrary text to a stranger.
-- ---------------------------------------------------------------------------

create or replace function dw_invite_friend(
  p_profile_id uuid, p_token text, p_friend_id uuid, p_room_code text
) returns jsonb language plpgsql security definer as $$
declare
  v_ok   boolean;
  v_me   profiles%rowtype;
  v_room rooms%rowtype;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  if not exists (
    select 1 from friendships
     where pair_key = least(p_profile_id::text, p_friend_id::text) || ':' ||
                      greatest(p_profile_id::text, p_friend_id::text)
       and status = 'ACCEPTED'
  ) then
    return dw_err('NOT_FRIENDS', 'You can only invite friends.');
  end if;

  select * into v_room from rooms where code = upper(trim(coalesce(p_room_code, '')));
  if not found then return dw_err('ROOM_NOT_FOUND', 'Room not found.'); end if;

  if not exists (
    select 1 from players
     where room_id = v_room.id and profile_id = p_profile_id
  ) then
    return dw_err('NOT_IN_ROOM', 'You are not in that room.');
  end if;

  select * into v_me from profiles where id = p_profile_id;

  perform dw_notify(p_friend_id, 'ROOM_INVITE',
    v_me.username || ' invited you to a game.',
    'Room ' || v_room.code,
    jsonb_build_object('roomCode', v_room.code, 'from', v_me.username,
                       'profileId', p_profile_id));

  return jsonb_build_object('ok', true, 'roomCode', v_room.code);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Reads
-- ---------------------------------------------------------------------------

create or replace function dw_friends(p_profile_id uuid)
returns jsonb language plpgsql stable security definer as $$
declare v_friends jsonb; v_incoming jsonb; v_outgoing jsonb;
begin
  if p_profile_id is null then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'friendshipId', f.id,
      'profileId', p.id, 'username', p.username, 'avatar', p.avatar,
      'frame', p.frame, 'title', p.title, 'level', p.level,
      'lastActiveAt', p.last_active_at,
      -- "Online" is a two-minute window on the last authenticated read. It is
      -- a hint, not a presence system.
      'online', p.last_active_at > now() - interval '2 minutes',
      'since', f.responded_at
    ) order by (p.last_active_at > now() - interval '2 minutes') desc,
               p.last_active_at desc), '[]'::jsonb) into v_friends
  from friendships f
  join profiles p on p.id = case when f.requester_id = p_profile_id
                                 then f.addressee_id else f.requester_id end
  where f.status = 'ACCEPTED'
    and (f.requester_id = p_profile_id or f.addressee_id = p_profile_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'friendshipId', f.id, 'profileId', p.id, 'username', p.username,
      'avatar', p.avatar, 'frame', p.frame, 'level', p.level, 'at', f.created_at
    ) order by f.created_at desc), '[]'::jsonb) into v_incoming
  from friendships f join profiles p on p.id = f.requester_id
  where f.addressee_id = p_profile_id and f.status = 'PENDING';

  select coalesce(jsonb_agg(jsonb_build_object(
      'friendshipId', f.id, 'profileId', p.id, 'username', p.username,
      'avatar', p.avatar, 'frame', p.frame, 'level', p.level, 'at', f.created_at
    ) order by f.created_at desc), '[]'::jsonb) into v_outgoing
  from friendships f join profiles p on p.id = f.addressee_id
  where f.requester_id = p_profile_id and f.status = 'PENDING';

  return jsonb_build_object('ok', true, 'friends', v_friends,
                            'incoming', v_incoming, 'outgoing', v_outgoing);
end $$;

create or replace function dw_notifications(p_profile_id uuid, p_limit int default 30)
returns jsonb language plpgsql stable security definer as $$
declare v_rows jsonb; v_unread int;
begin
  if p_profile_id is null then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  select count(*) into v_unread from notifications
   where profile_id = p_profile_id and read_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
      'data', n.data, 'read', n.read_at is not null, 'at', n.created_at
    ) order by n.created_at desc), '[]'::jsonb) into v_rows
  from (select * from notifications where profile_id = p_profile_id
         order by created_at desc limit greatest(1, least(100, p_limit))) n;

  return jsonb_build_object('ok', true, 'unread', v_unread, 'notifications', v_rows);
end $$;

/** Marks everything read, or just the ids given. Only ever your own. */
create or replace function dw_read_notifications(
  p_profile_id uuid, p_token text, p_ids uuid[] default null
) returns jsonb language plpgsql security definer as $$
declare v_ok boolean; v_rows int;
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  update notifications set read_at = now()
   where profile_id = p_profile_id and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok', true, 'marked', v_rows);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Achievements announce themselves
--
-- Same function as 0012 with a notification on each unlock, so a medal earned
-- mid-session is not only discovered by visiting the profile page.
-- ---------------------------------------------------------------------------

create or replace function dw_evaluate_achievements(p_profile_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_metrics jsonb;
  v_new     jsonb := '[]'::jsonb;
  v_rows    int;
  v_value   bigint;
  v_xp      bigint;
  a         achievements%rowtype;
begin
  if p_profile_id is null then
    return jsonb_build_object('ok', true, 'unlocked', '[]'::jsonb);
  end if;

  v_metrics := dw_profile_metrics(p_profile_id);
  if v_metrics = '{}'::jsonb then
    return dw_err('PROFILE_NOT_FOUND', 'Profile not found.');
  end if;

  for a in
    select * from achievements
     where is_active
       and not exists (select 1 from profile_achievements pa
                        where pa.profile_id = p_profile_id and pa.achievement_id = achievements.id)
     order by sort
  loop
    v_value := coalesce((v_metrics->>a.metric)::bigint, 0);
    continue when v_value < a.threshold;

    insert into profile_achievements (profile_id, achievement_id, value_at_unlock)
    values (p_profile_id, a.id, least(v_value, 2147483647))
    on conflict do nothing;

    get diagnostics v_rows = row_count;
    continue when v_rows = 0;

    if a.reward_coins > 0 then
      perform dw_award_coins(p_profile_id, a.reward_coins, 'ACHIEVEMENT', a.id,
                             jsonb_build_object('achievement', a.id, 'name', a.name));
    end if;

    if a.reward_xp > 0 then
      insert into xp_transactions (profile_id, amount, kind, detail)
      values (p_profile_id, a.reward_xp, 'ACHIEVEMENT',
              jsonb_build_object('achievement', a.id, 'name', a.name));
      update profiles set xp = xp + a.reward_xp where id = p_profile_id
        returning xp into v_xp;
      update profiles set level = dw_level_for_xp(v_xp) where id = p_profile_id;
    end if;

    if a.reward_item is not null then
      perform dw_grant_item(p_profile_id, a.reward_item, 'ACHIEVEMENT', 'achievement:' || a.id);
    end if;

    perform dw_notify(p_profile_id, 'ACHIEVEMENT', a.name, a.description,
                      jsonb_build_object('achievement', a.id, 'tier', a.tier,
                                         'coins', a.reward_coins, 'xp', a.reward_xp,
                                         'item', a.reward_item));

    v_new := v_new || jsonb_build_object(
      'id', a.id, 'name', a.name, 'description', a.description,
      'tier', a.tier, 'category', a.category,
      'coins', a.reward_coins, 'xp', a.reward_xp, 'item', a.reward_item);
  end loop;

  return jsonb_build_object('ok', true, 'unlocked', v_new);
end $$;
