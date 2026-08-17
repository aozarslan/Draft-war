"use client";

/**
 * ---------------------------------------------------------------------------
 * BATTLE SUMMARY CARD
 * ---------------------------------------------------------------------------
 * What happened, in the three seconds a player has before they scroll.
 *
 * One component for both the results screen and a shared match page, reading
 * one projection. Two implementations of "what happened" would eventually
 * disagree with each other, and the one a player pastes into a group chat is
 * exactly the one you cannot afford to have wrong.
 *
 * Every number arrives already decided. This file formats and lays out; it
 * does not add, divide or compare anything the engine did not already settle.
 * Sections whose source field is missing are simply absent — a shared legacy
 * match shows fewer lines rather than invented ones.
 */

import type { BattleSummary } from "@/lib/render/summary";
import { Panel } from "./ui";

export function BattleSummaryCard({
  summary,
  nameOf,
  colorOf,
  className,
}: {
  summary: BattleSummary;
  /** Turns a character id into a display name. Presentation only. */
  nameOf: (characterId: string) => string;
  /** Team colour for a player id, from their seat. */
  colorOf: (playerId: string) => string;
  className?: string;
}) {
  const { winner, runnerUp, mvp, turningPoint, upset, bestPerformer, biggestSurprise } =
    summary;
  if (!winner) return null;

  return (
    <Panel className={className} accent={colorOf(winner.playerId)}>
      <div className="space-y-3 p-4">
        {/* Who won, and by how much. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40">
              Result
            </p>
            <p className="truncate text-xl font-black">
              <span style={{ color: colorOf(winner.playerId) }}>{winner.nickname}</span>
              {runnerUp ? (
                <>
                  <span className="px-2 text-white/30">beat</span>
                  <span style={{ color: colorOf(runnerUp.playerId) }}>
                    {runnerUp.nickname}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-bold text-white/60">
            +{winner.points} pts
          </span>
        </div>

        {/* Was it a surprise? The forecast it beat says more than the word. */}
        {upset ? (
          <p className="rounded-lg border border-pink-400/40 bg-pink-400/10 px-3 py-2 text-xs font-black uppercase tracking-widest text-pink-300">
            🔥 Upset · won at {upset.wonAtProbability}%
          </p>
        ) : null}

        {/* Where it turned. The engine already wrote this sentence. */}
        {turningPoint ? (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">
            🔥 {turningPoint.text}
          </p>
        ) : null}

        {/* Who carried it, and by how much they beat what was expected. */}
        {mvp ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300/80">
                ⭐ MVP
              </p>
              <p className="truncate text-sm font-black">{nameOf(mvp.characterId)}</p>
            </div>
            <span
              className="shrink-0 text-sm font-black"
              style={{ color: mvp.performance >= 100 ? "#4ade80" : "#f87171" }}
            >
              {mvp.performance}%
              <span className="ml-1 text-[10px] font-bold text-white/35">
                of expectation
              </span>
            </span>
          </div>
        ) : null}

        {/* The engine's own two picks, when the source carried them. */}
        {bestPerformer || biggestSurprise ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {bestPerformer ? (
              <Note
                label="Best performer"
                name={nameOf(bestPerformer.characterId)}
                detail={`${bestPerformer.performance} score`}
              />
            ) : null}
            {biggestSurprise ? (
              <Note
                label="Biggest surprise"
                name={nameOf(biggestSurprise.characterId)}
                detail={`${biggestSurprise.performance} score for ${biggestSurprise.price} cr`}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function Note({
  label,
  name,
  detail,
}: {
  label: string;
  name: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-white/35">
        {label}
      </p>
      <p className="truncate text-sm font-bold">{name}</p>
      <p className="text-[11px] text-white/45">{detail}</p>
    </div>
  );
}
