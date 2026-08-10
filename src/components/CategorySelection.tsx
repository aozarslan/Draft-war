"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import { CATEGORIES, CATEGORIES_BY_ID, type Category } from "@/lib/game/categories";
import { playerColor } from "@/lib/game/colors";
import { play } from "@/lib/client/sound";
import { Countdown, Panel } from "./ui";

/**
 * CHOOSE YOUR BATTLE.
 *
 * One screen serves all three modes, because they only differ in who is
 * allowed to press what:
 *   HOST   — the host taps categories (up to four for a crossover) and starts
 *   VOTE   — everyone taps, the tally is live, the deadline decides
 *   RANDOM — a slot-machine reel spins until the server locks one in
 *
 * The locked category is revealed here for a beat before the auction opens, so
 * the table gets the "MARVEL!" moment rather than discovering it mid-bid.
 */
export function CategorySelection({
  store,
  counts,
}: {
  store: RoomStore;
  counts: Record<string, number>;
}) {
  const { snapshot, me, act, serverNow } = store;
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const locked = snapshot?.room.categoryIds ?? [];
  const mode = snapshot?.room.categoryMode ?? "HOST";
  const isLocked = locked.length > 0;

  // Slot-machine reel for the random mode, stopped the moment the server locks.
  const [reelIndex, setReelIndex] = useState(0);
  useEffect(() => {
    if (mode !== "RANDOM" || isLocked) return;
    const id = setInterval(() => setReelIndex((i) => i + 1), 110);
    return () => clearInterval(id);
  }, [mode, isLocked]);

  useEffect(() => {
    if (isLocked) play("sold");
  }, [isLocked]);

  const ballot = useMemo(() => {
    const ids = snapshot?.room.categoryCandidates ?? CATEGORIES.map((c) => c.id);
    return ids.map((id) => CATEGORIES_BY_ID[id]).filter(Boolean) as Category[];
  }, [snapshot?.room.categoryCandidates]);

  if (!snapshot) return null;

  const myVote = me ? snapshot.categoryVotes[me.id] : undefined;
  const votesFor = (id: string) =>
    snapshot.players.filter((p) => snapshot.categoryVotes[p.id] === id);

  // ---- Locked: the reveal -------------------------------------------------
  if (isLocked) {
    const chosen = locked.map((id) => CATEGORIES_BY_ID[id]).filter(Boolean);
    const primary = chosen[0];
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.45em] text-white/40">
          Category selected
        </p>
        <div className="animate-[slam_0.7s_both]">
          <div className="text-[clamp(4rem,22vw,9rem)] leading-none">
            {chosen.map((c) => c.icon).join(" ")}
          </div>
          <h2
            className="headline text-[clamp(2.5rem,14vw,6rem)] leading-none"
            style={{ color: primary?.accent }}
          >
            {chosen.map((c) => c.name).join(" + ")}
          </h2>
          <p className="mt-3 text-sm font-semibold text-white/55">
            {chosen.length > 1
              ? "Crossover — every category is normalised onto one scale."
              : primary?.tagline}
          </p>
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-white/35">
          The draft begins…
        </p>
      </div>
    );
  }

  // ---- Random: the reel ---------------------------------------------------
  if (mode === "RANDOM") {
    const spinning = ballot[reelIndex % Math.max(1, ballot.length)];
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-6 text-center">
        <p className="text-[11px] font-black uppercase tracking-[0.45em] text-white/40">
          Drawing a category
        </p>
        <div
          className="glass flex h-52 w-full max-w-sm flex-col items-center justify-center rounded-3xl"
          style={{ borderColor: `${spinning?.accent}66` }}
        >
          <div className="text-7xl">{spinning?.icon}</div>
          <div className="headline mt-2 text-3xl" style={{ color: spinning?.accent }}>
            {spinning?.name}
          </div>
        </div>
        <Countdown
          endsAt={snapshot.room.categoryDeadline}
          now={serverNow}
          className="text-4xl"
        />
      </div>
    );
  }

  // ---- Host pick / player vote --------------------------------------------
  const canPick = mode === "HOST" && me?.isHost;
  const canVote = mode === "VOTE";

  const toggle = (id: string) => {
    play("click");
    if (canVote) {
      void act({ type: "VOTE_CATEGORY", categoryId: id });
      return;
    }
    if (!canPick) return;
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id],
    );
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="headline text-[clamp(1.8rem,8vw,3rem)] neon-text">
          Choose your battle
        </h2>
        <p className="mt-1 text-sm font-semibold text-white/50">
          {canVote
            ? "Everyone votes. Most votes wins, ties are broken at random."
            : canPick
              ? "Pick one — or up to four for a crossover game."
              : "The host is choosing the category…"}
        </p>
        {snapshot.room.categoryDeadline ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
              Closing in
            </span>
            <Countdown
              endsAt={snapshot.room.categoryDeadline}
              now={serverNow}
              className="text-xl"
            />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ballot.map((c) => {
          const voters = votesFor(c.id);
          const selected = canVote ? myVote === c.id : picked.includes(c.id);
          const count = counts[c.id] ?? 0;

          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              disabled={!canPick && !canVote}
              aria-pressed={selected}
              className="glass group relative overflow-hidden rounded-2xl p-0 text-left transition active:scale-[0.98] disabled:opacity-70"
              style={{
                borderColor: selected ? c.accent : undefined,
                boxShadow: selected ? `0 0 0 1px ${c.accent}, 0 0 30px -8px ${c.accent}` : undefined,
              }}
            >
              <div
                className="flex h-24 items-center justify-center text-5xl"
                style={{ background: `linear-gradient(135deg, ${c.palette[0]}, ${c.palette[1]}99)` }}
              >
                {c.icon}
              </div>
              <div className="p-3">
                <h3 className="headline text-lg" style={{ color: c.accent }}>
                  {c.name}
                </h3>
                <p className="mt-0.5 text-[11px] leading-snug text-white/50">{c.tagline}</p>
                <p className="mt-2 text-[10px] font-black uppercase tracking-wider text-white/35">
                  {count} character{count === 1 ? "" : "s"}
                </p>

                {canVote ? (
                  <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1">
                    {voters.map((v) => (
                      <span
                        key={v.id}
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-black"
                        style={{
                          background: `${playerColor(v.colorIndex).hex}30`,
                          color: playerColor(v.colorIndex).hex,
                        }}
                      >
                        {v.nickname}
                      </span>
                    ))}
                    {voters.length === 0 ? (
                      <span className="text-[9px] text-white/25">no votes</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {canPick ? (
        <div className="sticky bottom-3">
          <button
            className="btn btn-hot w-full"
            disabled={busy || picked.length === 0}
            onClick={async () => {
              setBusy(true);
              await act({ type: "PICK_CATEGORY", categoryIds: picked });
              setBusy(false);
            }}
          >
            {picked.length === 0
              ? "Pick a category"
              : picked.length === 1
                ? `Draft ${CATEGORIES_BY_ID[picked[0]]?.name}`
                : `Crossover · ${picked.length} categories`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
