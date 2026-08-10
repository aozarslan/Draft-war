"use client";

import { useEffect } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { BattleMap, EventCard } from "@/lib/game/types";
import { play } from "@/lib/client/sound";
import { Countdown, Panel } from "./ui";

/** The dramatic beat between the draft and the fight. */
export function EventReveal({
  store,
  maps,
  events,
}: {
  store: RoomStore;
  maps: BattleMap[];
  events: EventCard[];
}) {
  const { snapshot, me, act, serverNow } = store;
  const game = snapshot?.game ?? null;

  useEffect(() => {
    play("reveal");
  }, []);

  if (!game) return null;
  const map = maps.find((m) => m.id === game.mapId);
  const event = events.find((e) => e.id === game.eventId);

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      {map ? (
        <div
          className="glass w-full max-w-md animate-[rise_0.4s] overflow-hidden rounded-2xl"
          style={{ borderColor: `${map.palette[1]}66` }}
        >
          <div
            className="flex items-center gap-3 px-5 py-4"
            style={{ background: `linear-gradient(120deg, ${map.palette[0]}, ${map.palette[1]}66)` }}
          >
            <span className="text-4xl">{map.icon}</span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60">
                Battlefield
              </p>
              <h3 className="headline text-2xl">{map.name}</h3>
            </div>
          </div>
          <div className="px-5 py-3">
            <p className="text-xs text-white/55">{map.description}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {map.modifiers.map((m) => (
                <li
                  key={m.tag}
                  className="rounded-full border border-emerald-400/30 px-2.5 py-1 text-[11px] font-bold text-emerald-300"
                >
                  {m.tag} +{Math.round(m.bonus * 100)}%
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {event ? (
        <div className="w-full max-w-md animate-[slam_0.6s_0.25s_both]">
          <div
            className="glass overflow-hidden rounded-2xl border-2"
            style={{ borderColor: "#fbbf24" }}
          >
            <div className="bg-gradient-to-br from-amber-500/25 to-rose-500/20 px-5 py-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-200/80">
                Event card
              </p>
              <div className="my-2 text-6xl">{event.icon}</div>
              <h3 className="headline text-3xl text-amber-200">{event.name}</h3>
              <p className="mt-2 text-sm font-semibold text-white/70">{event.description}</p>
            </div>
          </div>
        </div>
      ) : null}

      <Panel className="w-full max-w-md">
        <div className="flex items-center gap-3 p-4">
          <div className="flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
              Battle begins in
            </p>
            <Countdown endsAt={game.phaseDeadline} now={serverNow} className="text-3xl" />
          </div>
          {me?.isHost ? (
            <button className="btn btn-hot" onClick={() => act({ type: "ADVANCE" })}>
              Fight now
            </button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
