"use client";

import type { StateResponse } from "@/lib/client/api";
import type { Character } from "@/lib/game/types";
import { matchAwards, matchStandings, type StandingRow } from "@/lib/client/standings";
import { boardOf, pricesOf } from "@/lib/client/economy";
import { playerColor } from "@/lib/game/colors";
import { nicknameFor } from "@/lib/game/characters";
import { Panel, SectionTitle } from "./ui";
import { CharacterImage } from "./CharacterImage";

/**
 * How the match ended.
 *
 * The last screen five people look at together, so it says only what the
 * server recorded. There is no estimated placing, no projected champion and no
 * award handed to whoever came closest — anything without a real figure behind
 * it is left out.
 *
 * Round combat is not wired up yet, so a match played today ends with every
 * seat on full health and no rounds won. Rather than crown somebody out of a
 * tie-break, the screen says the match was never decided and shows the draft,
 * which is the half that does work.
 */
export function MatchResults({
  snapshot,
  charactersById,
  meId,
}: {
  snapshot: StateResponse;
  charactersById: Record<string, Character>;
  meId: string | null;
}) {
  const standings = matchStandings(snapshot);
  if (!standings) return null;
  const awards = matchAwards(snapshot, charactersById);

  return (
    <div className="space-y-3">
      <Panel className="overflow-hidden">
        <div className="relative px-4 py-6 text-center sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(520px_180px_at_50%_0%,rgba(251,191,36,0.20),transparent)]" />
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-white/40">
            {standings.roundsPlayed} of {standings.totalRounds} rounds
          </p>

          {standings.champion ? (
            <>
              <p className="mt-2 text-4xl" aria-hidden>👑</p>
              <p
                className="headline mt-1 text-[clamp(1.8rem,10vw,3rem)] leading-none"
                style={{ color: playerColor(standings.champion.colorIndex).hex }}
              >
                {standings.champion.nickname}
              </p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.28em] text-amber-300/80">
                Champion
              </p>
            </>
          ) : (
            <>
              <p className="headline mt-2 text-[clamp(1.5rem,8vw,2.4rem)] leading-tight neon-text">
                Draft complete
              </p>
              {/* Honest rather than tidy: nothing in this match separated the
                  players, so nobody is crowned. */}
              <p className="mx-auto mt-2 max-w-[30ch] text-xs font-semibold text-white/45">
                No battles were fought this match, so there is no champion — only
                the squads everybody built.
              </p>
            </>
          )}
        </div>
      </Panel>

      {/* ---- The table ---------------------------------------------------- */}
      <Panel>
        <div className="p-3 sm:p-4">
          <SectionTitle>Final standings</SectionTitle>
          <ul className="mt-2 divide-y divide-white/5">
            {standings.rows.map((row) => (
              <StandingLine key={row.playerId} row={row} mine={row.playerId === meId} />
            ))}
          </ul>
        </div>
      </Panel>

      {/* ---- Awards ------------------------------------------------------- */}
      {awards.length > 0 ? (
        <Panel>
          <div className="p-3 sm:p-4">
            <SectionTitle>The draft</SectionTitle>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {awards.map((award) => (
                <li
                  key={award.key}
                  className="flex items-baseline justify-between gap-2 rounded-xl border border-white/8 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-black uppercase tracking-[0.22em] text-white/35">
                      {award.label}
                    </span>
                    <span className="block truncate text-sm font-black">{award.nickname}</span>
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-white/45">
                    {award.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      ) : null}

      {/* ---- Every squad, because the draft is the match ------------------- */}
      {standings.rows.map((row) => (
        <SquadPanel
          key={row.playerId}
          snapshot={snapshot}
          charactersById={charactersById}
          row={row}
          mine={row.playerId === meId}
        />
      ))}
    </div>
  );
}

function StandingLine({ row, mine }: { row: StandingRow; mine: boolean }) {
  const color = playerColor(row.colorIndex).hex;
  const out = row.eliminatedAt !== null;

  return (
    <li className="flex items-center gap-2.5 py-2.5" style={{ opacity: out ? 0.5 : 1 }}>
      <span className="w-5 shrink-0 text-center text-sm font-black tabular-nums text-white/30">
        {row.rank}
      </span>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-black">
        {row.nickname}
        {mine ? <span className="ml-1 text-[10px] font-bold text-white/35">you</span> : null}
      </span>

      {out ? (
        <span className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-rose-300">
          Out · R{row.eliminatedAt}
        </span>
      ) : (
        <span className="shrink-0 text-sm font-black tabular-nums text-rose-300">❤️ {row.hp}</span>
      )}
      <span className="shrink-0 text-[11px] font-bold tabular-nums text-white/40">
        {row.squadSize} drafted
      </span>
      <span className="shrink-0 text-sm font-black tabular-nums text-amber-300">💰 {row.credits}</span>
    </li>
  );
}

/**
 * One player's finished squad.
 *
 * `SquadCharacter` is kept as its own component for the same reason
 * `BoardCharacter` and `MatchupSide` are: it is where Visual 2.0 replaces the
 * artwork in S8.11, and nothing above it knows how a fighter is drawn.
 */
function SquadPanel({
  snapshot,
  charactersById,
  row,
  mine,
}: {
  snapshot: StateResponse;
  charactersById: Record<string, Character>;
  row: StandingRow;
  mine: boolean;
}) {
  const slots = boardOf(snapshot, row.playerId);
  if (slots.length === 0) return null;
  const prices = pricesOf(snapshot);
  const color = playerColor(row.colorIndex).hex;

  return (
    <Panel>
      <div className="p-3 sm:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-black" style={{ color }}>
            {row.nickname}
            {mine ? <span className="ml-1 text-[10px] font-bold text-white/35">you</span> : null}
          </span>
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-white/35">
            {row.spent} spent
          </span>
        </div>

        <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto pb-1">
          {slots.map((slot) => (
            <SquadCharacter
              key={slot.characterId}
              characterId={slot.characterId}
              character={charactersById[slot.characterId]}
              price={prices[slot.characterId]}
              benched={slot.zone === "BENCH"}
              color={color}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SquadCharacter({
  character,
  characterId,
  price,
  benched,
  color,
}: {
  character: Character | undefined;
  characterId: string;
  price?: number;
  benched: boolean;
  color: string;
}) {
  const name = character?.name ?? characterId;
  const nick = nicknameFor(characterId, name);

  return (
    <div
      className="flex w-[64px] shrink-0 flex-col items-center gap-1"
      style={{ opacity: benched ? 0.5 : 1 }}
    >
      <div
        className="relative h-[64px] w-[64px] overflow-hidden rounded-xl border"
        style={{ borderColor: `${color}55`, background: `${color}12` }}
      >
        {character ? (
          <CharacterImage character={character} className="h-full w-full object-cover" />
        ) : null}
        {typeof price === "number" ? (
          <span className="absolute bottom-0 right-0 rounded-tl-lg bg-black/70 px-1 py-0.5 text-[9px] font-black tabular-nums text-amber-300">
            {price}
          </span>
        ) : null}
      </div>
      <span className="w-full truncate text-center text-[9px] font-bold leading-tight text-white/70">
        {name}
      </span>
      {nick !== name ? (
        <span className="w-full truncate text-center text-[8px] font-black uppercase tracking-[0.16em] text-amber-300/60">
          {nick}
        </span>
      ) : null}
    </div>
  );
}
