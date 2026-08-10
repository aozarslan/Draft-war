"use client";

import type { RoomStore } from "@/lib/client/useRoom";
import type { Character } from "@/lib/game/types";
import { computeSynergy } from "@/lib/game/battle";
import { playerColor } from "@/lib/game/colors";
import { CharacterArt } from "./CharacterArt";
import { Countdown, Panel, SectionTitle, StatBar } from "./ui";

function teamStats(chars: Character[]) {
  const sum = (k: keyof Character) =>
    chars.reduce((s, c) => s + (c[k] as number), 0);
  const n = Math.max(1, chars.length);
  return {
    power: Math.round(sum("power") / n),
    speed: Math.round(sum("speed") / n),
    defense: Math.round(sum("defense") / n),
    tactics: Math.round(sum("tactics") / n),
    special: Math.round(sum("special") / n),
    total: sum("power") + sum("speed") + sum("defense") + sum("tactics") + sum("special"),
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
  if (!snapshot) return null;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="headline text-[clamp(1.8rem,8vw,3rem)] neon-text">Team Review</h2>
        <p className="mt-1 text-sm font-semibold text-white/50">
          The draft is done. Here is what everyone paid for.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {snapshot.players.map((p) => {
          const color = playerColor(p.colorIndex);
          const chars = p.roster
            .map((r) => charactersById[r.characterId])
            .filter(Boolean) as Character[];
          const stats = teamStats(chars);
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
                  <div key={c.id} className="w-[86px] shrink-0">
                    <div className="aspect-[5/6] overflow-hidden rounded-lg border border-white/10">
                      <CharacterArt character={c} />
                    </div>
                    <p className="mt-1 truncate text-[10px] font-bold">{c.name}</p>
                    <p className="text-[10px] font-black tabular-nums text-amber-300">
                      {p.roster[i]?.price ?? 0} cr
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pb-3">
                <StatBar label="Power" value={stats.power} color="#f43f5e" />
                <StatBar label="Speed" value={stats.speed} color="#22d3ee" />
                <StatBar label="Defense" value={stats.defense} color="#22c55e" />
                <StatBar label="Tactics" value={stats.tactics} color="#a855f7" />
                <StatBar label="Special" value={stats.special} color="#fbbf24" />
                <StatBar
                  label="Synergy"
                  value={Math.round(synergy * 100)}
                  max={14}
                  color="#38bdf8"
                />
              </div>

              <p className="px-4 pb-4 text-[11px] text-white/35">
                Spent {spent} credits · squad rating {stats.total}
              </p>
            </Panel>
          );
        })}
      </div>

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
    </div>
  );
}
