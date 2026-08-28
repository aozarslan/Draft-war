# DRAFT WAR S8 — audit, rulebook and implementation plan

Written before touching anything. No production code was modified to produce
this document; the only things that ran were the existing test suite, the
existing catalogue, and two throwaway simulations in a scratchpad.

**The headline finding:** S8 is mostly an *accumulation layer*, not a rewrite.
A room already plays a numbered sequence of games; an auction already knows how
to keep opening lots until every player owns their quota; a battle already
takes N teams, is simulated once server-side, and is stored as a replayable
blob. What does not exist is the thing that ties eight of those together into
one match with carried-over credits, HP and rosters — plus pairwise
matchmaking, which the renderer actually *needs* because the arena has only ever
had two sides.

**The one hard blocker found:** with one acquisition per player per round over
eight rounds, a five-player game needs 40 characters plus slack. **No single
category in the catalogue is that big** (Marvel and DC are 50, and the auction
asks for required + 40% = 56). This constrains the rulebook, and §2 resolves it.

---

## PART 1 — AUDIT

### 1. The current game loop

One room plays a sequence of independent **games**. A game is one draft and one
battle:

```
LOBBY → CATEGORY → AUCTION → TEAM_REVIEW → MAP_SELECTION → EVENT → BATTLE → RESULTS
  ↑                                                                          │
  └───────────────── dw_return_to_lobby / dw_rematch ────────────────────────┘
```

`PHASE_ORDER` is declared in [types.ts:30](src/lib/game/types.ts:30) and
enforced by a check constraint on `rooms.phase`.

Nothing drives this loop but the clock. `dw_tick(room)`
([0001_init.sql:836](supabase/migrations/0001_init.sql:836)) is idempotent, is
called by *every* connected client, and returns a list of actions the Node layer
then performs (`NEEDS_MAP_LOCK`, `NEEDS_BATTLE`, …). There is no background
worker and no host authority over the clock — which is why a host closing their
laptop does not stall the room, and why S8 must not introduce a phase that only
one particular client can advance.

**What already resembles a round:** `games.game_no` increments per room,
`rooms.games_played` counts them, and `players.wins / losses / points` already
accumulate a season across games ([dw_store_battle](supabase/migrations/0001_init.sql:763)).
A round of S8 is very close to a game of today.

**What breaks if you naively call it a round:**

* `dw_start_game` **resets every player's credits** to `startingCredits`
  ([0001_init.sql:414](supabase/migrations/0001_init.sql:414)). Eight rounds
  would be eight fresh wallets.
* `dw_start_game` refuses unless `rooms.phase = 'LOBBY'` and everybody is
  `is_ready`. A round transition cannot go through the lobby.
* `team_characters` is unique on `(game_id, character_id)`, so a roster is
  scoped to one game and does not accumulate.
* `dw_return_to_lobby` marks the active game `ABANDONED` and resets credits —
  the "play again" path is a *reset*, not a *continue*.

### 2. The current state model

Server-authoritative, single-blob snapshot. `dw_snapshot(room)` returns
everything the UI needs in one round trip; the TypeScript shape is
[`Snapshot` in engine.ts:19](src/lib/server/engine.ts:19).

```
room    { phase, config, stateVersion, categoryIds, categoryMode, watching }
players [{ id, seat, colorIndex, credits, formation, roster[], wins/losses/points }]
game    { id, gameNo, seed, queue[], queueIndex, mapId, eventId,
          phaseDeadline, battleStartedAt, battleResult }
auction { id, characterId, status, currentBid, highBidderId, endsAt, passedPlayerIds }
mapVotes / categoryVotes / events / chat
```

Three properties S8 must preserve:

* **Timers are timestamps.** `auctions.ends_at`, `games.phase_deadline`,
  `games.battle_started_at`. Clients render a countdown against a measured
  server-clock offset ([useRoom.ts](src/lib/client/useRoom.ts)). Nothing ticks
  in a process.
* **Realtime is a doorbell.** Any write bumps `rooms.state_version`; the client
  hears it and refetches through our own API on the service-role key. The anon
  key can read only `rooms`, `chat_messages`, `characters`.
* **The client computes nothing.** Bids, prices, damage, winners and rewards are
  all decided in Postgres or in `runBattle` on the server.

### 3. The current DB model

Game tables: `rooms`, `players`, `player_secrets`, `characters`, `games`,
`auctions`, `bids`, `auction_passes`, `team_characters`, `map_votes`,
`chat_messages`, `game_events`, `battle_results`, `spectators`, `live_events`,
`action_results` (idempotency), `rate_limits`.

Progression tables (untouched by S8): `profiles`, `profile_stats`, `seasons`,
`xp_transactions`, `coin_transactions`, `match_history`, `catalog_items`,
`profile_items`, `shop_rotations`, `achievements`, `challenge_*`, `friendships`,
`notifications`.

RLS is on for everything. Only `rooms`, `chat_messages`, `characters` and
`live_events` have anon read policies.

The two rows that carry a match today:

```sql
games (id, room_id, game_no, status, seed, queue jsonb, queue_index,
       characters_per_player, map_id, event_id, map_candidates,
       phase_deadline, battle_started_at, battle_result jsonb, ...)

team_characters (game_id, room_id, player_id, character_id, price,
                 unique (game_id, character_id))
```

`games.battle_result` is **one blob for one battle**. S8 has up to two battles
per round, which is the single most consequential schema fact in this document.

### 4. How the auction works

The rules exist twice on purpose: TypeScript in
[auction.ts](src/lib/game/auction.ts) so the UI can grey out impossible buttons,
and plpgsql as the authority. `tests/auction.test.ts` documents the contract
both implement.

* **Queue.** Built once, server-side, before the first lot opens
  (`buildAuctionQueue`), from the categories in play. Size is
  `required + max(5, 40% of required)` (`queueSize`). Persisted on `games.queue`;
  the client never sees the wider pool.
* **Clock.** Every accepted bid puts the *full* `auctionSeconds` back
  (`resetDeadline`), so a bidding war cannot be sniped.
* **Reserve rule.** `maxAllowedBid(credits, slotsRemaining, minBid)` — you must
  keep `minBid` for every slot you still need after this one. The `MAX` button
  shows exactly that.
* **Pass rule.** `validatePass` blocks passing when remaining supply equals
  remaining demand, so the draft can never become unsolvable.
* **Termination.** `dw_open_next_auction` loops until `dw_total_demand(game) = 0`
  and then flips the room to `TEAM_REVIEW`
  ([0027:30](supabase/migrations/0027_feedback_fixes.sql:30)). Unsold characters
  are recycled back onto the queue rather than shrinking the draft.
* **Concurrency.** `dw_place_bid` takes `SELECT … FOR UPDATE`; the loser of a
  race is told *"Someone else placed a higher bid."* `p_action_id` makes a retry
  return the first answer instead of bidding twice.

**This machinery is exactly what S8 needs, unchanged.** A round where every
player buys one character is `characters_per_player = 1`. `dw_total_demand`,
`dw_slots_remaining`, the reserve rule and the termination condition all already
express "keep opening lots until everybody has their quota".

### 5. How character acquisition works

`dw_resolve_auction` ([0005:242](supabase/migrations/0005_v2_1_five_players.sql:242))
debits the winner, inserts into `team_characters`, logs a `SOLD` game event and
opens the next lot. If nobody bid *and* the draft would otherwise become
unsolvable, it force-assigns the character at `minBid` to the player who needs
slots most (`AUTO_ASSIGNED`). Credits are on `players.credits`, room-scoped.

