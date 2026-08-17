import { createRng } from "./rng";
import { applyFormation, getFormation, type FormationId } from "./formations";
import {
  AXIS_KEYS,
  CATEGORIES,
  MAX_SYNERGY,
  allAxes,
  getCategory,
  type AxisKey,
} from "./categories";
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
 * V2 fights on five canonical axes rather than on category stats. Each category
 * projects its own ratings onto those axes (Marvel's Durability and Animals'
 * Defense both become `defense`), which is what lets a crossover game work at
 * all without the engine knowing what a "Bite" is.
 *
 * Crossover fairness is handled by normalisation: in a mixed game every axis is
 * rescaled from its own category's observed band onto a shared one, so the best
 * Hollywood actor arrives at the same effective ceiling as the best Kryptonian.
 * In a single-category game no rescaling happens and the authored numbers are
 * used as written.
 *
 * The stronger team is favoured but never guaranteed:
 *   team rating     = sum of (damage output x survivability), the same terms
 *                     the round loop fights with
 *   win probability = softmax over team ratings, with the coefficient fitted
 *                     against the simulator so the number shown is honest
 *   outcome         = an actual round-by-round simulation using those stats
 */

const MAX_ROUNDS = 14;
const TARGET_DURATION_MS = 34_000;
const MAX_STEP_MS = 520;
const POINTS_TABLE = [3, 2, 1, 0];

/**
 * Which version of these rules is in force.
 *
 * Bumped by hand whenever the simulation's *behaviour* changes — damage
 * maths, RNG draws, turn ordering, formation or map influence. Not a
 * timestamp and not a deployment version: a replay needs to know which rules
 * produced it, and that only changes when somebody changes the rules.
 */
export const RULES_VERSION = 1;

/**
 * The shape V4 asks a battle to have. Rounds are mapped onto these after the
 * fight, because how long a battle ran is not known until it stops — a
 * three-round rout and a fourteen-round grind both deserve an opening and a
 * final clash.
 */
const PHASES = [
  { id: "OPENING", label: "Opening" },
  { id: "ENGAGEMENT", label: "Engagement" },
  { id: "ADVANTAGE", label: "Advantage" },
  // V4's phase list calls this one "Turning point", but the turning point is
  // also a *detected moment* that can land in any phase — a divider reading
  // "TURNING POINT · ROUND 6" above a card reading "Round 4 turned it" is two
  // different things wearing one name. The phase is renamed; the moment keeps
  // the name that matters.
  { id: "PRESSURE", label: "Pressure" },
  { id: "FINAL_CLASH", label: "Final clash" },
] as const;

/**
 * The label the last phase reports under.
 *
 * Exported so presentation can recognise the closing rounds from the divider
 * the engine already wrote, instead of matching a literal string. The same
 * lesson as the synergy labels in M7: match the producer's own vocabulary, or
 * the first rename breaks it silently.
 */
export const FINAL_PHASE_LABEL = PHASES[PHASES.length - 1].label;

/** Which phase a round belongs to, given how many rounds the battle lasted. */
function phaseOfRound(round: number, totalRounds: number): (typeof PHASES)[number] {
  if (totalRounds <= 1) return PHASES[0];
  const t = (round - 1) / (totalRounds - 1);
  const index = Math.min(PHASES.length - 1, Math.floor(t * PHASES.length));
  return PHASES[index];
}

/**
 * Shared combat-value band that every category is mapped onto in a crossover.
 * These are in the units `combatValue` returns, not raw stat points.
 */
const SHARED_LOW = 40;
const SHARED_HIGH = 120;

export interface BattleTeamInput {
  playerId: string;
  nickname: string;
  characters: { characterId: string; price: number }[];
  /** Chosen between the draft and the battle. Defaults to BALANCED. */
  formation?: FormationId;
}

/**
 * Sorted combat values for every character in a category. Crossover
 * normalisation maps a character's rank inside this list onto a shared band.
 */
export type AxisBands = Record<string, number[]>;

export interface SimulateInput {
  teams: BattleTeamInput[];
  map: BattleMap;
  event: EventCard;
  charactersById: Record<string, Character>;
  seed: string;
  /** Categories in play. More than one turns normalisation on. */
  categoryIds?: string[];
  /**
   * Per-category axis ranges, computed from the *full* pool of each category
   * rather than from the drafted twenty, so the scale does not shift with the
   * luck of the draft.
   */
  bands?: AxisBands;
}

