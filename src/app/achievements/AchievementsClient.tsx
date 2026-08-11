"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchAchievements,
  getAccount,
  type AchievementProgress,
  type AchievementsPayload,
} from "@/lib/client/account";
import {
  CATEGORY_LABEL,
  TIER_STYLE,
  type AchievementCategory,
  type AchievementTier,
} from "@/lib/game/achievements";
import { getItem } from "@/lib/game/items";
import { formatCoins } from "@/lib/game/progression";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";

const ORDER: AchievementCategory[] = [
  "BATTLE",
  "AUCTION",
  "PROGRESS",
  "COLLECTION",
  "DEDICATION",
];

/**
 * The full list, unlocked or not.
 *
 * Progress comes from the server — every metric behind it is derived from
 * match history, the coin ledger and the inventory — so this page reports a
 * position rather than asserting one. A guest sees the same list with no
 * progress, which is the honest version of the invitation to sign up.
 */
export function AchievementsClient() {
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchAchievements().then((a) => {
      setData(a);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return <LoadingScreen label="Counting your medals…" />;
  if (!data) {
    return (
      <EmptyState
        icon="🏅"
        title="Could not load the achievements."
        hint="Try again in a moment."
      />
    );
  }

  const isGuest = !getAccount();
  const percent = data.total > 0 ? Math.round((data.unlockedCount / data.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <Panel accent="#fbbf24">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="text-3xl">🏅</span>
          <div className="min-w-0 flex-1">
            <h1 className="headline text-2xl">Achievements</h1>
            <p className="text-[11px] text-white/45">
              {isGuest
                ? "Sign in and these start tracking."
                : `${data.unlockedCount} of ${data.total} unlocked`}
            </p>
          </div>
          {!isGuest ? (
            <span className="shrink-0 text-2xl font-black tabular-nums text-amber-200">
              {percent}%
            </span>
          ) : (
            <Link href="/profile" className="btn btn-primary !min-h-9 shrink-0 !text-[11px]">
              Sign in
            </Link>
          )}
        </div>
        {!isGuest ? (
          <div className="px-4 pb-4">
            <div className="stat-bar">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-fuchsia-500 transition-[width] duration-700"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : null}
      </Panel>

      {ORDER.map((category) => {
        const rows = data.achievements.filter((a) => a.category === category);
        if (rows.length === 0) return null;
        const meta = CATEGORY_LABEL[category];
        const done = rows.filter((r) => r.unlocked).length;

        return (
          <Panel key={category}>
            <SectionTitle
              right={
                <span className="text-[10px] text-white/35">
                  {done} / {rows.length}
                </span>
              }
            >
              {meta.icon} {meta.label}
            </SectionTitle>
            <ul className="space-y-1.5 px-4 pb-4">
              {rows.map((a) => (
                <AchievementRow key={a.id} achievement={a} />
              ))}
            </ul>
          </Panel>
        );
      })}

      <div className="flex gap-2">
        <Link href="/profile" className="btn flex-1">
          Profile
        </Link>
        <Link href="/#play" className="btn btn-primary flex-1">
          Play
        </Link>
      </div>
    </div>
  );
}

function AchievementRow({ achievement: a }: { achievement: AchievementProgress }) {
  const tier = TIER_STYLE[a.tier as AchievementTier] ?? TIER_STYLE.BRONZE;
  const percent = a.threshold > 0 ? Math.min(100, Math.round((a.value / a.threshold) * 100)) : 0;
  const reward = a.item ? getItem(a.item) : null;

  return (
    <li
      className="rounded-xl border px-3 py-2.5 transition"
      style={{
        borderColor: a.unlocked ? `${tier.colour}66` : "rgba(255,255,255,0.08)",
        background: a.unlocked ? `${tier.colour}14` : "transparent",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm"
          style={{
            background: a.unlocked ? tier.colour : "rgba(255,255,255,0.05)",
            color: a.unlocked ? "#05060c" : "rgba(255,255,255,0.3)",
          }}
        >
          {a.unlocked ? "✓" : "🔒"}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-black">{a.name}</p>
          {/* Wraps rather than truncates: the description is the instruction
              for how to earn it, so cutting it off defeats the point. */}
          <p className="text-[10px] leading-snug text-white/40">{a.description}</p>
        </div>

        <div className="shrink-0 text-right">
          {a.coins > 0 ? (
            <span className="block text-[10px] font-black text-amber-200">
              🪙 {formatCoins(a.coins)}
            </span>
          ) : null}
          {a.xp > 0 ? (
            <span className="block text-[10px] font-black text-cyan-300">+{a.xp} XP</span>
          ) : null}
        </div>
      </div>

      {!a.unlocked ? (
        <div className="mt-2 flex items-center gap-2">
          <div className="stat-bar flex-1">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${percent}%`, background: tier.colour }}
            />
          </div>
          <span className="shrink-0 text-[9px] font-bold tabular-nums text-white/35">
            {a.value} / {a.threshold}
          </span>
        </div>
      ) : null}

      {reward ? (
        <p className="mt-1.5 text-[10px]" style={{ color: tier.colour }}>
          Unlocks {reward.name} · {reward.kind.toLowerCase()}
        </p>
      ) : null}
    </li>
  );
}
