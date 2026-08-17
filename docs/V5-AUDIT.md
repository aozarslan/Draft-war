# DRAFT WAR V5 — battle presentation audit

Milestone 1. No production code was modified to produce this.

The headline finding: **the replay already exists and is already persisted.**
`games.battle_result` holds the complete simulation output, including a
time-stamped event log, and the current battle screen already replays it from a
server timestamp so every phone stays frame-aligned. V5 does not need a replay
system built — it needs the existing event stream enriched with four missing
facts, and a renderer pointed at it.

---

## 1. Current battle architecture (as built in V1–V4)

```
tickRoom(roomId)                         src/lib/server/engine.ts
  └─ "NEEDS_BATTLE" → runBattle(roomId)
       ├─ getSnapshot(roomId)            players, rosters, formations, map, event
       ├─ getCharacters()                full catalog (for crossover bands)
       ├─ simulateBattle({…})            src/lib/game/battle.ts — pure, seeded
       │    seed = `${game.seed}:${game.gameNo}`
       └─ dw_store_battle(gameId, result)
            ├─ games.battle_result = <the whole result as jsonb>
            ├─ games.battle_started_at = now()
            ├─ games.phase_deadline = now() + durationMs
            ├─ rooms.phase = 'BATTLE'
            ├─ battle_results row (winner, mvp, standings, combatants)
            └─ season standings on players
```

Then, on every client:

```
BattleStage.tsx  →  reads snapshot.game.battleResult + battleStartedAt
                 →  elapsed = serverNow() - battleStartedAt
                 →  shows every log entry whose atMs <= elapsed
```

Four properties of this that matter enormously for V5:

* **The simulation runs once, on the server, and is stored.** No client ever
  simulates. `dw_store_battle` takes `FOR UPDATE` and returns `noop` if a
  result already exists, so a second tick cannot produce a second battle.
* **Playback is already deterministic and already synchronised.** Every entry
  carries `atMs`, and every client renders against the same server
  `battle_started_at`. Two phones show the same hit at the same moment today.
* **The result is immutable once written.** Nothing in the codebase updates
  `battle_result` after the fact.
* **`simulateBattle` is a pure function of its inputs** (`createRng("battle:" +
  seed)`), so the same game re-simulates identically — but V5 will not need to,
  because the output is stored.

### Where formations and maps enter

Both affect the *numbers*, before the fight:

```
projectAxes(character)          crossover normalisation
  → applyFormation(axes)        formations.ts    ±4% on two axes
  → × environmentMultiplier()   map + event card
  → − event stat drain          CHAOS-type events
  → axes used by the round loop
```

Neither appears in the event log. The renderer can be *told* the formation
(it is on `players.formation` and already in the snapshot and the public match
payload) but cannot see which hit was bigger *because of* the map.

---

## 2. What battle data already exists

`BattleResult` (`src/lib/game/types.ts`), stored whole in `games.battle_result`:

| Field | Renderer use |
| --- | --- |
| `seed`, `mapId`, `eventId`, `categoryIds` | arena selection, determinism |
| `log[]` | **the event stream** |
| `durationMs` | total playback length |
| `teams[]` | rank, points, survivors, totalDamage, remainingHpPct, winProbability, teamRating, synergies |
| `combatants[]` | per character: damageDealt, damageTaken, kills, specials, survived, survivalPct, performance, price, valueScore |
| `winnerPlayerId` | victory screen |
| `upset` | dramatic presentation |
| `turningPoint` | `{round, phase, from, to, text}` — camera emphasis |
| `mvp` | `{playerId, characterId, expected, actual, performance}` |

`BattleLogEntry`:

```ts
{ round, atMs, kind, text, actorId?, actorTeamId?, targetId?, targetTeamId?, damage? }
kind: ROUND_START | PHASE | ATTACK | CRIT | SPECIAL | BLOCK
    | ELIMINATION | TURNING_POINT | END
```

**`actorId` is a `characterId`, and that is safe as an instance key.**
`team_characters` carries `unique (game_id, character_id)`, so a character
appears at most once in a battle. V5 needs no new combatant-instance concept.

