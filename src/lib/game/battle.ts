import { createRng } from "./rng";
import type {
  BattleLogEntry,
  BattleMap,
  BattleResult,
  Character,
  CombatantResult,
  EventCard,
  TeamResult,
} from "./types";

/**
 * ---------------------------------------------------------------------------
 * BATTLE SIMULATOR (pure, deterministic given a seed)
 * ---------------------------------------------------------------------------
 * The stronger team is favoured but never guaranteed. The flow is:
 *
 *   effective stats = base stats x map modifiers x event modifiers x synergy
 *   team rating     = sum of effective overalls
 *   win probability = softmax over team ratings (shown to players, honest)
 *   outcome         = an actual round-by-round simulation using those stats
 *
 * The simulation is what decides the winner; the probability is a forecast of
 * it. Because everything is driven by one seed, the same battle can be replayed
 * byte-for-byte from the database, which is also what the tests rely on.
 */

const MAX_ROUNDS = 14;
const TARGET_DURATION_MS = 34_000;
const MAX_STEP_MS = 520;
const POINTS_TABLE = [3, 2, 1, 0];

export interface BattleTeamInput {
  playerId: string;
  nickname: string;
  characters: { characterId: string; price: number }[];
}

export interface SimulateInput {
  teams: BattleTeamInput[];
  map: BattleMap;
  event: EventCard;
  charactersById: Record<string, Character>;
  seed: string;
}

interface Combatant {
  characterId: string;
  name: string;
  playerId: string;
  teamName: string;
  power: number;
  speed: number;
  defense: number;
  tactics: number;
  special: number;
  specialAbility: string;
  price: number;
  maxHp: number;
  hp: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  specials: number;
  synergy: number;
}

function overallOf(c: {
  power: number;
  speed: number;
  defense: number;
  tactics: number;
  special: number;
}) {
  return (c.power + c.speed + c.defense + c.tactics + c.special) / 5;
}

/**
 * Team synergy: overlapping tags mean the squad fights as a unit. Capped so a
 * mono-tag team cannot run away with the game.
 */
