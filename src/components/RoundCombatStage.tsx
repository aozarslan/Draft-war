"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { Character } from "@/lib/game/types";
import { playerColor } from "@/lib/game/colors";
import { buildStage, elapsedFor } from "@/lib/render/stage";
import { highlightsOf } from "@/lib/render/highlights";
import { narrativeOf } from "@/lib/render/narrative";
import { BattleCanvas } from "./BattleCanvas";
import { BattleNarration } from "./BattleNarration";
import { Panel } from "./ui";

const DURATION_OVERRIDE_MS = 18_000;

/**
 * Cinematic playback for a single round matchup in S8.
 *
 * The battle was already simulated server-side before this phase started.
 * This component reads the result from `snapshot.match.matchups`, projects
 * it into an 18-second replay, and plays it back in sync with the server clock.
 *
 * "Atla" jumps elapsed to the end so the player does not have to wait.
 */
export function RoundCombatStage({
  store,
  charactersById,
}: {
  store: RoomStore;
  charactersById: Record<string, Character>;
}) {
  const { snapshot, me, serverNow } = store;
  const [elapsed, setElapsed] = useState(0);
  const [skipped, setSkipped] = useState(false);

  const match = snapshot?.match ?? null;

  // The viewer's own matchup for the current round.
  const matchup = useMemo(() => {
    if (!match || !me) return null;
    return (
      match.matchups.find(
        (m) =>
          m.roundNo === match.roundNo &&
          (m.playerA === me.id || m.playerB === me.id),
      ) ?? null
    );
  }, [match, me]);

  const result = matchup?.battleResult ?? null;
  const startedAt = matchup?.startedAt ?? null;
  const duration = DURATION_OVERRIDE_MS;

  const [calmMotion, setCalmMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setCalmMotion(query.matches);
    const onChange = () => setCalmMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const players = snapshot?.players ?? [];

  const stage = useMemo(
    () =>
      buildStage(
        {
          battleId: matchup?.id ?? "round-combat",
          result: startedAt ? result : null,
          players: players.map((p) => ({
            id: p.id,
            nickname: p.nickname,
            formation: p.formation,
            colorHex: playerColor(p.colorIndex).hex,
          })),
          charactersById,
        },
        { durationOverrideMs: DURATION_OVERRIDE_MS },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchup?.id, result, startedAt, players, charactersById],
  );

  const cues = useMemo(
    () => (stage ? narrativeOf(stage.replay, highlightsOf(stage.replay)) : []),
    [stage],
  );

  const elapsedFn = () =>
    skipped
      ? duration
      : elapsedFor(startedAt, serverNow(), duration);

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setElapsed(elapsedFn()), 90);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, serverNow, duration, skipped]);

  const progress = Math.min(100, (elapsed / Math.max(1, duration)) * 100);

  // Spinner while waiting for the battle to be simulated or to start.
  if (!result || !startedAt) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-4 py-14">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-rose-400" />
          <p className="text-sm font-black uppercase tracking-[0.2em] text-white/50">
            Savaş hazırlanıyor…
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="stat-bar">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-400 transition-[width] duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Arena */}
      {stage ? (
        <Panel>
          <BattleCanvas
            className="aspect-video w-full rounded-xl bg-[#0b1220]"
            replay={stage.replay}
            art={stage.art}
            interactions={stage.interactions}
            teamColors={stage.teamColors}
            reducedMotion={calmMotion}
            elapsedMs={elapsedFn}
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="min-w-0 flex-1">
              <BattleNarration cues={cues} elapsedMs={elapsedFn} />
            </div>
            {!skipped && progress < 100 ? (
              <button
                className="btn btn-ghost shrink-0 text-sm"
                onClick={() => setSkipped(true)}
              >
                Atla
              </button>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