interface Combatant {
  characterId: string;
  name: string;
  playerId: string;
  teamName: string;
  axes: Record<AxisKey, number>;
  ability: string;
  price: number;
  maxHp: number;
  hp: number;
  damageDealt: number;
  damageTaken: number;
  kills: number;
  specials: number;
  synergy: number;
}

/**
 * A character's contribution to the fight, in the same terms the round loop
 * uses: how hard they hit multiplied by how long they last.
 *
 * An earlier version averaged the five axes instead, which quietly lied to
 * players — two squads could show near-identical ratings while one of them won
 * every single simulation, because a high Strategy score flatters the average
 * without stopping anybody's fist. The forecast has to be built out of the
 * same numbers as the fight or it is not a forecast.
 */
function combatValue(axes: Record<AxisKey, number>): number {
  const attack = axes.power * 0.6 + axes.special * 0.2 + axes.strategy * 0.2;
  const hp = 70 + axes.defense * 1.55 + axes.power * 0.45;
  return (attack * hp) / 230;
}

/**
 * Sorted combat values per category, derived from a character list. Pass the
 * whole pool so the scale does not move with the luck of a draft.
 */
export function computeAxisBands(characters: Character[]): AxisBands {
  const bands: AxisBands = {};
  for (const c of characters) {
    const value = combatValue(allAxes(getCategory(c.categoryId), c.stats));
    (bands[c.categoryId] ??= []).push(value);
  }
  for (const key of Object.keys(bands)) bands[key].sort((a, b) => a - b);
  return bands;
}

/** Where a value sits inside a sorted list, as 0..1. */
function percentileOf(sorted: number[], value: number): number {
  if (sorted.length < 2) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(1, Math.max(0, lo / (sorted.length - 1)));
}

/**
 * A character's axes, rescaled onto a shared scale when categories are mixed.
 * With a single category this returns the authored values untouched.
 *
 * Normalisation works on COMBAT VALUE, not on each axis separately. Rescaling
 * axis by axis looked right and played terribly: combat value is roughly
 * attack x survivability, so a category whose best characters are extreme on
 * both — comic-book gods — kept a compounding edge over a category whose best
 * are merely well-rounded, and the top five Hollywood actors won 1% of games
 * against the top five from Marvel. Mapping each character's rank inside its
 * own category onto one shared band fixes that by construction, and it cannot
 * reorder a category against itself.
 */
export function projectAxes(
  character: Character,
  options: { mixed: boolean; bands?: AxisBands } = { mixed: false },
): Record<AxisKey, number> {
  const raw = allAxes(getCategory(character.categoryId), character.stats);
  if (!options.mixed) return raw;

  const sorted = options.bands?.[character.categoryId];
  if (!sorted || sorted.length < 2) return raw;

  const current = combatValue(raw);
  const target =
    SHARED_LOW + percentileOf(sorted, current) * (SHARED_HIGH - SHARED_LOW);

  // combatValue grows faster than linearly in the axes, so solve for the
  // scaling factor numerically rather than assuming a shape.
  let lo = 0.2;
  let hi = 3;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const scaled = {} as Record<AxisKey, number>;
    for (const key of AXIS_KEYS) scaled[key] = raw[key] * mid;
    if (combatValue(scaled) < target) lo = mid;
    else hi = mid;
  }

  const factor = (lo + hi) / 2;
  const out = {} as Record<AxisKey, number>;
  for (const key of AXIS_KEYS) out[key] = raw[key] * factor;
  return out;
}

/** Every synergy group defined by any category, indexed by tag. */
const SYNERGY_BY_TAG = new Map<string, { label: string; perMember: number }>();
for (const category of CATEGORIES) {
  for (const group of category.synergies) {
    if (!SYNERGY_BY_TAG.has(group.tag)) {
      SYNERGY_BY_TAG.set(group.tag, { label: group.label, perMember: group.perMember });
    }
  }
}

/**
 * The label a synergy tag reports under, if it is one the game scores.
 *
 * Exported so presentation can map a group back to the characters in it
 * without guessing at the label's wording — matching "Predators ×3" to the
 * tag "predator" by string surgery worked until the first plural.
 */
export function synergyLabelForTag(tag: string): string | null {
  return SYNERGY_BY_TAG.get(tag)?.label ?? null;
}

