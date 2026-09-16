"use client";

import { useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { Character } from "@/lib/game/types";
import { playerColor } from "@/lib/game/colors";
import { play } from "@/lib/client/sound";
import {
  PHASE_LABELS,
  ROUND_PHASES,
  isClockDriven,
  isMatchPhase,
  nextPhaseOf,
} from "@/lib/game/rounds";
import { AuctionStage } from "./AuctionStage";
import { MatchBoard } from "./MatchBoard";
import { MatchupReveal } from "./MatchupReveal";
import { MatchResults } from "./MatchResults";
import { RoundCombatStage } from "./RoundCombatStage";
import { Countdown, Panel } from "./ui";

/**
 * The round rail: where the match is, and what everybody's match looks like.
 *
 * S8.1 is the backbone milestone, so this screen shows *state* rather than
 * gameplay — there is no auction inside a round yet, no combat, no damage and
 * no board. What it does have to be is honest and legible at 375px, because
 * every later milestone hangs its own content off this frame.
 *
 * Nothing here decides anything. The phase, the round number, HP and credits
 * are read from `snapshot.match`, which the server derived; the host's button
 * sends `ADVANCE_MATCH` with no arguments and the server works out what that
 * means. A client cannot name a phase, so it cannot skip to one.
 */
export function MatchStage({
  store,
  charactersById,
}: {
  store: RoomStore;
  charactersById: Record<string, Character>;
}) {
  const { snapshot, me, act, serverNow, refresh } = store;
  const [busy, setBusy] = useState(false);

  const match = snapshot?.match ?? null;
  if (!match) return null;

  const phase = isMatchPhase(match.phase) ? match.phase : null;
  const players = snapshot?.players ?? [];
  const byId = new Map(players.map((p) => [p.id, p]));

  const finished = match.status !== "ACTIVE" || match.phase === "MATCH_RESULTS";
  const next = phase ? nextPhaseOf(phase, match) : null;
  // A phase the match does not own has no deadline of its own, so it waits for
  // whoever does own it. In S8.1 nobody does, and the host is the clock.
  const waitingOnHost = Boolean(phase && !isClockDriven(phase) && !finished);
  // A round's draft closes itself when every quota is filled. Until it has,
  // the server refuses to leave the phase, so the button should not offer it.
  const auctionRunning = phase === "AUCTION" && match.roundAuctionStatus === "ACTIVE";

  async function advance() {
    setBusy(true);
    play("click");
    await act({ type: "ADVANCE_MATCH" });
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      {/* ---- Where we are ------------------------------------------------ */}
      <Panel className="overflow-hidden">
        <div className="relative px-4 py-5 text-center sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(460px_160px_at_50%_0%,rgba(124,58,237,0.22),transparent)]" />

          <p className="text-[10px] font-black uppercase tracking-[0.32em] text-white/40">
            {finished ? "Match complete" : `Match ${match.matchNo}`}
          </p>

          <p className="headline mt-1 text-[clamp(2rem,11vw,3.5rem)] leading-none neon-text">
            {match.roundNo === 0 ? "READY" : `ROUND ${match.roundNo}`}
            {match.roundNo > 0 ? (
              <span className="text-white/30"> / {match.totalRounds}</span>
            ) : null}
          </p>

          <p className="mt-2 text-sm font-black uppercase tracking-[0.18em] text-cyan-300">
            {phase ? PHASE_LABELS[phase] : match.phase}
          </p>

          {/* ---- Persistent HP strip ------------------------------------ */}
          {!finished && match.roundNo > 0 ? (
            <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
              {match.players.map((mp) => {
                const player = byId.get(mp.playerId);
                const color = playerColor(player?.colorIndex ?? 0).hex;
                const out = mp.eliminatedAt !== null || mp.hp <= 0;
                return (
                  <div
                    key={mp.playerId}
                    className="flex items-center gap-1.5"
                    style={{ opacity: out ? 0.4 : 1 }}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="max-w-[72px] truncate text-[11px] font-bold text-white/65">
                      {player?.nickname ?? "?"}
                    </span>
                    {out ? (
                      <span className="text-[11px] font-black text-rose-400/60">OUT</span>
                    ) : (
                      <span className="text-[11px] font-black tabular-nums text-rose-300">
                        ❤️{mp.hp}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}

          {match.phaseDeadline && !finished ? (
            <Countdown
              endsAt={match.phaseDeadline}
              now={serverNow}
              onZero={() => void refresh({ tick: true })}
              className="mt-2 text-3xl"
            />
          ) : waitingOnHost && !auctionRunning ? (
            <p className="mt-2 text-[11px] font-semibold text-white/40">
              {/* TODO(S8.2 / S8.5): the auction and combat own their own clocks
                  and neither is wired into a round yet. */}
              Waiting for the host
            </p>
          ) : null}
        </div>

        {/* ---- The round, as a strip -------------------------------------- */}
        {!finished && match.roundNo > 0 ? (
          <ol
            className="flex gap-1 overflow-x-auto border-t border-white/5 px-3 py-3"
            aria-label={`Round ${match.roundNo} of ${match.totalRounds}`}
          >
            {ROUND_PHASES.map((p) => {
              const current = p === match.phase;
              const done = ROUND_PHASES.indexOf(p) < ROUND_PHASES.indexOf(match.phase as never);
              return (
                <li
                  key={p}
                  aria-current={current ? "step" : undefined}
                  className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide transition"
                  style={{
                    background: current
                      ? "rgba(34,211,238,0.18)"
                      : done
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
                    color: current ? "#67e8f9" : done ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.25)",
                    border: `1px solid ${current ? "rgba(34,211,238,0.45)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {PHASE_LABELS[p]}
                </li>
              );
            })}
          </ol>
        ) : null}
      </Panel>

      {/* ---- How it ended ------------------------------------------------ */}
      {finished ? (
        <MatchResults
          snapshot={snapshot!}
          charactersById={charactersById}
          meId={me?.id ?? null}
        />
      ) : null}

      {/* ---- The round's own content ------------------------------------- */}
      {!finished && phase === "AUCTION" ? (
        // The legacy auction screen, unchanged. It reads its wallet through
        // `creditsOf`, which returns match credits while a match is live, so
        // the MAX button is computed against the balance the server will check.
        <AuctionStage store={store} charactersById={charactersById} />
      ) : !finished && (phase === "COMBAT" || phase === "FINAL_COMBAT") ? (
        <RoundCombatStage store={store} charactersById={charactersById} />
      ) : !finished && me ? (
        <MatchBoard snapshot={snapshot!} charactersById={charactersById} playerId={me.id} />
      ) : null}

      {/* Who you face, from the moment the pairing is written until the round
          is settled. Absent before MATCHMAKING because there is nothing to
          reveal, and absent in the draft because the draft is its own screen. */}
      {phase === "MATCHMAKING" || phase === "COMBAT" || phase === "RESOLUTION" ? (
        <MatchupReveal snapshot={snapshot!} roundNo={match.roundNo} meId={me?.id ?? null} />
      ) : null}

      {/* ---- The table --------------------------------------------------- */}
      {!finished ? (
      <Panel>
        <ul className="divide-y divide-white/5">
          {match.players.map((mp) => {
            const player = byId.get(mp.playerId);
            const color = playerColor(player?.colorIndex ?? 0).hex;
            const out = mp.eliminatedAt !== null || mp.hp <= 0;

            return (
              <li
                key={mp.playerId}
                className="flex items-center gap-3 px-3 py-2.5"
                style={{ opacity: out ? 0.45 : 1 }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm font-black">
                  {player?.nickname ?? "—"}
                  {player?.id === me?.id ? (
                    <span className="ml-1 text-[10px] font-bold text-white/35">you</span>
                  ) : null}
                </span>

                {out ? (
                  <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-rose-300">
                    Out · R{mp.eliminatedAt}
                  </span>
                ) : (
                  <span className="shrink-0 text-sm font-black tabular-nums text-rose-300">
                    ❤️ {mp.hp}
                  </span>
                )}

                <span className="shrink-0 text-sm font-black tabular-nums text-amber-300">
                  💰 {mp.credits}
                </span>

                {match.pendingPlayerIds.includes(mp.playerId) && phase === "AUCTION" ? (
                  <span className="shrink-0 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-cyan-300">
                    {match.acquisitionRequired ? "needs" : "open"}
                  </span>
                ) : null}

                {mp.streak > 1 ? (
                  <span className="shrink-0 text-[11px] font-black text-orange-300">
                    🔥{mp.streak}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>
      ) : null}

      {/* ---- Host controls ----------------------------------------------- */}
      {me?.isHost ? (
        <div className="sticky bottom-3 z-20 space-y-2">
          {!finished ? (
            <button
              className="btn btn-hot w-full"
              disabled={busy || next === null || auctionRunning}
              onClick={advance}
            >
              {busy
                ? "…"
                : auctionRunning
                  ? "Draft in progress"
                  : next
                    ? `Next · ${PHASE_LABELS[next]}`
                    : "Match over"}
            </button>
          ) : null}
          <button
            className="btn w-full !min-h-9 !text-[11px]"
            onClick={() => {
              play("click");
              void act({ type: "ABANDON_MATCH" });
            }}
          >
            {finished ? "Back to lobby" : "End match"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