Two S8-relevant consequences:

* A player's roster for a round is `team_characters WHERE game_id = <round>`.
  The **match** roster is the union across the match's rounds — no schema change
  needed to accumulate, only a different `WHERE`.
* Credits already survive between lots and between phases. They only die at
  `dw_start_game` and `dw_return_to_lobby`.

### 6. How the battle works

`simulateBattle` ([battle.ts:290](src/lib/game/battle.ts:290)) is pure and
deterministic given `seed`. It is called once, in `runBattle`
([engine.ts](src/lib/server/engine.ts)), and stored by `dw_store_battle`, which
takes `FOR UPDATE` and returns `noop` if a result already exists.

Pipeline per character:

```
projectAxes(char, {mixed, bands})   crossover normalisation on COMBAT VALUE
  → applyFormation(axes)            ±4% on two axes, measured to ~50% win rate
  → × environmentMultiplier(map,event)
  → − event stat drain
  → maxHp = 70 + defense*1.55 + power*0.45
```

Then a round loop (max 14) with speed-ordered initiative, 40% focus-fire on the
weakest enemy, and special/crit/block rolls. It emits a `BattleLogEntry[]` with
`atMs` playback offsets, `hpAfter` reported by the engine itself, per-team
standings, `winProbability` (softmax with `K = 0.0475`, *fitted* against the
simulator), `upset`, `turningPoint`, `mvp` and four awards.

**It already accepts N teams.** Standings sort by survivors → HP% → damage, and
`POINTS_TABLE = [3,2,1,0]` covers four places (a fifth team scores 0). For S8's
pairwise matches, `teams.length === 2` is the simplest case it supports and the
one it is best calibrated for.

**What it does *not* have:** any notion of space. There are no coordinates, no
lanes, no front/back, no positional targeting. Lanes are invented downstream in
[replay.ts](src/lib/game/replay.ts) as presentation and are explicitly documented
as reaching nothing. This is the fact that decides the positioning plan in §10.

### 7. How replay works

A strict projection chain, every step pure:

```
games.battle_result (jsonb, immutable)
  → toReplay(result, context)          replay.ts — lanes, seats, animation hints
      → highlightsOf(replay)           which beats matter
      → narrativeOf(replay, highlights)  the single title-card slot
      → revealOf(replay)               spoiler-free head-to-head
      → summaryOf(replay) → shareTextOf
      → sceneAt(replay, elapsedMs)     the whole picture at time N — pure
          → BattleRenderer             the only impure file
```

`sceneAt` holds no state and is order-independent, which is what keeps phones
frame-aligned: they do not accumulate frames, they both ask the same question
about `serverNow() - battleStartedAt`. Measured cost on a 3-team, 119-event
replay: **0.058 ms per call**, comfortably inside the 1 ms budget.

`buildStage` ([stage.ts:63](src/lib/render/stage.ts:63)) is the one place a
scene is assembled, and it is typed structurally (`ProjectableResult`) so a live
room and a shared public match go through the same builder.

### 8. What is reusable, as-is

| Piece | Why it survives S8 untouched |
| --- | --- |
| The whole auction engine + SQL | A round is `characters_per_player = 1`. Reserve rule, pass rule, clock reset, termination and race handling all already say the right thing. |
| `simulateBattle` | Already N-team, already pure, already seeded, already stored once. A pairwise match is its easiest case. |
| `battle_result` / `toReplay` / `sceneAt` / renderer | The replay format needs **no change** for pairwise combat. |
| Timers-as-timestamps, `dw_tick`, doorbell Realtime | The transport for an 8-round match is the transport for a 1-round match. |
| Idempotency (`action_results`), rate limits, `FOR UPDATE` | Already carry the whole mutation surface. |
| Categories, axes, synergy, crossover bands | Category-independent by construction; events in S8 must be too. |
| Visual identity (`CHARACTER_VISUALS`, sprites, anchors) | Client-side only, never in the DB, never in `battle_result`. S8 adds to it, changes none of it. |
| Spectators (`dw_watch`), public match, share | "Watch fight" is this, pointed at a round's battle instead of the room's only battle. |

### 9. What must change

1. **Credits must survive a round.** `dw_start_game` resets them; a round-start
   path must not.
2. **A match needs an owner row.** Round number, round count, phase, HP, streaks,
   modifiers and elimination have nowhere to live today.
3. **One battle per game is not enough.** Four players produce two battles per
   round. `games.battle_result` is a single blob.
4. **Matchmaking does not exist.** Every player is in the same battle today.
5. **The arena is two-sided.** `sceneAt` maps `seat === 0 ? 0 : 1`
   ([scene.ts:352](src/lib/render/scene.ts:352)) and `placement` mirrors on that
   one bit ([scene.ts:305](src/lib/render/scene.ts:305)). *Verified empirically:*
   in a 3-team, 15-combatant battle, **5 of 15 sprites land on exactly the same
   coordinates as another sprite.** Pairwise matchmaking does not merely enable
   S8 — it fixes a live rendering bug.
6. **Board/bench/position have no model.** Rosters are a flat list.
7. **Events are one card for one battle.** `EVENT_CARDS` has no rarity, no
   choices, no player decision, no duration and no per-player targeting.
8. **`POINTS_TABLE` has four entries.** Fine for pairwise; must not be reused as
   the match-level ladder.
9. **The pool-size arithmetic breaks.** See the blocker below.

**The pool blocker, in numbers.** Required lots = `players × acquisitions`. At
one acquisition per round for eight rounds:

| Category | Draftable | Max players (8 acquisitions + 40% reserve) |
| --- | --- | --- |
| Marvel / DC | 50 | 4 |
| Hollywood | 40 | 3 |
| Action Movies / Animals | 30 | 2 |
| Basketball | 25 | 2 |
| Fantasy | 24 | 2 |
| Anime / Video Games | 22 | 1 |
| Football | 20 | 1 |

A five-player game is impossible in every single category. §2 fixes this in the
rules rather than by inflating every pool.

### 10. What must not change

Hard constraints for every S8 milestone:

* `simulateBattle`'s damage maths, RNG draw order, turn ordering, synergy cap,
  crossover normalisation and `winProbabilities` coefficient. If it changes,
  `RULES_VERSION` bumps and every stored replay's provenance changes with it.
* The `battle_result` schema and the replay projection contract.
* The legacy 268-character fingerprint
  (`a2f9491d…`, `tests/character-visuals.test.ts`) and all ten categories.
* Visual metadata isolation: `CHARACTER_VISUALS` stays client-side, never
  reaches Postgres, never reaches `battle_result`.
* Server authority: no client ever computes a bid outcome, a price, damage, a
  winner, a reward or a random event result.
* Timers as timestamps; `dw_tick` idempotent and callable by any client.
* Auction reserve rule and pass rule.
* The `(playerId, token)` identity model — a request body never names a player.

### 11. Changes that will need a migration

