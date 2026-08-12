"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchChallenges,
  fetchCoins,
  fetchFriends,
  fetchProfile,
  getAccount,
  type ProfilePayload,
} from "@/lib/client/account";
import { formatCoins, levelFromXp, rankFromPoints } from "@/lib/game/progression";
import { bannerGradient } from "@/lib/game/items";
import { Avatar, LevelBar, TitleTag } from "./ProfileBadge";

/**
 * The top of the hub: who you are and what is waiting for you.
 *
 * Only shown to somebody with a profile. A guest gets the plain hero instead —
 * a card full of zeroes is a worse invitation than the game's own name, and
 * nothing here is a gate.
 *
 * Everything is read from the server; this component only decides what is
 * worth surfacing on the way to pressing Play.
 */
export function HubSummary() {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [ready, setReady] = useState({ daily: false, challenges: 0, online: 0, requests: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!getAccount()) {
      setLoaded(true);
      return;
    }

    let alive = true;
    void (async () => {
      const [profile, coins, challenges, friends] = await Promise.all([
        fetchProfile(),
        fetchCoins(),
        fetchChallenges(),
        fetchFriends(),
      ]);
      if (!alive) return;
      setData(profile);
      setReady({
        daily: coins ? !coins.dailyClaimed : false,
        challenges: (challenges?.challenges ?? []).filter((c) => c.complete && !c.claimed).length,
        online: (friends?.friends ?? []).filter((f) => f.online).length,
        requests: (friends?.incoming ?? []).length,
      });
      setLoaded(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (!loaded || !data) return null;

  const level = levelFromXp(data.profile.xp);
  const rank = rankFromPoints(data.season?.rankPoints ?? 0);

  // Only the things actually worth a tap right now.
  const nudges = [
    ready.daily && { href: "/profile", icon: "🎁", text: "Daily reward ready" },
    ready.challenges > 0 && {
      href: "/profile",
      icon: "🎯",
      text: `${ready.challenges} challenge${ready.challenges > 1 ? "s" : ""} to claim`,
    },
    ready.requests > 0 && {
      href: "/friends",
      icon: "👋",
      text: `${ready.requests} friend request${ready.requests > 1 ? "s" : ""}`,
    },
    ready.online > 0 && {
      href: "/friends",
      icon: "🟢",
      text: `${ready.online} friend${ready.online > 1 ? "s" : ""} around`,
    },
  ].filter(Boolean) as { href: string; icon: string; text: string }[];

  return (
    <div className="space-y-2">
      <Link
        href="/profile"
        className="glass block overflow-hidden rounded-2xl transition active:scale-[0.99]"
      >
        <div
          className="flex items-center gap-3 px-4 py-3.5"
          style={{ background: bannerGradient(data.profile.banner) }}
        >
          <Avatar avatar={data.profile.avatar} frame={data.profile.frame} size={46} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-black">{data.profile.username}</span>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold" style={{ color: rank.tier.colour }}>
                {rank.tier.icon} {rank.label}
              </span>
              <TitleTag title={data.profile.title} className="!text-[9px]" />
            </span>
          </span>
          <span className="shrink-0 rounded-lg border border-amber-300/25 bg-black/25 px-2 py-1 text-center">
            <span className="block text-sm font-black leading-none text-amber-200 tabular-nums">
              {formatCoins(data.profile.coins)}
            </span>
            <span className="block text-[8px] font-bold uppercase tracking-wider text-white/45">
              🪙 coins
            </span>
          </span>
        </div>
        <div className="px-4 py-2.5">
          <LevelBar xp={data.profile.xp} />
        </div>
      </Link>

      {nudges.length > 0 ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {nudges.map((n) => (
            <Link
              key={n.text}
              href={n.href}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-[11px] font-bold text-cyan-100 transition active:scale-95"
            >
              <span>{n.icon}</span>
              {n.text}
            </Link>
          ))}
        </div>
      ) : null}

      {/* Level is shown as a number in the badge; the bar above says how close
          the next one is, which is the part worth a glance before playing. */}
      <p className="text-center text-[10px] text-white/25">
        Level {level.level} · {level.toNext} XP to level {level.level + 1}
      </p>
    </div>
  );
}
