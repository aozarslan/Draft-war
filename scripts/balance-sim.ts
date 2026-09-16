/**
 * scripts/balance-sim.ts
 * Monte Carlo balance simulator — 100 matches (50×3-player + 50×5-player).
 *
 * Bot strategy: always buy the highest-game_power character not yet owned.
 * Deterministic: seed = "balance-3p-NNN" / "balance-5p-NNN".
 *
 * Run with:  npx tsx scripts/balance-sim.ts
 */

import { CHARACTERS } from "../src/lib/game/characters";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import {
  STARTING_HP,
  BOARD_CAPACITY,
  STANDARD_MATCH_ROUNDS,
  clampHp,
  nextPhaseOf,
} from "../src/lib/game/rounds";
import {
  fightingBoardOf,
  buildDuelInput,
  outcomeOf,
  type BoardSlot,
  type CombatContext,
} from "../src/lib/game/combat";
import { pairRound, type PairRoundInput } from "../src/lib/game/matchmaking";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOTAL_ROUNDS = STANDARD_MATCH_ROUNDS; // 8
const MATCH_COUNT_EACH = 50; // per player-count variant

const CATEGORY_SETS: Record<number, string[]> = {
  3: ["marvel", "dc", "football"],
  5: ["marvel", "dc", "football", "basketball", "animals"],
};
const CATEGORY_IDS_3 = CATEGORY_SETS[3];
const CATEGORY_IDS_5 = CATEGORY_SETS[5];

// ---------------------------------------------------------------------------
// Pre-computed pools (sorted DESC by game_power — bot always grabs index 0)
// ---------------------------------------------------------------------------

const BANDS = computeAxisBands(CHARACTERS);
const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

