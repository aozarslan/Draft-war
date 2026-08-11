"use client";

import { useEffect, useState } from "react";
import { getAccount } from "@/lib/client/account";
import { rankFromPoints } from "@/lib/game/progression";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";

interface Entry {
  profileId: string;
  username: string;
  avatar: string;
  level: number;
  title: string | null;
  rankPoints: number;
  wins: number;
  matches: number;
  mvps: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];
type SortKey = "rank" | "wins" | "winRate" | "mvps";

export function LeaderboardClient() {
  const [data, setData] = useState<{
    season: { number: number; name: string; endsAt: string } | null;
    entries: Entry[];
  } | null>(null);
  const [sort, setSort] = useState<SortKey>("rank");
  const me = getAccount()?.profileId;

  useEffect(() => {
    fetch("/api/leaderboard?limit=100")
      .then((r) => r.json())
      .then((d) => setData({ season: d.season ?? null, entries: d.entries ?? [] }))
      .catch(() => setData({ season: null, entries: [] }));
  }, []);

  if (!data) return <LoadingScreen label="Loading the standings…" />;

  const winRate = (e: Entry) => (e.matches ? e.wins / e.matches : 0);
  const sorted = [...data.entries].sort((a, b) =>
    sort === "wins"
      ? b.wins - a.wins
      : sort === "mvps"
        ? b.mvps - a.mvps
        : sort === "winRate"
          ? winRate(b) - winRate(a)
          : b.rankPoints - a.rankPoints,
  );

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          right={
            data.season ? (
              <span className="text-[10px] text-white/35">
                ends {new Date(data.season.endsAt).toLocaleDateString()}
              </span>
            ) : null
          }
        >
          {data.season?.name ?? "Season"}
        </SectionTitle>
        <div className="flex gap-1.5 px-4 pb-3">
          {([
            ["rank", "Rank"],
            ["wins", "Wins"],
            ["winRate", "Win rate"],
            ["mvps", "MVPs"],
          ] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className="rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition"
              style={{
                borderColor: sort === key ? "#22d3ee" : "rgba(255,255,255,0.12)",
                color: sort === key ? "#22d3ee" : "rgba(255,255,255,0.5)",
                background: sort === key ? "rgba(34,211,238,0.1)" : "transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon="🏅"
            title="Nobody has played a ranked match yet."
            hint="Turn on Ranked when you create a room."
          />
        ) : (
          <ul className="space-y-1 px-4 pb-4">
            {sorted.map((e, i) => {
              const rank = rankFromPoints(e.rankPoints);
              const isMe = e.profileId === me;
              return (
                <li
                  key={e.profileId}
                  className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                  style={{
                    borderColor: isMe ? "#22d3ee66" : "rgba(255,255,255,0.08)",
                    background: isMe ? "rgba(34,211,238,0.08)" : "transparent",
                  }}
                >
                  <span className="w-7 text-center text-sm font-black text-white/40">
                    {MEDALS[i] ?? i + 1}
                  </span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-base">
                    {e.avatar.length <= 3 ? e.avatar : "🎯"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black">
                      {e.username}
                      {isMe ? <span className="text-white/35"> · you</span> : null}
                    </span>
                    <span className="block text-[10px] text-white/35">
                      Lv {e.level} · {e.wins}W / {e.matches}M · {e.mvps} MVP
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className="block text-xs font-black"
                      style={{ color: rank.tier.colour }}
                    >
                      {rank.tier.icon} {rank.label}
                    </span>
                    <span className="block text-[10px] tabular-nums text-white/40">
                      {e.rankPoints} RP
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
