-- =============================================================================
-- DRAFT WAR V3 — Phase 8: the shop.
--
-- Two guarantees, and the rest is detail:
--
--   1. A purchase is atomic. The coins leaving and the item arriving happen in
--      one subtransaction; if either half fails the other is rolled back, so
--      "coins deducted but item missing" is not a state this database can be
--      in. The failure still comes back as a structured error rather than a
--      500, because the block that rolls it back also handles it.
--   2. The price is the server's. The browser sends an item id and nothing
--      else — no price, no discount, no rotation id. What a purchase costs is
--      computed here from the catalog and the active rotation.
--
-- The rotation is a 24-hour window that opens itself, exactly like a season.
-- Its contents are a deterministic function of the day, so every player sees
-- the same shop and nobody can reroll it by refreshing.
--
-- Nothing sold here touches a stat, a credit or a bid. Items earned through
-- achievements, levels or seasons are deliberately not purchasable at all.
--
-- Additive and safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rotations
-- ---------------------------------------------------------------------------

create table if not exists shop_rotations (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null unique,
  ends_at    timestamptz not null,
  -- The featured items and the percentage off them.
  item_ids   text[] not null default '{}',
  discount   int not null default 25 check (discount between 0 and 90),
  created_at timestamptz not null default now()
);

create index if not exists idx_shop_rotations_window on shop_rotations (starts_at desc);

alter table shop_rotations enable row level security;
-- Readable like the catalog: the shop has to be visible before anything is
-- bought. Writing it is server-only — there is no policy for that.
drop policy if exists "rotation readable" on shop_rotations;
create policy "rotation readable" on shop_rotations for select using (true);

-- ---------------------------------------------------------------------------
-- 2. The current rotation, opening itself when the day turns
--
-- The featured set is chosen by hashing each item id against the day, so it is
-- stable for everyone for 24 hours and cannot be rerolled. One item from every
-- slot is guaranteed, then the list is filled to six — a shop that showed four
-- avatars and nothing else would be a bad shop on a third of its days.
-- ---------------------------------------------------------------------------

create or replace function dw_current_rotation()
returns shop_rotations language plpgsql as $$
declare
  r shop_rotations%rowtype;
  v_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_key text;
  v_ids text[];
begin
  select * into r from shop_rotations
   where now() >= starts_at and now() < ends_at
   order by starts_at desc limit 1;
  if found then return r; end if;

  v_key := to_char(v_start at time zone 'utc', 'YYYY-MM-DD');

  select array_agg(id) into v_ids from (
    select distinct on (kind) id, kind
      from catalog_items
     where source = 'SHOP' and is_active
     order by kind, md5(id || v_key)
  ) one_per_slot;

  v_ids := coalesce(v_ids, '{}') || coalesce(array(
    select id from catalog_items
     where source = 'SHOP' and is_active and not (id = any(coalesce(v_ids, '{}')))
     order by md5(id || v_key)
     limit 2), '{}');

  insert into shop_rotations (starts_at, ends_at, item_ids)
  values (v_start, v_start + interval '1 day', v_ids)
  on conflict (starts_at) do nothing
  returning * into r;

  -- Another client opened the same window a moment earlier. Theirs wins.
  if r.id is null then
    select * into r from shop_rotations where starts_at = v_start;
  end if;

  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 3. What something costs
--
-- One function, called by both the read and the purchase, so the price shown
-- and the price charged cannot disagree.
-- ---------------------------------------------------------------------------

create or replace function dw_item_price(p_item_id text)
returns jsonb language plpgsql as $$
declare v_item catalog_items%rowtype; r shop_rotations%rowtype; v_price int;
begin
  select * into v_item from catalog_items where id = p_item_id and is_active;
  if not found then return dw_err('ITEM_NOT_FOUND', 'That item does not exist.'); end if;
  if v_item.source <> 'SHOP' or v_item.price <= 0 then
    return dw_err('NOT_FOR_SALE', 'That one is earned, not bought.');
  end if;

  r := dw_current_rotation();
  v_price := v_item.price;

  if r.id is not null and p_item_id = any(r.item_ids) then
    v_price := greatest(1, floor(v_item.price * (100 - r.discount) / 100.0)::int);
    return jsonb_build_object('ok', true, 'itemId', p_item_id, 'price', v_price,
                              'listPrice', v_item.price, 'discount', r.discount,
                              'featured', true);
  end if;

  return jsonb_build_object('ok', true, 'itemId', p_item_id, 'price', v_price,
                            'listPrice', v_item.price, 'discount', 0, 'featured', false);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Buying
