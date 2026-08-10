"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ApiError, createRoom, joinRoom } from "@/lib/client/api";
import { lastNickname, setSession } from "@/lib/client/session";
import { play } from "@/lib/client/sound";
import { SiteNav } from "@/components/SiteNav";
import { CATEGORIES } from "@/lib/game/categories";

type Mode = "HOME" | "CREATE" | "JOIN";

function Landing() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("HOME");
  const [nickname, setNickname] = useState("");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNickname(lastNickname());
    const prefill = params.get("code");
    if (prefill) {
      setCode(prefill.toUpperCase());
      setMode("JOIN");
    }
  }, [params]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("Creating room...");
    try {
      const result = await createRoom({ nickname: nickname.trim(), roomName });
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

  return (
    <>
      <SiteNav />
      <main className="mx-auto flex min-h-[85dvh] w-full max-w-xl flex-col justify-center gap-8 px-5 py-10">
      <header className="text-center">
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
        <form onSubmit={handleCreate} className="glass animate-[pop_0.3s] space-y-4 rounded-2xl p-5">
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
          {error ? <p className="text-sm font-semibold text-rose-400">{error}</p> : null}
          <div className="flex gap-3">
            <button type="button" className="btn btn-ghost" onClick={() => setMode("HOME")}>
              Back
            </button>
            <button className="btn btn-primary flex-1" disabled={Boolean(busy) || nickname.trim().length < 2}>
              {busy ?? "Create Room"}
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
          4 players. 40 credits. 20 characters. 5 fighters each.
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
      </section>

      <section className="glass rounded-2xl p-5">
        <p className="mb-3 text-center text-[11px] font-black uppercase tracking-[0.25em] text-white/40">
          Pick a battle
        </p>
        <div className="grid grid-cols-4 gap-2">
          {CATEGORIES.map((c) => (
            <Link
              key={c.id}
              href={`/characters?category=${c.id}`}
              title={c.name}
              className="grid aspect-square place-items-center rounded-xl border border-white/10 text-2xl transition hover:scale-105"
              style={{ background: `linear-gradient(135deg, ${c.palette[0]}88, transparent)` }}
            >
              {c.icon}
            </Link>
          ))}
        </div>
        <Link href="/categories" className="btn btn-ghost !min-h-9 mt-3 w-full !text-[11px]">
          See all categories
        </Link>
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
