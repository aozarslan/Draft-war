"use client";

import { useEffect, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import { playerColor } from "@/lib/game/colors";
import { draftSize, rosterSize } from "@/lib/game/auction";
import { CATEGORIES_BY_ID } from "@/lib/game/categories";
import { totalRoundsFor } from "@/lib/game/rounds";
import { play } from "@/lib/client/sound";
import { Panel, SectionTitle } from "./ui";

const CATEGORY_MODES = [
  { id: "HOST", label: "I choose", hint: "You pick the category" },
  { id: "VOTE", label: "We vote", hint: "Everyone votes, most wins" },
  { id: "RANDOM", label: "Surprise us", hint: "Drawn at random" },
] as const;

const ROOM_SIZES = [2, 3, 4, 5, 6] as const;

export function Lobby({ store }: { store: RoomStore }) {
  const { snapshot, me, act } = store;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"HOST" | "VOTE" | "RANDOM">(
    snapshot?.room.config.categoryMode ?? "HOST",
  );

  // The host may have settled the category when they made the room.
  useEffect(() => {
    if (snapshot?.room.config.categoryMode) setMode(snapshot.room.config.categoryMode);
  }, [snapshot?.room.config.categoryMode]);

  if (!snapshot) return null;
  const { room, players } = snapshot;

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";
  // For the friend who wants to see it but not play, or who arrived after the
  // room filled up. Watching takes no seat.
  const watchUrl =
    typeof window !== "undefined" ? `${window.location.origin}/watch/${room.code}` : "";
  const [copiedWatch, setCopiedWatch] = useState(false);
  const everyoneReady = players.length > 0 && players.every((p) => p.isReady);
  const enoughPlayers = players.length >= room.config.minPlayers;
  const isFull = players.length >= room.config.maxPlayers;

  const perPlayer = rosterSize(room.config);
  const draftTotal = draftSize(Math.max(players.length, 1), room.config);
  const plannedTotal = draftSize(room.config.maxPlayers, room.config);

  const preset = (room.config.categories ?? [])
    .map((id) => CATEGORIES_BY_ID[id])
    .filter(Boolean);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      play("click");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      store.pushToast("error", "Copy failed — select the link manually.");
    }
  }

  async function startGame() {
    setBusy(true);
    await act({ type: "START", mode });
    setBusy(false);
  }

  /**
   * S8: the round-based match, beside the classic single-battle game rather
   * than replacing it. The round count is not offered as a choice — the server
   * derives it from the table size, so the button only says what will happen.
   */
  async function startMatch() {
    setBusy(true);
    await act({ type: "START_MATCH" });
    setBusy(false);
  }

  // Stated with the seat count it is derived from, not on its own. Six rounds
  // is right for two players and wrong for three, and the difference between
  // them is whether somebody is still typing their nickname on the join screen
  // — which the host cannot see. A bare "6 rounds" reads as a rule; "2 players
  // · 6 rounds" reads as a fact about the room.
  const seatedPlayers = players.length;
  const matchRounds = totalRoundsFor(Math.max(seatedPlayers, 1));

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="relative px-5 py-6 text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_180px_at_50%_0%,rgba(34,211,238,0.18),transparent)]" />
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-white/40">
            Room code
          </p>
          <p className="headline mt-1 text-[clamp(2.5rem,14vw,4.5rem)] tracking-[0.12em] neon-text">
            {room.code}
          </p>
          {room.name ? (
            <p className="mt-1 text-sm font-semibold text-white/60">{room.name}</p>
          ) : null}
          <p className="mt-2 text-xs font-semibold text-white/45">
            {room.config.maxPlayers} players. {room.config.startingCredits} credits each.
            Draft {plannedTotal} characters. Build the strongest {perPlayer}-person team.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button className="btn btn-primary flex-1" onClick={copyLink}>
              {copied ? "✅ Link copied" : "📋 Share room"}
            </button>
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <button
                className="btn flex-1"
                onClick={() =>
                  navigator
                    .share({ title: "DRAFT WAR", text: `Join my room: ${room.code}`, url: shareUrl })
                    .catch(() => {})
                }
              >
                📱 Send to friends
              </button>
            ) : null}
          </div>
          <p className="mt-3 break-all text-[11px] text-white/30">{shareUrl}</p>

          <button
            className="btn mt-2 w-full !min-h-9 !text-[11px]"
            onClick={() => {
              void navigator.clipboard.writeText(watchUrl).then(() => {
                setCopiedWatch(true);
                setTimeout(() => setCopiedWatch(false), 1800);
              });
            }}
          >
            {copiedWatch ? "✅ Watch link copied" : "📺 Copy watch link · no seat needed"}
          </button>
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          right={
            <span
              className={`text-[11px] font-black ${isFull ? "text-amber-300" : "text-white/45"}`}
            >
              {isFull ? "ROOM FULL · " : ""}
              {players.length} / {room.config.maxPlayers}
            </span>
          }
        >
          Players
        </SectionTitle>
        <ul className="space-y-2 px-4 pb-4">
          {players.map((p, i) => {
            const color = playerColor(p.colorIndex);
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border px-3 py-3"
                style={{
                  borderColor: `${color.hex}44`,
                  background: `linear-gradient(90deg, ${color.hex}18, transparent)`,
                }}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black"
                  style={{ background: color.hex, color: "#05060c" }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">
                    {p.nickname}
                    {p.id === me?.id ? <span className="text-white/40"> (you)</span> : null}
                  </span>
                  <span className="text-[11px] text-white/40">
                    {p.isHost ? "👑 Host · " : ""}
                    💰 {p.credits}
                    {p.connected ? "" : " · reconnecting…"}
                    {p.gamesPlayed > 0 ? ` · ${p.points} pts` : ""}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wider ${
                    p.isReady ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/35"
                  }`}
                >
                  {p.isReady ? "READY" : "NOT READY"}
                </span>
              </li>
            );
          })}

          {Array.from({ length: Math.max(0, room.config.maxPlayers - players.length) }).map(
            (_, i) => (
              <li
                key={`empty-${i}`}
                className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-3 py-3 text-white/25"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-sm font-black">
                  {players.length + i + 1}
                </span>
                <span className="text-sm font-semibold">Waiting for a player…</span>
              </li>
            ),
          )}
        </ul>
      </Panel>

      <Panel>
        <SectionTitle>This game</SectionTitle>
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-4">
          {[
            { label: "Credits each", value: room.config.startingCredits },
            { label: "Roster", value: perPlayer },
            { label: "Draft", value: draftTotal },
            { label: "Bid clock", value: `${room.config.auctionSeconds}s` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 px-3 py-3 text-center">
              <div className="text-2xl font-black tabular-nums">{s.value}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      {me?.isHost ? (
        <Panel>
          <SectionTitle
            right={
              <span className="text-[10px] text-white/30">
                credits and roster are fixed for now
              </span>
            }
          >
            Max players
          </SectionTitle>
          <div className="grid grid-cols-5 gap-2 px-4 pb-4">
            {ROOM_SIZES.map((n) => {
              const on = room.config.maxPlayers === n;
              const tooSmall = n < players.length;
              return (
                <button
                  key={n}
                  disabled={tooSmall}
                  onClick={() => {
                    play("click");
                    void act({ type: "SET_MAX_PLAYERS", maxPlayers: n });
                  }}
                  aria-pressed={on}
                  title={tooSmall ? "Somebody is already sitting in that seat" : undefined}
                  className="rounded-xl border py-3 text-center transition disabled:opacity-30"
                  style={{
                    borderColor: on ? "#22d3ee" : "rgba(255,255,255,0.1)",
                    background: on ? "rgba(34,211,238,0.12)" : "transparent",
                  }}
                >
                  <div className="text-xl font-black tabular-nums">{n}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">
                    {n * perPlayer} chars
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* The host who already chose at creation is not asked again. */}
      {me?.isHost && preset.length > 0 ? (
        <Panel>
          <SectionTitle>Battle</SectionTitle>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
            {preset.map((c) => (
              <span
                key={c.id}
                className="rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wide"
                style={{ borderColor: `${c.accent}66`, color: c.accent }}
              >
                {c.icon} {c.name}
              </span>
            ))}
            <span className="text-[11px] text-white/35">
              {preset.length > 1 ? "Crossover — picked when you made the room." : "Picked when you made the room."}
            </span>
          </div>
        </Panel>
      ) : null}

      {me?.isHost && preset.length === 0 ? (
        <Panel>
          <SectionTitle>How do we pick the category?</SectionTitle>
          <div className="grid grid-cols-3 gap-2 px-4 pb-4">
            {CATEGORY_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  play("click");
                  setMode(m.id);
                }}
                aria-pressed={mode === m.id}
                className="rounded-xl border px-2 py-3 text-center transition"
                style={{
                  borderColor: mode === m.id ? "#22d3ee" : "rgba(255,255,255,0.1)",
                  background: mode === m.id ? "rgba(34,211,238,0.12)" : "transparent",
                }}
              >
                <div className="text-xs font-black uppercase tracking-wide">{m.label}</div>
                <div className="mt-0.5 text-[10px] text-white/40">{m.hint}</div>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      <div className="sticky bottom-3 z-20 space-y-2">
        <button
          className={`btn w-full ${me?.isReady ? "" : "btn-primary"}`}
          onClick={() => {
            play("click");
            void act({ type: "READY", ready: !me?.isReady });
          }}
        >
          {me?.isReady ? "Cancel ready" : "I'm ready"}
        </button>

        {me?.isHost ? (
          <button
            className="btn btn-hot w-full"
            disabled={busy || !everyoneReady || !enoughPlayers}
            onClick={startGame}
          >
            {busy
              ? "Opening the draft…"
              : !enoughPlayers
                ? `Need ${room.config.minPlayers} players`
                : !everyoneReady
                  ? "Waiting for everyone"
                  : "Klasik Maç (tek savaş)"}
          </button>
        ) : null}

        {me?.isHost ? (
          <button
            className="btn w-full"
            disabled={busy || !everyoneReady || !enoughPlayers}
            onClick={startMatch}
          >
            {`⚔️ Turnuva Maçı · ${matchRounds} tur`}
          </button>
        ) : (
          <p className="text-center text-xs font-semibold text-white/40">
            Waiting for the host to start…
          </p>
        )}
      </div>
    </div>
  );
}
