"use client";

import type { RoomStore } from "@/lib/client/useRoom";
import type { BattleMap } from "@/lib/game/types";
import { playerColor } from "@/lib/game/colors";
import { play } from "@/lib/client/sound";
import { Countdown, Panel } from "./ui";

export function MapSelection({
  store,
  maps,
}: {
  store: RoomStore;
  maps: BattleMap[];
}) {
  const { snapshot, me, act, serverNow } = store;
  if (!snapshot?.game) return null;

  const byId = Object.fromEntries(maps.map((m) => [m.id, m]));
  const candidates = (snapshot.game.mapCandidates ?? [])
    .map((id) => byId[id])
    .filter(Boolean);
  const myVote = me ? snapshot.mapVotes[me.id] : undefined;

  const votesFor = (mapId: string) =>
    snapshot.players.filter((p) => snapshot.mapVotes[p.id] === mapId);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="headline text-[clamp(1.8rem,8vw,3rem)] neon-text">Choose the ground</h2>
        <p className="mt-1 text-sm font-semibold text-white/50">
          Every battlefield favours a different kind of fighter.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
            Voting ends in
          </span>
          <Countdown
            endsAt={snapshot.game.phaseDeadline}
            now={serverNow}
            className="text-xl"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {candidates.map((m) => {
          const voters = votesFor(m.id);
          const mine = myVote === m.id;
          return (
            <button
              key={m.id}
              onClick={() => {
                play("click");
                void act({ type: "VOTE_MAP", mapId: m.id });
              }}
              className="glass group relative overflow-hidden rounded-2xl p-0 text-left transition active:scale-[0.98]"
              style={{ borderColor: mine ? m.palette[1] : undefined }}
              aria-pressed={mine}
            >
              <div
                className="flex h-28 items-center justify-center text-5xl"
                style={{
                  background: `linear-gradient(135deg, ${m.palette[0]}, ${m.palette[1]}88)`,
                }}
              >
                {m.icon}
              </div>
              <div className="p-4">
                <h3 className="headline text-lg">{m.name}</h3>
                <p className="mt-1 text-xs text-white/50">{m.description}</p>
                <ul className="mt-2 space-y-0.5">
                  {m.modifiers.map((mod) => (
                    <li key={mod.tag} className="text-[11px] font-bold text-emerald-300">
                      {mod.tag} +{Math.round(mod.bonus * 100)}%
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex min-h-6 items-center gap-1">
                  {voters.map((v) => (
                    <span
                      key={v.id}
                      title={v.nickname}
                      className="rounded-full px-2 py-0.5 text-[10px] font-black"
                      style={{
                        background: `${playerColor(v.colorIndex).hex}30`,
                        color: playerColor(v.colorIndex).hex,
                      }}
                    >
                      {v.nickname}
                    </span>
                  ))}
                  {voters.length === 0 ? (
                    <span className="text-[10px] text-white/25">no votes yet</span>
                  ) : null}
                </div>
              </div>
              {mine ? (
                <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[10px] font-black backdrop-blur">
                  YOUR VOTE
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <Panel>
        <div className="p-4">
          {me?.isHost ? (
            <button className="btn btn-hot w-full" onClick={() => act({ type: "ADVANCE" })}>
              Lock it in now
            </button>
          ) : (
            <p className="text-center text-xs font-semibold text-white/40">
              Ties are broken at random. The event card comes next.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