| # | Change | Kind |
| --- | --- | --- |
| M1 | `matches` table (round no, round count, phase, seed, status) | new table |
| M2 | `match_players` (hp, credits, streak, wins, eliminated_at, modifiers) | new table |
| M3 | `games.match_id`, `games.round_no` | additive columns |
| M4 | `round_matchups` (match, round, pairing, seat A/B, battle_result, started_at) | new table |
| M5 | `board_slots` (match, player, character, zone, slot) | new table |
| M6 | `round_events` (match, round, player, event id, choices, chosen, server result) | new table |
| M7 | `dw_start_round` / `dw_advance_round` / `dw_settle_round` | new functions |
| M8 | `dw_snapshot` extended with `match`, `matchups`, `board`, `event` | replace function |
| M9 | `rooms.phase` check constraint gains `ROUND_*` phases | constraint change |
| M10 | RLS policies for the five new tables (server-only; no anon read) | policy |

Everything is additive. Nothing drops a column, nothing rewrites a row, and a
room that never starts an S8 match keeps behaving exactly as it does today.

### 12. The visual renderer's limits

Measured and read, not assumed:

* **Two sides, hard-coded.** Proven overlap above. Pairwise combat is inside the
  renderer's competence; free-for-all is not.
* **32×32 frames, 7 rows, 6 columns**, eight body plans, greyscale + runtime
  tint. `SHEET_CLIPS` is the single declaration both the generator and the
  manifest read.
* **Composed frames are cached** on `characterId|row|frame|size|identityKey`.
  Adding a *style* dimension means adding to that key, or S2's bug returns.
* **Anchors**: `head`, `back`, `body`, `marks[]`, `hand`, `foot`. A new anchor
  costs a regeneration of `anchors.generated.ts` (12,843 lines) and touches all
  nine draw paths.
* **Arena is 320×180 abstract units**, scaled to the canvas. Ten combatants max
  in practice (5v5).
* **No positional semantics.** Lane is a look. If S8 wants position to matter,
  the number has to come from the engine, not from the renderer.
* **No renderer dependency, no runtime asset generation, no external image
  fetch during a battle** — and S8 must keep it that way.

**Baseline right now:** 854 tests / 35 files pass; typecheck clean.

---

## PART 2 — DRAFT WAR RULEBOOK v1

### 2.1 The shape of a match

| | Default |
| --- | --- |
| Players | 2–5 |
| Rounds | 8 |
| Starting credits | 50 |
| Starting HP | 100 |
| Board | max 5 |
| Bench | max 3 |
| Acquisitions | at most 1 per round |
| Length target | 20–30 minutes |

### 2.2 The pool rule (resolves the §9 blocker)

**Acquisition is mandatory only while your board is not full.**

* Rounds 1–5: you *must* end the round with one more character (the existing
  pass rule already enforces exactly this when supply is tight).
* Rounds 6–8: acquisition is **optional**. You may pass to bank credits, or buy
  to upgrade the board and bench a weaker fighter.

Required lots therefore drop from `players × 8` to `players × 5`, and the pool
requirement becomes:

```
minPool = players × 5,  queue = minPool + max(5, 40% of minPool)
```

| Players | Required | Queue | Categories that qualify |
| --- | --- | --- | --- |
| 2 | 10 | 15 | all ten |
| 3 | 15 | 21 | all except football (20) |
| 4 | 20 | 28 | Marvel, DC, Hollywood, Action Movies, Animals |
| 5 | 25 | 35 | Marvel, DC, Hollywood — or **any two categories mixed** |

Crossover already exists and already normalises fairly, so the five-player
answer is "mix two categories", which is a feature rather than a workaround. The
lobby must refuse a match whose pool is too small **before** the first lot opens,
with the same `POOL_TOO_SMALL` error path that exists today.

### 2.3 Per-player state

```
hp                100 → 0
credits           50 + rewards − spend
board             ≤5 characters, each in FRONT | MID | BACK
bench             ≤3 characters
acquired          board ∪ bench, the match roster
roundWins / streak
modifiers[]       event effects with an explicit expiry round
eliminated        hp = 0, and only from round 5 onward
```

### 2.4 Round structure

Every round is the same seven beats. What changes between rounds is the **board
cap**, whether acquisition is mandatory, and which event tier fires.

| R | Name | Board cap | Acquisition | Event tier |
| --- | --- | --- | --- | --- |
| 1 | First draft | 1 | mandatory | none — teach the loop |
| 2 | Draft | 2 | mandatory | none |
| 3 | Draft + event | 3 | mandatory | **minor** (choice) |
| 4 | Special event | 4 | mandatory | **major** (choice, targets a player) |
| 5 | Draft | 5 | mandatory | minor |
| 6 | Power event | 5 | optional | **power** (choice, lasts 2 rounds) |
| 7 | Final preparation | 5 | optional | none — pure board decision |
| 8 | Championship | 5 | none | bracket presentation |

The seven beats:

```
1 ROUND_INTRO      who is on what HP, what round it is, what is about to happen
2 EVENT            drawn deterministically from the match seed; ≥50% offer a choice
3 ACQUISITION      the existing auction, one lot at a time, one buy per player
4 BOARD            place / swap / bench / choose zone. Deadline, then auto-lock
5 MATCHMAKE        deterministic pairing published before combat
6 COMBAT           one simulateBattle per pairing, stored, replayed
7 SETTLE           damage, rewards, streaks, eliminations, next round
```

Rounds must not *feel* identical, and the levers used are deliberately cheap:
the board cap changes what a buy is *for* (R1–R5 you are filling, R6–R8 you are
upgrading), the event tier changes the stakes, and R7 has no event and no
mandatory buy so it reads as the quiet before the final.

### 2.5 Winning

Round 8 is a bracket over the survivors, seeded by HP then round wins.

| Alive at R8 | Format |
| --- | --- |
| 2 | Final |
| 3 | #2 vs #3, winner meets #1 in the final |
| 4 | Two semifinals, then the final |
| 5 | #4 vs #5 play in; then semifinals and the final |

If everybody but one is eliminated before round 8, the match ends immediately
and that player is champion.

Awards on the final screen — champion, MVP, best draft, biggest upset — are all
projections of data the engine already stores.

---

## PART 3 — STATE MACHINE

Rooms keep their existing phases. S8 adds a *match* state machine that lives
inside the room's `BATTLE`-era phases. Legacy single-battle games keep working
because they simply never create a match row.

```
                            ┌──────────────────────────────────┐
LOBBY ── start ──► CATEGORY ─┴─► MATCH_INTRO                    │
                                     │                          │
                                     ▼                          │
             ┌──────────► ROUND_EVENT ───► ROUND_AUCTION         │
             │                  │               │                │
             │            (no event rounds      ▼                │
             │             skip straight)  ROUND_BOARD           │
             │                                  │                │
             │                                  ▼                │
             │                            ROUND_COMBAT           │
             │                                  │                │
             │                                  ▼                │
             └──── round < 8 ───────────  ROUND_SETTLE           │
                                                │                │
                                     round = 8  ▼                │
                                          CHAMPIONSHIP           │
                                                │                │
                                                ▼                │
                                          MATCH_RESULTS ─────────┘
                                                │
                                                ▼
                                             LOBBY
```

Transition rules, all server-side and all idempotent:

