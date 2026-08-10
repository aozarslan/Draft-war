"use client";

import type { Category } from "@/lib/game/categories";

/**
 * The disclaimer that has to travel with every rating in this game.
 *
 * It matters most for the two real-world categories: the Hollywood entries are
 * real people and the Animals entries are real animals, and neither set of
 * numbers is a measurement of anything. Fictional categories get the shorter
 * version. Never render a stat block without one of these nearby.
 */
export function GameRatingNote({
  category,
  className = "",
}: {
  category: Category;
  className?: string;
}) {
  return (
    <p
      className={`rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] leading-snug text-white/40 ${className}`}
    >
      <span className="font-black uppercase tracking-wider text-white/55">
        Game rating
      </span>{" "}
      — {category.disclaimer}
    </p>
  );
}
