"use client";

import { getCategory } from "@/lib/game/categories";
import type { Character } from "@/lib/game/types";
import { CharacterImage } from "./CharacterImage";

const RARITY_COLOR: Record<string, string> = {
  COMMON: "#94a3b8",
  RARE: "#38bdf8",
  EPIC: "#a855f7",
  LEGENDARY: "#fbbf24",
};

/**
 * The card used everywhere a character is listed: the database page, team
 * review, the results screen. The auction has its own larger presentation.
 *
 * Everything on it is derived from the character and its category, so a new
 * category with completely different stat names renders correctly with no
 * changes here.
 */
export function CharacterCard({
  character,
  onOpen,
  price,
  footer,
  compact = false,
}: {
  character: Character;
  onOpen?: (character: Character) => void;
  /** Shown as the paid price when the card represents a drafted character. */
  price?: number;
  footer?: React.ReactNode;
  compact?: boolean;
}) {
  const category = getCategory(character.categoryId);
  const rarity = RARITY_COLOR[character.rarity] ?? "#94a3b8";
  const Wrapper = onOpen ? "button" : "div";

  return (
    <Wrapper
      {...(onOpen
        ? { onClick: () => onOpen(character), type: "button" as const }
        : {})}
      className="glass group relative flex w-full flex-col overflow-hidden rounded-2xl p-0 text-left transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      style={{ borderColor: `${category.accent}33` }}
      aria-label={onOpen ? `${character.name} details` : undefined}
    >
      <div className={`relative w-full ${compact ? "aspect-[4/5]" : "aspect-[3/4]"}`}>
        <CharacterImage character={character} sizes="(max-width: 640px) 45vw, 220px" />

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />

        <span
          className="absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[9px] font-black tracking-widest backdrop-blur"
          style={{ background: "rgba(0,0,0,0.55)", color: rarity }}
        >
          {character.rarity}
        </span>

        <span
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg text-sm font-black backdrop-blur"
          style={{ background: "rgba(0,0,0,0.6)", color: category.accent }}
          title="Game power — a rating created for DRAFT WAR"
        >
          {character.gamePower}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-3">
          <p
            className="text-[9px] font-black uppercase tracking-[0.2em]"
            style={{ color: category.accent }}
          >
            {category.icon} {category.name}
          </p>
          <h3 className="headline truncate text-base leading-tight">{character.name}</h3>
          {character.version ? (
            <p className="text-[10px] font-bold text-white/45">{character.version}</p>
          ) : null}
        </div>
      </div>

      {!compact ? (
        <div className="space-y-1.5 p-3">
          {category.stats.slice(0, 4).map((stat) => {
            const value = character.stats[stat.key] ?? 0;
            return (
              <div key={stat.key} className="flex items-center gap-2">
                <span className="w-4 text-center text-[11px]" aria-hidden>
                  {stat.icon}
                </span>
                <span className="w-16 shrink-0 text-[10px] font-bold uppercase tracking-wide text-white/40">
                  {stat.label}
                </span>
                <span className="stat-bar flex-1">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.min(100, value)}%`,
                      background: `linear-gradient(90deg, ${category.accent}55, ${category.accent})`,
                    }}
                  />
                </span>
                <span className="w-6 text-right text-[10px] font-black tabular-nums">
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      {price !== undefined ? (
        <div className="border-t border-white/10 px-3 py-2 text-[11px] font-black tabular-nums text-amber-300">
          {price} credits
        </div>
      ) : null}

      {footer}
    </Wrapper>
  );
}