| From | Trigger | Guard |
| --- | --- | --- |
| `MATCH_INTRO` → `ROUND_EVENT` | deadline | match row exists, pool validated |
| `ROUND_EVENT` → `ROUND_AUCTION` | every live player chose, or deadline | choices persisted |
| `ROUND_AUCTION` → `ROUND_BOARD` | `dw_total_demand(round) = 0` | reuses today's exit condition verbatim |
| `ROUND_BOARD` → `ROUND_COMBAT` | every player locked, or deadline | boards auto-locked to a legal layout |
| `ROUND_COMBAT` → `ROUND_SETTLE` | every matchup has a stored result **and** its `durationMs` elapsed | `dw_store_round_battle` is `noop`-safe |
| `ROUND_SETTLE` → `ROUND_EVENT` | deadline | HP/credits/streaks written once, guarded by `settled_at` |
| `ROUND_SETTLE` → `CHAMPIONSHIP` | `round = 8` or one player left | |

Every transition is driven by `dw_tick`, which any client may call. **No new
timer mechanism.** Each phase writes `matches.phase_deadline` exactly as
`games.phase_deadline` works today.

---

## PART 4 — DATABASE MODEL

Five new tables, two new columns, no destructive change.

```sql
create table matches (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id) on delete cascade,
  match_no      int  not null,
  status        text not null default 'ACTIVE'
                check (status in ('ACTIVE','FINISHED','ABANDONED')),
  phase         text not null default 'MATCH_INTRO',
  round_no      int  not null default 0,
  round_count   int  not null default 8,
  seed          text not null,          -- every random draw in the match derives from this
  category_ids  text[] not null default '{}',
  phase_deadline timestamptz,
  champion_player_id uuid references players(id) on delete set null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  unique (room_id, match_no)
);

create table match_players (
  match_id      uuid not null references matches(id) on delete cascade,
  player_id     uuid not null references players(id) on delete cascade,
  hp            int  not null default 100,
  credits       int  not null,
  round_wins    int  not null default 0,
  streak        int  not null default 0,
  eliminated_at int,                    -- round number, null while alive
  modifiers     jsonb not null default '[]'::jsonb,
  primary key (match_id, player_id)
);

alter table games add column if not exists match_id uuid references matches(id) on delete cascade;
alter table games add column if not exists round_no int;

create table round_matchups (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  round_no      int  not null,
  pairing_index int  not null,
  player_a      uuid not null references players(id) on delete cascade,
  player_b      uuid references players(id) on delete cascade,   -- null = bye
  kind          text not null default 'DUEL'
                check (kind in ('DUEL','BYE','ENCOUNTER','FINAL','SEMIFINAL','PLAY_IN')),
  battle_result jsonb,
  started_at    timestamptz,
  settled_at    timestamptz,
  winner_player_id uuid references players(id) on delete set null,
  damage        int,
  unique (match_id, round_no, pairing_index)
);

create table board_slots (
  match_id     uuid not null references matches(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  character_id text not null references characters(id),
  zone         text not null check (zone in ('FRONT','MID','BACK','BENCH')),
  slot         int  not null,
  updated_at   timestamptz not null default now(),
  primary key (match_id, player_id, character_id)
);

create table round_events (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  round_no      int  not null,
  player_id     uuid references players(id) on delete cascade,  -- null = table-wide
  event_id      text not null,
  choices       jsonb not null default '[]'::jsonb,
  chosen        text,
  server_result jsonb,                  -- what the server decided, for the replay
  resolved_at   timestamptz,
  unique (match_id, round_no, player_id, event_id)
);
```

Design notes worth defending:

* **`round_matchups.battle_result` rather than reshaping `games.battle_result`.**
  A stored result is immutable and every finished match on disk depends on its
  shape. Adding a second place a result can live is additive; changing the first
  one is not. The blob written into `round_matchups` is a `BattleResult` in
  *exactly* the same format, so `toReplay` / `sceneAt` / the renderer need no
  change at all.
* **`match_players.credits` rather than reusing `players.credits`.**
  `players.credits` is reset by two existing functions. A separate column means
  those functions stay correct and the match owns its own economy.
* **`board_slots` keyed by character, not by slot index.** A character is in
  exactly one place; a slot can be empty. This makes "swap" a two-row update
  with no chance of duplicating a fighter.
* **No visual columns anywhere.** Look stays client-side, as in S1–S7.
* **RLS**: all five tables server-only, no anon policy — same posture as
  `team_characters`.

---

## PART 5 — GAME FLOW

```
HOST STARTS
  │
  ├─ category resolved (existing)
  ├─ dw_start_match: matches + match_players (hp 100, credits 50), validate pool
  │
  ▼
ROUND r  ────────────────────────────────────────────────────────────────────
  │
  ├─ EVENT       rng = createRng(`event:${match.seed}:${r}`)
  │              draw a card for the round's tier; write round_events
  │              players choose (or the deadline chooses the default)
  │
  ├─ AUCTION     games row: match_id = m, round_no = r, characters_per_player = 1
  │              existing dw_open_next_auction / dw_place_bid / dw_resolve_auction
  │              credits debited from match_players
  │              R6–R8: demand is 0 for a player who declines, so passing is free
  │
  ├─ BOARD       board_slots writes; deadline auto-locks anything unplaced
  │              legal layout enforced server-side (≤5 board, ≤3 bench)
  │
  ├─ MATCHMAKE   pure function of (match.seed, r, live players, history)
  │              round_matchups written; published to every client BEFORE combat
  │
  ├─ COMBAT      per matchup: simulateBattle({ teams:[A,B], seed:
  │                `${match.seed}:${r}:${pairing}` })
  │              stored by dw_store_round_battle (FOR UPDATE, noop-safe)
  │              clients replay from round_matchups.started_at
  │
  └─ SETTLE      damage → hp, rewards → credits, streaks, eliminations
                 guarded by settled_at so a repeated tick pays once
  │
  ▼
r < 8 → ROUND r+1        r = 8 → CHAMPIONSHIP → MATCH_RESULTS → LOBBY
```

---

## PART 6 — ECONOMY

### 6.1 The formula

```
startingCredits            50

after every round:
  participation            +3          every live player, bye included
  win                      +5
  streak                   +2 per consecutive win beyond the first, capped +4
  event                    per card, always disclosed on the card
  catch-up                 see 6.3 — NOT a credit grant

spending:
  reserve rule             keep 1 credit per mandatory acquisition still owed
                           (rounds 1–5 only; from R6 the reserve is 0)
```

Per-round income is 3–12. Over eight rounds a player takes in roughly 24–90 on
top of the starting 50.

### 6.2 What the simulation actually says

10,000 matches per configuration, per player count, driven by the real
catalogue's `gamePower` distribution and an English-auction model where price
settles at the runner-up's willingness + 1. (Scratchpad only — no repo code.)

Baseline, participation 3 / win 5 / streak 2 (cap 4):

| Players | Median end credits | Median lot price | Runaway | Comeback | Elim/game |
| --- | --- | --- | --- | --- | --- |
| 2 | 27 | 7 | 28.0% | — | 0.00 |
| 3 | 13 | 11 | 7.1% | 43.2% | 0.00 |
| 4 | 12 | 11 | 6.1% | 26.9% | 0.00 |
| 5 | 9 | 11 | 2.3% | 15.1% | 0.00 |

*Runaway* = the leader after round 2 also finishes first **and** by ≥25 HP.
*Comeback* = the player in last place at the halfway mark finishes top two.

Three findings that changed the design:

1. **A flat credit catch-up is a no-op.** +3 credits per round to the lowest-HP
   player moved runaway from 6.1% → 6.1% at four players and comeback from
   26.9% → 27.4%. This is the same result M12 found for a dynamic starting
   budget: **money is not the lever that closes a gap.** §6.3 therefore spends
   the catch-up budget on decisions instead of on credits.
