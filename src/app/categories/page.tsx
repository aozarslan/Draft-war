import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { CATEGORIES } from "@/lib/game/categories";
import { categoryCounts } from "@/lib/server/engine";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Categories · DRAFT WAR",
  description:
    "Eight battle categories, each with its own character pool, stat schema and synergies.",
};

export default async function CategoriesPage() {
  // A missing database should not take the marketing page down.
  let counts: Record<string, number> = {};
  try {
    counts = await categoryCounts();
  } catch {
    counts = {};
  }

  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <header className="mb-6">
          <h1 className="headline text-[clamp(2rem,8vw,3.5rem)] neon-text">
            Choose your battle
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-white/50">
            Each category has its own pool, its own stats and its own synergies.
            Mix two or more and every rating is normalised onto one scale so a
            crossover is still a fair fight.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => (
            <article
              key={c.id}
              className="glass overflow-hidden rounded-2xl"
              style={{ borderColor: `${c.accent}33` }}
            >
              <div
                className="flex h-28 items-center justify-center text-6xl"
                style={{ background: `linear-gradient(135deg, ${c.palette[0]}, ${c.palette[1]}99)` }}
              >
                {c.icon}
              </div>
              <div className="p-4">
                <h2 className="headline text-xl" style={{ color: c.accent }}>
                  {c.name}
                </h2>
                <p className="mt-1 text-xs text-white/55">{c.description}</p>
                <p className="mt-3 text-[10px] font-black uppercase tracking-wider text-white/35">
                  {counts[c.id] ?? 0} characters
                </p>

                <div className="mt-3 flex flex-wrap gap-1">
                  {c.stats.map((s) => (
                    <span
                      key={s.key}
                      className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold text-white/45"
                    >
                      {s.icon} {s.label}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {c.synergies.slice(0, 3).map((s) => (
                    <span
                      key={s.tag}
                      className="rounded-full border border-cyan-400/25 px-2 py-0.5 text-[10px] font-bold text-cyan-300"
                    >
                      {s.label}
                    </span>
                  ))}
                </div>

                <p className="mt-3 text-[10px] leading-snug text-white/30">{c.disclaimer}</p>

                <Link
                  href={`/characters?category=${c.id}`}
                  className="btn !min-h-9 mt-3 w-full !text-[11px]"
                >
                  Browse {c.name}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </main>
    </>
  );
}
