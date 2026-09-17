-- ---------------------------------------------------------------------------
-- 0041 · Two live-test bug fixes
-- ---------------------------------------------------------------------------
--
-- BUG A — S8 auction not auto-advancing when the lot timer expires.
--
--   Root cause: `dw_match_tick` correctly resolves an expired lot and returns
--   'ROUND_AUCTION_COMPLETE', but nobody was calling it.  The client clock
--   driver in useRoom.ts checks `snap.room.phase === "AUCTION"` (the legacy
--   S7 room phase), which is never true inside an S8 match — the room stays
--   in phase "MATCH".  Fix is in the TypeScript client (see useRoom.ts); this
--   migration documents the finding and contains no SQL change for bug A.
--
-- BUG B — 0-credit player is never assigned a character in rounds 1–5.
--
--   Root cause: `dw_resolve_auction` selects forced candidates with
--   `dw_bid_credits(...) >= v_min`, filtering out players who have spent all
--   their credits.  When the pool is exhausted and the only unmet demand comes
--   from such players the recycling loop in `dw_open_next_round_auction` can
--   run indefinitely (capped by the 500-iteration guard but never finishing
--   cleanly).
--
--   Fix: immediately before the recycle-and-retry branch, scan for players
--   who still need a character this round but cannot afford even the minimum
--   bid.  Assign each of them the cheapest-power unsold character in the
--   round's pool at price 0.  After charity assignment the demand check may
--   drop to zero and the round can complete normally; if paid-up players still
--   need characters the recycle branch then handles only them.
-- ---------------------------------------------------------------------------

-- Replace dw_open_next_round_auction with the charity-assignment extension.
-- Every line of the original is preserved; the new block is inserted between
-- the recycling guard and the recycle query, clearly delimited.
create or replace function dw_open_next_round_auction(p_game_id uuid)
returns void language plpgsql as $$
declare
  v_game        games%rowtype;
  m             matches%rowtype;
  v_idx         int;
  v_char        text;
  v_secs        int;
  v_demand      int;
  v_required    boolean;
  v_recycled    jsonb;
  v_guard       int := 0;
  v_reveal      interval := interval '3 seconds';
  -- charity-assignment locals
  v_needy       uuid;
  v_free_char   text;
  v_free_price  int := 0;