2. **Interest inflates, it does not balance.** +1 credit per 10 banked (cap 3)
   raised the median lot price from 11 to 14 and left every outcome metric
   within noise. Rejected.
3. **A streak reward is safe.** Removing it entirely changed runaway by 0.4
   points. Keep it — it is a story, not a snowball.

### 6.3 Damage, and why it is the real lever

The user brief asks that damage derive from remaining enemy power, a round
multiplier and an upset modifier. The simulation says the *shape* matters far
more than the terms:

```
damage = clamp( round( (8 + 2.4 × survivingEnemyFighters)
                       × (1 + 0.18 × (round − 1))
                       × upsetModifier ), 4, 32 )

upsetModifier = 1.15 when the loser was the forecast favourite, else 1.0
```

Sweeping the base/per-survivor/ramp triple across 10,000 matches each:

| Curve | Median end HP (4p) | Elim/game (4p) | Runaway | Comeback |
| --- | --- | --- | --- | --- |
| soft (3 + 1.4·s, ramp .12) | 63 | 0.00 | 6.1% | 26.9% |
| **chosen (8 + 2.4·s, ramp .18)** | **16** | **1.34** | **22.9%** | **26.6%** |
| harsh (12 + 3.0·s, ramp .22) | 0 | 2.43 | 29.6% | 18.5% |

The soft curve makes HP decorative — nobody is ever eliminated and nobody is
ever nervous. The harsh curve kills half the table and cuts comebacks by a
third. The chosen curve leaves a four-player match ending on a median 16 HP with
about one elimination — tense, survivable, and the last round still matters.

**Elimination floor:** a player cannot be eliminated before round 5. Before
that, HP is clamped at 1. Sitting out five of eight rounds is not a game a
friend group enjoys, and the floor costs nothing structurally.

**Two-player matches are structurally different** — every round is the same
duel, so "runaway" is near 50% by definition. Recommendation: the two-player
default is **6 rounds**, not 8, and the damage ramp starts at round 1. This is a
config value, not a special case in the rules.

### 6.4 Catch-up, spent on decisions

Total advantage is capped and every part of it is visible to the whole table:

| Mechanic | Given to | Size |
| --- | --- | --- |
| Event priority | lowest HP | picks their event option first; on a table-wide card, picks the variant |
| Bounty | lowest HP | whoever beats them next round earns +4 credits — makes them a target *and* a prize |
| Underdog forecast | any matchup where the forecast gap ≥ 20 points | the underdog's win reward is +8 instead of +5 |
| Board grace | eliminated-adjacent (HP ≤ 15) | one free board rearrangement after seeing the matchup |

No free wins, no stat buffs, no hidden numbers. Every one of these is a *choice*
or a *reward*, which is what the simulation says money is not.

---

## PART 7 — MATCHMAKING

Deterministic, server-authoritative, reproducible from `(match.seed, round,
history)`. Pure function; unit-testable with no database.

```
pairFor(round):
  live      = players with hp > 0, sorted by (hp desc, roundWins desc, seat asc)
  history   = for each unordered pair, how many times they have met
  lastRound = each player's opponent in round-1

  score(a, b) =
      1000 × timesMet(a, b)              # rule 2: prefer strangers — dominant term
    +  500 × (b == lastOpponentOf(a))    # rule 5: never the same opponent twice running
    +    1 × |strength(a) − strength(b)| # rule 3: closest board strength
    −  0.5 × |hp(a) − hp(b)| × catchUpOn # rule 4: mild pull toward the wounded

  choose the perfect matching that minimises total score
    (≤5 players → at most 15 pairings; exhaustive search, no heuristic needed)

  odd player out → the one with the FEWEST byes so far, ties broken by the seed
```

* **2 players** — A vs B every round.
* **3 players** — one duel, one `ENCOUNTER`.
* **4 players** — two duels.
* **5 players** — two duels, one `ENCOUNTER`.

`strength` is a projection of the board, not a new source of truth: it reuses
`teamRating` from `battle.ts` with the same map/event/bands inputs the fight
will use.

**The odd player out gets an `ENCOUNTER`, not a bye.** A bye is dead air in a
game whose whole appeal is watching. An encounter is a real `simulateBattle`
against a board the server assembles from the match seed — same engine, same
replay format, same renderer, no new code path. Winning it pays the participation
reward plus 3; losing costs the standard damage at 0.6×, so it can never be the
best or worst seat at the table.

---

## PART 8 — EVENT SYSTEM

Category-independent, seeded, replayable. An event is data, and its outcome is a
row.

```ts
interface RoundEvent {
  id: string;
  name: string;
  tier: "MINOR" | "MAJOR" | "POWER";
  rarity: "COMMON" | "RARE" | "EPIC";
  triggerRounds: number[];          // which rounds may draw it
  scope: "PLAYER" | "TABLE";
  choices: EventChoice[];           // ≥2 for a decision card, [] for a pure modifier
  resolve(input): EventResult;      // pure, seeded, server-side only
}

interface EventResult {
  modifiers: Modifier[];            // each carries an explicit expiryRound
  credits?: number;
  acquisitions?: number;            // bonus lots — the ONLY bypass of "1 per round"
  replayData: Record<string, unknown>;
}
```

**Design rule: at least half of all events must contain a player decision.**
Ten cards, six of which are decisions:

| # | Card | Tier | Decision |
| --- | --- | --- | --- |
| 1 | **Wild Encounter** | MINOR | pick BEAST (fight for credits) / TREASURE (safe credits) / CHAOS (random, high variance) |
| 2 | **Treasure** | MINOR | +8 now, or +14 with your next lot's reserve doubled |
| 3 | **Blood Moon** | MINOR | table-wide: next round's damage ×1.25 both ways. No choice — it changes how everyone plays |
| 4 | **Mutation** | MAJOR | pick one of your characters: +8 power / −5 defense, for the rest of the match |
| 5 | **Bounty** | MAJOR | you name a target; whoever beats them next round takes +6 |
| 6 | **Black Market** | MAJOR | one off-queue character at a fixed price, seen before you commit. Bonus acquisition — the declared exception |
| 7 | **Double Down** | POWER | next battle's rewards ×2; if you lose, −6 extra HP |
| 8 | **Mirror Match** | POWER | override your next matchup against a chosen opponent |
| 9 | **Wild Card** | POWER | one of three sealed modifiers, revealed after you pick |
| 10 | **Chaos Round** | POWER | table-wide: every player receives the same small deterministic modifier |

Rules the implementation must hold:

* Randomness is `createRng(\`event:${match.seed}:${round}:${playerId}\`)`. The
  client never rolls anything.
* A modifier carries `expiryRound` and is dropped by `dw_settle_round`. Nothing
  is permanent unless the card says so and the card is EPIC.
* `round_events.server_result` is written once and is what the replay reads, so
  a shared match shows the same event outcome forever.
* Bonus acquisitions are the **only** documented bypass of "one main character
  per round", and they are logged as `BONUS_ACQUISITION` so the table can see it.
* Events never touch `simulateBattle`'s internals. They express themselves as
  the axis modifiers the engine *already* accepts (`environmentMultiplier`,
  formation-shaped multipliers), so no engine change is needed for any of the
  ten.

---

## PART 9 — BOARD SYSTEM