// Pool per category, sorted highest game_power first.
// The bot pops from the front of its pool each round.
const POOL_BY_CAT: Record<string, string[]> = {};
for (const cat of Object.values(CATEGORY_SETS).flat()) {
  if (POOL_BY_CAT[cat]) continue;
  POOL_BY_CAT[cat] = CHARACTERS
    .filter((c) => c.categoryId === cat)
    .sort((a, b) => b.gamePower - a.gamePower || a.id.localeCompare(b.id))
    .map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlayerSim {
  id: string;
  nickname: string;
  category: string;
  seat: number;
  hp: number;
  eliminatedAt: number | null;
  roundWins: number;
  /** Next index into POOL_BY_CAT[category] to buy. */
  buyIndex: number;
}

interface DamageEvent {
  roundNo: number;
  damage: number;
}

interface MatchResult {
  seed: string;
  playerCount: number;
  endedAtRound: number;
  earlyFinish: boolean;
  /** HP of the match champion (highest HP among survivors). */
  winnerFinalHp: number;
  /** How many players ended with exactly STARTING_HP (never took damage). */
  noDamageCount: number;
  /** Was the R2 HP leader the eventual match champion? null if 1 survived to R2. */
  r2LeaderWon: boolean | null;
  /** All damage events across the match, for per-round stats. */
  damageEvents: DamageEvent[];
  /** Byes granted per round (for 3-player: usually 1 per round). */
  byesPerRound: number[];
  /** Final HP of each player. */
  finalHps: number[];
  /** Number of eliminations that occurred. */
  elimCount: number;
}

// ---------------------------------------------------------------------------
// Board helpers (mirrors dw_record_acquisition re-rank logic)
// ---------------------------------------------------------------------------

function rerankBoard(slots: BoardSlot[], playerId: string): void {
  const owned = slots.filter((s) => s.playerId === playerId);
  owned.sort(
    (a, b) =>
      (BY_ID[b.characterId]?.gamePower ?? 0) - (BY_ID[a.characterId]?.gamePower ?? 0) ||
      a.characterId.localeCompare(b.characterId),
  );
  owned.forEach((s, i) => {
    s.zone = i < BOARD_CAPACITY ? "FRONT" : "BENCH";
    s.slot = i;
  });
}

function addAndRerank(slots: BoardSlot[], playerId: string, characterId: string): void {
  if (slots.some((s) => s.playerId === playerId && s.characterId === characterId)) return;
  const existing = slots.filter((s) => s.playerId === playerId).length;
  slots.push({ playerId, characterId, zone: "BENCH", slot: existing });
  rerankBoard(slots, playerId);
}

function fightingBoard(slots: BoardSlot[], playerId: string) {
  const priceMap = new Map(
    slots
      .filter((s) => s.playerId === playerId)
      .map((s, i) => [s.characterId, i + 1]),
  );
  return fightingBoardOf(slots, playerId, (id) => priceMap.get(id));
}

// ---------------------------------------------------------------------------
// Single match simulation
// ---------------------------------------------------------------------------

function simulateMatch(playerCount: 3 | 5, seed: string): MatchResult {
  const categorySet = CATEGORY_SETS[playerCount];
  const categoryIds = playerCount === 3 ? CATEGORY_IDS_3 : CATEGORY_IDS_5;

  const players: PlayerSim[] = categorySet.map((cat, i) => ({
    id: `p${i}`,
    nickname: `P${i}(${cat})`,
    category: cat,
    seat: i,
    hp: STARTING_HP,
    eliminatedAt: null,
    roundWins: 0,
    buyIndex: 0,
  }));

  // Track which indices have been used per category so different players
  // using the same category don't duplicate picks. (In our setup they don't
  // share categories, but guard anyway.)
  const catBuyIndex: Record<string, number> = {};
  for (const cat of categorySet) catBuyIndex[cat] = 0;

  const boardSlots: BoardSlot[] = [];
  const history: { roundNo: number; playerA: string; playerB: string | null }[] = [];
  const damageEvents: DamageEvent[] = [];
  const byesPerRound: number[] = [];
  const realIds = new Set(players.map((p) => p.id));

  let r2HpLeaderId: string | null = null;
  let endedAtRound = TOTAL_ROUNDS;
  let earlyFinish = false;

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    // ── AUCTION: bot buys highest-power available ─────────────────────────
    for (const p of players) {
      if (p.eliminatedAt !== null) continue;
      const pool = POOL_BY_CAT[p.category];
      // Skip already-owned (shouldn't happen with per-player index, but guard)
      while (
        p.buyIndex < pool.length &&
        boardSlots.some(
          (s) => s.playerId === p.id && s.characterId === pool[p.buyIndex],
        )
      ) {
        p.buyIndex++;
      }
      if (p.buyIndex < pool.length) {
        addAndRerank(boardSlots, p.id, pool[p.buyIndex]);
        p.buyIndex++;
      }
    }

    // ── MATCHMAKING ───────────────────────────────────────────────────────
    const pairingInput: PairRoundInput = {
      matchSeed: seed,
      roundNo: round,
      seats: players.map((p) => ({
        playerId: p.id,
        seat: p.seat,
        hp: p.hp,
        eliminatedAt: p.eliminatedAt,
        board: boardSlots
          .filter((s) => s.playerId === p.id)
          .map((s) => BY_ID[s.characterId]?.gamePower ?? 0),
      })),
      history,
    };
    const pairings = pairRound(pairingInput);

    let byesThisRound = 0;
    for (const pair of pairings) {
      history.push({ roundNo: round, playerA: pair.playerA, playerB: pair.playerB });
      if (pair.playerB === null) { byesThisRound++; continue; }
    }
    byesPerRound.push(byesThisRound);

    // ── COMBAT ────────────────────────────────────────────────────────────
    for (const [pi, pairing] of pairings.entries()) {
      if (pairing.playerB === null) continue;

      const pA = players.find((p) => p.id === pairing.playerA)!;
      const pB = players.find((p) => p.id === pairing.playerB)!;

      const ctx: CombatContext = {
        matchSeed: seed,
        roundNo: round,
        pairingIndex: pi,
        categoryIds,
        charactersById: BY_ID,
        bands: BANDS,
      };

      const built = buildDuelInput(
        ctx,
        { playerId: pA.id, nickname: pA.nickname, board: fightingBoard(boardSlots, pA.id) },
        { playerId: pB.id, nickname: pB.nickname, board: fightingBoard(boardSlots, pB.id) },
      );
      if (!built.ok) continue;

      const result = simulateBattle(built.input);
      const outcome = outcomeOf(result, round, realIds);

      if (outcome.loserPlayerId) {
        const loser = players.find((p) => p.id === outcome.loserPlayerId)!;
        loser.hp = clampHp(loser.hp - outcome.damage, round);
        damageEvents.push({ roundNo: round, damage: outcome.damage });
        if (outcome.winnerPlayerId) {
          const winner = players.find((p) => p.id === outcome.winnerPlayerId)!;
          winner.roundWins++;
        }
        if (loser.hp <= 0 && loser.eliminatedAt === null) {
          loser.eliminatedAt = round;
        }
      }
    }

    // ── Capture R2 HP leader ──────────────────────────────────────────────
    if (round === 2) {
      const alive = players.filter((p) => p.eliminatedAt === null && p.hp > 0);
      if (alive.length > 1) {
        const maxHp = Math.max(...alive.map((p) => p.hp));
        const leaders = alive.filter((p) => p.hp === maxHp);
        // Tie → pick by playerId (deterministic)
        r2HpLeaderId = leaders.sort((a, b) => a.id.localeCompare(b.id))[0].id;
      }
    }

    // ── ROUND_END: early-finish check ─────────────────────────────────────
    const live = players.filter((p) => p.eliminatedAt === null && p.hp > 0);
    const next = nextPhaseOf("ROUND_END", {
      roundNo: round,
      totalRounds: TOTAL_ROUNDS,
      liveCount: live.length,
    });

    if (next === "CHAMPIONSHIP") {
      endedAtRound = round;
      earlyFinish = live.length < 2;
      break;
    }
  }

  // ── Result assembly ───────────────────────────────────────────────────────
  const alive = players.filter((p) => p.eliminatedAt === null && p.hp > 0);
  const winnerFinalHp = alive.length > 0
    ? Math.max(...alive.map((p) => p.hp))
    : 0;

  const noDamageCount = players.filter((p) => p.hp === STARTING_HP).length;
  const finalHps = players.map((p) => p.hp);
  const elimCount = players.filter((p) => p.eliminatedAt !== null).length;

  let r2LeaderWon: boolean | null = null;
  if (r2HpLeaderId !== null) {
    const leader = players.find((p) => p.id === r2HpLeaderId)!;
    // "Won" = survived to the end with the highest HP among survivors
    const survived = players.filter((p) => p.eliminatedAt === null && p.hp > 0);
    if (survived.length > 0) {
      const maxSurvivorHp = Math.max(...survived.map((p) => p.hp));
      const champions = survived.filter((p) => p.hp === maxSurvivorHp);
      r2LeaderWon = champions.some((p) => p.id === r2HpLeaderId);
    } else {
      r2LeaderWon = false;
    }
  }

  return {
    seed,
    playerCount,
    endedAtRound,
    earlyFinish,
    winnerFinalHp,
    noDamageCount,
    r2LeaderWon,
    damageEvents,
    byesPerRound,
    finalHps,
    elimCount,
  };
}