### Mapping the existing kinds onto the V5 taxonomy

| V5 event | Status |
| --- | --- |
| ATTACK | **exists** |
| CRITICAL_HIT | **exists** (`CRIT`) |
| ABILITY | **exists** (`SPECIAL`, carries the ability name in `text`) |
| HIT | implicit in ATTACK/CRIT/SPECIAL — every one carries `damage` |
| KO | **exists** (`ELIMINATION`) |
| VICTORY | **exists** (`END`) |
| MVP | **exists**, on the result rather than the log |
| MISS / DODGE | **do not exist** — the engine has no whiff; `BLOCK` is a 70% reduction, not a miss |
| SPAWN, MOVE, KNOCKBACK, STUN, HEAL, STATUS_* | **do not exist** — the engine has no positions, no movement and no status effects |

This is the honest shape of it: the engine is a **damage-exchange simulation,
not a spatial one**. There are no coordinates anywhere in it.

---

## 3. What is missing for visual replay

Only four things, and one of them is the important one.

### (a) `maxHp` per combatant — **the blocking gap**

A health bar needs a denominator. `maxHp` is computed inside `simulateBattle`
as `round(70 + defense × 1.55 + power × 0.45)` **from the projected axes** —
after crossover normalisation, formation, map and event drain. The renderer
cannot recompute it without duplicating the whole projection pipeline, which is
exactly the "second source of truth" V5 forbids.

Without it, a renderer can show damage numbers but not a health bar, and
cannot honestly show anybody at "30% health".

### (b) Initial positions / lanes

There are none, because the engine has no space. This is a **presentation
invention**, not missing data: the renderer assigns lanes from the roster order
and the chosen formation. That is legitimate — it decides nothing — but it must
be documented as decoration, because a player will read a frontline sprite as
meaningful.

### (c) `rulesVersion`

Not present. Needed so a replay stored today still renders correctly after the
engine is retuned. Cheap to add and impossible to backfill honestly, so the
sooner the better.

### (d) The log is not exposed on the public match page

`dw_public_match` returns `teams`, `combatants`, `mvp`, `turningPoint` and
`upset` — but **not `log`**. Milestone 10 needs one line changed there.

### Explicitly *not* missing

* **Determinism** — the stored log *is* the replay. No re-simulation.
* **Timing** — `atMs` on every entry, `durationMs` on the result.
* **Turning point / upset / MVP** — all three already computed and stored.
* **Formation** — already on the player row, already in both payloads.
* **Archetype for animation selection** — derivable client-side from the axes
  via the existing `archetypeOf()`, which the auction card already uses. No
  server change, no per-character authoring.

---

## 4. Recommended renderer

Current state: the frontend has **zero graphics dependencies**. The whole app
is `next`, `react`, `react-dom`, `@supabase/supabase-js`. `BattleStage` is DOM
and React today.

The scene V5 actually needs: **one background, up to 10 sprites, health bars,
a few particle bursts, camera shake, 10–20 seconds, mobile-first.**

| Option | Bundle (gz) | Fit |
| --- | --- | --- |
| **Canvas 2D, hand-rolled** | **0 KB** | Sprite-sheet blitting, tweens, a particle pool and a shaking camera are all first-party Canvas work. ~500 lines to own. Trivially performant at 10 sprites. Fully deterministic — no framework scheduler between the event stream and the frame. |
| PixiJS v8 | ~350–450 KB | WebGL batching, scene graph, filters. The batching solves a problem we do not have (10 sprites), and the filters are the only genuinely hard thing it buys. |
| Phaser 3 | ~1.2 MB | A game framework — scenes, input, physics, tilemaps, its own loop. We already have a game; we need a cutscene player. Most of it would be dead weight. |
| DOM/SVG | 0 KB | Works, but 60 fps sprite animation plus camera shake means fighting React reconciliation and layout on exactly the low-end phones we care about. |

**Recommendation: Canvas 2D, no new dependency.**

The reasoning is proportion. This app's entire JS payload is four packages;
adding 350 KB for a fifteen-second cutscene would be the single largest
dependency in the project, to accelerate a workload that a 2015 phone renders
without effort. Canvas 2D also keeps playback a pure function of
`(log, elapsed)` — the same property that makes the current battle screen stay
in sync across phones.

