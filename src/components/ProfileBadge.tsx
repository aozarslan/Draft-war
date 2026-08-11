"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchProfile, getAccount, type ProfilePayload } from "@/lib/client/account";
import { formatCoins, levelFromXp, rankFromPoints } from "@/lib/game/progression";
import { avatarEmoji, frameStyle, titleText } from "@/lib/game/items";

/**
 * A player as they dress themselves: their avatar inside their frame.
 *
 * Both values come from the server — a frame is only stored after the database
 * has confirmed the wearer owns it — so this renders an entitlement, not a
 * preference the browser could invent.
 */
export function Avatar({
  avatar,
  frame,
  size = 32,
  className = "",
}: {
  avatar: string | null | undefined;
  frame?: string | null;
  size?: number;
  className?: string;
}) {
  const ring = frameStyle(frame);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-xl bg-white/5 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.52),
        borderWidth: ring.style === "double" ? 2 : 1,
        borderStyle: "solid",
        borderColor: ring.colour === "#ffffff" ? "rgba(255,255,255,0.12)" : ring.colour,
        boxShadow: ring.glow > 0 ? `0 0 ${ring.glow}px ${ring.colour}66` : undefined,
      }}
    >
      {avatarEmoji(avatar)}
    </span>
  );
}

/** The equipped title, or nothing when a player has not chosen one. */
export function TitleTag({ title, className = "" }: { title: string | null; className?: string }) {
  const t = titleText(title);
  if (!t) return null;
  return (
    <span className={`text-[11px] font-black ${className}`} style={{ color: t.colour }}>
      {t.text}
    </span>
  );
}

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
      <span className="relative">
        <Avatar avatar={data.profile.avatar} frame={data.profile.frame} size={30} />
        <span
          className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-md px-0.5 text-[9px] font-black leading-none"
          style={{ background: rank.tier.colour, color: "#05060c" }}
        >
          {level.level}
        </span>
      </span>
      {/* On a phone the header is already carrying the nav, so the badge
          shrinks to the two things worth knowing at a glance. */}
      {!compact ? (
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-[110px] truncate text-xs font-black leading-tight">
            {data.profile.username}
          </span>
          <span className="block text-[9px] font-bold" style={{ color: rank.tier.colour }}>
            {rank.tier.icon} {rank.label}
          </span>
        </span>
      ) : null}
      <CoinPill coins={data.profile.coins} />
    </Link>
  );
}

/** The wallet, wherever it needs to appear. */
export function CoinPill({
  coins,
  className = "",
}: {
  coins: number;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-lg border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-amber-200 ${className}`}
      title="Coins"
    >
      🪙 {formatCoins(coins)}
    </span>
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