// ---------------------------------------------------------------------------
// Run all matches
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(72)}`);
console.log(`  DRAFT WAR — MONTE CARLO BALANCE SIMULATION`);
console.log(`  ${MATCH_COUNT_EACH}×3-player + ${MATCH_COUNT_EACH}×5-player = ${MATCH_COUNT_EACH * 2} matches`);
console.log(`  Bot: always buy highest game_power | Rounds: ${TOTAL_ROUNDS} | HP: ${STARTING_HP}`);
console.log(`${"═".repeat(72)}\n`);

const allResults: MatchResult[] = [];

process.stdout.write("  Running 3-player matches... ");
for (let i = 0; i < MATCH_COUNT_EACH; i++) {
  allResults.push(simulateMatch(3, `balance-3p-${String(i + 1).padStart(3, "0")}`));
}
console.log("done.");

process.stdout.write("  Running 5-player matches... ");
for (let i = 0; i < MATCH_COUNT_EACH; i++) {
  allResults.push(simulateMatch(5, `balance-5p-${String(i + 1).padStart(3, "0")}`));
}
console.log("done.\n");

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(1)}%`;
}
function fmt1(n: number): string { return n.toFixed(1); }
function fmt0(n: number): string { return Math.round(n).toString(); }

// ---------------------------------------------------------------------------
// Compute and print metrics by player-count variant
// ---------------------------------------------------------------------------

