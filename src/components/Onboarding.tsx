"use client";

import { useEffect, useState } from "react";
import { createProfile, getAccount } from "@/lib/client/account";
import { itemsOfKind } from "@/lib/game/items";
import { lastNickname } from "@/lib/client/session";
import { play } from "@/lib/client/sound";

const SEEN_KEY = "draftwar:welcomed";

// Sign-up only offers the free avatars; everything else is earned or bought.
const STARTER_AVATARS = itemsOfKind("AVATAR").filter((i) => i.source === "DEFAULT");

/** The whole game, in four lines. */
const PROMISES = [
  { icon: "🗂", text: "Pick a category" },
  { icon: "💰", text: "Outbid your friends" },
  { icon: "⚔️", text: "Battle" },
  { icon: "📈", text: "Climb the ranks" },
];

/**
 * The first thirty seconds.
 *
 * Two screens and an exit on both of them. V4 asks for onboarding that is
 * "extremely short", and the harder constraint is that nothing may be locked
 * behind it: a guest can play everything, so this has to read as an offer
 * rather than a gate. Both steps therefore carry a way past them, and skipping
 * is remembered so it never asks twice.
 *
 * Shown only to somebody with no account and no previous room — a returning
 * player who cleared their profile still gets straight to the game.
 */
export function Onboarding() {
  // Never read localStorage during render: the server has none, and branching
  // on it while rendering is a hydration mismatch. This is why the whole
  // component starts closed and opens itself after mount.
  const [step, setStep] = useState<"hidden" | "promise" | "name">("hidden");
  const [username, setUsername] = useState("");
  const [avatar, setAvatar] = useState(STARTER_AVATARS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const seen = window.localStorage.getItem(SEEN_KEY);
    const returning = Boolean(getAccount()) || Boolean(lastNickname());
    if (!seen && !returning) setStep("promise");
  }, []);

  function dismiss() {
    window.localStorage.setItem(SEEN_KEY, "1");
    setStep("hidden");
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProfile(username.trim(), avatar);
      play("sold");
      dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the profile.");
      setBusy(false);
    }
  }

  if (step === "hidden") return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to DRAFT WAR"
    >
      {/* Scrolls rather than traps. It fits comfortably on every phone I
          measured, but a device with larger accessibility text is exactly the
          case where an unreachable "skip" would be worst. */}
      <div className="glass max-h-[92dvh] w-full max-w-sm animate-[rise_0.3s_ease-out] overflow-y-auto rounded-2xl p-5">
        {step === "promise" ? (
          <>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/35">
              Welcome to
            </p>
            <h2 className="headline text-[clamp(2rem,11vw,3rem)] leading-none neon-text">
              Draft War
            </h2>

            <ul className="my-5 space-y-2.5">
              {PROMISES.map((p, i) => (
                <li
                  key={p.text}
                  className="flex items-center gap-3 animate-[rise_0.3s_ease-out_both]"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-lg">
                    {p.icon}
                  </span>
                  <span className="text-sm font-bold">{p.text}</span>
                </li>
              ))}
            </ul>

            <p className="mb-4 text-[11px] leading-relaxed text-white/40">
              Five players, fifty credits each, five characters to buy. Spend
              early and you might miss the one you wanted.
            </p>

            <button
              className="btn btn-primary w-full"
              onClick={() => {
                play("click");
                setUsername(lastNickname());
                setStep("name");
              }}
            >
              Pick a name
            </button>
            <button className="btn btn-ghost mt-2 w-full !text-[11px]" onClick={dismiss}>
              Skip · play as a guest
            </button>
          </>
        ) : (
          <form onSubmit={claim}>
            <h2 className="headline text-2xl">What should we call you?</h2>
            <p className="mt-1 text-[11px] text-white/45">
              This is what your friends see, and what your rank and coins stick to.
            </p>

            <input
              className="mt-4"
              value={username}
              onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
              placeholder="draft_shark"
              maxLength={16}
              autoCapitalize="none"
              autoFocus
              required
            />

            <div className="mt-3 grid grid-cols-5 gap-2">
              {STARTER_AVATARS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAvatar(a.id)}
                  aria-pressed={avatar === a.id}
                  title={a.name}
                  className="grid aspect-square place-items-center rounded-xl border text-xl transition active:scale-95"
                  style={{
                    borderColor: avatar === a.id ? "#22d3ee" : "rgba(255,255,255,0.1)",
                    background: avatar === a.id ? "rgba(34,211,238,0.12)" : "transparent",
                  }}
                >
                  {String(a.payload.emoji)}
                </button>
              ))}
            </div>

            {error ? <p className="mt-3 text-xs font-semibold text-rose-400">{error}</p> : null}

            <button
              className="btn btn-primary mt-4 w-full"
              disabled={busy || username.trim().length < 3}
            >
              {busy ? "Creating…" : "Start playing"}
            </button>
            <button type="button" className="btn btn-ghost mt-2 w-full !text-[11px]" onClick={dismiss}>
              Skip · play as a guest
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