export interface SynergyResult {
  total: number;
  groups: { label: string; bonus: number }[];
}

/**
 * Team synergy: squads built around a shared identity fight as a unit. Capped
 * at +10% so it flavours a draft without deciding it.
 */
export function computeSynergy(chars: Character[]): SynergyResult {
  const counts = new Map<string, number>();
  for (const c of chars) {
    for (const tag of c.tags) {
      if (SYNERGY_BY_TAG.has(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const groups: { label: string; bonus: number }[] = [];
  let total = 0;
  for (const [tag, n] of counts) {
    if (n < 2) continue;
    const def = SYNERGY_BY_TAG.get(tag)!;
    const bonus = def.perMember * (n - 1);
    groups.push({ label: `${def.label} ×${n}`, bonus: Math.round(bonus * 1000) / 1000 });
    total += bonus;
  }

  groups.sort((a, b) => b.bonus - a.bonus);
  return { total: Math.min(MAX_SYNERGY, Number(total.toFixed(4))), groups };
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
  options: { mixed: boolean; bands?: AxisBands } = { mixed: false },
): number {
  const chars = team.characters
    .map((c) => charactersById[c.characterId])
    .filter(Boolean);
  const synergy = computeSynergy(chars).total;
  const raw = chars.reduce((sum, c) => {
    const env = environmentMultiplier(c, map, event);
    const axes = projectAxes(c, options);
    const scaled = {} as Record<AxisKey, number>;
    for (const key of AXIS_KEYS) scaled[key] = axes[key] * env;
    return sum + combatValue(scaled);
  }, 0);
  return Math.round(raw * (1 + synergy) * 100) / 100;
}

/**
 * Softmax over team ratings.
 *
 * K is not guessed: it is fitted against the simulator itself. The calibration
 * sweep runs seventy random matchups (single-category and crossover) sixty
 * times each and least-squares fits the logistic that best predicts the actual
 * win rate. If the damage model changes, refit it — a forecast nobody can trust
 * is worse than no forecast.
 */
export function winProbabilities(ratings: number[]): number[] {
  const K = 0.0475;
  const max = Math.max(...ratings);
  const exps = ratings.map((r) => Math.exp(K * (r - max)));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => Math.round((e / sum) * 1000) / 10);
}

export function simulateBattle(input: SimulateInput): BattleResult {
  const { teams, map, event, charactersById, seed, bands } = input;
  const categoryIds =
    input.categoryIds && input.categoryIds.length
      ? input.categoryIds
      : Array.from(
          new Set(
            teams.flatMap((t) =>
              t.characters
                .map((c) => charactersById[c.characterId]?.categoryId)
                .filter(Boolean) as string[],
            ),
          ),
        );
  const mixed = categoryIds.length > 1;
  const projection = { mixed, bands };

  const rng = createRng(`battle:${seed}`);

  // ---- 1. Build combatants -------------------------------------------------
  const combatants: Combatant[] = [];
  const teamSynergy = new Map<string, SynergyResult>();

  for (const team of teams) {
    const chars = team.characters
      .map((c) => charactersById[c.characterId])
      .filter(Boolean);
    const synergy = computeSynergy(chars);
    teamSynergy.set(team.playerId, synergy);
    const formation = getFormation(team.formation);

    // CHAOS drains a slice of one random axis for the whole team.
    const drainAxis =
      event.kind === "RANDOM_STAT_DRAIN" ? rng.pick(AXIS_KEYS) : null;
    const drainAmount = drainAxis ? rng.int(4, 9) : 0;

    for (const entry of team.characters) {
      const c = charactersById[entry.characterId];
      if (!c) continue;

      const env = environmentMultiplier(c, map, event);
      // Formation first, then the environment, then the event's drain. The
      // order matters only a little, but it has to be *an* order: applying the
      // formation last would let it partly undo a map that is meant to hurt.
      const base = applyFormation(projectAxes(c, projection), formation);
      const axes = {} as Record<AxisKey, number>;
      for (const key of AXIS_KEYS) {
        axes[key] = Math.max(
          1,
          Math.round(base[key] * env) - (drainAxis === key ? drainAmount : 0),
        );
      }

      combatants.push({
        characterId: c.id,
        name: c.name,
        playerId: team.playerId,
        teamName: team.nickname,
        axes,
        ability: c.abilities[0] ?? "Signature Move",
        price: entry.price,
        maxHp: Math.round(70 + axes.defense * 1.55 + axes.power * 0.45),
        hp: 0,
        damageDealt: 0,
        damageTaken: 0,
        kills: 0,
        specials: 0,
        synergy: synergy.total,
      });
    }
  }
  for (const c of combatants) c.hp = c.maxHp;

  // ---- 2. Forecast ---------------------------------------------------------
  const ratings = teams.map((t) =>
    teamRating(t, charactersById, map, event, projection),
  );
  const probabilities = winProbabilities(ratings);

  // AMBUSH: the fastest average team opens with a free damage bonus.
  let ambushTeamId: string | null = null;
  if (event.kind === "FIRST_STRIKE_FASTEST") {
    let best = -1;
    for (const t of teams) {
      const mine = combatants.filter((c) => c.playerId === t.playerId);
      const avg = mine.reduce((s, c) => s + c.axes.speed, 0) / (mine.length || 1);
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

  // Live odds after each round, so the swing can be found afterwards. Health
  // and firepower still standing is the honest read on who is winning — it is
  // the same quantity the forecast was built from.
  const oddsByRound: { round: number; odds: number[] }[] = [];
  const liveOdds = () =>
    winProbabilities(
      teams.map((t) => {
        const mine = combatants.filter((c) => c.playerId === t.playerId);
        return mine.reduce(
          (sum, c) => sum + (c.hp > 0 ? combatValue(c.axes) * (c.hp / c.maxHp) : 0),
          0,
        );
      }),
    );

  let round = 0;
  while (round < MAX_ROUNDS && aliveTeams().size > 1) {
    round++;
    log.push({ round, atMs: 0, kind: "ROUND_START", text: `ROUND ${round}` });

    const order = combatants
      .filter((c) => c.hp > 0)
      .map((c) => ({ c, roll: c.axes.speed + rng.range(-12, 12) }))
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
        (actor.axes.power * 0.6 +
          actor.axes.special * 0.2 +
          actor.axes.strategy * 0.2) *
        (1 + actor.synergy);
      const guard = target.axes.defense * 0.5 + target.axes.speed * 0.18;

      let damage = (attack - guard * 0.62) * rng.range(0.82, 1.18) * 0.62;
      if (round === 1 && ambushTeamId === actor.playerId) damage *= 1.25;

      let kind: BattleLogEntry["kind"] = "ATTACK";
      let text = `${actor.name} strikes ${target.name}.`;

      const specialChance = actor.axes.special / 620;
      const critChance =
        0.05 + (actor.axes.strategy + actor.axes.speed) / 2 / 1000;
      const blockChance = Math.min(0.22, target.axes.defense / 900);

      if (rng.chance(specialChance)) {
        damage *= 1.55;
        actor.specials++;
        kind = "SPECIAL";
        text = `${actor.name} uses ${actor.ability} on ${target.name}.`;
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
        // Floored, because the engine floors it on the very next lines when
        // the target dies. Reporting -7 HP would be reporting an intermediate
        // value the simulation itself never considers real.
        hpAfter: Math.max(0, target.hp),
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

    oddsByRound.push({ round, odds: liveOdds() });
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
      synergies: teamSynergy.get(t.playerId)?.groups ?? [],
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
  const winnerIndex = teams.findIndex((t) => t.playerId === winnerPlayerId);

  // An upset is the forecast's least-liked team winning. Ties are not upsets.
  const bestForecast = Math.max(...probabilities);
  const winnerForecast = probabilities[winnerIndex] ?? 0;
  // An upset needs a forecast that actually favoured somebody else. Between
  // two evenly matched teams the "least fancied" side wins about half the
  // time, and calling that an upset would put the badge on a coin flip.
  // NB: winProbabilities returns percentages (0-100), not fractions. Every
  // threshold here is on that scale.
  const upset =
    winnerIndex >= 0 &&
    winnerForecast === Math.min(...probabilities) &&
    bestForecast - winnerForecast >= 15;

  // The turning point: the round where the eventual winner's live odds moved
  // most in their favour. Reported only when the swing is big enough to have
  // actually felt like something.
  let turningPoint: BattleResult["turningPoint"] = null;
  if (winnerIndex >= 0 && oddsByRound.length > 1) {
    // Swings are measured between rounds, never from the pre-battle forecast.
    // The forecast is a flat prior; the first round always moves a long way
    // from it, and calling that a turning point made every single battle have
    // one — which is the same as no battle having one.
    let prev = oddsByRound[0].odds[winnerIndex] ?? winnerForecast;
    let best = { round: 0, from: 0, to: 0, delta: 0 };
    for (const entry of oddsByRound.slice(1)) {
      const now = entry.odds[winnerIndex] ?? prev;
      const delta = now - prev;
      if (delta > best.delta) best = { round: entry.round, from: prev, to: now, delta };
      prev = now;
    }
    // A real turning point is a comeback: the winner has to have been behind
    // and pulled ahead, or made a jump nobody could miss.
    const cameFromBehind = best.from < 50 && best.to >= 50;
    if (best.delta >= 12 && (cameFromBehind || best.delta >= 20)) {
      const phase = phaseOfRound(best.round, round);
      turningPoint = {
        round: best.round,
        phase: phase.label,
        from: Math.round(best.from),
        to: Math.round(best.to),
        text: `Round ${best.round} turned it: ${winnerName} went from ${Math.round(
          best.from,
        )}% to ${Math.round(best.to)}%.`,
      };
    }
  }

  // Name the phases now that the length of the fight is known, and mark the
  // round that swung it.
  for (const entry of log) {
    if (entry.kind !== "ROUND_START") continue;
    const phase = phaseOfRound(entry.round, round);
    entry.kind = "PHASE";
    entry.text = `${phase.label.toUpperCase()} · ROUND ${entry.round}`;
  }
  if (turningPoint) {
    const at = log.findIndex(
      (e) => e.kind === "PHASE" && e.round === turningPoint!.round,
    );
    const marker: BattleLogEntry = {
      round: turningPoint.round,
      atMs: 0,
      kind: "TURNING_POINT",
      text: turningPoint.text,
      actorTeamId: winnerPlayerId,
    };
    if (at >= 0) log.splice(at + 1, 0, marker);
    else log.push(marker);
  }

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
      maxHp: c.maxHp,
      performance,
      price: c.price,
      valueScore: Math.round((performance / Math.max(1, c.price)) * 100) / 100,
    };
  });

  const winnersResults = results.filter((r) => r.playerId === winnerPlayerId);
  const mvpEntry = [...winnersResults].sort(
    (a, b) => b.performance - a.performance,
  )[0];

  /**
   * How far past expectation the MVP played.
   *
   * Expectation is their share of their own team's combat value — the squad
   * paid for a certain slice of the damage from this character, and this is
   * whether they delivered it. A flat "most damage" MVP always crowns the
   * biggest name on the team; this can crown the cheap pick who carried.
   */
  let mvp: BattleResult["mvp"] = null;
  if (mvpEntry) {
    const teammates = combatants.filter((c) => c.playerId === winnerPlayerId);
    const teamValue = teammates.reduce((s, c) => s + combatValue(c.axes), 0);
    const mine = teammates.find((c) => c.characterId === mvpEntry.characterId);
    const teamDamage = winnersResults.reduce((s, r) => s + r.damageDealt, 0);

    const expected = teamValue > 0 && mine ? combatValue(mine.axes) / teamValue : 0;
    const actual = teamDamage > 0 ? mvpEntry.damageDealt / teamDamage : 0;

    mvp = {
      playerId: mvpEntry.playerId,
      characterId: mvpEntry.characterId,
      expected: Math.round(expected * 1000) / 10,
      actual: Math.round(actual * 1000) / 10,
      performance: expected > 0 ? Math.round((actual / expected) * 100) : 100,
    };
  }

  const byPerf = [...results].sort((a, b) => b.performance - a.performance);
  const byValue = [...results].sort((a, b) => b.valueScore - a.valueScore);
  // "Surprise" = beat what the price tag suggested by the widest margin.
  const bySurprise = [...results].sort(
    (a, b) => b.performance - 11 * b.price - (a.performance - 11 * a.price),
  );

  return {
    seed,
    rulesVersion: RULES_VERSION,
    mapId: map.id,
    eventId: event.id,
    categoryIds,
    log,
    durationMs,
    teams: teamStats,
    combatants: results,
    winnerPlayerId,
    upset,
    turningPoint,
    mvp,
    awards: {
      bestPerformer: byPerf[0] ?? null,
      biggestSurprise: bySurprise[0] ?? null,
      bestValue: byValue[0] ?? null,
      worstValue: byValue[byValue.length - 1] ?? null,
    },
  };
}