for (const playerCount of [3, 5] as const) {
  const results = allResults.filter((r) => r.playerCount === playerCount);
  const N = results.length;
  const label = `${playerCount}-PLAYER (${N} matches)`;
  const SEP = "─".repeat(72);

  console.log(`\n${"═".repeat(72)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(72)}`);

  // a) Round distribution
  const endRounds = results.map((r) => r.endedAtRound);
  const roundCounts: Record<number, number> = {};
  for (const r of endRounds) roundCounts[r] = (roundCounts[r] ?? 0) + 1;

  console.log(`\n  a) Round distribution (when match ended):`);
  console.log(`     ${"Round".padEnd(8)} ${"Count".padStart(6)}  ${"Share".padStart(8)}`);
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    const n = roundCounts[r] ?? 0;
    if (n === 0) continue;
    const bar = "█".repeat(Math.round(n / N * 20));
    console.log(`     R${r}       ${String(n).padStart(6)}  ${pct(n, N).padStart(8)}  ${bar}`);
  }
  const earlyCount = results.filter((r) => r.earlyFinish).length;
  console.log(`     liveCount<2 early exit: ${earlyCount} / ${N} (${pct(earlyCount, N)})`);

  // b) Eliminations
  const elimCounts = results.map((r) => r.elimCount);
  const elimDist: Record<number, number> = {};
  for (const e of elimCounts) elimDist[e] = (elimDist[e] ?? 0) + 1;
  console.log(`\n  b) Eliminations per match:`);
  console.log(`     avg=${fmt1(avg(elimCounts))}  min=${Math.min(...elimCounts)}  max=${Math.max(...elimCounts)}`);
  console.log(`     Distribution: ` + Object.entries(elimDist)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k} elim: ${v} (${pct(v, N)})`)
    .join("  |  "));

  // c) Winner final HP
  const winnerHps = results.map((r) => r.winnerFinalHp);
  console.log(`\n  c) Winner final HP:`);
  console.log(`     avg=${fmt1(avg(winnerHps))}  min=${Math.min(...winnerHps)}  max=${Math.max(...winnerHps)}`);
  // Distribution buckets: 1-20, 21-40, 41-60, 61-80
  const buckets = [
    [1, 20], [21, 40], [41, 60], [61, 80],
  ];
  for (const [lo, hi] of buckets) {
    const n = winnerHps.filter((hp) => hp >= lo && hp <= hi).length;
    console.log(`     HP ${String(lo).padStart(2)}–${String(hi).padStart(2)}: ${String(n).padStart(3)} (${pct(n, N)})`);
  }

  // d) No-damage players
  const totalPlayers = results.reduce((sum, r) => sum + r.playerCount, 0);
  const noDamagePlayers = results.reduce((sum, r) => sum + r.noDamageCount, 0);
  console.log(`\n  d) Players who took zero damage:`);
  console.log(`     ${noDamagePlayers} / ${totalPlayers} players (${pct(noDamagePlayers, totalPlayers)}) ended at full HP ${STARTING_HP}`);

  // e) Snowball: R2 HP leader wins
  const r2Applicable = results.filter((r) => r.r2LeaderWon !== null);
  const r2Wins = r2Applicable.filter((r) => r.r2LeaderWon === true).length;
  const r2Pct = r2Applicable.length > 0
    ? ((r2Wins / r2Applicable.length) * 100).toFixed(1)
    : "n/a";
  console.log(`\n  e) Snowball — R2 HP leader wins the match:`);
  console.log(`     ${r2Wins} / ${r2Applicable.length} (${r2Pct}%)`);

  // f) Damage per round
  console.log(`\n  f) Damage per round:`);
  console.log(`     ${"Round".padEnd(8)} ${"Fights".padStart(7)} ${"Avg dmg".padStart(9)} ${"Min".padStart(5)} ${"Max".padStart(5)}`);
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    const events = results.flatMap((m) => m.damageEvents.filter((e) => e.roundNo === r));
    if (events.length === 0) continue;
    const damages = events.map((e) => e.damage);
    console.log(
      `     R${r}       ${String(events.length).padStart(7)}` +
      `  ${fmt1(avg(damages)).padStart(8)}` +
      `  ${Math.min(...damages).toString().padStart(5)}` +
      `  ${Math.max(...damages).toString().padStart(5)}`,
    );
  }

  // g) Early finish count (already printed in a, reiterate clearly)
  console.log(`\n  g) Early-finish matches (liveCount<2 before R${TOTAL_ROUNDS}):`);
  console.log(`     ${earlyCount} / ${N} (${pct(earlyCount, N)})`);
  if (earlyCount > 0) {
    const earlyRounds = results.filter((r) => r.earlyFinish).map((r) => r.endedAtRound);
    const earlyDist: Record<number, number> = {};
    for (const r of earlyRounds) earlyDist[r] = (earlyDist[r] ?? 0) + 1;
    console.log(`     At which round: ` + Object.entries(earlyDist)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, v]) => `R${k}: ${v}`)
      .join("  |  "));
  }

  // h) Byes per round (3-player specific)
  if (playerCount === 3) {
    const byeTotals: Record<number, number> = {};
    for (const r of results) {
      r.byesPerRound.forEach((count, i) => {
        const rno = i + 1;
        byeTotals[rno] = (byeTotals[rno] ?? 0) + count;
      });
    }
    console.log(`\n  h) 3-player: byes per round (total across ${N} matches):`);
    console.log(`     ${"Round".padEnd(8)} ${"Total byes".padStart(12)} ${"Avg/match".padStart(12)}`);
    for (let r = 1; r <= TOTAL_ROUNDS; r++) {
      const total = byeTotals[r] ?? 0;
      console.log(
        `     R${r}       ${String(total).padStart(12)}` +
        `  ${fmt1(total / N).padStart(12)}`,
      );
    }
    console.log(`     → Every 3-player round has exactly 1 bye (3 live → 1 fight + 1 bye).`);
  }
}

// ---------------------------------------------------------------------------
// Combined summary
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(72)}`);
console.log(`  COMBINED SUMMARY (all ${allResults.length} matches)`);
console.log(`${"═".repeat(72)}`);
const allWinnerHps = allResults.map((r) => r.winnerFinalHp);
const allElims = allResults.map((r) => r.elimCount);
const allEarlyFinish = allResults.filter((r) => r.earlyFinish).length;
const allNoDmg = allResults.reduce((s, r) => s + r.noDamageCount, 0);
const allPlayerTotal = allResults.reduce((s, r) => s + r.playerCount, 0);
const allR2 = allResults.filter((r) => r.r2LeaderWon !== null);
const allR2Wins = allR2.filter((r) => r.r2LeaderWon === true).length;

console.log(`  Winner HP avg/min/max : ${fmt1(avg(allWinnerHps))} / ${Math.min(...allWinnerHps)} / ${Math.max(...allWinnerHps)}`);
console.log(`  Eliminations avg      : ${fmt1(avg(allElims))}`);
console.log(`  Early finish          : ${allEarlyFinish} / ${allResults.length} (${pct(allEarlyFinish, allResults.length)})`);
console.log(`  No-damage players     : ${allNoDmg} / ${allPlayerTotal} (${pct(allNoDmg, allPlayerTotal)})`);
console.log(`  Snowball (R2→win)     : ${allR2Wins} / ${allR2.length} (${((allR2Wins / allR2.length) * 100).toFixed(1)}%)`);
console.log(`\n${"═".repeat(72)}\n`);
