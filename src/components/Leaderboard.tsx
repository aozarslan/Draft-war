"use client";

import type { StateResponse } from "@/lib/client/api";
import { playerColor } from "@/lib/game/colors";
import { EmptyState, Panel, SectionTitle } from "./ui";

/** Season table for the room: 1st = 3 pts, 2nd = 2, 3rd = 1, 4th = 0. */
export function Leaderboard({ snapshot }: { snapshot: StateResponse }) {
  const ranked = [...snapshot.players].sort(
    (a, b) => b.points - a.points || b.wins - a.wins || a.nickname.localeCompare(b.nickname),
  );
  const played = snapshot.room.gamesPlayed;

  return (
    <Panel>
      <SectionTitle
        right={
          <span className="text-[11px] font-black text-white/40">
            {played} {played === 1 ? "game" : "games"}
          </span>
        }
      >
        Season leaderboard
      </SectionTitle>

      {played === 0 ? (
        <EmptyState icon="🏅" title="No games played yet." hint="Win one to get on the board." />
      ) : (
        <ul className="space-y-1 px-4 pb-4">
          {ranked.map((p, i) => {
            const color = playerColor(p.colorIndex);
            return (
              <li key={p.id} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="w-5 text-center font-black text-white/30">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-bold" style={{ color: color.hex }}>
                  {p.nickname}
                </span>
                <span className="text-[11px] tabular-nums text-white/40">
                  {p.wins}W · {p.losses}L
                </span>
                <span className="w-10 text-right font-black tabular-nums">{p.points}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
