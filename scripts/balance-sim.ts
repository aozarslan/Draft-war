/**
 * scripts/balance-sim.ts
 * Monte Carlo balance simulator — 100 matches per (HP × playerCount) combination.
 * Ghost fights are active: odd-seat rounds fight a deterministic copy of a live
 * player's board instead of getting a free bye.
 *
 * HP ∈ {50, 60, 70, 80} × players ∈ {2, 3, 4, 5} = 16 combinations × 100 matches.
 *
 * Run with:  npx tsx scripts/balance-sim.ts
 */

import { createRng } from "../src/lib/game/rng";
import { CHARACTERS } from "../src/lib/game/characters";
import { computeAxisBands, simulateBattle } from "../src/lib/game/battle";
import {
  BOARD_CAPACITY,
  STANDARD_MATCH_ROUNDS,
  clampHp,
  nextPhaseOf,
} from "../src/lib/game/rounds";
import {
  fightingBoardOf,
  buildDuelInput,
  outcomeOf,
  ghostSeedFor,
  GHOST_PLAYER_PREFIX,
  type BoardSlot,
  type CombatContext,
} from "../src/lib/game/combat";
import { pairRound, type PairRoundInput } from "../src/lib/game/matchmaking";

// ---------------------------------------------------------------------------
// Sweep parameters
// ---------------------------------------------------------------------------

const HP_VALUES = [50, 60, 70, 80] as const;
const PLAYER_COUNTS = [2, 3, 4, 5] as const;
const TOTAL_ROUNDS = STANDARD_MATCH_ROUNDS; // 8
const MATCH_COUNT = 100; // per combination

// ---------------------------------------------------------------------------
// Category sets
// ---------------------------------------------------------------------------

const CATEGORY_SETS: Record<number, string[]> = {
  2: ["marvel", "dc"],
  3: ["marvel", "dc", "football"],
  4: ["marvel", "dc", "football", "basketball"],
  5: ["marvel", "dc", "football", "basketball", "animals"],
};

// ---------------------------------------------------------------------------
// Pre-computed pools (sorted DESC by game_power — bot always grabs index 0)
// ---------------------------------------------------------------------------

const BANDS = computeAxisBands(CHARACTERS);
const BY_ID = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

const POOL_BY_CAT: Record<string, string[]> = {};
for (const cats of Object.values(CATEGORY_SETS)) {
  for (const cat of cats) {
    if (POOL_BY_CAT[cat]) continue;
    POOL_BY_CAT[cat] = CHARACTERS
      .filter((c) => c.categoryId === cat)
      .sort((a, b) => b.gamePower - a.gamePower || a.id.localeCompare(b.id))
      .map((c) => c.id);
  }
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
  buyIndex: number;
}

interface DamageEvent {
  roundNo: number;
  damage: number;
}

interface MatchResult {
  seed: string;
  playerCount: number;
  startingHp: number;
  endedAtRound: number;
  earlyFinish: boolean;
  winnerFinalHp: number;
  noDamageCount: number;
  r2LeaderWon: boolean | null;
  damageEvents: DamageEvent[];
  finalHps: number[];
  elimCount: number;
  /** Round when the first elimination happened, or null if none. */
  firstEliminationRound: number | null;
}

// ---------------------------------------------------------------------------
// Board helpers
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
// Ghost player selection (mirrors combat.ts pickGhostPlayerId, not exported)
// ---------------------------------------------------------------------------

function pickGhost(
  matchSeed: string,
  roundNo: number,
  pairingIndex: number,
  candidates: string[],
): string {
  const sorted = [...candidates].sort();
  return createRng(ghostSeedFor(matchSeed, roundNo, pairingIndex)).shuffle(sorted)[0];
}

// ---------------------------------------------------------------------------
// Single match simulation
// ---------------------------------------------------------------------------

