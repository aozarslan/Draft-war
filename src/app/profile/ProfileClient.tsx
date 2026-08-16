"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  claimChallenge,
  claimDaily,
  clearAccount,
  createProfile,
  equipItem,
  fetchAchievements,
  fetchChallenges,
  fetchCoins,
  fetchInventory,
  fetchProfile,
  getAccount,
  type AchievementsPayload,
  type ChallengeProgress,
  type CoinLedger,
  type InventoryPayload,
  type ProfilePayload,
} from "@/lib/client/account";
import { formatCoins, levelFromXp, rankFromPoints, RANK_TIERS } from "@/lib/game/progression";
import {
  bannerGradient,
  getItem,
  itemsOfKind,
  ITEM_KINDS,
  RARITY_STYLE,
  type ItemKind,
} from "@/lib/game/items";
import { TIER_STYLE, type AchievementTier } from "@/lib/game/achievements";
import { ladderView } from "@/lib/game/challenges";
import { getCategory } from "@/lib/game/categories";
import { Avatar, CoinPill, LevelBar, TitleTag } from "@/components/ProfileBadge";
import { RecoverForm, RecoveryPanel } from "@/components/RecoveryPanel";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";
import { play } from "@/lib/client/sound";

// Sign-up only offers the free avatars; everything else is earned or bought.
const STARTER_AVATARS = itemsOfKind("AVATAR").filter((i) => i.source === "DEFAULT");
const PLACE = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