```
FRONT   ┌───┬───┐        BENCH  ┌───┬───┬───┐
MID     ├───┼───┤               └───┴───┴───┘
BACK    └───┴───┘
```

Five board slots across three zones, three bench slots. Placement is free within
the cap — a player may stack all five in FRONT.

Zone affinity comes from the **existing derived combat archetype**
(`archetypeOf` in `src/lib/game/archetypes.ts`), never from a new authored
field:

| Archetype | Preferred zone | Effect when placed there |
| --- | --- | --- |
| TANK, BRUISER | FRONT | +6% defense |
| ASSASSIN, SPEEDSTER | FRONT or MID | +6% power |
| RANGED, CONTROL | BACK | +6% special |
| SUPPORT, STRATEGIST | MID or BACK | +6% strategy |
| WILD_CARD, BOSS | any | +3% to its own highest axis |

**Hard cap: the total effect of positioning on a squad's combat value must stay
inside ±10%**, asserted by a test that measures it through `combatValue`, exactly
the way `formationSwing` already holds formations to ±2%.

Positioning arrives in two phases, and phase 1 changes nothing about combat:

* **Phase 1 (S8.4).** `board_slots` exists, the UI works, the placement is
  stored, the renderer draws the board from it instead of from `LANE_PLANS`.
  **Zero effect on the simulation.** Verified by a test asserting that two
  battles with identical rosters and different boards produce byte-identical
  results.
* **Phase 2 (S8.7).** A `positionModifiers` term joins the same pipeline that
  formations already use, at the same point (`applyFormation` → position →
  environment). `RULES_VERSION` bumps to 2. Every pre-S8 replay keeps rendering
  because it records the version that produced it.

Formations and positioning overlap conceptually. Recommendation: **positioning
replaces the formation picker for S8 matches** (formations remain for legacy
single-battle games), so a player makes one spatial decision rather than two
that partly cancel.

---

## PART 10 — COMBAT EVOLUTION

`simulateBattle` is not rewritten. It is called more often, on smaller inputs,
and asked to report two things it already knows internally.

**Already stored, needs no work:** participants, HP changes (`hpAfter`),
attacks, abilities (`SPECIAL` + the character's own ability name), eliminations,
critical events, turning point, MVP, winner, duration, seed.

**Missing:** per-round odds. `oddsByRound` is computed inside the simulation and
then thrown away — only the single biggest swing survives as `turningPoint`.
Persisting it is a pure addition to `BattleResult` and unlocks the momentum
narrative that `narrative.ts` currently, correctly, refuses to invent.

Plan:

| Step | Change | `RULES_VERSION` |
| --- | --- | --- |
| S8.5 | Two-team battles per round, stored in `round_matchups`. **No engine change.** | 1 |
| S8.5 | Persist `oddsByRound` on the result; `narrativeOf` gains a real momentum cue | 1 (additive field, no behaviour change) |
| S8.7 | Position modifiers enter the axis pipeline | **2** |
| later | Match-intro / final-clash presentation beats | — |

`MATCH INTRO → ROUND 1 → ACTIONS → … → FINAL CLASH → RESULT` is already the
engine's own phase vocabulary (`PHASES` in `battle.ts`, `FINAL_PHASE_LABEL`
exported for exactly this). The watchable structure the brief asks for exists;
S8 gives it a bracket to sit inside.

---

## PART 11 — VISUAL ENGINE 2.0

The legacy pixel renderer is not removed and is not grown indefinitely. Two
pipelines coexist behind one interface.

```
CharacterVisualDefinition
  characterId, visualVersion: 1 | 2
  ── v1 (legacy) ──►  body plan + identity tiles + tint      [today's renderer]
  ── v2 (next gen) ─► bodyType, headType, faceType, marking,
                      equipment, prop, scale, palette,
                      animationSet                            [new pipeline]
```

* `visualVersion` is the switch. A character with no v2 definition renders v1;
  there is no flag day and no half-migrated arena.
* The v2 asset set covers `idle / attack / hit / special / victory / defeat` —
  a superset-compatible mapping onto the existing `AnimationHint`, so
  `sceneAt` does not change.
* **Style target:** stylized 2.5D — layered, higher-resolution sprites with a
  fixed three-quarter camera. Not a 3D engine, not a new runtime dependency, not
  runtime generation. Assets are authored offline by a script exactly as
  `scripts/generate-sprites.ts` does today, and committed.
* **Proof of concept is 1–3 characters**, not 313. The acceptance test is that
  a v1 and a v2 character stand in the same arena, in the same battle, and the
  battle result is byte-identical either way.
* The composed-frame cache key gains `visualVersion`. This is not optional — S2
  shipped a bug from exactly this omission.
* **Isolation is unchanged and re-asserted:** visual definitions stay
  client-side, never enter Postgres, never enter `battle_result`, and a test
  empties the whole visual table and asserts identical simulation output.

Mobile target: 375 px first-class. Battle hierarchy `BOARD → CHARACTERS →
ACTION → EFFECT → RESULT`; large nickname, HP, action and winner; the text feed
stays as the accessible record but is demoted below the fold.

---

## PART 12 — MIGRATION PLAN

| Migration | Contents | Risk |
| --- | --- | --- |
| `0030_match_series.sql` | `matches`, `match_players`, `games.match_id`, `games.round_no`, RLS, `dw_start_match`, `dw_match_snapshot` | low — purely additive |
| `0031_round_matchups.sql` | `round_matchups`, `dw_pair_round`, `dw_store_round_battle`, `dw_settle_round` | medium — new settlement path |
| `0032_board_slots.sql` | `board_slots`, `dw_set_board`, board validation | low |
| `0033_round_events.sql` | `round_events`, `dw_draw_event`, `dw_choose_event` | low |
| `0034_snapshot_v8.sql` | `dw_snapshot` replaced to carry `match`, `matchups`, `board`, `event` | **highest** — one function every client reads |
| `0035_phase_constraint.sql` | `rooms.phase` check widened | low, but must ship *before* 0034 is used |

Rules:

* Every migration is `create ... if not exists` / `create or replace`, safe to
  re-run.
* **Nothing runs against the live database without explicit approval.** Each is
  generated, reviewed, and tested against `tests/migrations.test.ts` first.
* Order matters: 0035 before 0030–0034 are exercised.
* Rollback for 0034 is the previous `dw_snapshot` body, kept verbatim in the
  migration's header comment so a revert is a copy-paste, not an archaeology
  exercise.
* Legacy path stays alive: a game with `match_id IS NULL` behaves exactly as
  today, and `dw_snapshot` returns `match: null` for it.

---

## PART 13 — TEST PLAN

Baseline to protect: **854 tests / 35 files / typecheck clean.**

