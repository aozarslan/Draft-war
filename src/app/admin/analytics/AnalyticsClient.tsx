"use client";

import { useCallback, useEffect, useState } from "react";
import { getCategory } from "@/lib/game/categories";
import { getItem } from "@/lib/game/items";
import { formatCoins } from "@/lib/game/progression";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";

interface Analytics {
  ok: true;
  days: number;
  funnel: Record<string, number>;
  activity: Record<string, number>;
  categories: { categoryId: string; games: number }[];
  auction: {
    bids: number;
    passes: number;
    avgWinningPrice: number | null;
    maxWinningPrice: number | null;
    unsold: number;
    poolExtended: number;
    topPicks: { characterId: string; picks: number; avgPrice: number }[];
  };
  economy: Record<string, number> & {
    topSellers: { itemId: string; sales: number; coins: number }[];
  };
  retention: Record<string, number>;
  daily: { day: string; rooms: number; games: number; finished: number; signups: number }[];
}

const RANGES = [7, 30, 90];

/**
 * The dashboard.
 *
 * Every number here is derived from tables the game already writes as a
 * consequence of being played — there is no event stream and no tracking call,
 * so nothing can drift out of step with the game itself and looking at this
 * page costs the players nothing.
 */
export function AnalyticsClient() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async (range: number) => {
    setState("loading");
    const res = await fetch(`/api/admin/analytics?days=${range}`, { cache: "no-store" });
    // 404 is the gate; anything else that fails is a real problem and saying
    // "disabled" would send somebody looking in the wrong place.
    if (res.status === 404) {
      setState("denied");
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok === false) {
      setProblem(body?.message ?? `The request failed with ${res.status}.`);
      setState("error");
      return;
    }
    setData(body as Analytics);
    setState("ready");
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  if (state === "loading") return <LoadingScreen label="Counting…" />;
  if (state === "denied") {
    return (
      <EmptyState
        icon="🔒"
        title="Analytics disabled."
        hint="Set DRAFT_WAR_DEV_KEY and present it, or run this in development."
      />
    );
  }
  if (state === "error" || !data) {
    return (
      <EmptyState
        icon="📉"
        title="Could not read the numbers."
        hint={problem ?? "Has 0017_analytics.sql been run on this database?"}
      />
    );
  }

  const f = data.funnel;
  const a = data.activity;
  const r = data.retention;
  const startRate = f.roomsCreated > 0 ? Math.round((f.roomsStarted / f.roomsCreated) * 100) : 0;
  const finishRate = f.gamesPlayed > 0 ? Math.round((f.gamesFinished / f.gamesPlayed) * 100) : 0;
  const signupRate =
    a.guestSeats + a.profileSeats > 0
      ? Math.round((a.profileSeats / (a.guestSeats + a.profileSeats)) * 100)
      : 0;
  const buyRate = a.profiles > 0 ? Math.round((data.economy.buyers / a.profiles) * 100) : 0;
  const peak = Math.max(1, ...data.daily.map((d) => d.rooms));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="headline text-[clamp(1.8rem,7vw,3rem)] neon-text">Analytics</h1>
          <p className="text-[11px] text-white/40">
            Derived from the game's own tables. No event stream, no tracking calls.
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {RANGES.map((n) => (
            <button
              key={n}
              onClick={() => setDays(n)}
              className={`btn !min-h-8 !px-2.5 !text-[10px] ${days === n ? "btn-primary" : ""}`}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {/* ---- The funnel ---- */}
      <Panel accent="#22d3ee">
        <SectionTitle right={<span className="text-[10px] text-white/35">last {data.days} days</span>}>
          Rooms → games → battles
        </SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4">
          <Stat label="Rooms made" value={f.roomsCreated} />
          <Stat label="Started" value={f.roomsStarted} hint={`${startRate}%`} />
          <Stat label="Games" value={f.gamesPlayed} />
          <Stat label="Finished" value={f.gamesFinished} hint={`${finishRate}%`} />
        </div>
        <p className="px-4 pb-4 text-[11px] text-white/40">
          {f.roomsAlone} room{f.roomsAlone === 1 ? "" : "s"} never got a second player —
          the clearest sign an invite link is not making it to anybody.
        </p>
      </Panel>

      {/* ---- Who ---- */}
      <Panel>
        <SectionTitle>Players</SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4">
          <Stat label="Profiles" value={a.profiles} />
          <Stat label="New" value={a.newProfiles} />
          <Stat label="Active 24h" value={a.activeToday} />
          <Stat label="Active 7d" value={a.activeWeek} />
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
          <Stat label="Seats w/ profile" value={a.profileSeats} hint={`${signupRate}%`} />
          <Stat label="Guest seats" value={a.guestSeats} />
          <Stat label="Friendships" value={a.friendships} />
          <Stat label="Buyers" value={data.economy.buyers} hint={`${buyRate}%`} />
        </div>
      </Panel>

      {/* ---- Activity per day ---- */}
      <Panel>
        <SectionTitle right={<span className="text-[10px] text-white/35">rooms per day</span>}>
          Day by day
        </SectionTitle>
        <div className="flex items-end gap-[2px] px-4 pb-2" style={{ height: 90 }}>
          {data.daily.map((d) => (
            <div
              key={d.day}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-cyan-500/30 to-cyan-300/80"
              style={{ height: `${Math.round((d.rooms / peak) * 100)}%`, minHeight: 2 }}
              title={`${d.day}: ${d.rooms} rooms, ${d.games} games, ${d.finished} finished, ${d.signups} signups`}
            />
          ))}
        </div>
        <p className="px-4 pb-4 text-[10px] text-white/25">
          {data.daily[0]?.day} → {data.daily[data.daily.length - 1]?.day} · peak {peak} rooms
        </p>
      </Panel>

      {/* ---- What they play ---- */}
      <Panel>
        <SectionTitle>Categories</SectionTitle>
        {data.categories.length === 0 ? (
          <p className="px-4 pb-4 text-[11px] text-white/30">No games in this window.</p>
        ) : (
          <ul className="space-y-1.5 px-4 pb-4">
            {data.categories.map((c) => {
              const cat = getCategory(c.categoryId);
              const top = data.categories[0].games;
              return (
                <li key={c.categoryId} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] font-bold" style={{ color: cat.accent }}>
                    {cat.icon} {cat.name}
                  </span>
                  <div className="stat-bar flex-1">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.round((c.games / top) * 100)}%`, background: cat.accent }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px] font-black tabular-nums">
                    {c.games}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* ---- The auction ---- */}
      <Panel accent="#a78bfa">
        <SectionTitle>The auction</SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4">
          <Stat label="Bids" value={data.auction.bids} />
          <Stat label="Passes" value={data.auction.passes} />
          <Stat label="Avg price" value={data.auction.avgWinningPrice ?? "—"} />
          <Stat label="Top price" value={data.auction.maxWinningPrice ?? "—"} />
        </div>
        <p className="px-4 pb-3 text-[11px] text-white/40">
          {data.auction.unsold} unsold · {data.auction.poolExtended} pool extensions
        </p>
        {data.auction.topPicks.length > 0 ? (
          <ul className="space-y-1 px-4 pb-4">
            {data.auction.topPicks.map((p) => (
              <li key={p.characterId} className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-white/60">
                  {p.characterId.replace(/^[a-z-]+?-/, "").replace(/-/g, " ")}
                </span>
                <span className="tabular-nums text-white/35">avg {p.avgPrice}</span>
                <span className="w-8 text-right font-black tabular-nums">{p.picks}×</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {/* ---- The economy ---- */}
      <Panel accent="#fbbf24">
        <SectionTitle>The economy</SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pb-2 sm:grid-cols-4">
          <Stat label="Coins earned" value={formatCoins(data.economy.coinsEarned)} />
          <Stat label="Coins spent" value={formatCoins(data.economy.coinsSpent)} />
          <Stat label="Held" value={formatCoins(data.economy.coinsHeld)} />
          <Stat label="Purchases" value={data.economy.purchases} />
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pb-3">
          <Stat label="Daily claims" value={data.economy.dailyClaims} />
          <Stat label="Challenges" value={data.economy.challengeClaims} />
          <Stat label="Medals" value={data.economy.achievementsUnlocked} />
        </div>
        {data.economy.topSellers.length > 0 ? (
          <ul className="space-y-1 px-4 pb-4">
            {data.economy.topSellers.map((s) => (
              <li key={s.itemId} className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-white/60">
                  {getItem(s.itemId)?.name ?? s.itemId}
                </span>
                <span className="tabular-nums text-amber-200">🪙 {formatCoins(s.coins)}</span>
                <span className="w-8 text-right font-black tabular-nums">{s.sales}×</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-[11px] text-white/30">Nothing bought yet.</p>
        )}
      </Panel>

      {/* ---- Do they come back ---- */}
      <Panel>
        <SectionTitle right={<span className="text-[10px] text-white/35">lifetime cohort</span>}>
          Retention
        </SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3">
          <Stat label="Signed up" value={r.cohort} />
          <Stat label="Played once" value={r.playedOnce} hint={pct(r.playedOnce, r.cohort)} />
          <Stat label="Played twice" value={r.playedTwice} hint={pct(r.playedTwice, r.cohort)} />
          <Stat label="Played 5+" value={r.playedFive} hint={pct(r.playedFive, r.cohort)} />
          <Stat label="Back next day" value={r.returnedNextDay} hint={pct(r.returnedNextDay, r.cohort)} />
          <Stat label="Back after a week" value={r.returnedNextWeek} hint={pct(r.returnedNextWeek, r.cohort)} />
        </div>
        <p className="px-4 pb-4 text-[10px] leading-relaxed text-white/25">
          Counted over everybody who signed up more than a day ago, so a
          seven-day figure is not diluted by people who have not had seven days.
        </p>
      </Panel>
    </div>
  );
}

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 px-2 py-3 text-center">
      <div className="text-lg font-black tabular-nums">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</div>
      {hint ? <div className="text-[10px] font-bold text-cyan-300">{hint}</div> : null}
    </div>
  );
}
