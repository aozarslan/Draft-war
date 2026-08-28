"use client";

import { useEffect } from "react";
import { getCategory } from "@/lib/game/categories";
import type { Character } from "@/lib/game/types";
import { CharacterImage, ImageCredit } from "./CharacterImage";
import { GameRatingNote } from "./GameRatingNote";
import { Nickname } from "./ui";
import { nicknameFor } from "@/lib/game/characters";

/**
 * Full character sheet. Opens as a centred dialog on desktop and a bottom sheet
 * on phones, which is where most of this game is played.
 */
export function CharacterModal({
  character,
  onClose,
}: {
  character: Character | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!character) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [character, onClose]);

  if (!character) return null;
  const category = getCategory(character.categoryId);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${character.name} details`}
    >
      <button
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />

      <div className="glass relative max-h-[92dvh] w-full max-w-lg animate-[rise_0.25s_ease-out] overflow-y-auto rounded-t-3xl sm:rounded-3xl">
        <div className="relative">
          <div className="aspect-[4/3] w-full sm:aspect-[16/10]">
            <CharacterImage character={character} priority sizes="512px" />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#05060c] via-transparent to-transparent" />

          <button
            onClick={onClose}
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-lg backdrop-blur"
            aria-label="Close"
          >
            ✕
          </button>

          <div className="absolute inset-x-0 bottom-0 p-4">
            <p
              className="text-[10px] font-black uppercase tracking-[0.25em]"
              style={{ color: category.accent }}
            >
              {category.icon} {category.name}
              {character.version ? ` · ${character.version}` : ""}
            </p>
            <Nickname
              nickname={nicknameFor(character.id, character.name)}
              name={character.name}
            />
            <h2 className="headline text-[clamp(1.6rem,7vw,2.4rem)] leading-none">
              {character.name}
            </h2>
            <p className="text-xs font-semibold text-white/55">
              {character.universe}
              {character.actor ? ` · played by ${character.actor}` : ""}
            </p>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {character.description ? (
            <p className="text-sm leading-relaxed text-white/70">
              {character.description}
            </p>
          ) : null}

          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: `${category.accent}18` }}
          >
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/45">
                Game power
              </p>
              <p
                className="headline text-4xl leading-none"
                style={{ color: category.accent }}
              >
                {character.gamePower}
              </p>
            </div>
            <p className="ml-auto max-w-[55%] text-[10px] leading-snug text-white/40">
              {category.disclaimer}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {category.stats.map((stat) => {
              const value = character.stats[stat.key] ?? 0;
              return (
                <div key={stat.key} title={`${stat.hint} — game rating, not an official ranking.`}>
                  <div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-wider text-white/45">
                    <span>
                      {stat.icon} {stat.label}
                    </span>
                    <span className="text-sm tabular-nums text-white/90">{value}</span>
                  </div>
                  <div className="stat-bar mt-1">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, value)}%`,
                        background: `linear-gradient(90deg, ${category.accent}55, ${category.accent})`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {character.abilities.length ? (
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
                Special abilities
              </p>
              <div className="flex flex-wrap gap-1.5">
                {character.abilities.map((a) => (
                  <span
                    key={a}
                    className="rounded-full border px-2.5 py-1 text-[11px] font-bold"
                    style={{ borderColor: `${category.accent}55`, color: category.accent }}
                  >
                    ⚡ {a}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {character.tags.length ? (
            <div className="flex flex-wrap gap-1">
              {character.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/40"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          <GameRatingNote category={category} />

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
            {character.wikiUrl ? (
              <a
                href={character.wikiUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-primary !min-h-10 flex-1 !text-[11px]"
              >
                Read Wikipedia ↗
              </a>
            ) : null}
            <button className="btn btn-ghost !min-h-10 !text-[11px]" onClick={onClose}>
              Close
            </button>
          </div>

          <ImageCredit character={character} />
          <p className="text-[10px] text-white/25">
            Source: Wikipedia / Wikimedia. DRAFT WAR is not affiliated with
            Wikipedia or with any rights holder.
          </p>
        </div>
      </div>
    </div>
  );
}
