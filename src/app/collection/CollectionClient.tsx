"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { accountHeaders, getAccount } from "@/lib/client/account";
import { CATEGORIES, getCategory } from "@/lib/game/categories";
import {
  categoryMasteryFromPoints,
  collectionLabel,
  collectionPercent,
  masteryBadge,
  masteryFromPoints,
} from "@/lib/game/mastery";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";

interface CategorySlice {
  categoryId: string;
  total: number;
  seen: number;
  drafted: number;
  points: number;
}

interface CharacterMastery {
  characterId: string;
  categoryId: string;
  drafts: number;
  wins: number;
  mvps: number;
  points: number;
  lastAt: string;
}

interface Payload {
  ok: true;
  categories: CategorySlice[];
  totals: { total: number; drafted: number; matches: number };
  characters: CharacterMastery[];
}

const pretty = (id: string) => id.replace(/^[a-z-]+?-/, "").replace(/-/g, " ");

/**
 * The long game: what you have drafted, how well you know it, and how much of
 * each category you have seen.
 *
 * Everything here is derived from match history rather than counted as you
 * play, so it cannot drift away from the games actually recorded — and nothing
 * on this page makes anybody stronger. Mastery is a level and a badge.
 */
export function CollectionClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "guest">("loading");
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccount()) {
      setState("guest");
      return;
    }
    void (async () => {
      const res = await fetch("/api/profile/collection", {
        headers: accountHeaders(),
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok === false) {
        setState("guest");
        return;
      }
      setData(body as Payload);
      setState("ready");
    })();
  }, []);

  if (state === "loading") return <LoadingScreen label="Opening the collection…" />;
  if (state === "guest" || !data) {
    return (
      <EmptyState
        icon="🗂"
        title="Collections need a name."
        hint="Claim a profile and every character you draft starts counting."
      />
    );
  }

  const overall = collectionPercent({
    total: data.totals.total,
    seen: 0,
    drafted: data.totals.drafted,
  });
  const byCharacter = new Map(data.characters.map((c) => [c.characterId, c]));

  return (
    <div className="space-y-4">
      <Panel accent="#a78bfa">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="text-3xl">🗂</span>
          <div className="min-w-0 flex-1">
            <h1 className="headline text-2xl">Collection</h1>
            <p className="text-[11px] text-white/45">
              {data.totals.drafted} of {data.totals.total} characters drafted across{" "}
              {data.totals.matches} matches
            </p>
          </div>
          <span className="shrink-0 text-2xl font-black tabular-nums text-fuchsia-300">
            {overall}%
          </span>
        </div>
        <div className="px-4 pb-4">
          <div className="stat-bar">
            <div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 transition-[width] duration-700"
              style={{ width: `${overall}%` }}
            />
          </div>
        </div>
      </Panel>

      {CATEGORIES.map((category) => {
        const slice =
          data.categories.find((c) => c.categoryId === category.id) ??
          ({ categoryId: category.id, total: 0, seen: 0, drafted: 0, points: 0 } as CategorySlice);
        const percent = collectionPercent(slice);
        const mastery = categoryMasteryFromPoints(slice.points);
        const open = openCategory === category.id;

        // Characters of this category the player has actually drafted.
        const mine = data.characters
          .filter((c) => c.categoryId === category.id)
          .sort((a, b) => b.points - a.points);

        return (
          <Panel key={category.id}>
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              onClick={() => setOpenCategory(open ? null : category.id)}
              aria-expanded={open}
            >
              <span className="text-xl">{category.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-black" style={{ color: category.accent }}>
                  {category.name}
                </span>
                <span className="block text-[10px] text-white/40">
                  {slice.drafted} / {slice.total} drafted · {slice.seen} seen ·{" "}
                  {collectionLabel(slice)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-xs font-black tabular-nums">{percent}%</span>
                <span className="block text-[9px] font-bold uppercase tracking-wider text-white/35">
                  mastery {mastery.level}
                </span>
              </span>
              <span className="shrink-0 text-white/30">{open ? "▾" : "▸"}</span>
            </button>

            <div className="px-4 pb-3">
              <div className="stat-bar">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${percent}%`, background: category.accent }}
                />
              </div>
            </div>

            {open ? (
              mine.length === 0 ? (
                <p className="px-4 pb-4 text-[11px] text-white/30">
                  Nothing drafted here yet. Play a {category.name} game and it starts filling in.
                </p>
              ) : (
                <ul className="space-y-1 px-4 pb-4">
                  {mine.map((c) => {
                    const level = masteryFromPoints(c.points);
                    const badge = masteryBadge(level.level);
                    return (
                      <li
                        key={c.characterId}
                        className="flex items-center gap-2 rounded-lg border border-white/8 px-2.5 py-1.5"
                      >
                        <span className="text-sm" style={{ color: badge.colour }}>
                          {badge.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-black capitalize">
                            {pretty(c.characterId)}
                          </span>
                          <span className="block text-[9px] text-white/35">
                            {c.drafts} drafts · {c.wins}W · {c.mvps} MVP
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span
                            className="block text-[10px] font-black"
                            style={{ color: badge.colour }}
                          >
                            {badge.label} {level.level}
                          </span>
                          <span className="block text-[9px] tabular-nums text-white/30">
                            {level.toNext} to next
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </Panel>
        );
      })}

      <p className="text-center text-[10px] leading-relaxed text-white/25">
        Mastery is a record of what you have played, never an advantage. A level
        20 character bids and fights exactly like a level 1 one.
      </p>

      <div className="flex gap-2">
        <Link href="/profile" className="btn flex-1">
          Profile
        </Link>
        <Link href="/#play" className="btn btn-primary flex-1">
          Play
        </Link>
      </div>
    </div>
  );
}