export function ProfileClient() {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchProfile().then((p) => {
      setData(p);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return <LoadingScreen label="Loading your profile…" />;
  if (!data) return <ClaimProfile onDone={(p) => setData(p)} />;

  const level = levelFromXp(data.profile.xp);
  const rank = rankFromPoints(data.season?.rankPoints ?? 0);
  const winRate = data.stats.matches
    ? Math.round((data.stats.wins / data.stats.matches) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* ---- Identity ---- */}
      <Panel className="overflow-hidden">
        <div
          className="flex items-center gap-4 px-5 py-6"
          style={{ background: bannerGradient(data.profile.banner) }}
        >
          <Avatar avatar={data.profile.avatar} frame={data.profile.frame} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="headline truncate text-3xl">{data.profile.username}</h1>
            <TitleTag title={data.profile.title} className="block" />
            <p className="text-xs font-semibold" style={{ color: rank.tier.colour }}>
              {rank.tier.icon} {rank.label} · {rank.points} RP
            </p>
          </div>
        </div>
        <div className="px-5 pb-5">
          <LevelBar xp={data.profile.xp} />
        </div>
      </Panel>

      {/* ---- Getting back in ---- */}
      <RecoveryPanel />

      {/* ---- Challenges ---- */}
      <Challenges
        onClaim={(balance) =>
          setData({ ...data, profile: { ...data.profile, coins: balance } })
        }
      />

      {/* ---- Medals ---- */}
      <Medals />

      {/* ---- Inventory ---- */}
      <Inventory onEquip={() => void fetchProfile().then((p) => p && setData(p))} />

      {/* ---- Wallet ---- */}
      <Wallet
        coins={data.profile.coins}
        onChange={(balance) =>
          setData({ ...data, profile: { ...data.profile, coins: balance } })
        }
      />

      {/* ---- Season ---- */}
      {data.season ? (
        <Panel>
          <SectionTitle
            right={
              <span className="text-[10px] text-white/35">
                ends {new Date(data.season.endsAt).toLocaleDateString("en-GB")}
              </span>
            }
          >
            {data.season.name}
          </SectionTitle>
          <div className="grid grid-cols-4 gap-2 px-4 pb-4">
            {[
              { label: "Rank points", value: data.season.rankPoints },
              { label: "Best", value: data.season.bestRankPoints },
              { label: "Matches", value: data.season.matches },
              { label: "Wins", value: data.season.wins },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 px-2 py-3 text-center">
                <div className="text-xl font-black tabular-nums">{s.value}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 pb-4">
            <RankLadder points={data.season.rankPoints} />
          </div>
        </Panel>
      ) : null}

      {/* ---- Lifetime ---- */}
      <Panel>
        <SectionTitle>Career</SectionTitle>
        <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-6">
          {[
            { label: "Matches", value: data.stats.matches },
            { label: "Wins", value: data.stats.wins },
            { label: "Win rate", value: `${winRate}%` },
            { label: "Top 3", value: data.stats.topThree },
            { label: "MVPs", value: data.stats.mvps },
            { label: "Drafted", value: data.stats.charactersDrafted },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 px-2 py-3 text-center">
              <div className="text-lg font-black tabular-nums">{s.value}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                {s.label}
              </div>
            </div>
          ))}
        </div>
        {data.stats.mostExpensiveName ? (
          <p className="px-4 pb-4 text-[11px] text-white/40">
            Biggest splash: {data.stats.mostExpensiveName.replace(/^[a-z-]+-/, "").replace(/-/g, " ")}{" "}
            for {data.stats.mostExpensivePrice} credits · {data.stats.creditsSpent} credits spent
            across every draft.
          </p>
        ) : null}
      </Panel>

      {/* ---- History ---- */}
      <Panel>
        <SectionTitle right={<span className="text-[10px] text-white/35">last 20</span>}>
          Match history
        </SectionTitle>
        {data.history.length === 0 ? (
          <EmptyState icon="🎮" title="No matches yet." hint="Play one and it lands here." />
        ) : (
          <ul className="space-y-1.5 px-4 pb-4">
            {data.history.map((m) => {
              const cat = getCategory(m.categoryIds[0]);
              return (
                <li
                  key={m.gameId}
                  className="flex items-center gap-3 rounded-xl border border-white/10 px-3 py-2.5"
                >
                  <span className="text-lg">{PLACE[m.placement - 1] ?? m.placement}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-black" style={{ color: cat.accent }}>
                      {cat.icon} {cat.name}
                      {m.isMvp ? <span className="ml-1 text-amber-300">· MVP</span> : null}
                      {m.ranked ? null : <span className="ml-1 text-white/25">· casual</span>}
                    </span>
                    <span className="block text-[10px] text-white/35">
                      {m.placement} of {m.playerCount} · {m.creditsSpent} credits ·{" "}
                      {new Date(m.at).toLocaleDateString("en-GB")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[11px] font-black text-cyan-300">+{m.xp} XP</span>
                    {m.coins > 0 ? (
                      <span className="block text-[10px] font-black text-amber-200">
                        +{m.coins} 🪙
                      </span>
                    ) : null}
                    {m.ranked ? (
                      <span
                        className={`block text-[10px] font-black ${
                          m.rankDelta >= 0 ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {m.rankDelta >= 0 ? "+" : ""}
                        {m.rankDelta} RP
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="flex gap-2">
        <Link href="/leaderboard" className="btn flex-1">Leaderboard</Link>
        <Link href="/#play" className="btn btn-primary flex-1">Play</Link>
      </div>

      <button
        className="btn btn-ghost w-full !text-[11px] text-white/40"
        onClick={() => {
          if (confirm("Sign out of this profile on this device?")) {
            clearAccount();
            location.reload();
          }
        }}
      >
        Sign out
      </button>
      <p className="text-center text-[10px] leading-relaxed text-white/25">
        Your profile lives in this browser. Signing in from another device is not
        supported yet.
      </p>
    </div>
  );
}

/**
 * Today's and this week's tasks.
 *
 * Progress is a delta from a baseline the server took when the task was
 * assigned, and finishing is re-checked before anything is paid — so this
 * shows a position rather than claiming one. The countdown is the period's own
 * expiry, not a client timer.
 */
function Challenges({ onClaim }: { onClaim: (balance: number) => void }) {
  const [rows, setRows] = useState<ChallengeProgress[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void fetchChallenges().then((c) => setRows(c?.challenges ?? []));
  }, []);

  async function claim(id: string) {
    setBusy(id);
    setNote(null);
    try {
      const result = await claimChallenge(id);
      onClaim(result.balance);
      setRows((await fetchChallenges())?.challenges ?? []);
      setNote(`${result.name} · +${result.coins} coins, +${result.xp} XP`);
      play("sold");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not claim that.");
    } finally {
      setBusy(null);
    }
  }

  if (!rows || rows.length === 0) return null;

  const daily = rows.filter((r) => r.scope === "DAILY");
  const weekly = rows.filter((r) => r.scope === "WEEKLY");
  const ready = rows.filter((r) => r.complete && !r.claimed).length;

  const section = (title: string, list: ChallengeProgress[]) =>
    list.length === 0 ? null : (
      <>
        <p className="px-4 pb-1.5 pt-1 text-[9px] font-black uppercase tracking-widest text-white/30">
          {/* Pinned to en-GB: the browser locale would print a Turkish
              weekday inside an otherwise English interface. */}
          {title} · resets {new Date(list[0].endsAt).toLocaleString("en-GB", {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
        <ul className="space-y-1.5 px-4 pb-2">
          {list.map((c) => {
            const percent = Math.min(100, Math.round((c.progress / c.target) * 100));
            return (
              <li
                key={c.id}
                className="rounded-xl border px-3 py-2.5"
                style={{
                  borderColor: c.claimed
                    ? "rgba(255,255,255,0.06)"
                    : c.complete
                      ? "rgba(52,211,153,0.45)"
                      : "rgba(255,255,255,0.08)",
                  background: c.complete && !c.claimed ? "rgba(52,211,153,0.08)" : "transparent",
                  opacity: c.claimed ? 0.5 : 1,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-black">{c.name}</span>
                    <span className="block truncate text-[10px] text-white/40">
                      {c.description}
                    </span>
                  </span>

                  {c.claimed ? (
                    <span className="shrink-0 text-[10px] font-black text-white/35">Claimed ✓</span>
                  ) : c.complete ? (
                    <button
                      onClick={() => claim(c.id)}
                      disabled={busy === c.id}
                      className="btn btn-primary !min-h-8 shrink-0 !px-2.5 !text-[10px]"
                    >
                      {busy === c.id ? "…" : `Claim 🪙 ${c.coins}`}
                    </button>
                  ) : (
                    <span className="shrink-0 text-right">
                      <span className="block text-[10px] font-black text-amber-200">
                        🪙 {c.coins}
                      </span>
                      <span className="block text-[9px] font-black text-cyan-300">+{c.xp} XP</span>
                    </span>
                  )}
                </div>

                {!c.complete ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="stat-bar flex-1">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-700"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[9px] font-bold tabular-nums text-white/35">
                      {c.progress} / {c.target}
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </>
    );

  return (
    <Panel accent="#34d399">
      <SectionTitle
        right={
          ready > 0 ? (
            <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-black text-emerald-200">
              {ready} ready
            </span>
          ) : null
        }
      >
        🎯 Challenges
      </SectionTitle>

      {section("Today", daily)}
      {section("This week", weekly)}

      {note ? (
        <p className="px-4 pb-4 text-center text-[11px] text-white/50">{note}</p>
      ) : (
        <div className="pb-2" />
      )}
    </Panel>
  );
}

/**
 * A summary of the medal cabinet: what has been unlocked, and the two nearest
 * things still to chase. The full list lives on its own page.
 */
function Medals() {
  const [data, setData] = useState<AchievementsPayload | null>(null);

  useEffect(() => {
    void fetchAchievements().then(setData);
  }, []);

  if (!data) return null;

  const recent = data.achievements
    .filter((a) => a.unlocked)
    .sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""))
    .slice(0, 3);

  // Closest to done, ignoring anything not started — "0 of 50" is not a tease.
  const next = data.achievements
    .filter((a) => !a.unlocked && a.value > 0)
    .sort((a, b) => b.value / b.threshold - a.value / a.threshold)
    .slice(0, 2);

  return (
    <Panel accent="#fbbf24">
      <SectionTitle
        right={
          <Link href="/achievements" className="text-[10px] font-bold text-white/45 hover:text-white">
            All {data.total} →
          </Link>
        }
      >
        🏅 {data.unlockedCount} unlocked
      </SectionTitle>

      <div className="space-y-1.5 px-4 pb-4">
        {recent.map((a) => {
          const tier = TIER_STYLE[a.tier as AchievementTier] ?? TIER_STYLE.BRONZE;
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-xl border px-3 py-2"
              style={{ borderColor: `${tier.colour}55`, background: `${tier.colour}12` }}
            >
              <span className="text-sm">🏅</span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-black">{a.name}</span>
              <span className="shrink-0 text-[9px] font-bold" style={{ color: tier.colour }}>
                {TIER_STYLE[a.tier as AchievementTier]?.label}
              </span>
            </div>
          );
        })}

        {next.map((a) => (
          <div key={a.id} className="rounded-xl border border-white/8 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-40">🔒</span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/55">
                {a.name}
              </span>
              <span className="shrink-0 text-[9px] font-bold tabular-nums text-white/35">
                {a.value} / {a.threshold}
              </span>
            </div>
            <div className="stat-bar mt-1.5">
              <div
                className="h-full rounded-full bg-white/25"
                style={{ width: `${Math.round((a.value / a.threshold) * 100)}%` }}
              />
            </div>
          </div>
        ))}

        {recent.length === 0 && next.length === 0 ? (
          <p className="text-center text-[11px] text-white/30">
            Play a match and the first ones start falling.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * The locker room.
 *
 * Locked items are shown rather than hidden — knowing what exists is half of
 * wanting it — but the equip button only appears on something owned, and the
 * server refuses the request anyway if the browser is talked into sending it.
 */
function Inventory({ onEquip }: { onEquip: () => void }) {
  const [inv, setInv] = useState<InventoryPayload | null>(null);
  const [kind, setKind] = useState<ItemKind>("AVATAR");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchInventory().then(setInv);
  }, []);

  const owned = new Set((inv?.owned ?? []).map((o) => o.itemId));
  const items = itemsOfKind(kind);
  const ownedCount = items.filter((i) => owned.has(i.id)).length;

  async function equip(itemId: string) {
    setBusy(itemId);
    setError(null);
    try {
      await equipItem(itemId);
      setInv(await fetchInventory());
      onEquip();
      play("bid");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not equip that.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel accent="#a78bfa">
      <SectionTitle
        right={
          <span className="text-[10px] text-white/35">
            {ownedCount} / {items.length} owned
          </span>
        }
      >
        Locker
      </SectionTitle>

      <div className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-3">
        {ITEM_KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            aria-pressed={kind === k.id}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition ${
              kind === k.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
            }`}
          >
            {k.icon} {k.label}
          </button>
        ))}
      </div>

      {error ? <p className="px-4 pb-2 text-[11px] text-rose-400">{error}</p> : null}

      <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3">
        {items.map((item) => {
          const isOwned = owned.has(item.id);
          const isEquipped = inv?.equipped?.[item.kind] === item.id;
          const rarity = RARITY_STYLE[item.rarity];
          return (
            <button
              key={item.id}
              disabled={!isOwned || isEquipped || busy === item.id}
              onClick={() => equip(item.id)}
              className="flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition enabled:hover:brightness-125 enabled:active:scale-[0.98]"
              style={{
                borderColor: isEquipped ? rarity.colour : `${rarity.colour}33`,
                background: isEquipped ? `${rarity.colour}18` : "transparent",
                opacity: isOwned ? 1 : 0.4,
              }}
            >
              <ItemSwatch id={item.id} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-black">{item.name}</span>
                <span className="block text-[9px] font-bold" style={{ color: rarity.colour }}>
                  {isEquipped
                    ? "Equipped"
                    : isOwned
                      ? rarity.label
                      : item.price > 0
                        ? `🪙 ${item.price}`
                        : (item.requirement ?? "Locked")}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-4 pb-4">
        <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-white/25">
          Cosmetics only. Nothing in here changes a stat, a credit or a bid — the
          richest locker walks into an auction with the same 50 credits as an
          empty one.
        </p>
        <Link href="/shop" className="btn !min-h-8 shrink-0 !px-3 !text-[10px]">
          🛒 Shop
        </Link>
      </div>
    </Panel>
  );
}

/** A one-glance preview of whichever kind of item this is. */
function ItemSwatch({ id }: { id: string }) {
  const item = getItem(id);
  if (!item) return null;

  if (item.kind === "AVATAR") {
    return <Avatar avatar={item.id} size={30} />;
  }
  if (item.kind === "FRAME") {
    return <Avatar avatar="avatar-target" frame={item.id} size={30} />;
  }
  if (item.kind === "BANNER") {
    return (
      <span
        className="h-[30px] w-[30px] shrink-0 rounded-xl border border-white/10"
        style={{ background: bannerGradient(item.id) }}
      />
    );
  }
  return (
    <span
      className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-xl border border-white/10 text-sm"
      style={{ color: String(item.payload.colour) }}
    >
      🏷
    </span>
  );
}

const COIN_KIND_LABEL: Record<string, string> = {
  MATCH: "Match reward",
  DAILY: "Daily login",
  ACHIEVEMENT: "Achievement",
  SEASON: "Season reward",
  PURCHASE: "Shop purchase",
  GRANT: "Granted",
};

/**
 * Coins, and where they came from.
 *
 * The ledger is shown rather than just a balance because that is what the
 * server actually stores — the number in `profiles.coins` is a cache of these
 * rows, and a player who can read the receipts never has to take the total on
 * trust. Claiming is a request, not an instruction: the amount and the "have
 * you already had today's?" decision both live in the database.
 */
function Wallet({ coins, onChange }: { coins: number; onChange: (balance: number) => void }) {
  const [ledger, setLedger] = useState<CoinLedger | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void fetchCoins().then(setLedger);
  }, []);

  async function claim() {
    setBusy(true);
    setNote(null);
    try {
      const result = await claimDaily();
      onChange(result.balance);
      setLedger(await fetchCoins());
      setNote(
        result.claimed
          ? `+${result.amount} coins · day ${result.ladderDay} of the run · ${result.streak} in a row`
          : "You already claimed today. Come back tomorrow.",
      );
      if (result.claimed) play("sold");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not claim today's reward.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel accent="#fbbf24">
      <SectionTitle right={<CoinPill coins={coins} />}>Wallet</SectionTitle>

      <div className="px-4 pb-4">
        {/* The seven-day ladder. Which day you are on and what it pays are the
            server's answer — this only draws it. */}
        {ledger ? (
          <div className="mb-2.5 flex gap-1">
            {ladderView(ledger.streak, ledger.dailyClaimed).map((day) => (
              <div
                key={day.day}
                className="flex-1 rounded-lg border py-1.5 text-center"
                style={{
                  borderColor: day.today
                    ? "#fbbf24"
                    : day.claimed
                      ? "rgba(251,191,36,0.35)"
                      : "rgba(255,255,255,0.08)",
                  background: day.claimed ? "rgba(251,191,36,0.12)" : "transparent",
                }}
                title={`Day ${day.day} · ${day.coins} coins`}
              >
                <div
                  className="text-[9px] font-black tabular-nums"
                  style={{ color: day.claimed || day.today ? "#fcd34d" : "rgba(255,255,255,0.3)" }}
                >
                  {day.claimed ? "✓" : day.coins}
                </div>
                <div className="text-[8px] font-bold uppercase text-white/25">D{day.day}</div>
              </div>
            ))}
          </div>
        ) : null}

        <button
          className="btn btn-primary w-full"
          disabled={busy || ledger?.dailyClaimed}
          onClick={claim}
        >
          {ledger?.dailyClaimed
            ? `Claimed ✓ · tomorrow pays ${ledger.nextAmount}`
            : busy
              ? "Claiming…"
              : `🎁 Claim ${ledger?.nextAmount ?? 100} daily coins`}
        </button>
        {note ? <p className="mt-2 text-center text-[11px] text-white/50">{note}</p> : null}

        {ledger && ledger.entries.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {ledger.entries.slice(0, 8).map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-lg border border-white/8 px-2.5 py-1.5 text-[11px]"
              >
                <span className="min-w-0 flex-1 truncate text-white/55">
                  {COIN_KIND_LABEL[t.kind] ?? t.kind}
                </span>
                <span className="tabular-nums text-white/25">
                  {new Date(t.at).toLocaleDateString("en-GB")}
                </span>
                <span
                  className={`w-16 shrink-0 text-right font-black tabular-nums ${
                    t.amount >= 0 ? "text-amber-200" : "text-rose-300"
                  }`}
                >
                  {t.amount >= 0 ? "+" : "−"}
                  {formatCoins(Math.abs(t.amount))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-center text-[11px] text-white/30">
            Coins are earned by playing. They buy cosmetics only — never an
            advantage in a draft.
          </p>
        )}
      </div>
    </Panel>
  );
}

function RankLadder({ points }: { points: number }) {
  const current = rankFromPoints(points);
  return (
    <div className="flex items-center gap-1">
      {RANK_TIERS.map((t) => {
        const reached = RANK_TIERS.indexOf(current.tier) >= RANK_TIERS.indexOf(t);
        return (
          <span
            key={t.id}
            title={t.name}
            className="flex-1 rounded-md py-1 text-center text-[10px] transition"
            style={{
              background: reached ? `${t.colour}26` : "rgba(255,255,255,0.04)",
              color: reached ? t.colour : "rgba(255,255,255,0.25)",
            }}
          >
            {t.icon}
          </span>
        );
      })}
    </div>
  );
}

function ClaimProfile({ onDone }: { onDone: (p: ProfilePayload) => void }) {
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState(STARTER_AVATARS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProfile(username.trim(), avatar);
      play("sold");
      const fresh = await fetchProfile();
      if (fresh) onDone(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the profile.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass space-y-5 rounded-2xl p-5">
      <div>
        <h1 className="headline text-3xl neon-text">Save your progress</h1>
        <p className="mt-1 text-sm text-white/55">
          Claim a name and DRAFT WAR starts keeping your XP, level, rank and match
          history. You can keep playing as a guest — nothing is locked behind this.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="username" className="text-xs font-bold uppercase tracking-widest text-white/45">
          Username
        </label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
          placeholder="draft_shark"
          maxLength={16}
          autoCapitalize="none"
          required
        />
        <p className="text-[10px] text-white/30">
          3–16 characters: letters, numbers and underscores.
        </p>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-widest text-white/45">Avatar</span>
        <div className="grid grid-cols-5 gap-2">
          {STARTER_AVATARS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAvatar(a.id)}
              aria-pressed={avatar === a.id}
              title={a.name}
              className="grid aspect-square place-items-center rounded-xl border text-2xl transition active:scale-95"
              style={{
                borderColor: avatar === a.id ? "#22d3ee" : "rgba(255,255,255,0.1)",
                background: avatar === a.id ? "rgba(34,211,238,0.12)" : "transparent",
              }}
            >
              {String(a.payload.emoji)}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm font-semibold text-rose-400">{error}</p> : null}

      <button className="btn btn-primary w-full" disabled={busy || username.trim().length < 3}>
        {busy ? "Creating profile…" : "Create my profile"}
      </button>
      <Link href="/#play" className="btn btn-ghost w-full !text-[11px]">
        Keep playing as a guest
      </Link>
      <RecoverForm onDone={() => void fetchProfile().then((p) => p && onDone(p))} />
    </form>
  );
}