function simulateMatch(
  playerCount: 2 | 3 | 4 | 5,
  seed: string,
  startingHp: number,
): MatchResult {
  const categorySet = CATEGORY_SETS[playerCount];
  const categoryIds = categorySet;

  const players: PlayerSim[] = categorySet.map((cat, i) => ({
    id: `p${i}`,
    nickname: `P${i}(${cat})`,
    category: cat,
    seat: i,
    hp: startingHp,
    eliminatedAt: null,
    roundWins: 0,
    buyIndex: 0,
  }));

  const boardSlots: BoardSlot[] = [];
  const history: { roundNo: number; playerA: string; playerB: string | null }[] = [];
  const damageEvents: DamageEvent[] = [];
  const realIds = new Set(players.map((p) => p.id));

  let r2HpLeaderId: string | null = null;
  let endedAtRound = TOTAL_ROUNDS;
  let earlyFinish = false;
  let firstEliminationRound: number | null = null;

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    // ── AUCTION: bot buys highest-power available ─────────────────────────
    for (const p of players) {
      if (p.eliminatedAt !== null) continue;
      const pool = POOL_BY_CAT[p.category];
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

    for (const pair of pairings) {
      history.push({ roundNo: round, playerA: pair.playerA, playerB: pair.playerB });
    }

    // ── COMBAT ────────────────────────────────────────────────────────────
    for (const [pi, pairing] of pairings.entries()) {
      const pA = players.find((p) => p.id === pairing.playerA)!;

      const ctx: CombatContext = {
        matchSeed: seed,
        roundNo: round,
        pairingIndex: pi,
        categoryIds,
        charactersById: BY_ID,
        bands: BANDS,
      };

      if (pairing.playerB === null) {
        // ── GHOST FIGHT ──────────────────────────────────────────────────
        const candidates = players
          .filter((p) => p.eliminatedAt === null && p.hp > 0 && p.id !== pA.id)
          .map((p) => p.id);

        if (candidates.length === 0) continue;

        const ghostRealId = pickGhost(seed, round, pi, candidates);
        const ghostBoard = fightingBoard(boardSlots, ghostRealId);
        const byeBoard = fightingBoard(boardSlots, pA.id);

        if (byeBoard.length === 0 || ghostBoard.length === 0) continue;

        const built = buildDuelInput(
          ctx,
          { playerId: pA.id, nickname: pA.nickname, board: byeBoard },
          { playerId: GHOST_PLAYER_PREFIX + ghostRealId, nickname: `ghost:${ghostRealId}`, board: ghostBoard },
        );
        if (!built.ok) continue;

        const result = simulateBattle(built.input);
        const outcome = outcomeOf(result, round, realIds);

        // Ghost owner's HP is never touched. Only bye player can take damage.
        if (outcome.loserPlayerId === pA.id) {
          pA.hp = clampHp(pA.hp - outcome.damage, round);
          damageEvents.push({ roundNo: round, damage: outcome.damage });
          if (pA.hp <= 0 && pA.eliminatedAt === null) {
            pA.eliminatedAt = round;
            if (firstEliminationRound === null) firstEliminationRound = round;
          }
        } else if (outcome.winnerPlayerId === pA.id) {
          pA.roundWins++;
        }
        continue;
      }

      // ── REAL DUEL ────────────────────────────────────────────────────────
      const pB = players.find((p) => p.id === pairing.playerB)!;

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
          players.find((p) => p.id === outcome.winnerPlayerId)!.roundWins++;
        }
        if (loser.hp <= 0 && loser.eliminatedAt === null) {
          loser.eliminatedAt = round;
          if (firstEliminationRound === null) firstEliminationRound = round;
        }
      }
    }

    // ── R2: capture HP leader ─────────────────────────────────────────────
    if (round === 2) {
      const alive = players.filter((p) => p.eliminatedAt === null && p.hp > 0);
      if (alive.length > 1) {
        const maxHp = Math.max(...alive.map((p) => p.hp));
        const leaders = alive.filter((p) => p.hp === maxHp);
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
  const noDamageCount = players.filter((p) => p.hp === startingHp).length;
  const finalHps = players.map((p) => p.hp);
  const elimCount = players.filter((p) => p.eliminatedAt !== null).length;

  let r2LeaderWon: boolean | null = null;
  if (r2HpLeaderId !== null) {
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
    startingHp,
    endedAtRound,
    earlyFinish,
    winnerFinalHp,
    noDamageCount,
    r2LeaderWon,
    damageEvents,
    finalHps,
    elimCount,
    firstEliminationRound,
  };
}

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

// ---------------------------------------------------------------------------
// Run all 16 combinations
// ---------------------------------------------------------------------------

type ComboKey = `hp${number}_p${number}`;
const results = new Map<ComboKey, MatchResult[]>();

for (const hp of HP_VALUES) {
  for (const pc of PLAYER_COUNTS) {
    const key: ComboKey = `hp${hp}_p${pc}`;
    const batch: MatchResult[] = [];
    process.stdout.write(`  HP=${hp} ${pc}p ... `);
    for (let i = 0; i < MATCH_COUNT; i++) {
      batch.push(simulateMatch(
        pc as 2 | 3 | 4 | 5,
        `bal-hp${hp}-${pc}p-${String(i + 1).padStart(3, "0")}`,
        hp,
      ));
    }
    results.set(key, batch);
    console.log(`done (${batch.length} matches)`);
  }
}

// ---------------------------------------------------------------------------
// Per-combination summary helper
// ---------------------------------------------------------------------------

interface ComboStats {
  hp: number;
  pc: number;
  elimAvg: number;
  elimGt0Pct: number;        // % matches with ≥1 elimination
  firstElimAvgRound: number | null;
  winnerHpAvg: number;
  winnerHpMin: number;
  winnerHpMax: number;
  winnerHpPct: number;       // winner HP as % of starting
  earlyFinishPct: number;    // % ending before R8
}

function computeStats(hp: number, pc: number): ComboStats {
  const key: ComboKey = `hp${hp}_p${pc}`;
  const batch = results.get(key)!;
  const N = batch.length;

  const elimCounts = batch.map((r) => r.elimCount);
  const elimGt0 = batch.filter((r) => r.elimCount > 0).length;

  const firstElimRounds = batch
    .map((r) => r.firstEliminationRound)
    .filter((r): r is number => r !== null);

  const winnerHps = batch.map((r) => r.winnerFinalHp);
  const earlyCount = batch.filter((r) => r.earlyFinish).length;

  return {
    hp,
    pc,
    elimAvg: avg(elimCounts),
    elimGt0Pct: (elimGt0 / N) * 100,
    firstElimAvgRound: firstElimRounds.length > 0 ? avg(firstElimRounds) : null,
    winnerHpAvg: avg(winnerHps),
    winnerHpMin: Math.min(...winnerHps),
    winnerHpMax: Math.max(...winnerHps),
    winnerHpPct: (avg(winnerHps) / hp) * 100,
    earlyFinishPct: (earlyCount / N) * 100,
  };
}

// ---------------------------------------------------------------------------
// Print detailed results per HP block
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(80)}`);
console.log(`  DRAFT WAR — GHOST-ACTIVE BALANCE SIMULATION`);
console.log(`  ${MATCH_COUNT} matches × 4 player-counts × 4 HP values = ${MATCH_COUNT * 16} total matches`);
console.log(`  Bot: highest game_power | Ghost fights active (odd-seat rounds)`);
console.log(`${"═".repeat(80)}`);

// Target profile reminder
console.log(`
  Target profile:
    - ≥50% of matches have at least 1 elimination
    - First elimination on average R6-R7
    - Winner finishes at 30-60% of starting HP
    - Player-count should not dominate outcome (ghost normalises odd seats)