**What would change my mind**, stated in advance so it is a decision and not a
preference: if Milestone 8 (turning-point/upset cinematics) needs real-time
shader effects — bloom, displacement, palette warping — hand-rolled Canvas
stops being cheap and PixiJS becomes the right answer. That call belongs at
Milestone 8, not now, and switching is contained because the renderer sits
behind one adapter.

**No dependency should be installed for Milestone 2 or 3.**

---

## 5. Required database changes

Minimal. One migration, additive, and only one field is load-bearing.

```sql
-- 0028_battle_replay.sql  (Milestone 2)
```

1. **Nothing structural.** `games.battle_result` is `jsonb` and already stores
   the whole result; the new fields ride inside it. No new table, no new column
   for the replay itself.
2. **`dw_public_match`** — add `'log', v_result->'log'` so shared matches can
   be watched. One line.
3. **Optional, later:** a `battle_assets` table for provenance (§7). Not needed
   for Milestones 2–5; needed before any non-original artwork ships.

Old battles are the honest caveat: results stored before Milestone 2 will have
no `maxHp` and no `rulesVersion`. They should render with damage numbers and no
health bars rather than with guessed ones, and the adapter should say
`replayVersion: 0` for them.

---

## 6. Required API changes

Also minimal.

| Endpoint | Change |
| --- | --- |
| `GET /api/rooms/:code/state` | none — `battleResult` already travels whole |
| `GET /api/match/:gameId` | gains `result.log` once `dw_public_match` returns it |
| new | none |

No new route is needed for playback: the client already has the entire replay
in the snapshot it is polling.

---

## 7. Asset architecture

Three layers, none of which touch the existing `characters` table.

```
characters (268, existing, untouched)
      │  characterId
      ▼
character_visuals        characterId → archetype + optional overrides
      │  archetypeId
      ▼
animation_archetypes     humanoid_small | quadruped_large | flying | …
      │  spritesheet + frame ranges per clip
      ▼
sprite sheets            idle / move / attack / hit / ko / special
```

* **Archetype first, character second.** A character declares an archetype and
  optionally overrides one clip. Nothing branches on a character id.
* **Archetype is already derivable.** `archetypeOf()` reads a character's axes
  and returns TANK/ASSASSIN/SPEEDSTER/etc. today. Those are *combat* roles, not
  body plans, so V5 needs a second, visual mapping — but it can be seeded from
  category plus tags (`animals` → quadruped by mass, `marvel` → humanoid) and
  hand-corrected, rather than authored 268 times.
* **Fallbacks are mandatory, not a nicety.** Missing clip → archetype default;
  missing archetype → `humanoid_medium`; missing sheet entirely → the existing
  portrait with tween-only motion. **V5 must be playable when zero sprites
  exist**, or the pipeline cannot be validated before the art does.
* **Loading**: only the ≤10 characters in *this* battle, resolved from the log,
  lazily, with the sheet cached by archetype. The 268-character catalog never
  becomes 268 loaded sheets.

---

## 8. IP and provenance architecture

This has to be right before any artwork ships, because it cannot be
retrofitted onto assets whose origin nobody recorded.

```sql
battle_assets (
  asset_id, character_id, archetype_id,
  source_type,        -- ORIGINAL | PUBLIC_DOMAIN | LICENSED | USER_CREATED
  source_reference,   -- exact edition/version for public domain
  license_note, creator, version,
  approved boolean,   -- runtime loads only approved rows
  created_at
)
```

Rules this encodes:

* **The runtime loads only `approved` assets.** Generation is an offline
  content process; nothing is generated during a match.
* **Public domain means a specific version.** "Dracula" is public domain; a
  2004 film's Dracula is not. `source_reference` stores which one.
* **No scraping for sprites.** The existing Wikipedia integration fetches
  *portraits under their stated licence with attribution* and that stays as it
  is — but battle sprites are original artwork, not traced from it.
* **Licensed characters get a row shape that already fits**, so Marvel/DC
  artwork could later be dropped in without an engine change.

