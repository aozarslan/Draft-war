"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCategory } from "@/lib/game/categories";
import { playerColor } from "@/lib/game/colors";
import { draftEfficiency, efficiencyLabel } from "@/lib/game/archetypes";
import { getFormation } from "@/lib/game/formations";
import { Avatar } from "@/components/ProfileBadge";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";

interface PublicTeam {
  playerId: string;
  nickname: string;
  colorIndex: number;
  formation: string;
  username: string | null;
  avatar: string | null;
  frame: string | null;
  title: string | null;
  level: number | null;
  roster: { characterId: string; price: number }[];
  spent: number;
}

interface Payload {
  ok: true;
  gameId: string;
  roomCode: string;
  playedAt: string;
  categoryIds: string[];
  mapId: string | null;
  eventId: string | null;
  teams: PublicTeam[];
  result: {
    winnerPlayerId: string;
    upset: boolean;
    turningPoint: { text: string } | null;
    mvp: { characterId: string; performance: number } | null;
    teams: { playerId: string; rank: number; teamRating: number; winProbability: number }[];
  };
  moments: {
    averagePrice?: number;
    bargain?: { characterId: string; nickname: string; price: number } | null;
    overpay?: { characterId: string; nickname: string; price: number } | null;
  } | null;
}

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
const pretty = (id: string) => id.replace(/^[a-z-]+?-/, "").replace(/-/g, " ");

/**
 * A finished match, readable by anybody with the link.
 *
 * No sign-in and no room session: this is the page you paste into the group
 * chat. The server only serves finished games, so nothing here could leak a
 * roster or a credit balance out of a match still being played.
 */
export function PublicMatch({ gameId }: { gameId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/match/${gameId}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok === false) {
        setState("missing");
        return;
      }
      setData(body as Payload);
      setState("ready");
    })();
  }, [gameId]);

  if (state === "loading") return <LoadingScreen label="Loading the match…" />;
  if (state === "missing" || !data) {
    return (
      <EmptyState
        icon="🔍"
        title="No such match."
        hint="It may still be in progress — only finished games can be shared."
      />
    );
  }

  const standings = [...data.result.teams].sort((a, b) => a.rank - b.rank);
  const winner = data.teams.find((t) => t.playerId === data.result.winnerPlayerId);
  const winnerOdds = standings.find((t) => t.playerId === data.result.winnerPlayerId);

  return (
    <div className="space-y-4">
      <Panel accent={playerColor(winner?.colorIndex ?? 0).hex} className="overflow-hidden">
        <div className="px-5 py-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">
            {data.categoryIds.map((id) => getCategory(id).name).join(" + ")} · room{" "}
            {data.roomCode}
          </p>
          <h1
            className="headline text-[clamp(2rem,11vw,3.5rem)]"
            style={{ color: playerColor(winner?.colorIndex ?? 0).hex }}
          >
            {winner?.username ?? winner?.nickname ?? "—"}
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest text-white/35">
            {new Date(data.playedAt).toLocaleDateString("en-GB")}
          </p>
          {data.result.upset ? (
            <p className="mt-3 inline-block rounded-xl border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-300">
              🔥 Major upset · won at {Math.round(winnerOdds?.winProbability ?? 0)}%
            </p>
          ) : null}
        </div>
      </Panel>

      {data.result.turningPoint ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-center text-sm font-bold">
          🔥 {data.result.turningPoint.text}
        </p>
      ) : null}

      <Panel>
        <SectionTitle
          right={
            data.moments?.averagePrice ? (
              <span className="text-[10px] text-white/35">
                average price {data.moments.averagePrice}
              </span>
            ) : null
          }
        >
          Final standings
        </SectionTitle>
        <ul className="space-y-1.5 px-4 pb-4">
          {standings.map((t) => {
            const team = data.teams.find((x) => x.playerId === t.playerId);
            if (!team) return null;
            const colour = playerColor(team.colorIndex).hex;
            const eff = draftEfficiency(t.teamRating, team.spent, team.roster.length);
            const formation = getFormation(team.formation);
            return (
              <li
                key={t.playerId}
                className="rounded-xl border px-3 py-2.5"
                style={{ borderColor: `${colour}44` }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{MEDALS[t.rank - 1] ?? t.rank}</span>
                  <Avatar avatar={team.avatar} frame={team.frame} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black" style={{ color: colour }}>
                      {team.username ?? team.nickname}
                    </span>
                    <span className="block text-[10px] text-white/40">
                      power {Math.round(t.teamRating)} · {team.spent} credits ·{" "}
                      <span className="text-cyan-300">{eff}</span> efficiency ·{" "}
                      {efficiencyLabel(eff)}
                      {formation.id !== "BALANCED" ? (
                        <span style={{ color: formation.colour }}>
                          {" · "}
                          {formation.icon} {formation.name}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[10px] text-white/30">
                  {team.roster.map((r) => `${pretty(r.characterId)} (${r.price})`).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>

      {data.moments?.bargain || data.moments?.overpay ? (
        <Panel>
          <SectionTitle>The draft</SectionTitle>
          <ul className="space-y-1.5 px-4 pb-4 text-[11px]">
            {data.moments.bargain ? (
              <li className="flex items-center gap-2">
                <span>💎</span>
                <span className="min-w-0 flex-1 text-white/55">
                  Best bargain — {data.moments.bargain.nickname} took{" "}
                  {pretty(data.moments.bargain.characterId)}
                </span>
                <span className="font-black tabular-nums">{data.moments.bargain.price}</span>
              </li>
            ) : null}
            {data.moments.overpay ? (
              <li className="flex items-center gap-2">
                <span>🧾</span>
                <span className="min-w-0 flex-1 text-white/55">
                  Biggest overpay — {data.moments.overpay.nickname} on{" "}
                  {pretty(data.moments.overpay.characterId)}
                </span>
                <span className="font-black tabular-nums">{data.moments.overpay.price}</span>
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      <Link href="/#play" className="btn btn-primary w-full">
        Play your own
      </Link>
    </div>
  );
}
