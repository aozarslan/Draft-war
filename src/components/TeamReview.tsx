"use client";

import { useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { Character } from "@/lib/game/types";
import { computeSynergy } from "@/lib/game/battle";
import { AXIS_KEYS, AXIS_LABELS, allAxes, getCategory } from "@/lib/game/categories";
import { playerColor } from "@/lib/game/colors";
import {
  FORMATIONS,
  FORMATION_IDS,
  getFormation,
  type FormationId,
} from "@/lib/game/formations";
import { play } from "@/lib/client/sound";
import { CharacterImage } from "./CharacterImage";
import { CharacterModal } from "./CharacterModal";
import { GameRatingNote } from "./GameRatingNote";
import { Countdown, Panel, SectionTitle, StatBar } from "./ui";

const AXIS_COLOR: Record<string, string> = {
  power: "#f43f5e",
  speed: "#22d3ee",
  defense: "#22c55e",
  strategy: "#a855f7",
  special: "#fbbf24",
};

/**
 * Team stats are reported on the canonical axes rather than on category stat
 * names, because in a crossover game the squads may not share a vocabulary —
 * one player's "Bite" and another's "Combat" both land on Special.
 */
function teamAxes(chars: Character[]) {
  const totals = { power: 0, speed: 0, defense: 0, strategy: 0, special: 0 };
  for (const c of chars) {
    const axes = allAxes(getCategory(c.categoryId), c.stats);
    for (const key of AXIS_KEYS) totals[key] += axes[key];
  }
  const n = Math.max(1, chars.length);
  return {
    power: Math.round(totals.power / n),
    speed: Math.round(totals.speed / n),
    defense: Math.round(totals.defense / n),
    strategy: Math.round(totals.strategy / n),
    special: Math.round(totals.special / n),
    rating: Math.round(AXIS_KEYS.reduce((s, k) => s + totals[k], 0)),
  };
}

export function TeamReview({
  store,
  charactersById,
}: {
  store: RoomStore;
  charactersById: Record<string, Character>;
}) {
  const { snapshot, me, act, serverNow } = store;
  const [detail, setDetail] = useState<Character | null>(null);
  if (!snapshot) return null;

  const categories = (snapshot.game?.categoryIds ?? []).map(getCategory);
  const primary = categories[0];

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="headline text-[clamp(1.8rem,8vw,3rem)] neon-text">Team Review</h2>
        <p className="mt-1 text-sm font-semibold text-white/50">
          {categories.map((c) => `${c.icon} ${c.name}`).join(" + ")} — here is what
          everyone paid for.
        </p>
      </div>

      <FormationPicker store={store} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {snapshot.players.map((p) => {
          const color = playerColor(p.colorIndex);
          const chars = p.roster
            .map((r) => charactersById[r.characterId])
            .filter(Boolean) as Character[];
          const axes = teamAxes(chars);
          const synergy = computeSynergy(chars);
          const spent = p.roster.reduce((s, r) => s + r.price, 0);

          return (
            <Panel key={p.id} accent={color.hex}>
              <div
                className="flex items-center justify-between gap-2 rounded-t-2xl px-4 py-3"
                style={{ background: `linear-gradient(90deg, ${color.hex}22, transparent)` }}
              >
                <h3 className="headline text-xl" style={{ color: color.hex }}>
                  {p.nickname}
                  {p.id === me?.id ? <span className="text-white/30"> ·you</span> : null}
                </h3>
                <div className="text-right">
                  <div className="text-lg font-black tabular-nums">{p.credits}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                    credits left
                  </div>
                </div>
              </div>

              <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
                {chars.map((c, i) => (
                  <button
                    key={c.id}
                    onClick={() => setDetail(c)}
                    className="w-[86px] shrink-0 p-0 text-left"
                  >
                    <div className="aspect-[5/6] overflow-hidden rounded-lg border border-white/10">
                      <CharacterImage character={c} sizes="100px" />
                    </div>
                    <p className="mt-1 truncate text-[10px] font-bold">{c.name}</p>
                    <p className="text-[10px] font-black tabular-nums text-amber-300">
                      {p.roster[i]?.price ?? 0} cr · {c.gamePower}
                    </p>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-3">
                {AXIS_KEYS.map((key) => (
                  <StatBar
                    key={key}
                    label={AXIS_LABELS[key]}
                    value={axes[key]}
                    color={AXIS_COLOR[key]}
                  />
                ))}
                <StatBar
                  label="Synergy"
                  value={Math.round(synergy.total * 100)}
                  max={10}
                  color="#38bdf8"
                />
              </div>

              {synergy.groups.length ? (
                <div className="flex flex-wrap gap-1 px-4 pb-3">
                  {synergy.groups.map((g) => (
                    <span
                      key={g.label}
                      className="rounded-full border border-cyan-400/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300"
                    >
                      {g.label} +{Math.round(g.bonus * 100)}%
                    </span>
                  ))}
                </div>
              ) : null}

              <p className="px-4 pb-4 text-[11px] text-white/35">
                Spent {spent} credits · squad rating {axes.rating}
              </p>
            </Panel>
          );
        })}
      </div>

      {primary ? <GameRatingNote category={primary} /> : null}

      <Panel>
        <SectionTitle
          right={
            <Countdown
              endsAt={snapshot.game?.phaseDeadline ?? null}
              now={serverNow}
              className="text-lg"
            />
          }
        >
          Next: battlefield vote
        </SectionTitle>
        <div className="px-4 pb-4">
          {me?.isHost ? (
            <button className="btn btn-primary w-full" onClick={() => act({ type: "ADVANCE" })}>
              Go to map selection
            </button>
          ) : (
            <p className="text-center text-xs font-semibold text-white/40">
              The host is about to open the map vote…
            </p>
          )}
        </div>
      </Panel>

      <CharacterModal character={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/**
 * The one decision between the draft and the battle.
 *
 * Deliberately shown with its cost as prominently as its benefit — every
 * formation trades one axis for another, and a picker that only listed the
 * upside would imply there is a correct answer. Locked once the battlefield
 * vote opens, so nobody can react to the map.
 */
function FormationPicker({ store }: { store: RoomStore }) {
  const { snapshot, me, act } = store;
  const [busy, setBusy] = useState<string | null>(null);
  if (!snapshot || !me) return null;

  const mine = snapshot.players.find((p) => p.id === me.id);
  const current = getFormation(mine?.formation);

  async function choose(id: FormationId) {
    if (id === current.id) return;
    setBusy(id);
    play("click");
    await act({ type: "SET_FORMATION", formation: id });
    setBusy(null);
  }

  return (
    <Panel accent={current.colour}>
      <SectionTitle
        right={
          <span className="text-[10px] text-white/35">
            locked when the map vote opens
          </span>
        }
      >
        Formation
      </SectionTitle>

      <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-5">
        {FORMATION_IDS.map((id) => {
          const f = FORMATIONS[id];
          const on = current.id === id;
          return (
            <button
              key={id}
              onClick={() => choose(id)}
              disabled={busy !== null}
              aria-pressed={on}
              className="flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition active:scale-95 disabled:opacity-60"
              style={{
                borderColor: on ? f.colour : "rgba(255,255,255,0.1)",
                background: on ? `${f.colour}1a` : "transparent",
                boxShadow: on ? `0 0 20px -8px ${f.colour}` : undefined,
              }}
            >
              <span className="text-lg leading-none">{f.icon}</span>
              <span
                className="text-[10px] font-black uppercase tracking-wider"
                style={{ color: on ? f.colour : "rgba(255,255,255,0.55)" }}
              >
                {f.name}
              </span>
              <span className="text-[9px] tabular-nums text-white/35">
                {Object.keys(f.modifiers).length === 0
                  ? "no change"
                  : Object.entries(f.modifiers)
                      .map(([axis, m]) => `${m > 1 ? "+" : ""}${Math.round((m - 1) * 100)}% ${axis.slice(0, 3)}`)
                      .join(" · ")}
              </span>
            </button>
          );
        })}
      </div>

      <p className="px-4 pb-4 text-[11px] text-white/45">
        {current.blurb} Every formation gives up as much as it gains — none of
        them is the right answer.
      </p>
    </Panel>
  );
}