| Suite | File | Key assertions |
| --- | --- | --- |
| Game loop | `tests/match-loop.test.ts` | 8 rounds advance; every phase transition; final round; elimination; a match with one player left ends early |
| Auction | extend `tests/auction.test.ts` | max 1 acquisition per round; credits never negative; bid validation; server authority; a second buy in one round is refused |
| Board | `tests/board.test.ts` | board ≤5; bench ≤3; placement; swap; removal; an illegal layout is rejected server-side |
| Matchmaking | `tests/matchmaking.test.ts` | no self-pair; no duplicate; repeat-opponent avoidance over 8 rounds; deterministic from seed; 5-player encounter; 3-player encounter; bye distribution |
| Combat | `tests/round-combat.test.ts` | deterministic; identical replay; identical winner; HP arithmetic; elimination threshold; **board layout does not change the result (phase 1)** |
| Economy | `tests/economy.test.ts` | **10,000 simulated matches**; average / median / max / min credits; winner vs loser economy; runaway rate; comeback rate |
| Events | `tests/round-events.test.ts` | deterministic from seed; choice validation; modifier expiry; persistence into the replay; bonus acquisition is the only auction bypass |
| Visual | extend `tests/visual-pipeline.test.ts` | visual metadata cannot affect gameplay; cache identity includes `visualVersion`; deterministic rendering; v1/v2 mixed arena is result-identical |
| Mobile | `tests/mobile-layout.test.ts` | 375 / 390 / 414 px — no horizontal overflow, tap targets ≥44 px |
| Performance | `tests/performance.test.ts` | `sceneAt` < 1 ms on a 5v5 (currently 0.058 ms); no allocation growth across 1,000 calls |
| Fingerprint | existing | legacy 268 unchanged; all ten categories intact |

**Mutation tests — 20, all of which must be caught:**

| # | Mutation | Suite that must fail |
| --- | --- | --- |
| 1 | Allow a second acquisition in one round | auction |
| 2 | Remove the reserve rule from the round auction | auction |
| 3 | Let credits go negative | auction |
| 4 | Compute the bid winner client-side | auction |
| 5 | Board accepts a 6th character | board |
| 6 | Bench accepts a 4th | board |
| 7 | Board layout leaks into `simulateBattle` in phase 1 | combat |
| 8 | Position modifier exceeds ±10% | board |
| 9 | Pair a player with themselves | matchmaking |
| 10 | Ignore opponent history | matchmaking |
| 11 | Seed the pairing from `Math.random()` | matchmaking |
| 12 | Give the bye to the same player twice running | matchmaking |
| 13 | Damage ignores the round multiplier | economy |
| 14 | Damage becomes a flat constant | economy |
| 15 | Streak reward uncapped | economy |
| 16 | Eliminate a player before round 5 | game loop |
| 17 | Round advances without every matchup settled | game loop |
| 18 | `dw_settle_round` pays twice on a repeated tick | game loop |
| 19 | Event result rolled on the client | events |
| 20 | Modifier never expires | events |
| 21 | Visual version omitted from the frame cache key | visual |
| 22 | A v2 visual definition changes a stat | visual |

(22 written; 20 is the floor.)

---

## PART 14 — RISK REGISTER

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | `dw_snapshot` replacement breaks every client at once | Medium | **Critical** | Ship last; keep the previous body verbatim in the migration header; test against a legacy game first |
| R2 | Pool too small for 4–5 players | **High** | High | Already resolved in §2.2: mandatory acquisitions capped at 5, pool validated before the first lot, crossover prompt for 5 players |
| R3 | An 8-round match runs 45+ minutes | Medium | High | Time-box each phase; measure a real 4-player match at S8.5 and cut round count or phase deadlines before adding more |
| R4 | Elimination benches a friend for three rounds | Medium | High | Elimination floor at round 5; eliminated players keep spectating and keep a vote on table-wide events |
| R5 | Position modifiers destabilise a balance that took milestones to fit | Medium | High | Two-phase rollout; ±10% cap asserted by test; `RULES_VERSION` bump; measured against the simulator like formations were |
| R6 | Round settlement pays twice on a concurrent tick | Medium | High | `settled_at` guard under `FOR UPDATE`, same pattern as `dw_store_battle` |
| R7 | The economy snowballs in practice despite simulation | Low | High | Ship the telemetry read (`round_matchups` + `match_players` are already the data), re-measure against real matches as M12 did |
| R8 | Visual 2.0 becomes a rabbit hole and blocks gameplay | **High** | Medium | It is the *last* milestone, is 1–3 characters, and the legacy renderer is never removed |
| R9 | Legacy single-battle games break | Low | **Critical** | `match_id IS NULL` path untouched; fingerprint test; every migration additive |
| R10 | Two-player matches are structurally boring | Medium | Medium | 6 rounds instead of 8 for two players; measure before shipping |
| R11 | Event modifiers reach the engine in an unaudited way | Medium | High | Events may only express themselves through the multiplier hooks that already exist |
| R12 | Scope creep — the brief is 14 systems | **High** | High | Strict milestone gating; nothing starts until the previous one is reported and approved |

---

## THE QUESTION: how does this attach with minimum breakage?

Five load-bearing answers.

**1. A round is a `games` row with `characters_per_player = 1`.** The auction
engine — reserve rule, pass rule, clock reset, race handling, termination,
recycling, force-assignment — needs *no change whatsoever*. This is the single
largest piece of S8 and it is already written and already tested.

**2. A matchup is a `BattleResult` in the format that already exists.** Written
to a new column on a new table rather than reshaping `games.battle_result`, so
`toReplay` → `sceneAt` → `BattleRenderer` do not change and every stored match on
disk keeps rendering.

**3. Pairwise combat is a bug fix, not just a feature.** The arena has always
been two-sided; three or more teams overlap sprites today. S8's matchmaking puts
the renderer inside the shape it was built for.

**4. The match state machine reuses `dw_tick` and timestamp deadlines.** No new
transport, no worker, no host authority, no websocket dependency.

**5. Everything is additive and gated by `match_id`.** A room that never starts
an S8 match plays exactly today's game, byte for byte.

The genuinely new code is: a match/round owner, a pairing function, a settlement
function, a board model, an event model, and the UI for them. That is a lot — but
it is *beside* the engine rather than *inside* it.

---

## MILESTONES

Each ends with: tests, typecheck, build, mutation tests, performance, legacy
fingerprint, `git diff`, changed files, bugs found. **No commits. No migration
run against the live database. No milestone starts without approval.**

| # | Milestone | Deliverable | Migration | Risk |
| --- | --- | --- | --- | --- |
| **S8.1** | Match skeleton | `matches` + `match_players`; `dw_start_match`; credits/HP carry across rounds; round counter advances with a stub round. **No auction, no combat, no UI beyond a debug panel.** | 0030 | Low |
| **S8.2** | Round auction | A round is a `games` row with `characters_per_player = 1`, credits debited from `match_players`; mandatory R1–R5, optional R6–R8; pool validation. Existing auction UI reused verbatim. | 0030 (extend) | Low |
| **S8.3** | Matchmaking | Pure pairing function + `round_matchups`; pairings published before combat; encounter and bracket kinds. **No combat yet.** | 0031 | Low |
| **S8.4** | Board & bench | `board_slots`, placement UI at 375 px, renderer reads the board. **Zero gameplay effect**, asserted. | 0032 | Low |
| **S8.5** | Round combat | `simulateBattle` per matchup, stored, replayed; watch-fight for other pairings; per-round odds persisted. | 0031 (extend) | Medium |
| **S8.6** | Damage, rewards, elimination | `dw_settle_round`; the §6 economy; catch-up mechanics; 10k-match economy test. | 0031 (extend) | Medium |
| **S8.7** | Positioning affects combat | Position modifiers in the axis pipeline; ±10% cap; `RULES_VERSION` → 2. | none | **High** |
| **S8.8** | Event system | Ten cards, six with decisions; `round_events`; deterministic resolution and replay. | 0033 | Medium |
| **S8.9** | Championship & match results | R8 bracket, final presentation, champion / MVP / best draft / biggest upset. | 0031 (extend) | Low |
| **S8.10** | Social room & mobile polish | Live HP/credit rail, round progress, next match, spectate any pairing; 375/390/414 pass. | 0034 | **High** (snapshot) |
| **S8.11** | Visual engine 2.0 PoC | `CharacterVisualDefinition`, `visualVersion`, 1–3 next-gen characters coexisting with legacy. | none | Medium |