export function computeSynergy(chars: Character[]): number {
  const counts = new Map<string, number>();
  for (const c of chars) {
    for (const tag of c.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  let synergy = 0;
  for (const [, n] of counts) if (n >= 2) synergy += 0.015 * (n - 1);
  // A little reward for stat balance too, so "5 glass cannons" is a real choice.
  const avgDef = chars.reduce((s, c) => s + c.defense, 0) / (chars.length || 1);
  const avgSpd = chars.reduce((s, c) => s + c.speed, 0) / (chars.length || 1);
  const balance = 1 - Math.min(1, Math.abs(avgDef - avgSpd) / 30);
  synergy += balance * 0.03;
  return Math.min(0.14, Number(synergy.toFixed(4)));
}

/** Character-level multiplier coming from the map and the event card. */
export function environmentMultiplier(
  char: Character,
  map: BattleMap,
  event: EventCard,
): number {
  const mapScale = event.kind === "DOUBLE_MAP_MODIFIERS" ? 2 : 1;
  let mult = 1;
  for (const mod of map.modifiers) {
    if (char.tags.includes(mod.tag)) mult += mod.bonus * mapScale;
  }
  if (event.kind === "TAG_BONUS" && event.tag && event.amount) {
    if (char.tags.includes(event.tag)) mult += event.amount;
  }
  return Math.max(0.5, mult);
}

export function teamRating(
  team: BattleTeamInput,
  charactersById: Record<string, Character>,
  map: BattleMap,
  event: EventCard,
): number {
  const chars = team.characters
    .map((c) => charactersById[c.characterId])
    .filter(Boolean);
  const synergy = computeSynergy(chars);
  const raw = chars.reduce(
    (sum, c) => sum + overallOf(c) * environmentMultiplier(c, map, event),
    0,
  );
  return Math.round(raw * (1 + synergy) * 100) / 100;
}

/**
 * Softmax over ratings. `K` is tuned so that the spec's example (438 vs 421)
 * lands close to 58% / 42% rather than a near-certain win.
 */
export function winProbabilities(ratings: number[]): number[] {
  const K = 0.019;
  const max = Math.max(...ratings);
  const exps = ratings.map((r) => Math.exp(K * (r - max)));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => Math.round((e / sum) * 1000) / 10);
}

export function simulateBattle(input: SimulateInput): BattleResult {
  const { teams, map, event, charactersById, seed } = input;
  const rng = createRng(`battle:${seed}`);

  // ---- 1. Build combatants -------------------------------------------------
  const combatants: Combatant[] = [];
  const teamSynergy = new Map<string, number>();

  for (const team of teams) {
    const chars = team.characters
      .map((c) => charactersById[c.characterId])
      .filter(Boolean);
    const synergy = computeSynergy(chars);
    teamSynergy.set(team.playerId, synergy);

    // CHAOS drains a slice of one random stat for the whole team.
    const drainStat =
      event.kind === "RANDOM_STAT_DRAIN"
        ? rng.pick(["power", "speed", "defense", "tactics", "special"] as const)
        : null;
    const drainAmount = drainStat ? rng.int(4, 9) : 0;

    for (const entry of team.characters) {
      const c = charactersById[entry.characterId];
      if (!c) continue;
      const env = environmentMultiplier(c, map, event);
      const scale = (v: number, key: string) =>
        Math.max(
          1,
          Math.round(v * env) - (drainStat === key ? drainAmount : 0),
        );

      const power = scale(c.power, "power");
      const speed = scale(c.speed, "speed");
      const defense = scale(c.defense, "defense");
      const tactics = scale(c.tactics, "tactics");
      const special = scale(c.special, "special");

      combatants.push({
        characterId: c.id,
        name: c.name,
        playerId: team.playerId,
        teamName: team.nickname,
        power,
        speed,
        defense,
        tactics,
        special,
        specialAbility: c.specialAbility,
        price: entry.price,
        maxHp: Math.round(70 + defense * 1.55 + power * 0.45),
        hp: 0,
        damageDealt: 0,
        damageTaken: 0,
        kills: 0,
        specials: 0,
        synergy,
      });
    }
  }
  for (const c of combatants) c.hp = c.maxHp;

  // ---- 2. Forecast ---------------------------------------------------------
  const ratings = teams.map((t) => teamRating(t, charactersById, map, event));
  const probabilities = winProbabilities(ratings);

  // AMBUSH: the fastest average team opens with a free damage bonus.
  let ambushTeamId: string | null = null;
  if (event.kind === "FIRST_STRIKE_FASTEST") {
    let best = -1;
    for (const t of teams) {
      const mine = combatants.filter((c) => c.playerId === t.playerId);
      const avg = mine.reduce((s, c) => s + c.speed, 0) / (mine.length || 1);
      if (avg > best) {
        best = avg;
        ambushTeamId = t.playerId;
      }
    }
  }

  // ---- 3. Rounds -----------------------------------------------------------
  const log: BattleLogEntry[] = [];
  const aliveTeams = () =>
    new Set(combatants.filter((c) => c.hp > 0).map((c) => c.playerId));

  let round = 0;
  while (round < MAX_ROUNDS && aliveTeams().size > 1) {
    round++;
    log.push({
      round,
      atMs: 0,
      kind: "ROUND_START",
      text: `ROUND ${round}`,
    });

    const order = combatants
      .filter((c) => c.hp > 0)
      .map((c) => ({ c, roll: c.speed + rng.range(-12, 12) }))
      .sort((a, b) => b.roll - a.roll)
      .map((x) => x.c);

    for (const actor of order) {
      if (actor.hp <= 0) continue;
      const enemies = combatants.filter(
        (c) => c.hp > 0 && c.playerId !== actor.playerId,
      );
      if (enemies.length === 0) break;

      // Mostly random targeting, sometimes focus fire on the weakest.
      const target = rng.chance(0.4)
        ? enemies.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b))
        : rng.pick(enemies);

      const attack =
        (actor.power * 0.6 + actor.special * 0.2 + actor.tactics * 0.2) *
        (1 + actor.synergy);
      const guard = target.defense * 0.5 + target.speed * 0.18;

      let damage = (attack - guard * 0.62) * rng.range(0.82, 1.18) * 0.62;
      if (round === 1 && ambushTeamId === actor.playerId) damage *= 1.25;

      let kind: BattleLogEntry["kind"] = "ATTACK";
      let text = `${actor.name} strikes ${target.name}.`;

      const specialChance = actor.special / 620;
      const critChance = 0.05 + (actor.tactics + actor.speed) / 2 / 1000;
      const blockChance = Math.min(0.22, target.defense / 900);

      if (rng.chance(specialChance)) {
        damage *= 1.55;
        actor.specials++;
        kind = "SPECIAL";
        text = `${actor.name} uses ${actor.specialAbility} on ${target.name}.`;
      } else if (rng.chance(critChance)) {
        damage *= 1.7;
        kind = "CRIT";
        text = `${actor.name} lands a critical hit on ${target.name}.`;
      } else if (rng.chance(blockChance)) {
        damage *= 0.3;
        kind = "BLOCK";
        text = `${target.name} blocks ${actor.name}.`;
      }

      const dealt = Math.max(4, Math.round(damage));
      target.hp -= dealt;
      actor.damageDealt += dealt;
      target.damageTaken += dealt;

      log.push({
        round,
        atMs: 0,
        kind,
        text,
        actorId: actor.characterId,
        actorTeamId: actor.playerId,
        targetId: target.characterId,
        targetTeamId: target.playerId,
        damage: dealt,
      });

      if (target.hp <= 0) {
        target.hp = 0;
        actor.kills++;
        log.push({
          round,
          atMs: 0,
          kind: "ELIMINATION",
          text: `${target.name} is eliminated by ${actor.name}.`,
          actorId: actor.characterId,
          actorTeamId: actor.playerId,
          targetId: target.characterId,
          targetTeamId: target.playerId,
        });
        if (aliveTeams().size <= 1) break;
      }
    }
  }

  // ---- 4. Standings --------------------------------------------------------
  const teamStats = teams.map((t, i) => {
    const mine = combatants.filter((c) => c.playerId === t.playerId);
    const survivors = mine.filter((c) => c.hp > 0).length;
    const totalDamage = mine.reduce((s, c) => s + c.damageDealt, 0);
    const hpPct =
      (mine.reduce((s, c) => s + c.hp, 0) /
        Math.max(1, mine.reduce((s, c) => s + c.maxHp, 0))) *
      100;
    return {
      playerId: t.playerId,
      survivors,
      totalDamage,
      remainingHpPct: Math.round(hpPct * 10) / 10,
      winProbability: probabilities[i],
      teamRating: ratings[i],
      rank: 0,
      points: 0,
    } satisfies TeamResult;
  });

  teamStats.sort(
    (a, b) =>
      b.survivors - a.survivors ||
      b.remainingHpPct - a.remainingHpPct ||
      b.totalDamage - a.totalDamage,
  );
  teamStats.forEach((t, i) => {
    t.rank = i + 1;
    t.points = POINTS_TABLE[i] ?? 0;
  });

  const winnerPlayerId = teamStats[0]?.playerId ?? "";
  const winnerName =
    teams.find((t) => t.playerId === winnerPlayerId)?.nickname ?? "—";

  log.push({
    round,
    atMs: 0,
    kind: "END",
    text: `TEAM ${winnerName.toUpperCase()} TAKES THE FIELD.`,
    actorTeamId: winnerPlayerId,
  });

  // ---- 5. Playback timing --------------------------------------------------
  const step = Math.min(MAX_STEP_MS, TARGET_DURATION_MS / Math.max(1, log.length));
  let cursor = 0;
  for (const entry of log) {
    entry.atMs = Math.round(cursor);
    cursor += entry.kind === "ROUND_START" ? step * 1.6 : step;
  }
  const durationMs = Math.round(cursor + 1200);

  // ---- 6. Per-character scoring -------------------------------------------
  const results: CombatantResult[] = combatants.map((c) => {
    const survivalPct = Math.round((c.hp / c.maxHp) * 1000) / 10;
    const performance = Math.round(
      c.damageDealt * 0.12 + survivalPct * 0.35 + c.kills * 10 + c.specials * 4,
    );
    return {
      characterId: c.characterId,
      playerId: c.playerId,
      damageDealt: c.damageDealt,
      damageTaken: c.damageTaken,
      kills: c.kills,
      specials: c.specials,
      survived: c.hp > 0,
      survivalPct,
      performance,
      price: c.price,
      valueScore: Math.round((performance / Math.max(1, c.price)) * 100) / 100,
    };
  });

  const winnersResults = results.filter((r) => r.playerId === winnerPlayerId);
  const mvpEntry = [...winnersResults].sort(
    (a, b) => b.performance - a.performance,
  )[0];

  const byPerf = [...results].sort((a, b) => b.performance - a.performance);
  const byValue = [...results].sort((a, b) => b.valueScore - a.valueScore);
  // "Surprise" = beat what the price tag suggested by the widest margin.
  const bySurprise = [...results].sort(
    (a, b) => b.performance - 11 * b.price - (a.performance - 11 * a.price),
  );

  return {
    seed,
    mapId: map.id,
    eventId: event.id,
    log,
    durationMs,
    teams: teamStats,
    combatants: results,
    winnerPlayerId,
    mvp: mvpEntry
      ? { playerId: mvpEntry.playerId, characterId: mvpEntry.characterId }
      : null,
    awards: {
      bestPerformer: byPerf[0] ?? null,
      biggestSurprise: bySurprise[0] ?? null,
      bestValue: byValue[0] ?? null,
      worstValue: byValue[byValue.length - 1] ?? null,
    },
  };
}
