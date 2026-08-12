# DRAFT WAR — technical map and V4 gap analysis

Written before touching anything, as V4's own P0 asks. Two purposes: describe
what exists and what depends on what, and say honestly which V4 requirements
are already met by V1–V3 and which are not.

The short version: **a large share of V4 is already built.** V3 delivered
profiles, XP, levels, ranks, seasons, coins, inventory, shop, achievements,
challenges, friends, notifications, analytics and the mobile hub. V4's genuinely
new work is concentrated in draft strategy, the battle simulation, spectating
and sharing, and a handful of reliability gaps.

---

## 1. Architecture

```
Browser (Next.js 15 client)
  │
  │ 1. mutations ── POST /api/rooms/:code/action ──► Route Handler
  │                                                  │ service-role key
  │                                                  ▼
  │                                           Postgres function
  │                                           (row locks, validation)
  │                                                  │
  │ 2. "something changed" ◄─ Supabase Realtime ─────┘ (rooms.state_version)
  │
  └─ 3. refetch ── GET /api/rooms/:code/state ──► dw_snapshot() ──► one JSON blob
```

Three properties hold everything else up:

* **Postgres is the game server.** Every mutation is a `plpgsql` function that
  takes `SELECT … FOR UPDATE` on the row it changes, so simultaneous bids
  serialise instead of racing. No game logic runs on the client.
* **Timers are timestamps, not loops.** `auctions.ends_at` is the deadline;
  `dw_tick(room)` is idempotent and callable by any connected client. Vercel
  needs no background worker and a host who closes their laptop cannot stall
  the game.
* **Realtime is a doorbell, not a data channel.** The anon key can read only
  `rooms`, `chat_messages`, `characters` and the public catalogs. A bump of
  `rooms.state_version` tells clients to refetch the snapshot through our API
  on the service role.

### Client/server boundary

| Decided by | What |
| --- | --- |
| Server only | auction winner, credits, roster, prices, battle result, XP, coins, rank, inventory, achievements, challenge progress, friendships, notifications |
| Client only | which room to look at, what to render, sound, animation |

The client never sends a price, a result or an amount. Where it names a thing
(an item id, a challenge id, a username) the server re-derives everything else.

---

## 2. Critical game states

`rooms.phase` is the state machine:

```
LOBBY → CATEGORY → AUCTION → TEAM_REVIEW → MAP_SELECTION → EVENT → BATTLE → RESULTS → FINISHED
                                  ↑                                            │
                                  └──────────── PLAY_AGAIN ────────────────────┘
```

`dw_advance_phase` refuses to leave `AUCTION` while any roster is short
(`DRAFT_INCOMPLETE`). That guard is what makes the complete-team guarantee real
rather than aspirational.

### Critical tables

| Concern | Tables |
| --- | --- |
| Match | `rooms`, `players`, `games`, `auctions`, `bids`, `auction_passes`, `team_characters`, `map_votes`, `game_events`, `battle_results` |
| Player | `profiles`, `profile_secrets`, `profile_stats`, `match_history` |
| Competitive | `seasons`, `season_players` |
| Economy | `coin_transactions`, `xp_transactions` |
| Cosmetic | `catalog_items`, `profile_items`, `shop_rotations` |
| Retention | `achievements`, `profile_achievements`, `challenge_templates`, `challenge_periods`, `profile_challenges` |
| Social | `friendships`, `notifications` |
| Reference | `characters` |

Separation is already along V4's lines: match data, player data, economy data,
cosmetic data and analytics are distinct table groups with distinct lifetimes.

### Reward state

Three independent idempotent ledgers, all keyed so a retry pays once:

* `xp_transactions` — unique `(profile_id, match_id, kind)`
* `coin_transactions` — unique `(profile_id, kind, reference)`
* `profile_achievements` — primary key `(profile_id, achievement_id)`

`dw_settle_match` runs all of it in one transaction per player.

---

## 3. Gap analysis against the V4 priorities

Legend: **done** = shipped and verified · **partial** = exists but short of the
spec · **missing** = not built.

### P0 — reliability

| Requirement | State | Note |
| --- | --- | --- |
| Server is source of truth | **done** | every mutation is a locked plpgsql function |
| PASS is a real action | **done** | V2.1/0006; passing keeps credits, roster and future eligibility |
| Unsold → next character | **done** | `dw_resolve_auction` |
| Reserve pool | **done** | `queueSize` = required + max(5, 40%) |
| Complete-team guarantee | **done** | `dw_advance_phase` refuses `DRAFT_INCOMPLETE`; auto-assign at floor price |
| Count allocations not attempts | **done** | `dw_total_demand` drives completion |
| Disconnect/reconnect | **partial** | state survives (it is all server-side) and host migrates after 25s; there is no explicit reconnect event or grace-period UI |
| **Idempotent actions with action ids** | **missing** | rewards are idempotent; **bid and pass are not** — a double-tap or a retried POST can place two bids |
| **Full event log** | **partial** | `game_events` exists but emits only 7 types; V4 lists 20 |
| **Rate limiting** | **missing** | nothing throttles bid/join/friend-request/purchase |

### P1 — draft strategy

| Requirement | State |
| --- | --- |
| Player information panel | **done** — credits, roster, slots, max bid, current bid/bidder, progress |
| **Hidden power (estimate band)** | **missing** — exact game power is shown |
| **Archetypes** | **missing** |
| Synergy, capped at 10% | **done** — `computeSynergy`, `MAX_SYNERGY = 0.1` |
| **Hidden/discovered synergies** | **missing** |
| **Draft efficiency** | **missing** — components exist, the metric does not |
| **Auction achievements** (bargain, overpay, contested…) | **missing** |
| Last-second extension | **conflict** — see §4 |
| Dynamic pool, randomised order | **done** — seeded shuffle, pool > required |