Recommended stopping point for a first playable end-to-end match: **S8.6.**
Everything after that is depth, and the brief's real goal — *"what should I do
this round?"* — is already answered by S8.2 (a buy that must last), S8.4 (a
board to arrange) and S8.6 (an HP total that can be lost).

---

## PART 15 — S8.2 AS BUILT: ROUND AUCTION AND MATCH ECONOMY

Written after the milestone rather than before it, so it describes what runs.

### 15.1 Economy authority (decision A′)

A match's money lives in `match_players.credits` and nowhere else. There is no
synchronisation with `players.credits`, no round-boundary transfer, and no path
in either direction — not when a round ends, not when a match is abandoned, not
when a room returns to the lobby.

Two accessors hold the whole decision:

```sql
dw_bid_credits(game_id, player_id)           -- games.match_id is null ? players : match_players
dw_debit_credits(game_id, player_id, amount) -- the same branch, for the write
```

`dw_place_bid` and `dw_resolve_auction` keep their exact logic, lock order and
error codes; only their credit reads and writes changed. The alternative — two
balances kept in step at round boundaries — was rejected because a
synchronisation that is missed once is a stale balance, and a stale balance is
a double spend. The project already settled this argument for `profiles.coins`,
which is written inside one function under one row lock for the same reason.

The browser reads the right wallet through `src/lib/client/economy.ts`, which
performs no arithmetic at all: it picks a number the server already sent. A
client that works out a balance for itself is a client that offers a MAX button
the server will reject.

### 15.2 Acquisition rules

| Round | Acquisitions | Passing |
| --- | --- | --- |
| 1–5 | exactly 1, mandatory | blocked when supply equals demand (the existing rule) |
| 6–8 | at most 1, optional | always allowed |

"At most one per round" needed no new rule. A round's draft is a `games` row
with `characters_per_player = 1`, so `dw_slots_remaining` returns zero after the
first purchase and the second bid is refused as `ROSTER_FULL` by machinery that
predates S8 entirely.

### 15.3 Auction lifecycle

```
ROUND_START
  └─ advance ──► AUCTION
                   ├─ dw_start_round_auction(room, seed, queue)
                   │    games row: match_id, round_no, characters_per_player = 1
                   │    rooms.current_game_id points at it, so the existing
                   │    auction UI and snapshot pick it up unchanged
                   ├─ dw_place_bid / dw_pass_auction   (unchanged rules)
                   ├─ dw_resolve_auction               (debit + record + board)
                   └─ dw_open_next_round_auction
                        demand = 0            → games.status = FINISHED
                        queue empty, optional → games.status = FINISHED
                        queue empty, required → recycle unsold, else FINISHED
                   ↓ dw_match_tick reports ROUND_AUCTION_COMPLETE
BOARD_UPDATE
```

`dw_open_next_auction` — the legacy draft's engine — is **not touched**. A round
gets its own opener beside it, because the legacy one ends a draft by flipping
the room to `TEAM_REVIEW` and a match must stay in `MATCH`.

The phase move out of `AUCTION` is made by the Node layer rather than by SQL, so
the phase-deadline table keeps living in exactly one file
(`src/lib/game/rounds.ts`). `dw_advance_match_phase` refuses to leave `AUCTION`
while the round's game is still `ACTIVE` (`AUCTION_INCOMPLETE`).

### 15.4 The consumed-character rule

A character can be won **once per match**. Enforced twice:

* the queue builder excludes everything in `match_acquisitions` before selecting,
* `unique (match_id, character_id)` refuses a duplicate at the database.

A pool filter is a good first line and a poor only line.

### 15.5 Deterministic pool

The round queue is built from `${match.seed}:${round}` — same match, same round,
same category, same starting pool, every time. Nothing is drawn at call time, so
a retry opens the same lots and a replay could reproduce them. What happens to
those characters is decided entirely by the people bidding.

### 15.6 The concurrent-advance fix

The S8.1 live test found six simultaneous host advances moving a match three
phases. The row lock was never the problem: each request read a phase that was
genuinely current when it read it, and advanced from there. What was missing is
any way to tell a decision from the same tap arriving twice.

`matches.phase_started_at` supplies it. Inside the lock:

* **clock path** (`p_player_id is null`) — a phase the match times may advance
  only once its deadline has passed. A phase with no deadline belongs to a
  subsystem; only `AUCTION` has one wired up, and its completion is checked
  separately. `COMBAT` and `FINAL_COMBAT` fall through to `noop` rather than
  being skipped silently, which is the seam S8.5 replaces.
* **manual path** — refused inside `dw_min_phase_dwell()` (one second) with
  `CONCURRENT_PHASE_ADVANCE`.

The losing request is told it lost. It is never reported as a success it did not
perform, so the UI can refetch instead of believing a stale screen.

### 15.7 Error semantics

| Code | Meaning |
| --- | --- |
| `CONCURRENT_PHASE_ADVANCE` | the phase only just started; refetch |
| `AUCTION_INCOMPLETE` | the round's draft is still running |
| `NO_MATCH` | the room is not playing a match |
| `MATCH_OVER` | the match has finished |
| `INVALID_TRANSITION` | the destination is not the derived successor |
| `POOL_EXHAUSTED` | the match has drafted its categories dry |

Existing auction codes (`BID_TOO_LOW`, `NOT_ENOUGH_CREDITS`, `RESERVE_REQUIRED`,
`ROSTER_FULL`, `MUST_BID`, `ALREADY_PASSED`, `ALREADY_HIGH_BIDDER`,
`AUCTION_CLOSED`, `TOO_FAST`) are unchanged in wording and meaning.

### 15.8 Replay metadata

`match_acquisitions` records every sale as it happens, inside the same
transaction and the same row lock as the debit: match, round, game, auction,
player, character, final price, seed, timestamp. It is both the consumed-set
authority and the record a replay will read, which is why it is one table rather
than two that can disagree.

### 15.9 Server authority

The client sends `BID { auctionId, amount }` and `PASS { auctionId }`. It sends
no character, no winner, no price, no credits, no round and no phase, and the
match verbs (`START_MATCH`, `ADVANCE_MATCH`, `ABANDON_MATCH`) carry no arguments
at all.

`amount` stays client-supplied deliberately. The server validates the phase, the
auction state, the deadline, the pass state, the minimum bid, affordability, the
reserve ceiling, the round quota and the rate limit before accepting it, and
then decides the price, the winner and the character itself. Replacing it with
server-chosen increments would cost the bluffing layer its expressiveness and
would require rewriting the auction core that all of this depends on.

### 15.10 Legacy compatibility

* `match_id is null` takes the original path in every replaced function.
* `dw_open_next_auction`, `dw_total_demand`, `dw_slots_remaining`,
  `dw_auction_is_dead`, `dw_start_game`, `dw_tick`, `dw_return_to_lobby` and
  `dw_snapshot` are untouched.
* `players.credits` is never written by a match.
* `RULES_VERSION` stays 1: positioning does not reach combat until S8.7.
* The legacy 268-character fingerprint is unchanged.