--
-- Validate everything first, then make both changes inside one block. The
-- block is a subtransaction: a raise inside it undoes the spend and the grant
-- together, and the handler turns it back into an error the UI can read.
-- ---------------------------------------------------------------------------

create or replace function dw_buy_item(p_profile_id uuid, p_token text, p_item_id text)
returns jsonb language plpgsql security definer as $$
declare
  v_ok      boolean;
  v_item    catalog_items%rowtype;
  v_pricing jsonb;
  v_spend   jsonb;
  v_price   int;
  v_code    text := 'PURCHASE_FAILED';
  v_msg     text := 'The purchase could not be completed.';
begin
  select true into v_ok from profile_secrets
   where profile_id = p_profile_id and token = p_token;
  if not coalesce(v_ok, false) then
    return dw_err('INVALID_SESSION', 'Please sign in again.');
  end if;

  select * into v_item from catalog_items where id = p_item_id and is_active;
  if not found then return dw_err('ITEM_NOT_FOUND', 'That item does not exist.'); end if;

  if exists (select 1 from profile_items
              where profile_id = p_profile_id and item_id = p_item_id) then
    return dw_err('ALREADY_OWNED', 'You already own that.');
  end if;

  v_pricing := dw_item_price(p_item_id);
  if coalesce((v_pricing->>'ok')::boolean, false) is not true then
    return v_pricing;
  end if;
  v_price := (v_pricing->>'price')::int;

  -- From here on, both halves happen or neither does.
  begin
    v_spend := dw_spend_coins(
      p_profile_id, v_price, 'PURCHASE', p_item_id,
      jsonb_build_object('itemId', p_item_id, 'name', v_item.name,
                         'kind', v_item.kind,
                         'listPrice', (v_pricing->>'listPrice')::int,
                         'discount', (v_pricing->>'discount')::int));

    if coalesce((v_spend->>'ok')::boolean, false) is not true then
      v_code := coalesce(v_spend->>'code', 'PURCHASE_FAILED');
      v_msg  := coalesce(v_spend->>'message', v_msg);
      raise exception 'purchase aborted: %', v_msg using errcode = 'check_violation';
    end if;

    if coalesce((dw_grant_item(p_profile_id, p_item_id, 'SHOP',
                               'purchase:' || p_item_id)->>'granted')::boolean, false)
       is not true then
      -- Somebody else granted it between the ownership check and here. Refuse
      -- rather than charge for a duplicate.
      v_code := 'ALREADY_OWNED';
      v_msg  := 'You already own that.';
      raise exception 'purchase aborted: already owned' using errcode = 'check_violation';
    end if;
  exception when others then
    -- The spend and the grant are both undone by the time we get here.
    return dw_err(v_code, v_msg);
  end;

  return jsonb_build_object(
    'ok', true, 'itemId', p_item_id, 'kind', v_item.kind, 'name', v_item.name,
    'paid', v_price, 'balance', (v_spend->>'balance')::bigint);
end $$;

-- ---------------------------------------------------------------------------
-- 5. The shop front
--
-- Prices come from dw_item_price so the card a player taps shows exactly what
-- they will be charged. Ownership is included when a profile is given, so the
-- UI never has to guess what is already in the locker.
-- ---------------------------------------------------------------------------

create or replace function dw_shop(p_profile_id uuid default null)
returns jsonb language plpgsql security definer as $$
declare
  r shop_rotations%rowtype;
  v_items jsonb;
  v_owned jsonb := '[]'::jsonb;
  v_balance bigint := 0;
begin
  r := dw_current_rotation();

  select coalesce(jsonb_agg(jsonb_build_object(
      'itemId', c.id, 'kind', c.kind, 'name', c.name, 'rarity', c.rarity,
      'price', (dw_item_price(c.id)->>'price')::int,
      'listPrice', c.price,
      'featured', c.id = any(r.item_ids)
    ) order by c.sort), '[]'::jsonb) into v_items
  from catalog_items c
  where c.is_active and c.source = 'SHOP' and c.price > 0;

  if p_profile_id is not null then
    select coalesce(jsonb_agg(item_id), '[]'::jsonb) into v_owned
      from profile_items where profile_id = p_profile_id;
    select coins into v_balance from profiles where id = p_profile_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'rotation', case when r.id is null then null else jsonb_build_object(
      'endsAt', r.ends_at, 'discount', r.discount,
      'itemIds', to_jsonb(r.item_ids)) end,
    'items', v_items,
    'owned', v_owned,
    'balance', coalesce(v_balance, 0));
end $$;