begin
  select * into v_game from games where id = p_game_id;
  select * into m from matches where id = v_game.match_id;
  v_required := dw_acquisition_required(v_game.round_no);
  v_secs := coalesce((select (config->>'auctionSeconds')::int from rooms where id = v_game.room_id), 10);
  v_idx := v_game.queue_index;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;

    v_idx := v_idx + 1;
    v_demand := dw_round_demand(p_game_id);

    -- Everybody has their character for this round.
    if v_demand <= 0 then
      update games set queue_index = v_idx, status = 'FINISHED', finished_at = now()
       where id = p_game_id;
      perform dw_event(p_game_id, v_game.room_id, 'ROUND_AUCTION_COMPLETE',
        jsonb_build_object('matchId', m.id, 'roundNo', v_game.round_no,
                           'acquired', (select count(*) from team_characters where game_id = p_game_id)));
      perform dw_bump(v_game.room_id);
      return;
    end if;

    if v_idx >= jsonb_array_length(v_game.queue) then
      if v_required then
        -- ----------------------------------------------------------------
        -- CHARITY PASS (BUG B fix)
        --
        -- Before recycling, assign each player who still needs a character
        -- but cannot afford even the minimum bid (credits = 0) the
        -- cheapest-power unsold character from this round's pool at price 0.
        --
        -- This prevents the infinite recycle loop that arises when the only
        -- remaining demand comes from broke players: the recycle branch above
        -- would keep putting the same unsold characters back on the queue
        -- and dw_resolve_auction would keep skipping those players.
        -- ----------------------------------------------------------------
        loop
          -- Find a player who needs a character and has no credits.
          select p.id into v_needy
            from players p
            join match_players mp
              on mp.player_id = p.id and mp.match_id = m.id
           where p.room_id = v_game.room_id
             and dw_slots_remaining(p_game_id, p.id) > 0
             and dw_bid_credits(p_game_id, p.id) = 0
             and mp.eliminated_at is null
           order by p.seat asc
           limit 1;

          exit when v_needy is null;  -- no more broke players needing one

          -- Lowest-gamePower unsold character still available in this round.
          select a.character_id into v_free_char
            from auctions a
            join characters c on c.id = a.character_id
           where a.game_id = p_game_id
             and a.status = 'UNSOLD'
             and not exists (
               select 1 from team_characters t
                where t.game_id = p_game_id and t.character_id = a.character_id)
           order by c.game_power asc, a.order_index asc
           limit 1;

          exit when v_free_char is null;  -- nothing left to give

          -- Mark the chosen auction row as sold at price 0.
          update auctions
             set status = 'SOLD', winner_id = v_needy, final_price = v_free_price,
                 current_bid = v_free_price, high_bidder_id = v_needy,
                 resolved_at = now()
           where game_id = p_game_id and character_id = v_free_char
             and status = 'UNSOLD';

          insert into team_characters (game_id, room_id, player_id, character_id, price)
          values (p_game_id, v_game.room_id, v_needy, v_free_char, v_free_price)
          on conflict (game_id, character_id) do nothing;

          perform dw_record_acquisition(p_game_id, null, v_needy, v_free_char, v_free_price);

          insert into game_events (game_id, room_id, type, payload)
          values (p_game_id, v_game.room_id, 'CHARITY_ASSIGNED', jsonb_build_object(
            'characterId', v_free_char, 'playerId', v_needy, 'price', v_free_price));

          v_needy := null;
          v_free_char := null;
        end loop;

        -- Re-evaluate demand after giving out any free characters.
        v_demand := dw_round_demand(p_game_id);
        if v_demand <= 0 then
          update games set queue_index = v_idx, status = 'FINISHED', finished_at = now()
           where id = p_game_id;
          perform dw_event(p_game_id, v_game.room_id, 'ROUND_AUCTION_COMPLETE',
            jsonb_build_object('matchId', m.id, 'roundNo', v_game.round_no,
                               'acquired', (select count(*) from team_characters where game_id = p_game_id),
                               'charityAssigned', true));
          perform dw_bump(v_game.room_id);
          return;
        end if;
        -- ----------------------------------------------------------------
        -- END CHARITY PASS
        -- ----------------------------------------------------------------

        -- Mandatory round: an unsold character goes back on the queue rather
        -- than leaving somebody short, exactly as the legacy draft does.
        select coalesce(jsonb_agg(a.character_id), '[]'::jsonb) into v_recycled
          from auctions a
         where a.game_id = p_game_id
           and a.status = 'UNSOLD'
           and not exists (select 1 from team_characters t
                            where t.game_id = p_game_id and t.character_id = a.character_id);

        if jsonb_array_length(v_recycled) > 0 then
          update games set queue = queue || v_recycled where id = p_game_id;
          select * into v_game from games where id = p_game_id;
          v_idx := v_idx - 1;
          continue;
        end if;
      end if;

      -- Optional round, or a mandatory one with nothing left to offer. A match
      -- must not stall on an empty pool, so the round closes and the shortfall
      -- is recorded rather than retried forever.
      update games set queue_index = v_idx, status = 'FINISHED', finished_at = now()
       where id = p_game_id;
      perform dw_event(p_game_id, v_game.room_id, 'ROUND_AUCTION_COMPLETE',
        jsonb_build_object('matchId', m.id, 'roundNo', v_game.round_no,
                           'exhausted', true, 'unfilled', v_demand,
                           'required', v_required));
      perform dw_bump(v_game.room_id);
      return;
    end if;

    v_char := v_game.queue->>v_idx;
    -- Never offer a character this match has already sold.
    exit when not exists (
      select 1 from match_acquisitions
       where match_id = m.id and character_id = v_char);
  end loop;

  update games set queue_index = v_idx where id = p_game_id;

  insert into auctions (game_id, room_id, character_id, order_index, ends_at)
  values (p_game_id, v_game.room_id, v_char, v_idx,
          now() + v_reveal + make_interval(secs => v_secs));

  perform dw_bump(v_game.room_id);
end $$;
