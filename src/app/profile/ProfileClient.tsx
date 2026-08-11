"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  claimDaily,
  clearAccount,
  createProfile,
  fetchCoins,
  fetchProfile,
  getAccount,
  type CoinLedger,
  type ProfilePayload,
} from "@/lib/client/account";
import { formatCoins, levelFromXp, rankFromPoints, RANK_TIERS } from "@/lib/game/progression";
import { getCategory } from "@/lib/game/categories";
import { CoinPill, LevelBar } from "@/components/ProfileBadge";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";
import { play } from "@/lib/client/sound";

const AVATARS = ["🎯", "🔥", "💀", "👑", "🦊", "🐺", "⚡", "🎭", "🛡", "🗡"];
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
          style={{
            background: `radial-gradient(600px 200px at 20% 0%, ${rank.tier.colour}33, transparent)`,
          }}
        >
          <span
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl text-3xl"
            style={{ background: `${rank.tier.colour}22`, border: `1px solid ${rank.tier.colour}66` }}
          >
            {data.profile.avatar.length <= 3 ? data.profile.avatar : "🎯"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="headline truncate text-3xl">{data.profile.username}</h1>
            {data.profile.title ? (
              <p className="text-xs font-bold text-cyan-300">{data.profile.title}</p>
            ) : null}
            <p className="text-xs font-semibold" style={{ color: rank.tier.colour }}>
              {rank.tier.icon} {rank.label} · {rank.points} RP
            </p>
          </div>
        </div>
        <div className="px-5 pb-5">
          <LevelBar xp={data.profile.xp} />
        </div>
      </Panel>

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
                ends {new Date(data.season.endsAt).toLocaleDateString()}
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
                      {new Date(m.at).toLocaleDateString()}
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
          ? `+${result.amount} coins · ${result.streak} day streak`
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
        <button
          className="btn btn-primary w-full"
          disabled={busy || ledger?.dailyClaimed}
          onClick={claim}
        >
          {ledger?.dailyClaimed
            ? "Daily reward claimed ✓"
            : busy
              ? "Claiming…"
              : "🎁 Claim 100 daily coins"}
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
                  {new Date(t.at).toLocaleDateString()}
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
  const [avatar, setAvatar] = useState(AVATARS[0]);
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
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAvatar(a)}
              aria-pressed={avatar === a}
              className="grid aspect-square place-items-center rounded-xl border text-2xl transition active:scale-95"
              style={{
                borderColor: avatar === a ? "#22d3ee" : "rgba(255,255,255,0.1)",
                background: avatar === a ? "rgba(34,211,238,0.12)" : "transparent",
              }}
            >
              {a}
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
    </form>
  );
}
