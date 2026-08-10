"use client";

import { useMemo, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { Character } from "@/lib/game/types";
import { maxAllowedBid, minAllowedBid } from "@/lib/game/auction";
import { playerColor } from "@/lib/game/colors";
import { play } from "@/lib/client/sound";
import { CharacterArt } from "./CharacterArt";
import { PlayerRail } from "./PlayerRail";
import { Countdown, EmptyState, Panel, SectionTitle, StatBar } from "./ui";

export function AuctionStage({
  store,
  charactersById,
}: {
  store: RoomStore;
  charactersById: Record<string, Character>;
}) {
  const { snapshot, me, act, serverNow } = store;
  const [pending, setPending] = useState(false);

  const auction = snapshot?.auction ?? null;
  const character = auction ? charactersById[auction.characterId] : null;

  const perPlayer = snapshot?.game?.charactersPerPlayer ?? 5;
  const minBid = snapshot?.room.config.minBid ?? 1;
  const slots = me ? Math.max(0, perPlayer - me.roster.length) : 0;

  const limits = useMemo(() => {
    if (!auction || !me) return { min: 0, max: 0 };
    return {
      min: minAllowedBid(auction.currentBid, auction.highBidderId !== null, minBid),
      max: maxAllowedBid(me.credits, slots, minBid),
    };
  }, [auction, me, minBid, slots]);

  if (!snapshot) return null;

  if (!auction || !character) {
    return (
      <Panel>
        <EmptyState icon="⏳" title="Preparing the next character…" hint="Hold tight." />
      </Panel>
    );
  }

  const highBidder = auction.highBidderId
    ? snapshot.players.find((p) => p.id === auction.highBidderId)
    : null;
  const iPassed = me ? auction.passedPlayerIds.includes(me.id) : false;
  const iLead = Boolean(me && auction.highBidderId === me.id);
  const rosterFull = slots <= 0;

  const canBid = (amount: number) =>
    Boolean(me) && !iPassed && !iLead && !rosterFull && amount >= limits.min && amount <= limits.max;

  async function bid(amount: number) {
    if (!canBid(amount)) return;
    setPending(true);
    play("click");
    await act({ type: "BID", auctionId: auction!.id, amount });
    setPending(false);
  }

  async function pass() {
    setPending(true);
    play("click");
    await act({ type: "PASS", auctionId: auction!.id });
    setPending(false);
  }

  const bidUp1 = limits.min;
  const bidUp5 = Math.max(limits.min, auction.currentBid + 5);
  const totalDrafted = snapshot.players.reduce((s, p) => s + p.roster.length, 0);
  const totalNeeded = snapshot.players.length * perPlayer;

  const reason = rosterFull
    ? "Your roster is full."
    : iPassed
      ? "You passed on this character."
      : iLead
        ? "You are the highest bidder."
        : limits.min > limits.max
          ? "You must keep credits for your remaining slots."
          : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {/* ---------- Character on the block ---------- */}
        <Panel className="overflow-hidden" accent={character.palette[1]}>
          <div className="flex items-stretch">
            <div className="relative w-[38%] max-w-[210px] shrink-0 overflow-hidden">
              <div key={character.id} className="h-full animate-[pop_0.35s]">
                <CharacterArt character={character} />
              </div>
              <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[9px] font-black tracking-widest backdrop-blur">
                {character.rarity}
              </span>
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                  On the block · {auction.orderIndex + 1} of {snapshot.game?.queue.length ?? 20}
                </p>
                <h2 className="headline mt-1 text-[clamp(1.5rem,6vw,2.6rem)]">
                  {character.name}
                </h2>
                <p className="text-xs font-semibold text-white/45">
                  {character.title} · ⚡ {character.specialAbility}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {character.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/50"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                <StatBar label="Power" value={character.power} color="#f43f5e" />
                <StatBar label="Speed" value={character.speed} color="#22d3ee" />
                <StatBar label="Defense" value={character.defense} color="#22c55e" />
                <StatBar label="Tactics" value={character.tactics} color="#a855f7" />
                <StatBar label="Special" value={character.special} color="#fbbf24" />
                <StatBar label="Value" value={character.basePrice} max={12} color="#94a3b8" />
              </div>
            </div>
          </div>
        </Panel>

        {/* ---------- Bid state + clock ---------- */}
        <Panel>
          <div className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
                Current bid
              </p>
              <div className="flex items-baseline gap-2">
                <span
                  key={auction.currentBid}
                  className="headline animate-[pop_0.25s] text-[clamp(2.2rem,10vw,3.4rem)] tabular-nums"
                >
                  {auction.highBidderId ? auction.currentBid : minBid}
                </span>
                <span className="text-xs font-bold uppercase text-white/35">credits</span>
              </div>
              <p className="truncate text-sm font-bold">
                {highBidder ? (
                  <span style={{ color: playerColor(highBidder.colorIndex).hex }}>
                    🔥 {highBidder.nickname} leads
                  </span>
                ) : (
                  <span className="text-white/35">No bids yet — opening price {minBid}</span>
                )}
              </p>
            </div>

            <div className="shrink-0 text-center">
              <Countdown
                endsAt={auction.endsAt}
                now={serverNow}
                className="text-[clamp(2.6rem,12vw,4rem)]"
              />
              <p className="text-[10px] font-black uppercase tracking-widest text-white/35">
                seconds
              </p>
            </div>
          </div>

          {/* ---------- Bid controls ---------- */}
          <div className="border-t border-white/10 p-4">
            <div className="mb-3 flex items-center justify-between text-xs font-bold">
              <span className="text-white/45">
                Your credits{" "}
                <span className="text-base font-black text-white tabular-nums">
                  {me?.credits ?? 0}
                </span>
              </span>
              <span className="text-white/45">
                Slots left{" "}
                <span className="text-base font-black text-white tabular-nums">{slots}</span>
              </span>
              <span className="text-white/45">
                Max bid{" "}
                <span className="text-base font-black tabular-nums text-amber-300">
                  {Math.max(0, limits.max)}
                </span>
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                className="btn btn-primary"
                disabled={pending || !canBid(bidUp1)}
                onClick={() => bid(bidUp1)}
              >
                +1 · {bidUp1}
              </button>
              <button
                className="btn"
                disabled={pending || !canBid(bidUp5)}
                onClick={() => bid(bidUp5)}
              >
                +5 · {bidUp5}
              </button>
              <button
                className="btn btn-hot"
                disabled={pending || !canBid(limits.max)}
                onClick={() => bid(limits.max)}
              >
                Max · {Math.max(0, limits.max)}
              </button>
              <button
                className="btn btn-ghost"
                disabled={pending || iPassed || iLead || rosterFull}
                onClick={pass}
              >
                {iPassed ? "Passed" : "Pass"}
              </button>
            </div>

            {reason ? (
              <p className="mt-2 text-center text-[11px] font-semibold text-white/40">{reason}</p>
            ) : null}
          </div>
        </Panel>

        {/* ---------- Draft progress ---------- */}
        <Panel>
          <SectionTitle
            right={
              <span className="text-[11px] font-black text-white/45">
                {totalDrafted}/{totalNeeded} drafted
              </span>
            }
          >
            Draft progress
          </SectionTitle>
          <div className="px-4 pb-4">
            <div className="stat-bar">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-500 transition-[width] duration-500"
                style={{ width: `${(totalDrafted / Math.max(1, totalNeeded)) * 100}%` }}
              />
            </div>
          </div>
        </Panel>

        <PlayerRail
          snapshot={snapshot}
          charactersById={charactersById}
          meId={me?.id ?? null}
          highlightId={auction.highBidderId}
          className="lg:hidden"
          compact
        />
      </div>

      {/* ---------- Side column ---------- */}
      <div className="min-w-0 space-y-4">
        <PlayerRail
          snapshot={snapshot}
          charactersById={charactersById}
          meId={me?.id ?? null}
          highlightId={auction.highBidderId}
          className="hidden lg:block"
        />

        <Panel>
          <SectionTitle>Bid history</SectionTitle>
          <div className="max-h-64 overflow-y-auto px-4 pb-4">
            {auction.history.length === 0 ? (
              <EmptyState icon="🤐" title="Nobody has moved yet." hint="Who blinks first?" />
            ) : (
              <ul className="space-y-1.5">
                {auction.history.map((h, i) => {
                  const p = snapshot.players.find((x) => x.id === h.playerId);
                  const color = p ? playerColor(p.colorIndex).hex : "#94a3b8";
                  return (
                    <li
                      key={`${h.at}-${i}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm"
                      style={{ background: i === 0 ? `${color}1f` : "transparent" }}
                    >
                      <span className="truncate font-bold" style={{ color }}>
                        {p?.nickname ?? "—"}
                      </span>
                      <span className="font-black tabular-nums">{h.amount}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {auction.passedPlayerIds.length > 0 ? (
              <p className="mt-3 text-[11px] text-white/35">
                Passed:{" "}
                {auction.passedPlayerIds
                  .map((id) => snapshot.players.find((p) => p.id === id)?.nickname ?? "?")
                  .join(", ")}
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>My team</SectionTitle>
          <ol className="space-y-1 px-4 pb-4">
            {Array.from({ length: perPlayer }).map((_, i) => {
              const owned = me?.roster[i];
              const c = owned ? charactersById[owned.characterId] : null;
              return (
                <li
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm"
                >
                  <span className="w-4 text-white/25">{i + 1}</span>
                  <span className={`flex-1 truncate font-bold ${c ? "" : "text-white/25"}`}>
                    {c ? c.name : "—"}
                  </span>
                  {owned ? (
                    <span className="text-xs font-black tabular-nums text-amber-300">
                      {owned.price}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
