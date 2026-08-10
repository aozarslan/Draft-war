"use client";

import { useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import { playerColor } from "@/lib/game/colors";
import { charactersPerPlayer } from "@/lib/game/auction";
import { Panel, SectionTitle } from "./ui";
import { play } from "@/lib/client/sound";

export function Lobby({ store }: { store: RoomStore }) {
  const { snapshot, me, act } = store;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!snapshot) return null;
  const { room, players } = snapshot;

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";
  const everyoneReady = players.length > 0 && players.every((p) => p.isReady);
  const enoughPlayers = players.length >= room.config.minPlayers;
  const perPlayer = charactersPerPlayer(
    Math.max(1, players.length),
    room.config.poolSize,
    room.config.charactersPerPlayer,
  );
  const leftover = room.config.poolSize - players.length * perPlayer;

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
    await act({ type: "START" });
    setBusy(false);
  }

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
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          right={
            <span className="text-[11px] font-black text-white/45">
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
                    {p.connected ? "online" : "reconnecting…"}
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
            { label: "Credits", value: room.config.startingCredits },
            { label: "Pool", value: room.config.poolSize },
            { label: "Per player", value: perPlayer },
            { label: "Unused", value: Math.max(0, leftover) },
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
              ? "Starting auction…"
              : !enoughPlayers
                ? `Need ${room.config.minPlayers} players`
                : !everyoneReady
                  ? "Waiting for everyone"
                  : "Start game"}
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
