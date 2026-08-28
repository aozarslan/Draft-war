"use client";

import type { StateResponse } from "@/lib/client/api";
import type { Character } from "@/lib/game/types";
import { playerColor } from "@/lib/game/colors";
import { nicknameFor } from "@/lib/game/characters";
import { creditsOf } from "@/lib/client/economy";

/**
 * Opponent status. Deliberately shows only public information: roster, credits
 * and remaining slots. What somebody is *willing* to pay stays in their head,
 * which is the whole point of the bluffing layer.
 */
export function PlayerRail({
  snapshot,
  charactersById,
  meId,
  highlightId,
  className = "",
  compact = false,
}: {
  snapshot: StateResponse;
  charactersById: Record<string, Character>;
  meId: string | null;
  highlightId?: string | null;
  className?: string;
  compact?: boolean;
}) {
  const perPlayer = snapshot.game?.charactersPerPlayer ?? snapshot.room.config.charactersPerPlayer ?? 5;

  return (
    <div className={className}>
      <div
        className={
          compact
            ? "no-scrollbar flex gap-2 overflow-x-auto pb-1"
            : "grid gap-2"
        }
      >
        {snapshot.players.map((p) => {
          const color = playerColor(p.colorIndex);
          const slots = Math.max(0, perPlayer - p.roster.length);
          const leading = highlightId === p.id;

          return (
            <div
              key={p.id}
              className={`glass rounded-xl p-3 transition ${compact ? "min-w-[168px] shrink-0" : ""}`}
              style={{
                borderColor: leading ? color.hex : `${color.hex}33`,
                boxShadow: leading ? `0 0 0 1px ${color.hex}, 0 0 26px -6px ${color.hex}` : undefined,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color.hex, opacity: p.connected ? 1 : 0.3 }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  {p.nickname}
                  {p.id === meId ? <span className="text-white/35"> ·you</span> : null}
                </span>
                {leading ? <span className="text-[10px] font-black text-amber-300">LEAD</span> : null}
              </div>

              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-2xl font-black tabular-nums" style={{ color: color.hex }}>
                  {creditsOf(snapshot, p.id)}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                  credits
                </span>
                <span className="ml-auto text-[11px] font-bold text-white/45">
                  {p.roster.length}/{perPlayer}
                </span>
              </div>

              <div className="mt-2 flex gap-1">
                {Array.from({ length: perPlayer }).map((_, i) => {
                  const owned = p.roster[i];
                  return (
                    <span
                      key={i}
                      title={owned ? charactersById[owned.characterId]?.name : "Empty slot"}
                      className="h-1.5 flex-1 rounded-full"
                      style={{ background: owned ? color.hex : "rgba(255,255,255,0.1)" }}
                    />
                  );
                })}
              </div>

              {!compact && p.roster.length > 0 ? (
                <ul className="mt-2 space-y-0.5">
                  {p.roster.map((r) => (
                    <li key={r.characterId} className="flex justify-between gap-2 text-[11px]">
                      <span className="truncate text-white/70">
                        {charactersById[r.characterId]?.name ?? r.characterId}
                        {(() => {
                          const name = charactersById[r.characterId]?.name;
                          if (!name) return null;
                          const nick = nicknameFor(r.characterId, name);
                          // One line per slot here, so the nickname is a
                          // suffix rather than a second row.
                          return nick === name ? null : (
                            <span className="ml-1.5 font-black uppercase tracking-wider text-amber-300/60">
                              {nick}
                            </span>
                          );
                        })()}
                      </span>
                      <span className="tabular-nums text-white/35">{r.price}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {!compact && slots > 0 ? (
                <p className="mt-1 text-[10px] text-white/25">{slots} slot(s) to fill</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