`);

for (const hp of HP_VALUES) {
  console.log(`\n${"─".repeat(80)}`);
  console.log(`  HP = ${hp}`);
  console.log(`${"─".repeat(80)}`);
  console.log(
    `  ${"Players".padEnd(9)}` +
    `${"Elim/match".padStart(12)}` +
    `${"≥1 elim".padStart(10)}` +
    `${"1st elim R".padStart(12)}` +
    `${"Win HP avg".padStart(12)}` +
    `${"Win HP %".padStart(10)}` +
    `${"Early end".padStart(11)}`,
  );
  console.log(`  ${"─".repeat(74)}`);
  for (const pc of PLAYER_COUNTS) {
    const s = computeStats(hp, pc);
    const firstStr = s.firstElimAvgRound !== null ? fmt1(s.firstElimAvgRound) : "none";
    console.log(
      `  ${String(pc).padEnd(9)}` +
      `${fmt1(s.elimAvg).padStart(12)}` +
      `${(s.elimGt0Pct.toFixed(1) + "%").padStart(10)}` +
      `${firstStr.padStart(12)}` +
      `${(fmt1(s.winnerHpAvg) + ` (${s.winnerHpMin}–${s.winnerHpMax})`).padStart(12)}` +
      `${(s.winnerHpPct.toFixed(1) + "%").padStart(10)}` +
      `${(s.earlyFinishPct.toFixed(1) + "%").padStart(11)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cross-player consistency check (ghost validation)
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(80)}`);
console.log(`  GHOST VALIDATION: 3p vs 5p gap (should be small with ghost active)`);
console.log(`${"═".repeat(80)}`);
console.log(
  `  ${"HP".padEnd(6)}` +
  `${"3p elim%".padStart(10)}` +
  `${"5p elim%".padStart(10)}` +
  `${"gap".padStart(8)}` +
  `${"3p winHP%".padStart(12)}` +
  `${"5p winHP%".padStart(12)}` +
  `${"gap".padStart(8)}`,
);
console.log(`  ${"─".repeat(64)}`);
for (const hp of HP_VALUES) {
  const s3 = computeStats(hp, 3);
  const s5 = computeStats(hp, 5);
  const elimGap = Math.abs(s3.elimGt0Pct - s5.elimGt0Pct);
  const hpGap = Math.abs(s3.winnerHpPct - s5.winnerHpPct);
  console.log(
    `  ${String(hp).padEnd(6)}` +
    `${(s3.elimGt0Pct.toFixed(1) + "%").padStart(10)}` +
    `${(s5.elimGt0Pct.toFixed(1) + "%").padStart(10)}` +
    `${(elimGap.toFixed(1) + "pp").padStart(8)}` +
    `${(s3.winnerHpPct.toFixed(1) + "%").padStart(12)}` +
    `${(s5.winnerHpPct.toFixed(1) + "%").padStart(12)}` +
    `${(hpGap.toFixed(1) + "pp").padStart(8)}`,
  );
}

// ---------------------------------------------------------------------------
// Markdown table output (for docs/S8.6-BALANCE.md)
// ---------------------------------------------------------------------------

console.log(`\n${"═".repeat(80)}`);
console.log(`  MARKDOWN TABLE (copy to docs/S8.6-BALANCE.md)`);
console.log(`${"═".repeat(80)}\n`);

console.log(`| HP | Players | Elim/match | ≥1 elim | 1st elim (avg R) | Win HP avg | Win HP % | Early end |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const hp of HP_VALUES) {
  for (const pc of PLAYER_COUNTS) {
    const s = computeStats(hp, pc);
    const firstStr = s.firstElimAvgRound !== null ? fmt1(s.firstElimAvgRound) : "—";
    console.log(
      `| ${hp} | ${pc} | ${fmt1(s.elimAvg)} | ${s.elimGt0Pct.toFixed(1)}% | ${firstStr} | ${fmt1(s.winnerHpAvg)} (${s.winnerHpMin}–${s.winnerHpMax}) | ${s.winnerHpPct.toFixed(1)}% | ${s.earlyFinishPct.toFixed(1)}% |`,
    );
  }
}

console.log(`\n${"═".repeat(80)}\n`);
