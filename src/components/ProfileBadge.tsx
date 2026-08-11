"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchProfile, getAccount, type ProfilePayload } from "@/lib/client/account";
import { levelFromXp, rankFromPoints } from "@/lib/game/progression";

/**
 * The persistent player, shown in the site header.
 *
 * A guest sees an invitation to claim a name rather than an empty slot — the
 * game is playable without one, so this must read as an offer, not a gate.
 */
export function ProfileBadge({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchProfile().then((p) => {
        if (alive) {
          setData(p);
          setLoaded(true);
        }
      });
    };
    load();
    window.addEventListener("draftwar:account", load);
    return () => {
      alive = false;
      window.removeEventListener("draftwar:account", load);
    };
  }, []);

  if (!loaded) return <span className="h-9 w-24" aria-hidden />;

  if (!data) {
    return (
      <Link
        href="/profile"
        className="btn !min-h-9 shrink-0 !px-3 !text-[11px]"
        title={getAccount() ? "Profile" : "Save your progress"}
      >
        👤 Sign in
      </Link>
    );
  }

  const level = levelFromXp(data.profile.xp);
  const rank = rankFromPoints(data.season?.rankPoints ?? 0);

  return (
    <Link
      href="/profile"
      className="glass flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1.5 transition hover:brightness-125"
    >
      <span
        className="grid h-7 w-7 place-items-center rounded-lg text-xs font-black"
        style={{ background: rank.tier.colour, color: "#05060c" }}
      >
        {level.level}
      </span>
      {!compact ? (
        <span className="min-w-0">
          <span className="block max-w-[110px] truncate text-xs font-black leading-tight">
            {data.profile.username}
          </span>
          <span className="block text-[9px] font-bold" style={{ color: rank.tier.colour }}>
            {rank.tier.icon} {rank.label}
          </span>
        </span>
      ) : null}
    </Link>
  );
}

/** Level bar used on the profile page and the reward screen. */
export function LevelBar({ xp, className = "" }: { xp: number; className?: string }) {
  const level = levelFromXp(xp);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-wider text-white/45">
        <span>Level {level.level}</span>
        <span className="tabular-nums">
          {level.intoLevel} / {level.levelSpan} XP
        </span>
      </div>
      <div className="stat-bar mt-1">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 transition-[width] duration-700"
          style={{ width: `${Math.round(level.progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
