"use client";

import { useState } from "react";
import type { StateResponse } from "@/lib/client/api";
import type { Character } from "@/lib/game/types";
import { boardOf, pricesOf } from "@/lib/client/economy";
import { nicknameFor } from "@/lib/game/characters";
import { playerColor } from "@/lib/game/colors";
import { BOARD_CAPACITY } from "@/lib/game/rounds";
import { CharacterImage } from "./CharacterImage";
import { CharacterModal } from "./CharacterModal";
import { Panel, SectionTitle } from "./ui";

/**
 * What a squad has become, round by round.
 *
 * The board is read from `match.board`, which the server writes at the moment
 * a sale resolves. It is deliberately not accumulated on the client from round
 * rosters: `snapshot.players[].roster` is scoped to the current round's game,
 * so summing it here would silently drop every earlier round — the exact bug
 * "previous board preserved" exists to catch.
 *
 * `BoardCharacter` is split out as its own component rather than inlined
 * because it is the seam Visual 2.0 replaces in S8.11. Everything about how a
 * fighter is *drawn* lives below this line; everything about which fighters
 * exist lives above it.
 */
export function BoardCharacter({
  character,
  characterId,
  price,
  benched,
  color,
  onClick,
}: {
  character: Character | undefined;
  characterId: string;
  price?: number;
  benched: boolean;
  color: string;
  onClick?: () => void;
}) {
  const name = character?.name ?? characterId;
  const nick = nicknameFor(characterId, name);

  return (
    <div
      className={`relative flex w-[72px] shrink-0 flex-col items-center gap-1 ${onClick ? "cursor-pointer" : ""}`}
      style={{ opacity: benched ? 0.55 : 1 }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <div
        className="relative h-[72px] w-[72px] overflow-hidden rounded-xl border"
        style={{ borderColor: `${color}55`, background: `${color}12` }}
      >
        {character ? (
          <CharacterImage character={character} className="h-full w-full object-cover" />
        ) : null}
        {typeof price === "number" ? (
          <span className="absolute bottom-0 right-0 rounded-tl-lg bg-black/70 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-amber-300">
            {price}
          </span>
        ) : null}
      </div>
      <span className="w-full truncate text-center text-[10px] font-bold leading-tight text-white/75">
        {name}
      </span>
      {nick !== name ? (
        <span className="w-full truncate text-center text-[8px] font-black uppercase tracking-[0.18em] text-amber-300/70">
          {nick}
        </span>
      ) : null}
    </div>
  );
}

export function MatchBoard({
  snapshot,
  charactersById,
  playerId,
  title,
}: {
  snapshot: StateResponse;
  charactersById: Record<string, Character>;
  playerId: string;
  title?: string;
}) {
  const [detail, setDetail] = useState<Character | null>(null);

  const slots = boardOf(snapshot, playerId);
  const prices = pricesOf(snapshot);
  const player = snapshot.players.find((p) => p.id === playerId);
  const color = playerColor(player?.colorIndex ?? 0).hex;

  const board = slots.filter((s) => s.zone !== "BENCH");
  const bench = slots.filter((s) => s.zone === "BENCH");

  return (
    <>
      <Panel>
        <div className="p-3 sm:p-4">
          <SectionTitle>
            {title ?? "Your squad"} · {board.length}/{BOARD_CAPACITY}
          </SectionTitle>

          {slots.length === 0 ? (
            <p className="mt-3 text-center text-xs font-semibold text-white/35">
              Nothing drafted yet. Win a lot and it lands here.
            </p>
          ) : (
            <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
              {board.map((s) => {
                const c = charactersById[s.characterId];
                return (
                  <BoardCharacter
                    key={s.characterId}
                    characterId={s.characterId}
                    character={c}
                    price={prices[s.characterId]}
                    benched={false}
                    color={color}
                    onClick={c ? () => setDetail(c) : undefined}
                  />
                );
              })}
            </div>
          )}

          {bench.length > 0 ? (
            <>
              <p className="mt-3 text-[10px] font-black uppercase tracking-[0.28em] text-white/30">
                Bench
              </p>
              <div className="no-scrollbar mt-1.5 flex gap-2 overflow-x-auto pb-1">
                {bench.map((s) => {
                  const c = charactersById[s.characterId];
                  return (
                    <BoardCharacter
                      key={s.characterId}
                      characterId={s.characterId}
                      character={c}
                      price={prices[s.characterId]}
                      benched
                      color={color}
                      onClick={c ? () => setDetail(c) : undefined}
                    />
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </Panel>

      <CharacterModal character={detail} onClose={() => setDetail(null)} />
    </>
  );
}
