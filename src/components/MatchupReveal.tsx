"use client";

import type { StateResponse } from "@/lib/client/api";
import { kindLabel, matchupsForRound, reasonSentence, type MatchupView } from "@/lib/client/matchup";
import { playerColor } from "@/lib/game/colors";
import { Panel, SectionTitle } from "./ui";

/**
 * Who you face this round, and one line of why.
 *
 * `MatchupSide` is split out rather than inlined because it is the seam Visual
 * 2.0 replaces in S8.11: everything about how a player is *drawn* lives below
 * this line, everything about who is playing whom lives above it.
 *
 * No rating appears anywhere in this file. They are recorded so the reason can
 * be audited later, not so somebody can be shown a number that says how good
 * they are — a schedule that displays its own scoring is a scoreboard, and the
 * design refuses to be one.
 */
function MatchupSide({
  name,
  colorHex,
  you,
}: {
  name: string;
  colorHex: string;
  you: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: colorHex }}
        aria-hidden
      />
      <span className="min-w-0 truncate text-sm font-black" style={{ color: colorHex }}>
        {name}
        {you ? <span className="ml-1 text-[10px] font-bold text-white/35">you</span> : null}
      </span>
    </div>
  );
}

export function MatchupReveal({
  snapshot,
  roundNo,
  meId,
}: {
  snapshot: StateResponse;
  roundNo: number;
  meId: string | null;
}) {
  const matchups = matchupsForRound(snapshot, roundNo, meId);
  if (matchups.length === 0) return null;

  const colorOf = (id: string | null) =>
    playerColor(snapshot.players.find((p) => p.id === id)?.colorIndex ?? 0).hex;

  // The viewer's own first. The rest stay, because watching each other's rounds
  // is most of why people are in the room.
  const ordered = [...matchups].sort((a, b) => Number(b.mine) - Number(a.mine));
  const mine = ordered.find((m) => m.mine) ?? null;

  return (
    <Panel>
      <div className="p-3 sm:p-4">
        <SectionTitle>This round</SectionTitle>

        {mine ? <Headline view={mine} colorOf={colorOf} /> : null}

        <ul className="mt-3 space-y-1.5">
          {ordered.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-xl border px-2.5 py-2"
              style={{
                borderColor: m.mine ? "rgba(34,211,238,0.35)" : "rgba(255,255,255,0.08)",
                background: m.mine ? "rgba(34,211,238,0.07)" : "transparent",
              }}
            >
              <MatchupSide
                name={m.playerName}
                colorHex={colorOf(m.playerId)}
                you={m.mine && m.opponentId !== null}
              />

              {m.opponentId ? (
                <>
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.2em] text-white/25">
                    vs
                  </span>
                  <MatchupSide
                    name={m.opponentName ?? "—"}
                    colorHex={colorOf(m.opponentId)}
                    you={false}
                  />
                </>
              ) : (
                <span className="shrink-0 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-300">
                  {kindLabel(m.kind)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

/** The viewer's own matchup, said plainly. */
function Headline({
  view,
  colorOf,
}: {
  view: MatchupView;
  colorOf: (id: string | null) => string;
}) {
  const sentence = reasonSentence(view.reason, view.opponentName);

  return (
    <div className="mt-2 text-center">
      {view.opponentId ? (
        <p className="headline text-[clamp(1.3rem,7vw,2rem)] leading-tight">
          <span style={{ color: colorOf(view.playerId) }}>You</span>
          <span className="mx-2 text-white/25">vs</span>
          <span style={{ color: colorOf(view.opponentId) }}>{view.opponentName}</span>
        </p>
      ) : (
        <p className="headline text-[clamp(1.3rem,7vw,2rem)] leading-tight text-violet-300">
          {kindLabel(view.kind)}
        </p>
      )}
      {sentence ? (
        <p className="mt-1 text-xs font-semibold text-white/50">{sentence}</p>
      ) : null}
    </div>
  );
}