### P2 — battle

| Requirement | State |
| --- | --- |
| Real simulation, not power comparison | **done** — round loop with damage, HP, criticals |
| **Named phases** (opening → final clash) | **missing** — rounds are unnamed |
| True 5-way battle | **done** |
| Category-specific stats → canonical axes | **done** |
| **Formations** | **missing** |
| Maps, ≤10% influence | **done** |
| Random events | **done** |
| Battle moments with reasons | **partial** — events are generated from real calculations; the copy does not explain *why* |
| **Turning point with live probability** | **missing** |
| MVP on performance | **partial** — MVP exists; expected-vs-actual contribution does not |
| **Upset system** | **missing** |
| Cinematic screen | **partial** |

### P3 — social

| Requirement | State |
| --- | --- |
| Friends, requests, online status, invite | **done** (0016) |
| Block | **done** · Report | **missing** |
| **Rematch** | **missing** — "play again" returns to lobby, it does not offer options |
| **Recent players** | **missing** |
| **Private leagues** | **missing** |
| **Head to head** | **missing** |
| **Fair play score** | **missing** |

### P4 — seasons and retention

| Requirement | State |
| --- | --- |
| Seasons with rank, points, wins, MVPs | **done** (0007) |
| Season end rewards | **partial** — `frame-champion` exists; no automatic distribution |
| **Live events** | **missing** |
| Daily/weekly challenges | **done** (0014) |
| Progression shown after match | **done** |
| **Character mastery** | **missing** |
| **Category mastery** | **missing** |
| **Collection view** | **missing** |

### P5–P7 — economy, ranked, anti-cheat

| Requirement | State |
| --- | --- |
| Two currencies, never mixed | **done** — asserted by tests |
| Coin sources, all server-side | **done** |
| Auditable transaction log | **done** |
| Shop with rotation | **done** (0011) |
| No pay-to-win | **done** — a test forbids stat keys in item payloads |
| Casual/ranked/private | **partial** — ranked flag exists; private is implicit; no mode picker |
| Rank points table | **done** — exactly V4's numbers |
| Ranked map vote | **done** |
| **Matchmaking architecture** | **missing** — rooms are invite-only by design |
| Client controls nothing important | **done** — verified against RLS repeatedly |
| **Rate limiting** | **missing** |
| RLS, atomic transactions, authorization | **done** |
| **Replay data** | **partial** — seed, pool, bids, passes, teams, map, event and result are all persisted; there is no replay reader |

### P8–P10 — sharing, AI, UX

| Requirement | State |
| --- | --- |
| **Spectator mode** | **missing** |
| **Shareable result card** | **missing** |
| **Public profile URL** | **missing** |
| **Public match URL** | **missing** |
| AI commentary from structured events | **missing** |
| AI character import assistant | **partial** — the importer exists and is admin-approved; no AI normalisation step |
| Mobile-first, bottom nav | **done** (phase 12) |
| Home prioritises play | **done** |
| **Onboarding** | **missing** |
| Feedback animations | **partial** |
| Audio with settings | **done** |
| **Connection quality** | **missing** |
| Structured error codes → human messages | **done** |
| **Current goal on home** | **partial** — nudges exist; no "2 wins until Gold II" |

---

## 4. One conflict to settle

V4 P1 asks for a **2-second extension** when a bid lands in the final two
seconds. On 2026-08-11 the instruction was the opposite and explicit: *"her
seçime arttıran arttırsın"* with a 10-second clock — every bid puts the full
clock back, which is what ships today.

Both cannot be true. The current behaviour is kept until this is settled, and
the reasonable middle — which V4 also asks for — is to **cap the extensions**
so a bidding war cannot run forever. That cap is implemented in Phase 1; the
reset length is left alone.

---

## 5. What Phase 1 changes

Only the P0 gaps, in the order V4 gives:

1. **Idempotent bid and pass.** Every action carries a client-generated id;
   the server returns the first result for a repeated id instead of acting
   twice.
2. **The full event log.** All 20 event types, emitted where they happen.
3. **Extension cap.** A hard limit on how many times one auction can be
   extended.
4. **Rate limiting.** Per-player windows on bid, pass, chat, join, friend
   request and purchase.
5. **Reconnect events.** `PLAYER_LEFT` / `PLAYER_RECONNECTED` so a
   multiplayer bug can be read out of the log afterwards.

Nothing in Phase 1 touches the battle, the economy or the UI.

---

## 6. What Phase 2 changes

Draft gameplay, per V4's order:

1. **Archetypes**, derived from the axes rather than authored. Ten roles read
   out of a character's own profile, so a character added tomorrow is labelled
   with no extra work and the labels cannot drift when the numbers are retuned.
   Calibrated against the real 268-character pool: an earlier cut labelled a
   quarter of the game BOSS.
2. **Hidden power.** The auction shows a band, not the number. Deterministic in
   the character and the game seed, so every player in a room sees the same
   range; ranked hides more than casual. The exact value arrives at team review.
3. **Draft efficiency** — team power per credit, with a plain-language read.
4. **Auction moments** — bargain, overpay, biggest bid, most contested, buzzer
   beater, unsold count, perfect budget. A read model over `bids`,
   `team_characters` and `auctions`, so nothing new is written during a game.

Formations are listed under V4's Phase 2 but are mechanically a battle feature;
they land in Phase 3 with the battle simulation they modify.
