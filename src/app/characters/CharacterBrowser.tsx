"use client";

import { useEffect, useMemo, useState } from "react";
import type { Character, Rarity } from "@/lib/game/types";
import type { Category } from "@/lib/game/categories";
import { CharacterCard } from "@/components/CharacterCard";
import { CharacterModal } from "@/components/CharacterModal";
import { LoadingScreen, EmptyState, Panel } from "@/components/ui";

const RARITIES: Rarity[] = ["LEGENDARY", "EPIC", "RARE", "COMMON"];
const PAGE = 48;

/**
 * The browsable character database.
 *
 * The whole catalogue is a few hundred rows of static reference data, so it is
 * fetched once and every filter runs locally — typing "spider" should not cost
 * a round trip. Cards are paged in as you scroll so a phone is not asked to
 * decode 268 images at once.
 */
export function CharacterBrowser() {
  const [data, setData] = useState<{
    characters: Character[];
    categories: Category[];
    categoryCounts: Record<string, number>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<string>("all");
  const [rarity, setRarity] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [minPower, setMinPower] = useState(0);
  const [sort, setSort] = useState<"power" | "name">("power");
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<Character | null>(null);

  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok === false) throw new Error(d.message ?? "Could not load characters.");
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load characters."));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const rows = data.characters.filter((c) => {
      if (category !== "all" && c.categoryId !== category) return false;
      if (rarity !== "all" && c.rarity !== rarity) return false;
      if (c.gamePower < minPower) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.universe.toLowerCase().includes(q) ||
        (c.actor ?? "").toLowerCase().includes(q) ||
        c.tags.some((t) => t.includes(q)) ||
        c.abilities.some((a) => a.toLowerCase().includes(q))
      );
    });
    rows.sort((a, b) =>
      sort === "power"
        ? b.gamePower - a.gamePower || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
    return rows;
  }, [data, category, rarity, query, minPower, sort]);

  useEffect(() => setLimit(PAGE), [category, rarity, query, minPower, sort]);

  if (error) {
    return (
      <Panel>
        <EmptyState icon="⚠️" title={error} hint="Run the seed migration in Supabase." />
      </Panel>
    );
  }
  if (!data) return <LoadingScreen label="Loading the database…" />;

  return (
    <div className="space-y-4">
      <div className="glass space-y-3 rounded-2xl p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search characters…"
          aria-label="Search characters"
          className="!min-h-11"
        />

        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          <FilterChip active={category === "all"} onClick={() => setCategory("all")}>
            All · {data.characters.length}
          </FilterChip>
          {data.categories.map((c) => (
            <FilterChip
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              color={c.accent}
            >
              {c.icon} {c.name} · {data.categoryCounts[c.id] ?? 0}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            <FilterChip active={rarity === "all"} onClick={() => setRarity("all")}>
              Any rarity
            </FilterChip>
            {RARITIES.map((r) => (
              <FilterChip key={r} active={rarity === r} onClick={() => setRarity(r)}>
                {r}
              </FilterChip>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/45">
            Power ≥ {minPower}
            <input
              type="range"
              min={0}
              max={95}
              step={5}
              value={minPower}
              onChange={(e) => setMinPower(Number(e.target.value))}
              className="!min-h-0 w-28 !p-0"
              aria-label="Minimum game power"
            />
          </label>

          <div className="ml-auto flex gap-1.5">
            <FilterChip active={sort === "power"} onClick={() => setSort("power")}>
              By power
            </FilterChip>
            <FilterChip active={sort === "name"} onClick={() => setSort("name")}>
              A–Z
            </FilterChip>
          </div>
        </div>
      </div>

      <p className="text-xs font-bold uppercase tracking-wider text-white/35">
        {filtered.length} character{filtered.length === 1 ? "" : "s"}
      </p>

      {filtered.length === 0 ? (
        <Panel>
          <EmptyState icon="🔍" title="Nothing matches that." hint="Try a different filter." />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {filtered.slice(0, limit).map((c) => (
              <CharacterCard key={c.id} character={c} onOpen={setDetail} compact />
            ))}
          </div>
          {limit < filtered.length ? (
            <button className="btn w-full" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({filtered.length - limit} left)
            </button>
          ) : null}
        </>
      )}

      <CharacterModal character={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition"
      style={{
        borderColor: active ? (color ?? "#22d3ee") : "rgba(255,255,255,0.12)",
        color: active ? (color ?? "#22d3ee") : "rgba(255,255,255,0.5)",
        background: active ? `${color ?? "#22d3ee"}18` : "transparent",
      }}
    >
      {children}
    </button>
  );
}
