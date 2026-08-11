"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchProfile,
  getAccount,
  type MatchHistoryEntry,
  type ProfilePayload,
} from "@/lib/client/account";
import { formatCoins, levelFromXp, rankFromPoints } from "@/lib/game/progression";
import { LevelBar } from "./ProfileBadge";
import { Panel, SectionTitle } from "./ui";
import { play } from "@/lib/client/sound";

/**
 * "You earned" — shown on the results screen once the battle is stored.
 *
 * The numbers are read back from the server rather than computed here: the
 * award already happened server-side, and showing anything the database has not
 * agreed to would be a lie waiting to be found. Guests get an invitation
 * instead, because they really did earn nothing bankable.
 */
export function MatchRewards({ gameId }: { gameId: string | null }) {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [entry, setEntry] = useState<MatchHistoryEntry | null>(null);
  const [state, setState] = useState<"loading" | "guest" | "ready">("loading");

  useEffect(() => {
    if (!gameId) return;
    if (!getAccount()) {
      setState("guest");
      return;
    }

    let alive = true;
    let attempts = 0;

    // The payout lands a moment after the battle is stored; poll briefly rather
    // than showing a permanent zero.
    const load = async () => {
      const profile = await fetchProfile();
      if (!alive) return;
      const found = profile?.history.find((h) => h.gameId === gameId) ?? null;
      if (found || attempts++ > 6) {
        setData(profile);
        setEntry(found);
        setState(profile ? "ready" : "guest");
        if (found) play("victory");
      } else {
        setTimeout(load, 1200);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [gameId]);

  if (state === "guest") {
    return (
      <Panel>
        <div className="flex items-center gap-3 p-4">
          <span className="text-2xl">💾</span>
          <p className="min-w-0 flex-1 text-xs text-white/55">
            You are playing as a guest, so this match was not banked. Claim a name
            and DRAFT WAR starts keeping your XP, level and rank.
          </p>
          <Link href="/profile" className="btn btn-primary !min-h-9 shrink-0 !text-[11px]">
            Save progress
          </Link>
        </div>
      </Panel>
    );
  }

  if (state === "loading" || !data) {
    return (
      <Panel>
        <div className="p-4 text-center text-xs font-bold uppercase tracking-widest text-white/35">
          Banking your rewards…
        </div>
      </Panel>
    );
  }

  if (!entry) return null;

  const level = levelFromXp(data.profile.xp);
  const rank = rankFromPoints(data.season?.rankPoints ?? 0);
  const levelledUp = level.intoLevel < entry.xp;

  return (
    <Panel className="overflow-hidden" accent="#22d3ee">
      <SectionTitle right={<span className="text-[10px] text-white/35">{data.profile.username}</span>}>
        You earned
      </SectionTitle>

      <div className="grid grid-cols-3 gap-2 px-4 pb-3">
        <div className="animate-[pop_0.4s] rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-2 py-3 text-center">
          <div className="text-2xl font-black tabular-nums text-cyan-300">+{entry.xp}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">XP</div>
        </div>
        <div className="animate-[pop_0.4s_0.05s_both] rounded-xl border border-amber-300/30 bg-amber-300/10 px-2 py-3 text-center">
          <div className="text-2xl font-black tabular-nums text-amber-200">+{entry.coins}</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">🪙 Coins</div>
        </div>
        <div
          className="animate-[pop_0.4s_0.1s_both] rounded-xl border px-2 py-3 text-center"
          style={{
            borderColor: entry.ranked ? `${rank.tier.colour}55` : "rgba(255,255,255,0.1)",
            background: entry.ranked ? `${rank.tier.colour}14` : "transparent",
          }}
        >
          <div
            className="text-2xl font-black tabular-nums"
            style={{ color: entry.ranked ? rank.tier.colour : "rgba(255,255,255,0.35)" }}
          >
            {entry.ranked ? `${entry.rankDelta >= 0 ? "+" : ""}${entry.rankDelta}` : "—"}
          </div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/45">
            {entry.ranked ? "Rank points" : "Casual match"}
          </div>
        </div>
      </div>

      {levelledUp ? (
        <p className="mx-4 mb-3 animate-[slam_0.5s_both] rounded-xl bg-gradient-to-r from-cyan-400/20 to-fuchsia-500/20 px-3 py-2 text-center text-sm font-black">
          ⭐ LEVEL {level.level}
        </p>
      ) : null}

      <div className="px-4 pb-4">
        <LevelBar xp={data.profile.xp} />
        <p className="mt-2 text-[11px] font-bold text-amber-200/80">
          🪙 {formatCoins(data.profile.coins)} coins in your wallet
        </p>
        {entry.ranked ? (
          <p className="mt-2 text-[11px] font-bold" style={{ color: rank.tier.colour }}>
            {rank.tier.icon} {rank.label} · {rank.points} RP
            {rank.next ? (
              <span className="text-white/30"> · {rank.next - rank.points} to next</span>
            ) : null}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
