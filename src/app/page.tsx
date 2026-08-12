"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, createRoom, joinRoom } from "@/lib/client/api";
import { lastNickname, setSession } from "@/lib/client/session";
import { getAccount } from "@/lib/client/account";
import { play } from "@/lib/client/sound";
import { SiteNav } from "@/components/SiteNav";
import { HubSummary } from "@/components/HubSummary";
import { CATEGORIES } from "@/lib/game/categories";
import type { CategoryMode } from "@/lib/game/types";

type Mode = "HOME" | "CREATE" | "JOIN";

/** The two ways to leave the category open instead of picking one now. */
const OPEN_MODES = [
  { id: "VOTE" as const, icon: "🗳", label: "We vote", hint: "Everyone picks in the lobby" },
  { id: "RANDOM" as const, icon: "🎲", label: "Surprise us", hint: "Drawn at random" },
];

function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("HOME");
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  // Category choice made at creation time. Empty + HOST means "decide later".
  const [picked, setPicked] = useState<string[]>([]);
  const [categoryMode, setCategoryMode] = useState<CategoryMode>("HOST");
  const [ranked, setRanked] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getAccount()));
    setNickname(lastNickname());
    const prefill = params.get("code");
    if (prefill) {
      setCode(prefill.toUpperCase());
      setMode("JOIN");
    }
  }, [params]);

  function toggleCategory(id: string) {
    play("click");
    setCategoryMode("HOST");
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id],
    );
  }

  function chooseOpenMode(next: CategoryMode) {
    play("click");
    setPicked([]);
    setCategoryMode((current) => (current === next ? "HOST" : next));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("Creating room...");
    try {
      const result = await createRoom({
        nickname: nickname.trim(),
        roomName,
        config: { categories: picked, categoryMode, ranked },
      });
      setSession(result.code, {
        playerId: result.playerId,
        token: result.token,
        nickname: nickname.trim(),
      });
      play("sold");
      router.push(`/room/${result.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the room.");
      setBusy(null);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("Joining room...");
    try {
      const result = await joinRoom({ code: code.trim(), nickname: nickname.trim() });
      setSession(result.code, {
        playerId: result.playerId,
        token: result.token,
        nickname: nickname.trim(),
      });
      play("click");
      router.push(`/room/${result.code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join the room.");
      setBusy(null);
    }
  }

  const battleLabel =
    categoryMode === "VOTE"
      ? "Create room · we vote"
      : categoryMode === "RANDOM"
        ? "Create room · surprise us"
        : picked.length === 0
          ? "Create room · decide in the lobby"
          : picked.length === 1
            ? `Create room · ${CATEGORIES.find((c) => c.id === picked[0])?.name}`
            : `Create room · crossover (${picked.length})`;

  return (
    <>
      <SiteNav />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-8">
        {/* Signed in, this is a hub and the card carries the identity; signed
            out it is a landing page and the name has to do that job. The two
            never both shout. */}
        <HubSummary />

        <header className={`text-center ${signedIn ? "sr-only" : ""}`}>
          <p className="mb-3 text-[11px] font-black uppercase tracking-[0.45em] text-white/35">
            Auction · Draft · Battle
          </p>
          <h1 className="headline neon-text text-[clamp(3rem,17vw,6rem)]">
            Draft
            <br />
            War
          </h1>
          <p className="mt-4 text-base font-semibold text-white/70">
            Build your team. Break the bank. Win the war.
          </p>
        </header>

        {mode === "HOME" ? (
          <div id="play" className="animate-[rise_0.35s_ease-out] space-y-3">
            <button className="btn btn-primary w-full" onClick={() => setMode("CREATE")}>
              Create Room
            </button>
            <button className="btn w-full" onClick={() => setMode("JOIN")}>
              Join Room
            </button>
          </div>
        ) : null}

        {mode === "CREATE" ? (
          <form onSubmit={handleCreate} className="glass animate-[pop_0.3s] space-y-5 rounded-2xl p-5">
            <h2 className="headline text-2xl">Create Room</h2>

            <div className="space-y-2">
              <label htmlFor="nick" className="text-xs font-bold uppercase tracking-widest text-white/45">
                Your nickname
              </label>
              <input
                id="nick"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Ege"
                maxLength={18}
                autoComplete="nickname"
                required
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="room" className="text-xs font-bold uppercase tracking-widest text-white/45">
                Room name <span className="normal-case text-white/25">(optional)</span>
              </label>
              <input
                id="room"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Friday Night War"
                maxLength={40}
              />
            </div>

            {/* ---- Category, chosen here so the lobby does not ask again ---- */}
            <fieldset className="space-y-2">
              <legend className="text-xs font-bold uppercase tracking-widest text-white/45">
                Choose your battle{" "}
                <span className="normal-case text-white/25">
                  — tap up to 4 for a crossover
                </span>
              </legend>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CATEGORIES.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      aria-pressed={on}
                      title={c.tagline}
                      className="flex flex-col items-center gap-1 rounded-xl border px-1 py-3 transition active:scale-95"
                      style={{
                        borderColor: on ? c.accent : "rgba(255,255,255,0.1)",
                        background: on
                          ? `linear-gradient(140deg, ${c.palette[0]}, ${c.palette[1]}33)`
                          : "transparent",
                        boxShadow: on ? `0 0 22px -8px ${c.accent}` : undefined,
                      }}
                    >
                      <span className="text-2xl">{c.icon}</span>
                      <span
                        className="text-center text-[9px] font-black uppercase leading-tight tracking-wide"
                        style={{ color: on ? c.accent : "rgba(255,255,255,0.45)" }}
                      >
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {OPEN_MODES.map((m) => {
                  const on = categoryMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => chooseOpenMode(m.id)}
                      aria-pressed={on}
                      className="rounded-xl border px-2 py-2.5 text-center transition active:scale-95"
                      style={{
                        borderColor: on ? "#22d3ee" : "rgba(255,255,255,0.1)",
                        background: on ? "rgba(34,211,238,0.12)" : "transparent",
                      }}
                    >
                      <span className="text-xs font-black uppercase tracking-wide">
                        {m.icon} {m.label}
                      </span>
                      <span className="block text-[10px] text-white/40">{m.hint}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-xs font-bold uppercase tracking-widest text-white/45">
                Match type
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { on: false, icon: "🎮", label: "Casual", hint: "XP only, no rank risk" },
                  { on: true, icon: "🏆", label: "Ranked", hint: "Season rank points move" },
                ].map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    onClick={() => {
                      play("click");
                      setRanked(m.on);
                    }}
                    aria-pressed={ranked === m.on}
                    className="rounded-xl border px-2 py-2.5 text-center transition active:scale-95"
                    style={{
                      borderColor: ranked === m.on ? "#22d3ee" : "rgba(255,255,255,0.1)",
                      background: ranked === m.on ? "rgba(34,211,238,0.12)" : "transparent",
                    }}
                  >
                    <span className="text-xs font-black uppercase tracking-wide">
                      {m.icon} {m.label}
                    </span>
                    <span className="block text-[10px] text-white/40">{m.hint}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/25">
                Matchmaking is not built yet, so ranked means ranked against the
                friends in your room.
              </p>
            </fieldset>

            {error ? <p className="text-sm font-semibold text-rose-400">{error}</p> : null}

            <div className="flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setMode("HOME")}>
                Back
              </button>
              <button
                className="btn btn-primary flex-1"
                disabled={Boolean(busy) || nickname.trim().length < 2}
              >
                {busy ?? battleLabel}
              </button>
            </div>
          </form>
        ) : null}

        {mode === "JOIN" ? (
          <form onSubmit={handleJoin} className="glass animate-[pop_0.3s] space-y-4 rounded-2xl p-5">
            <h2 className="headline text-2xl">Join Room</h2>
            <div className="space-y-2">
              <label htmlFor="code" className="text-xs font-bold uppercase tracking-widest text-white/45">
                Room code
              </label>
              <input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                placeholder="X7K9P"
                className="text-center text-2xl font-black tracking-[0.4em]"
                inputMode="text"
                autoCapitalize="characters"
                maxLength={5}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="nick2" className="text-xs font-bold uppercase tracking-widest text-white/45">
                Your nickname
              </label>
              <input
                id="nick2"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Mikail"
                maxLength={18}
                required
              />
            </div>
            {error ? <p className="text-sm font-semibold text-rose-400">{error}</p> : null}
            <div className="flex gap-3">
              <button type="button" className="btn btn-ghost" onClick={() => setMode("HOME")}>
                Back
              </button>
              <button
                className="btn btn-hot flex-1"
                disabled={Boolean(busy) || code.trim().length !== 5 || nickname.trim().length < 2}
              >
                {busy ?? "Join Room"}
              </button>
            </div>
          </form>
        ) : null}

        <section className="glass rounded-2xl p-5">
          <p className="text-center text-sm font-bold text-white/75">
            5 players. 50 credits each. Draft 25 characters. Build the
            strongest 5-person team.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { icon: "💰", label: "Auction", hint: "Outbid your friends" },
              { icon: "🧠", label: "Strategy", hint: "Manage the budget" },
              { icon: "⚔️", label: "Battle", hint: "Simulated showdown" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border border-white/10 px-2 py-3">
                <div className="text-xl">{x.icon}</div>
                <div className="mt-1 text-[11px] font-black uppercase tracking-wider">{x.label}</div>
                <div className="text-[10px] text-white/40">{x.hint}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <Link href="/characters" className="btn btn-ghost !min-h-9 flex-1 !text-[11px]">
              Browse 268 characters
            </Link>
            <Link href="/rules" className="btn btn-ghost !min-h-9 flex-1 !text-[11px]">
              How to play
            </Link>
          </div>
        </section>

        <footer className="text-center text-[11px] leading-relaxed text-white/25">
          Game ratings are invented for DRAFT WAR and are not an official ranking.
          Character data and images come from Wikipedia / Wikimedia.
        </footer>
      </main>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Landing />
    </Suspense>
  );
}