The current 268 characters carry Wikimedia portraits with licence metadata
already; that data should be carried into `battle_assets` as
`source_type = LICENSED` rows for portraits, keeping one place to answer "where
did this image come from".

---

## 9. V5 migration plan

| Milestone | Deliverable | Touches |
| --- | --- | --- |
| **1** | This audit | docs only |
| **2** | Replay adapter + the four missing facts | `battle.ts`, `types.ts`, one migration |
| **3** | Canvas renderer shell — loads a replay, plays it, no sprites | new `src/lib/render/*` |
| **4** | One complete archetype (`quadruped_medium`) end to end | assets + manifest |
| **5** | First playable 3v3 with 6 characters | renderer + fallbacks |
| **6** | Arena from existing `mapId`; formation lanes | maps.ts reuse |
| **7** | Interaction layer (synergy/rivalry) — visual only | render layer |
| **8** | Turning point + upset cinematics | render layer (PixiJS decision point) |
| **9** | MVP + result presentation | render layer |
| **10** | Replay on the public match page | `dw_public_match`, match page |
| **11** | Performance + mobile | profiling |

Sequencing constraint worth stating: **Milestone 2 must ship before any art is
commissioned.** If `maxHp` and `rulesVersion` land after sprites exist, every
replay recorded in between is permanently un-renderable.

---

## 10. Exact files to change in Milestone 2

Nothing here changes what the simulation *decides* — only what it *reports*.

| File | Change |
| --- | --- |
| `src/lib/game/types.ts` | `BattleLogEntry.kind` gains `SPAWN`; entry gains optional `hpAfter`, `maxHp`. `BattleResult` gains `rulesVersion: number` and `replayVersion: number`. `CombatantResult` gains `maxHp`. |
| `src/lib/game/battle.ts` | Emit one `SPAWN` per combatant at `atMs: 0` carrying `maxHp`; attach `hpAfter` to every damaging entry (the loop already has `target.hp` in hand); set `rulesVersion`. **The round loop, damage maths, RNG draws and ordering are untouched** — this is reporting, not simulation. |
| `src/lib/game/replay.ts` | *(new)* Pure adapter: `toReplay(result, context) → Replay`. Normalises the log into the V5 taxonomy, derives lanes from formation, resolves visual archetypes, and stamps `replayVersion`. Handles pre-V5 results by degrading rather than guessing. |
| `supabase/migrations/0028_battle_replay.sql` | `dw_public_match` returns `log`. No schema change. |
| `tests/replay.test.ts` | *(new)* See below. |

### Tests Milestone 2 adds

* A replay generated twice from one result is byte-identical.
* Event order is stable and `atMs` is monotonic.
* Every `ELIMINATION` is preceded by a `SPAWN` for that character.
* `hpAfter` never goes below zero and never exceeds `maxHp`.
* Summing damage per combatant reproduces `combatants[].damageDealt` exactly —
  this is the assertion that catches the renderer and the engine disagreeing.
* A pre-V5 result (no `maxHp`) yields `replayVersion: 0` and no health bars,
  rather than invented ones.
* **`toReplay` is pure**: the input `BattleResult` is deep-equal before and
  after, and the winner/MVP/ranks it reports match the input exactly.

### The 217 existing tests

**All 217 can remain untouched.** The Milestone 2 changes are additive: new
optional fields on existing interfaces and new log entries appended to a stream
nothing asserts the length of.

One existing test needs checking rather than changing —
`tests/battle.test.ts` asserts `result.log[0].kind === "PHASE"`. Adding
`SPAWN` entries at `atMs: 0` would break that assertion, so **spawns must be
appended after the opening phase marker, or that one assertion updated
deliberately**. It is called out here so the decision is made on purpose
instead of discovered as a red test.

---

## Confirmation

* The existing battle engine is not replaced.
* PostgreSQL remains authoritative; the renderer receives a finished result and
  decides nothing.
* No second source of truth is introduced — the replay is a *projection* of the
  stored result, generated by a pure function, and the tests above assert it
  cannot disagree with what the server recorded.
* No dependency is installed.
* No production code was modified to produce this audit.
