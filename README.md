# DRAFT WAR

**Build your team. Break the bank. Win the war.**

A real-time multiplayer drafting game for a group of friends. Four players join
one room from a shared link, bid against each other for characters with a fixed
budget, then their squads fight it out in a simulated battle. Rooms keep a
season leaderboard, so you can play round after round.

*5 players. 50 credits each. Draft 25 characters. Build the strongest 5-person team.*

**V2** adds a category system: pick Marvel, DC, Hollywood, Action Movies,
Animals, Fantasy, Video Games or Anime — or mix two for a crossover — and draft
from 268 characters with artwork, descriptions and licence data pulled from
Wikipedia and Wikimedia.

---

## Table of contents

1. [How the game plays](#how-the-game-plays)
2. [Architecture](#architecture)
3. [Database schema](#database-schema)
4. [Setup](#setup)
5. [Environment variables](#environment-variables)
6. [Running locally](#running-locally)
7. [Running the tests](#running-the-tests)
8. [Deploying to Vercel](#deploying-to-vercel)
9. [Adding characters](#adding-characters)
10. [Adding maps](#adding-maps)
11. [Adding event cards](#adding-event-cards)
12. [Development tools](#development-tools)
13. [Known limitations](#known-limitations)
14. [File map](#file-map)

---

## How the game plays

| Phase | What happens |
| --- | --- |
| `LOBBY` | Players join by link or 5-character code, pick a nickname, mark ready. The host starts. |
| `CATEGORY` | The host picks a category, everyone votes, or one is drawn at random with a reveal. Up to four can be mixed for a crossover. |
| `AUCTION` | Exactly `players × 5` characters go up one at a time on a 10-second clock. Bid `+1`, `+5`, `MAX`, or `PASS`. **Every bid puts the full 10 seconds back**, so a bidding war cannot be sniped. |
| `TEAM_REVIEW` | Every squad is revealed with its stats, synergy and what each fighter cost. |
| `MAP_SELECTION` | Three battlefields go to a vote. Each one buffs different tags. |
| `EVENT` | One event card is drawn and shown. It bends the rules for this battle only. |
| `BATTLE` | A round-by-round cinematic plays out, synchronised across every phone. |
| `RESULTS` | Champion, MVP, awards, value-for-money table, season standings. Play again. |

**The two rules that make the auction interesting**

* **The reserve rule.** You must keep 1 credit for every roster slot you still
  need. With 10 credits and 2 slots to fill, your ceiling is 9. The `MAX` button
  always shows exactly what that is.
* **The pass rule.** You may pass — unless the remaining characters exactly
  match the remaining roster slots, in which case somebody has to buy. The
  draft is sized to exactly `players × 5`, so in a standard game nothing ever
  goes unsold and every credit you overspend early is a credit you cannot spend
  later.

**The standard game (V2.1)**

| | |
| --- | --- |
| Players | 2–5, default **5** |
| Credits each | **50** |
| Roster | **5** characters |
| Draft pool | `players × 5` — **25** for five players |
| Bid clock | **10 seconds**, reset in full by every bid |

The host sets the room size (2–5) in the lobby; credits and roster size are
fixed for now, and the plumbing is in place to open them up later. The game
pool is drawn once, server-side, after the category is settled and before the
first character opens — the client never sees the wider category pool and
cannot influence which characters were drawn.

---

## Categories (V2)

Eight categories, each owning three things: the stats its characters are rated
on, how those stats feed the five axes the battle engine fights with, and the
synergy groups that reward a coherent squad.

| Category | Characters | Stats |
| --- | --- | --- |
| 🦸 Marvel | 50 | Power · Speed · Durability · Combat · Intelligence · Special |
| 🦇 DC | 50 | Power · Speed · Durability · Combat · Intelligence · Special |
| 🎬 Hollywood | 40 | Strength · Speed · Combat · Weapons · Tactics · Stamina |
| 🔫 Action Movies | 30 | Combat · Speed · Weapons · Tactics · Durability · Special |
| 🐅 Animals | 30 | Mass · Strength · Speed · Bite · Defense · Aggression |
| 🧙 Fantasy | 24 | Power · Speed · Durability · Combat · Magic · Special |
| 🎮 Video Games | 22 | Power · Speed · Durability · Combat · Skill · Special |
| 🍥 Anime | 22 | Power · Speed · Durability · Combat · Intelligence · Special |

**Canonical axes.** The simulator never reads a category stat key. Each category
projects its own ratings onto five axes — power, speed, defense, strategy,
special — which is what lets a tiger, an actor and a Norse god share a
battlefield without a single special case in the engine.

**Crossover normalisation.** Mixing categories rescales every character from its
own category's combat-value distribution onto one shared band, so the best
Hollywood actor and the best Kryptonian arrive at the same effective ceiling.
Single-category games use the authored numbers untouched.

**Game power is not decorative.** The 0–100 number on every card is derived from
the same quantity the round loop fights with — damage output multiplied by
survivability — so a higher number really is a better fighter. The win
probability is fitted against the simulator rather than guessed; see
`winProbabilities` in `src/lib/game/battle.ts`.

**Synergy** is named on the results screen (Avengers ×5, Pack Hunters ×3) and
capped at +10%, so it flavours a draft without deciding it.

---

## Wikipedia / Wikimedia integration

`src/lib/server/wikipedia.ts` is a small client over the documented MediaWiki
APIs — REST search, REST page summary, and the Action API for `pageimages` and
`imageinfo`. No HTML scraping.

Three rules it enforces:

1. **A real User-Agent.** Wikimedia's policy asks for a contact; a UA without
   one gets throttled within a handful of requests.
2. **No hammering.** Calls are serialised with a minimum gap and back off on
   429/5xx, honouring `Retry-After`.
3. **Cache.** Nothing calls Wikimedia during a match. The pool is enriched
   offline into `data/wiki-cache.json`, which is committed, and the SQL seed is
   generated from it.

**Images are never re-hosted.** We store the Wikimedia thumbnail URL plus
whatever licence and author metadata Wikimedia reports, and show it as
attribution under the card. When a licence is not reported we say where the
image came from without implying anything about reuse. 250 of 268 characters
have an image; the rest are articles that carry only non-free cover art, which
the Wikimedia APIs correctly refuse to serve — those get a generated placeholder
rather than a broken image.

**Wrong-subject protection.** A fictional character whose name is also a common
noun quietly resolves to the wrong page: Wolverine is an animal, Magneto is a
machine, Thor is a Norse god. A name check cannot catch this, so the enrichment
script checks the *subject* of the resolved page and re-searches with the
universe attached when it does not look like fiction.

---

## Architecture

```
Browser (Next.js client)
  │
  │  1. mutations  ── POST /api/rooms/:code/action ──► Route Handler
  │                                                     │ service-role key
  │                                                     ▼
  │                                              Postgres function
  │                                              (row locks, validation)
  │                                                     │
  │  2. "something changed"  ◄── Supabase Realtime ─────┘ (rooms.state_version)
  │
  └─ 3. refetch ── GET /api/rooms/:code/state ──► dw_snapshot() ──► one JSON blob
```

**Why this shape.** Vercel has no long-lived process, so there is nowhere to run
a game loop. Three decisions follow from that:

1. **Postgres is the game server.** Every mutation is a `plpgsql` function that
   takes a row lock, re-validates from scratch and writes the result. Two players
   tapping `BID` at the same millisecond are serialised by the lock: the second
   transaction sees the first one's committed bid and is rejected with
   *"Someone else placed a higher bid."* There is no window in which two clients
   both believe they are winning.

2. **Timers are timestamps, not processes.** An auction stores `ends_at`. Each
   client renders a countdown against a server-clock offset, and when it hits
   zero it calls `?tick=1`. `dw_tick` applies whatever the clock owes — resolve
   the auction, lock in the map, start the battle — and it is idempotent, so
   four clients firing at once produce exactly one outcome. This is also why a
   host disconnect cannot stall the game: *any* client drives the clock.

3. **Realtime is a doorbell, not a data channel.** The browser's anon key can
   only read `rooms`, `chat_messages` and `characters`. When anything changes,
   `rooms.state_version` is bumped, the client hears about it and refetches the
   authoritative snapshot through our own API using the service-role key. If the
   websocket dies, a polling fallback takes over and the game keeps working.

**Anti-cheat.** The client is never trusted. Credits, roster size, turn state,
timers and character availability are re-derived server-side on every action.
Identity is a `(playerId, token)` pair minted at join time; the token lives in a
table with no anon-readable policy, and requests carry it as a header. The body
of a request never names a player — you can only ever act as yourself. Editing
`credits` in devtools changes a number on your screen and nothing else.

**Where the logic lives.** `src/lib/game/` is framework-free and side-effect
free: the auction rules, the battle simulator, the character pool, maps and
events. It has no React and no database imports, which is what makes it
testable. The auction rules exist in two places on purpose — TypeScript for the
UI (so impossible buttons are greyed out before any round trip) and plpgsql for
the authoritative decision. `tests/auction.test.ts` documents the contract both
sides implement.

**Determinism.** Auction order, map candidates, the event draw and the battle all
run through a seeded RNG whose seed is stored on the game row. Any battle can be
replayed byte-for-byte, which is what the tests rely on.

---

## Database schema

All tables have Row Level Security enabled. Only `rooms`, `chat_messages` and
`characters` are readable with the anon key (Realtime needs to read the first
two; the third is static reference data). Everything else is reachable only
through the server.

| Table | Purpose |
| --- | --- |
| `rooms` | Code, phase, config JSON, host, `state_version` change counter |
| `players` | Seat, colour, ready flag, credits, season W/L/points |
| `player_secrets` | Session token per player. No anon policy — never exposed |
| `characters` | The pool. Stats, tags, rarity, palette. Seeded from TypeScript |
| `games` | One round: seed, auction queue, map, event, battle result |
| `auctions` | One character on the block: current bid, high bidder, `ends_at` |
| `bids` | Full bid history |
| `auction_passes` | Who has passed on which character |
| `team_characters` | Who owns what, and what they paid |
| `map_votes` | Battlefield ballot |
| `chat_messages` | Chat, reactions and system messages |
| `game_events` | Append-only game log (sold, unsold, battlefield, …) |
| `battle_results` | Stored standings, MVP and per-character performance |
| `leaderboard` | View over the season columns on `players` |
| `profiles` | The persistent player: username, avatar, level, XP, coins |
| `profile_secrets` | Session token per profile. No anon policy |
| `profile_stats` | Lifetime record, untouched by a season reset |
| `seasons` / `season_players` | 45-day seasons and their rank points |
| `xp_transactions` | Immutable XP ledger, unique per (profile, match, kind) |
| `coin_transactions` | Immutable coin ledger, unique per (profile, kind, reference) |
| `match_history` | One row per profile per finished match |
| `catalog_items` | Every cosmetic: avatar, frame, banner, title. Public read |
| `profile_items` | Who owns what. No anon policy |
| `shop_rotations` | The 24-hour featured window. Public read, server-only write |
| `achievements` | The catalog: one metric, one threshold, one reward. Public read |
| `profile_achievements` | Who has unlocked what. No anon policy |
| `challenge_templates` | The task pool. Public read |
| `challenge_periods` | A day or a week, with the tasks live in it. Public read |
| `profile_challenges` | Assignment, baseline and progress. No anon policy |

None of the progression tables has an anon policy, so the browser cannot read
or write coins, XP or rank at all — every number the UI shows was fetched by
our own server on the service role. `profiles.coins` is a cache of
`coin_transactions`; both are written inside one function under a row lock, so
they cannot drift, and a repeated payout is refused by the unique index rather
than merely being unlikely.

**Coins are not credits.** Auction credits are minted at the start of a match,
spent inside it and destroyed at the end. Coins persist and buy cosmetics.
Nothing converts between them in either direction, which is what keeps the shop
off the battlefield.

**Cosmetics are only cosmetic.** An item carries a name, a rarity, a price and
a bag of colours — there is no field it could use to touch a stat, a credit or
a bid, and a test asserts that no payload ever grows one. Ownership is a row in
`profile_items`; `dw_equip_item` checks it before writing the slot, so the worst
a forged request can do is ask to wear something it does not own and be told no.

**A challenge is the same thing measured as a delta.** When one is assigned,
the profile's current value for its metric is snapshotted as a baseline, so
"win 2 matches today" needs no new counter anywhere — progress is whatever has
happened since. The server assigns them before a match is banked, so a player
who never opens the profile page still gets credit for playing.

**An achievement is a metric against a threshold**, and every metric is derived
by `dw_profile_metrics` from match history, the coin ledger and the inventory —
nothing a client reports about itself is ever an input. The unlock row is
inserted before the rewards are paid, so evaluating twice pays once, which is
why evaluation runs after every match, purchase and daily claim.

**A purchase is atomic.** `dw_buy_item` takes the coins and grants the item
inside one subtransaction, so "coins deducted but item missing" is not a state
this database can reach — a failure in either half rolls back the other and
still returns a structured error rather than a 500. The browser sends an item
id and nothing else: the price, the discount and whether the rotation is even
running are all decided server-side.

Key functions: `dw_create_room`, `dw_join_room`, `dw_set_ready`,
`dw_heartbeat` (also migrates a dead host), `dw_start_game`, `dw_place_bid`,
`dw_pass_auction`, `dw_resolve_auction`, `dw_open_next_auction`,
`dw_advance_phase`, `dw_vote_map`, `dw_lock_battlefield`, `dw_store_battle`,
`dw_return_to_lobby`, `dw_tick`, `dw_snapshot`, `dw_send_chat`.

Progression functions: `dw_create_profile`, `dw_link_player_profile`,
`dw_award_match`, `dw_profile`, `dw_leaderboard`, `dw_award_coins`,
`dw_spend_coins`, `dw_award_match_coins`, `dw_claim_daily`, `dw_coin_ledger`,
`dw_grant_item`, `dw_grant_defaults`, `dw_equip_item`, `dw_inventory`,
`dw_current_rotation`, `dw_item_price`, `dw_buy_item`, `dw_shop`,
`dw_profile_metrics`, `dw_evaluate_achievements`, `dw_achievements`,
`dw_current_period`, `dw_sync_challenges`, `dw_claim_challenge`,
`dw_daily_ladder`, `dw_claim_daily`.

---

## Setup

### 1. Clone and install

```bash
npm install
```

### 2. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a free project, and wait for
it to finish provisioning.

### 3. Run the migrations

Open **SQL Editor** in the Supabase dashboard and run these two files, in order:

1. `supabase/migrations/0001_init.sql` — schema, RLS policies, game functions
2. `supabase/migrations/0002_seed_characters.sql` — the original V1 pool
3. `supabase/migrations/0003_v2_categories.sql` — categories, the richer
   character columns, the category phase and the 30-second bidding clock
4. `supabase/migrations/0004_seed_v2_characters.sql` — 268 characters with
   Wikipedia data
5. `supabase/migrations/0005_v2_1_five_players.sql` — five-player rooms, the
   host's room-size control and the V2.1 defaults
6. `supabase/migrations/0006_reserve_pool.sql` — the reserve pool that makes
   PASS a real move and stops a draft ending with an unfilled roster
7. `supabase/migrations/0007_profiles_progression.sql` — profiles, XP, levels,
   rank points, seasons and match history
8. `supabase/migrations/0008_coins.sql` — the coin economy and its ledger
9. `supabase/migrations/0009_inventory.sql` — cosmetic inventory and equipping
10. `supabase/migrations/0010_seed_items.sql` — the cosmetic catalog
    (generated from `src/lib/game/items.ts` by `npm run seed:items`)
11. `supabase/migrations/0011_shop.sql` — the shop, its 24-hour rotation and
    atomic purchases
12. `supabase/migrations/0012_achievements.sql` — achievements and the metrics
    they are measured against
13. `supabase/migrations/0013_seed_achievements.sql` — the achievement catalog
    (generated from `src/lib/game/achievements.ts` by `npm run seed:achievements`)
14. `supabase/migrations/0014_challenges.sql` — daily and weekly challenges and
    the seven-day login ladder
15. `supabase/migrations/0015_seed_challenges.sql` — the challenge catalog
    (generated from `src/lib/game/challenges.ts` by `npm run seed:challenges`)

Run them in order. **Upgrading an existing V1 database?** Run 0003 onwards — they are additive, and the twenty V1 characters are migrated into the
new shape and retired from drafting rather than deleted, so finished games keep
rendering.

`0004_seed_v2_characters.sql` is ~230 KB, which some browsers dislike pasting
into the SQL editor in one go. `supabase/migrations/0004_parts/` holds the same
seed split into five smaller files — run them in any order, each is a
self-contained idempotent upsert. Use either the single file or the parts, not
both.

Paste the whole file, press **Run**, confirm it reports success, then do the
second one. Re-running them later is safe: the schema uses `if not exists` /
`create or replace`, and the seed is an upsert.

If you prefer the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 4. Enable Realtime

Migration `0001` already adds `rooms` and `chat_messages` to the
`supabase_realtime` publication. To confirm: **Database → Publications →
supabase_realtime** should list both tables.

### 5. Environment variables

```bash
cp .env.example .env.local
```

Fill in the three values from **Project Settings → API**.

---

## Environment variables

| Variable | Where it is used | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser only | Realtime subscription. RLS-limited to reads |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Bypasses RLS. Never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_DRAFT_WAR_DEV` | Browser, optional | `1` shows the dev tool panel |
| `DRAFT_WAR_DEV_KEY` | Server, optional | Lets `/api/dev` answer in production |

The service-role key is only ever imported by files under `src/app/api/`, all of
which are server-only route handlers.

---

## Running locally

```bash
npm run dev
```

Useful scripts:

```bash
npm run wiki:enrich   # refresh Wikipedia data into data/wiki-cache.json
npm run seed:sql      # regenerate the character seed migration
npm run balance       # print the game-power spread of every category
```

Open <http://localhost:3000>. To play against yourself, open the room link in a
normal window plus an incognito window — sessions are stored per browser
profile, so each one gets its own seat.

Other scripts:

```bash
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run seed:sql    # regenerate the character seed migration from TypeScript
```

---

## Running the tests

```bash
npm test
```

43 tests covering the parts where a bug would ruin a game night:

* **Auction** — the reserve rule, bid validation in the order the spec defines,
  simultaneous bids, the anti-snipe extension, the pass rule, early resolution,
  roster sizing for 2/3/4 players, and all three auction orders.
* **Battle** — pool balance (no dominant character), map and event modifiers,
  synergy, the win-probability model, determinism from a seed, the 3/2/1/0
  points table, MVP selection, value scores, and a monotonic playback timeline.

The database functions were verified separately against a real PostgreSQL
instance: a full 4-player game from room creation to leaderboard, plus two
racing sessions bidding the same amount at the same instant (exactly one is
accepted) and four clients ticking an expired auction at once (exactly one
award). Those scripts are not part of the repo because they need a live
database; the behaviour they check is mirrored by the unit tests above.

---

## Deploying to Vercel

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project**, import the repo. The framework is detected
   automatically; no build settings to change.
3. Under **Environment Variables**, add the three Supabase values for
   *Production*, *Preview* and *Development*.
4. Deploy.
5. Send the room link to your friends.

Do **not** set `NEXT_PUBLIC_DRAFT_WAR_DEV` or `DRAFT_WAR_DEV_KEY` in production
unless you want the dev tools reachable — without them, `/api/dev` returns 404.

---

## Adding characters

Everything about the pool lives in one file.

1. Add an entry to `CHARACTERS` in `src/lib/game/characters.ts`.
2. Run `npm run seed:sql` to regenerate
   `supabase/migrations/0002_seed_characters.sql`.
3. Run that migration again in Supabase. It is an upsert, so existing rows are
   updated in place and games already stored are untouched.

```ts
{
  id: "nova-kestrel",              // stable, kebab-case, never reused
  name: "Nova Kestrel",
  title: "The Skyline",
  universe: "ACTION",              // free-form grouping; nothing branches on it
  rarity: "EPIC",
  power: 90, speed: 88, defense: 84, tactics: 92, special: 88,
  specialAbility: "Freefall Entry",
  tags: ["mobility", "ranged"],    // drives map + event modifiers
  basePrice: 9,                    // displayed market value, not the floor
  palette: ["#0ea5e9", "#f472b6"], // used by the generated artwork
}
```

**Balance guidance.** Keep the five stats summing to roughly 440–455 and vary
the *shape* instead of the total, so characters differ by role rather than by
raw strength. `tests/battle.test.ts` asserts the band and that no character
dominates another on every stat.

**Artwork.** Characters render as generated posters derived from their id and
palette, so there are no image assets to ship or license. Set `imageUrl` on a
character to use a real picture instead — nothing else changes.

**Renaming the starter pool.** The 20 shipped characters are original
action-movie archetypes rather than copies of existing film characters. If you
want different names, edit `name` and `title` here and regenerate — no other
file refers to them.

**Bigger or smaller pools.** The pool size and characters-per-player come from
the room config. With more than 20 characters the extras simply are not
auctioned unless you raise `poolSize`.

---

## Adding maps

Append to `MAPS` in `src/lib/game/maps.ts`. Maps are read from TypeScript at
runtime, so no migration is needed.

```ts
{
  id: "rooftops",
  name: "ROOFTOPS",
  description: "Twelve storeys up, one wrong step.",
  modifiers: [{ tag: "mobility", bonus: 0.06 }],  // +6% to that tag
  palette: ["#1e1b4b", "#f0abfc"],
  icon: "🏢",
}
```

Tags nobody carries are ignored, so you can introduce a new tag on a map and a
new character in the same change.

---

## Adding event cards

Append to `EVENT_CARDS` in `src/lib/game/events.ts`. Reusing an existing `kind`
needs no engine change at all:

* `TAG_BONUS` — `tag` + signed `amount` (`0.1` = +10%, `-0.1` = −10%)
* `FIRST_STRIKE_FASTEST` — the fastest squad opens harder in round 1
* `DOUBLE_MAP_MODIFIERS` — map bonuses count twice
* `RANDOM_STAT_DRAIN` — each squad loses part of one random stat

A genuinely new effect means adding a `kind` to `EventEffectKind` in
`src/lib/game/types.ts` and handling it in `simulateBattle`.

---

## Development tools

Set `NEXT_PUBLIC_DRAFT_WAR_DEV=1` in `.env.local` to get a 🛠 panel in the
bottom-left of any room:

* **Add bot** — drops an extra ready player into the lobby so you can test 3–4
  player games alone
* **Skip auction** — fills every roster at the minimum price and jumps to team
  review
* **Force battle** — locks a map, draws an event and runs the simulation now
* **Reset** — wipes the room's games and season stats back to a fresh lobby

The endpoint behind these (`/api/dev`) returns 404 in production unless
`DRAFT_WAR_DEV_KEY` is set and sent as an `x-dw-dev-key` header.

---

## Troubleshooting

**"Invalid path specified in request URL"** — `NEXT_PUBLIC_SUPABASE_URL` has a
path on it. It must be the bare project URL (`https://<ref>.supabase.co`), not
the REST endpoint the dashboard also displays. Fix the variable, then
**redeploy** — see below.

**Changing an environment variable does nothing** — Vercel does not rebuild when
you edit a variable, and `NEXT_PUBLIC_*` values are baked into the client bundle
at build time. After any change, trigger a new deployment:

```bash
vercel redeploy https://your-app.vercel.app
```

**"The character pool is empty"** — migration `0002_seed_characters.sql` has not
been run. Run it in the Supabase SQL editor.

**The connection pill says SYNCING instead of LIVE** — Realtime is not
subscribing, and the game has fallen back to polling (still playable). Check
that `rooms` and `chat_messages` are in the `supabase_realtime` publication, and
look in the browser console for a `[DRAFT WAR] Realtime disabled` warning.

---

## Known limitations

* **Room codes are not rationed.** Anyone who guesses a 5-character code can join
  a lobby that has not started yet. With ~33 million combinations and a room that
  is only joinable while it is in the lobby, this is fine for a game night; add a
  PIN if you want more.
* **No spectators.** Watching without a seat is not implemented. The phase
  components already take a read-only snapshot, so this is mostly a UI change.
* **A player who leaves mid-game keeps their squad.** There is no takeover or
  drop-out handling; their team still fights, controlled by nobody. Host
  privileges *do* migrate automatically after ~25 seconds of silence.
* **Clock progress needs at least one client.** Deadlines are applied when a
  client calls `?tick=1`. If every phone closes the tab at once, the auction
  freezes until somebody comes back — at which point it resolves correctly. A
  Vercel Cron hitting the tick endpoint would close this gap.
* **`PLAY AGAIN` and `RETURN TO LOBBY` were the same action**, so the results
  screen ships one button instead of two.
* **Chat has no moderation** beyond a 5-messages-per-5-seconds rate limit and a
  240-character cap.
* **Reactions are chat messages**, not floating animations over the auction.
* **The battle is watched, not played.** That is the design — the decisions all
  happen in the auction — but there are no in-battle choices.
* **Manual auction order** is supported by the engine and config but has no UI
  yet; the host would have to set `manualOrder` in the room config.
* **A deliberately mono-category squad in a crossover can be strong.** With the
  pool shuffled from both categories the winners' rosters come out evenly
  spread (a test asserts it), but if a player somehow drafted five characters
  from one side on a map that happens to favour their tags, that squad has an
  edge. Normalisation equalises the categories, not every map interaction.
* **18 characters have no image**, because their Wikipedia article carries only
  non-free cover art. They render a generated placeholder that says so.
* **The admin importer saves bulk imports with neutral stats** (60 across the
  board); they need editing afterwards to be interesting.
* **Game power is comparable within a category, not across them.** Hollywood
  tops out around 83 and DC around 92 because the underlying ratings really are
  different; crossover games normalise it away, single-category games never
  need to.

---

## File map

```
draft-war/
├── README.md
├── .env.example
├── next.config.ts · postcss.config.mjs · tsconfig.json · package.json
│
├── supabase/migrations/
│   ├── 0001_init.sql              Schema, RLS, and every game function
│   └── 0002_seed_characters.sql   Generated from the TypeScript pool
│
├── scripts/
│   └── generate-character-sql.ts  npm run seed:sql
│
├── src/lib/game/                  Pure game logic — no React, no database
│   ├── types.ts                   Domain types, phases, room config
│   ├── characters.ts              The 20-character pool + helpers
│   ├── maps.ts                    Battlefields and their modifiers
│   ├── events.ts                  Event cards
│   ├── colors.ts                  Seat colours
│   ├── rng.ts                     Seeded deterministic RNG
│   ├── auction.ts                 Auction rules (mirrored by the SQL)
│   └── battle.ts                  Battle simulator, synergy, win probability
│
├── src/lib/server/
│   ├── engine.ts                  Snapshot, tick orchestration, battle running
│   └── session.ts                 Token identity, room codes, auth guard
│
├── src/lib/supabase/
│   ├── admin.ts                   Service-role client (server only)
│   └── browser.ts                 Anon client (Realtime only)
│
├── src/lib/client/
│   ├── useRoom.ts                 Realtime + polling + clock driver + actions
│   ├── api.ts                     Typed fetch wrappers
│   ├── session.ts                 localStorage identity
│   └── sound.ts                   WebAudio effects, no audio files
│
├── src/app/
│   ├── layout.tsx · globals.css   Shell and visual identity
│   ├── page.tsx                   Landing: create / join
│   ├── room/[code]/page.tsx       Room route
│   └── api/
│       ├── rooms/route.ts             POST create room
│       ├── rooms/join/route.ts        POST join room
│       ├── rooms/[code]/state/route.ts   GET snapshot (+ ?tick=1)
│       ├── rooms/[code]/action/route.ts  POST every mutation
│       └── dev/route.ts               Development-only shortcuts
│
├── src/components/
│   ├── RoomClient.tsx             Phase router, header, join gate
│   ├── Lobby.tsx · AuctionStage.tsx · TeamReview.tsx
│   ├── MapSelection.tsx · EventReveal.tsx · BattleStage.tsx
│   ├── ResultsStage.tsx · PlayerRail.tsx · ChatPanel.tsx
│   ├── Leaderboard.tsx · CharacterArt.tsx · DevPanel.tsx
│   └── ui.tsx                     Panel, Countdown, StatBar, Toasts, states
│
└── tests/
    ├── auction.test.ts            25 tests
    └── battle.test.ts             18 tests
```

---

Characters and statistics in this game are fictional and exist for gameplay
balance only. They are not claims about any real person.
