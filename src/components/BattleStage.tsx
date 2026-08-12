"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { BattleLogEntry, BattleMap, Character, EventCard } from "@/lib/game/types";
import { playerColor } from "@/lib/game/colors";
import { getCategory } from "@/lib/game/categories";
import { play } from "@/lib/client/sound";
import { Panel, SectionTitle } from "./ui";

const ICONS: Record<BattleLogEntry["kind"], string> = {
  ROUND_START: "🔔",
  PHASE: "🔔",
  TURNING_POINT: "🔥",
  ATTACK: "⚔️",
  CRIT: "💥",
  SPECIAL: "⚡",
  BLOCK: "🛡️",
  ELIMINATION: "☠️",
  END: "🏁",
};

/**
 * Cinematic playback. The whole battle is computed and stored server-side the
 * moment the phase starts; each client simply replays it against
 * `battleStartedAt`, so four phones stay frame-aligned without any streaming.
 */
export function BattleStage({
  store,
  charactersById,
  maps,
  events,
}: {
  store: RoomStore;
  charactersById: Record<string, Character>;
  maps: BattleMap[];
  events: EventCard[];
}) {
  const { snapshot, me, act, serverNow } = store;
  const [elapsed, setElapsed] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const lastPlayed = useRef(-1);

  const result = snapshot?.game?.battleResult ?? null;
  const startedAt = snapshot?.game?.battleStartedAt ?? null;

  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    const id = setInterval(() => setElapsed(Math.max(0, serverNow() - start)), 90);
    return () => clearInterval(id);
  }, [startedAt, serverNow]);

  const visible = useMemo(
    () => (result ? result.log.filter((e) => e.atMs <= elapsed) : []),
    [result, elapsed],
  );

  // Sound cues fire once, as each new entry becomes visible.
  useEffect(() => {
    if (visible.length === 0 || visible.length - 1 === lastPlayed.current) return;
    lastPlayed.current = visible.length - 1;
    const entry = visible[visible.length - 1];
    if (entry.kind === "CRIT" || entry.kind === "ELIMINATION") play("crit");
    else if (entry.kind === "SPECIAL") play("bid");
    else if (entry.kind === "ROUND_START") play("tick");
  }, [visible]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [visible.length]);

  if (!snapshot || !result) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-4 py-14">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-rose-400" />
          <p className="text-sm font-black uppercase tracking-[0.2em] text-white/50">
            Calculating battle…
          </p>
        </div>
      </Panel>
    );
  }

  const map = maps.find((m) => m.id === result.mapId);
  const event = events.find((e) => e.id === result.eventId);

  // Live tallies derived from what the viewer has actually seen so far.
  const damageByTeam = new Map<string, number>();
  const eliminated = new Set<string>();
  for (const e of visible) {
    if (e.damage && e.actorTeamId) {
      damageByTeam.set(e.actorTeamId, (damageByTeam.get(e.actorTeamId) ?? 0) + e.damage);
    }
    if (e.kind === "ELIMINATION" && e.targetId) eliminated.add(e.targetId);
  }
  // Scale against the final totals rather than the running maximum, so the bars
  // only ever grow instead of re-scaling every time the lead changes hands.
  const maxDamage = Math.max(1, ...result.teams.map((t) => t.totalDamage));
  const progress = Math.min(100, (elapsed / Math.max(1, result.durationMs)) * 100);
  const currentRound = visible.length ? visible[visible.length - 1].round : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-center gap-2 text-center">
        {(result.categoryIds ?? []).map((id) => {
          const c = getCategory(id);
          return (
            <span
              key={id}
              className="rounded-full border px-3 py-1 text-xs font-black"
              style={{ borderColor: `${c.accent}66`, color: c.accent }}
            >
              {c.icon} {c.name}
            </span>
          );
        })}
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold">
          {map?.icon} {map?.name}
        </span>
        <span className="rounded-full border border-amber-400/30 px-3 py-1 text-xs font-bold text-amber-200">
          {event?.icon} {event?.name}
        </span>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold">
          Round {currentRound}
        </span>
      </div>

      <div className="stat-bar">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-2">
          {snapshot.players.map((p) => {
            const color = playerColor(p.colorIndex);
            const dmg = damageByTeam.get(p.id) ?? 0;
            const alive = p.roster.filter((r) => !eliminated.has(r.characterId)).length;
            const forecast = result.teams.find((t) => t.playerId === p.id);

            return (
              <Panel key={p.id} accent={color.hex}>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-black" style={{ color: color.hex }}>
                      {p.nickname}
                    </span>
                    <span className="text-[10px] font-bold text-white/40">
                      {forecast ? `${forecast.winProbability}% odds` : ""}
                    </span>
                  </div>

                  <div className="mt-2 flex gap-1">
                    {p.roster.map((r) => {
                      const dead = eliminated.has(r.characterId);
                      return (
                        <span
                          key={r.characterId}
                          title={charactersById[r.characterId]?.name}
                          className="grid h-7 flex-1 place-items-center rounded text-[10px] font-black transition"
                          style={{
                            background: dead ? "rgba(255,255,255,0.05)" : `${color.hex}30`,
                            color: dead ? "rgba(255,255,255,0.25)" : "#fff",
                            textDecoration: dead ? "line-through" : "none",
                          }}
                        >
                          {dead
                            ? "☠"
                            : (charactersById[r.characterId]?.name ?? "?")
                                .split(" ")
                                .map((w) => w[0])
                                .join("")
                                .slice(0, 2)}
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <div className="stat-bar flex-1">
                      <div
                        className="h-full rounded-full transition-[width] duration-300"
                        style={{ width: `${(dmg / maxDamage) * 100}%`, background: color.hex }}
                      />
                    </div>
                    <span className="w-14 text-right text-xs font-black tabular-nums">
                      {dmg} dmg
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-white/35">{alive} still standing</p>
                </div>
              </Panel>
            );
          })}
        </div>

        <Panel className="flex min-h-[320px] flex-col">
          <SectionTitle>Battle log</SectionTitle>
          <div
            ref={feedRef}
            className="max-h-[52dvh] flex-1 overflow-y-auto px-4 pb-4 lg:max-h-[62dvh]"
          >
            <ul className="space-y-1.5">
              {visible.map((e, i) => {
                const color = e.actorTeamId
                  ? playerColor(
                      snapshot.players.find((p) => p.id === e.actorTeamId)?.colorIndex ?? 0,
                    ).hex
                  : "#94a3b8";

                if (e.kind === "ROUND_START") {
                  return (
                    <li key={i} className="pt-3">
                      <div className="flex items-center gap-2">
                        <span className="h-px flex-1 bg-white/10" />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
                          {e.text}
                        </span>
                        <span className="h-px flex-1 bg-white/10" />
                      </div>
                    </li>
                  );
                }

                if (e.kind === "END") {
                  return (
                    <li key={i} className="animate-[slam_0.5s_both] py-4 text-center">
                      <p className="headline text-2xl neon-text">{e.text}</p>
                    </li>
                  );
                }

                return (
                  <li
                    key={i}
                    className="flex animate-[rise_0.25s_ease-out] items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
                    style={{
                      background:
                        e.kind === "CRIT" || e.kind === "ELIMINATION"
                          ? "rgba(244,63,94,0.12)"
                          : e.kind === "SPECIAL"
                            ? "rgba(251,191,36,0.12)"
                            : "transparent",
                      borderLeft: `3px solid ${color}`,
                    }}
                  >
                    <span className="shrink-0">{ICONS[e.kind]}</span>
                    <span className="min-w-0 flex-1">{e.text}</span>
                    {e.damage ? (
                      <span className="shrink-0 font-black tabular-nums text-rose-300">
                        -{e.damage}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          {me?.isHost ? (
            <div className="border-t border-white/10 p-3">
              <button className="btn btn-ghost w-full" onClick={() => act({ type: "ADVANCE" })}>
                Skip to results
              </button>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
