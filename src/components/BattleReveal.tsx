"use client";

import type { Character } from "@/lib/game/types";
import { getFormation } from "@/lib/game/formations";
import type { Reveal } from "@/lib/render/reveal";
import { Nickname, Panel } from "./ui";
import { nicknameFor } from "@/lib/game/characters";

/**
 * The head-to-head, shown while the arena is still empty.
 *
 * Everything on this card is drawn from `revealOf`, which is a projection of
 * the *draft* rather than of the fight — so there is no path from here to the
 * winner, the ranks, the MVP or the upset flag. The component cannot leak what
 * it was never handed.
 *
 * Sides are laid out in the order `revealOf` returned them, which is seating
 * order. Sorting here would quietly reintroduce the spoiler the projection
 * exists to prevent, so this file does not sort.
 */
export function BattleReveal({
  reveal,
  charactersById,
  colorOf,
  countdownMs,
}: {
  reveal: Reveal;
  charactersById: Record<string, Character>;
  colorOf: (playerId: string) => string;
  /** Milliseconds until the first blow, or null when it has already landed. */
  countdownMs: number | null;
}) {
  const seconds = countdownMs === null ? null : Math.max(0, Math.ceil(countdownMs / 1000));

  return (
    <Panel>
      <div className="p-4 sm:p-6">
        <p className="text-center text-[10px] font-black uppercase tracking-[0.35em] text-white/40">
          {seconds === null ? "Battle" : "Battle begins"}
        </p>
        {seconds !== null ? (
          <p
            className="headline neon-text mt-1 text-center text-5xl tabular-nums"
            // Announced as one number rather than a ticking stream: an
            // assertive countdown read out every second would talk over
            // everything else on the page.
            aria-live="off"
          >
            {seconds}
          </p>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
          {reveal.sides.map((side, i) => {
            const color = colorOf(side.playerId);
            const formation = getFormation(side.formation);

            return [
              i > 0 ? (
                <p
                  key={`vs-${side.playerId}`}
                  className="headline self-center text-center text-2xl text-white/25"
                  aria-hidden
                >
                  vs
                </p>
              ) : null,

              <div
                key={side.playerId}
                className="rounded-xl border p-3"
                style={{ borderColor: `${color}44`, background: `${color}0d` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-lg font-black" style={{ color }}>
                    {side.nickname}
                  </span>
                  <span className="shrink-0 text-xs font-bold tabular-nums text-white/45">
                    {side.winProbability}%
                  </span>
                </div>

                <p className="mt-0.5 text-[11px] font-bold text-white/45">
                  {formation.icon} {formation.name} · {side.spent} spent
                </p>

                <ul className="mt-3 space-y-1">
                  {side.fighters.map((f) => (
                    <li
                      key={f.characterId}
                      className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 text-sm"
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="block truncate font-bold">
                          {charactersById[f.characterId]?.name ?? f.characterId}
                        </span>
                        <Nickname
                          nickname={nicknameFor(
                            f.characterId,
                            charactersById[f.characterId]?.name ?? f.characterId,
                          )}
                          name={charactersById[f.characterId]?.name ?? f.characterId}
                          className="text-[9px] font-black uppercase tracking-[0.22em] text-amber-300/70"
                        />
                      </span>
                      <span className="shrink-0 text-[10px] font-black tabular-nums text-white/35">
                        {f.price}
                      </span>
                    </li>
                  ))}
                </ul>

                {side.synergies.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {side.synergies.map((s) => (
                      <span
                        key={s.label}
                        className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-black text-white/60"
                      >
                        {s.label}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>,
            ];
          })}
        </div>
      </div>
    </Panel>
  );
}
