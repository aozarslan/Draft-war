"use client";

import { useState } from "react";
import { CATEGORIES, CATEGORIES_BY_ID } from "@/lib/game/categories";
import { SiteNav } from "@/components/SiteNav";
import { Panel, SectionTitle } from "@/components/ui";

/**
 * Character importer.
 *
 * Development-only: the page refuses to render unless
 * NEXT_PUBLIC_DRAFT_WAR_DEV is "1", and the API behind it 404s in production
 * without DRAFT_WAR_DEV_KEY. Nothing here is reachable by a player.
 *
 * Two flows:
 *   single — fill in the stats, fetch Wikipedia, review, save
 *   bulk   — paste a list of names, review the report, save the good ones
 *
 * Ambiguous results are never resolved silently: the importer shows the
 * candidate pages and makes a human choose.
 */

interface WikiData {
  wikiTitle: string;
  wikiUrl: string;
  description: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  imageSource: string | null;
  imageLicense: string | null;
  imageCredit: string | null;
  ambiguous: boolean;
  candidates: { title: string; description: string | null }[];
}

interface BulkRow {
  name: string;
  status: string;
  data: WikiData | null;
  saved?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  ok: "✓ Found · image",
  "no-image": "⚠ Found · no image",
  ambiguous: "⚠ Ambiguous",
  "not-found": "✗ Not found",
};

async function admin(payload: Record<string, unknown>) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.message ?? "Request failed");
  return data;
}

export default function AdminPage() {
  const enabled = process.env.NEXT_PUBLIC_DRAFT_WAR_DEV === "1";
  const [tab, setTab] = useState<"single" | "bulk">("single");

  if (!enabled) {
    return (
      <>
        <SiteNav />
        <main className="mx-auto max-w-xl px-4 py-16 text-center">
          <p className="text-4xl">🔒</p>
          <h1 className="headline mt-3 text-2xl">Importer disabled</h1>
          <p className="mt-2 text-sm text-white/50">
            Set <code className="text-cyan-300">NEXT_PUBLIC_DRAFT_WAR_DEV=1</code> in
            your local environment to use the character importer.
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="headline text-[clamp(1.8rem,7vw,3rem)] neon-text">
          Character importer
        </h1>
        <p className="mt-1 text-sm text-white/50">
          Fetches page data, lead image and licence metadata from Wikimedia, then
          writes a character. Development only.
        </p>

        <div className="my-4 flex gap-2">
          <button
            className={`btn !min-h-9 !text-[11px] ${tab === "single" ? "btn-primary" : ""}`}
            onClick={() => setTab("single")}
          >
            Single import
          </button>
          <button
            className={`btn !min-h-9 !text-[11px] ${tab === "bulk" ? "btn-primary" : ""}`}
            onClick={() => setTab("bulk")}
          >
            Bulk list
          </button>
        </div>

        {tab === "single" ? <SingleImport /> : <BulkImport />}
      </main>
    </>
  );
}

function SingleImport() {
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [name, setName] = useState("");
  const [universe, setUniverse] = useState("");
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [actor, setActor] = useState("");
  const [tags, setTags] = useState("");
  const [abilities, setAbilities] = useState("");
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [wiki, setWiki] = useState<WikiData | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const category = CATEGORIES_BY_ID[categoryId];

  async function fetchWiki(exactTitle?: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await admin({
        op: "RESOLVE",
        name: search.trim() || name.trim(),
        wikiTitle: exactTitle,
      });
      setWiki(res.data ?? null);
      setStatus(STATUS_LABEL[res.status] ?? res.status);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const res = await admin({
        op: "SAVE",
        character: {
          name: name.trim(),
          categoryId,
          universe: universe.trim() || category.name,
          version: version.trim() || null,
          title: title.trim(),
          actor: actor.trim() || null,
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          abilities: abilities.split(",").map((t) => t.trim()).filter(Boolean),
          stats,
        },
        wiki,
      });
      setStatus(`✓ Saved ${res.id} — game power ${res.gamePower}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle>Character</SectionTitle>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-widest text-white/45">
            Category
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setStats({});
              }}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0a0d1a]">
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="Name" value={name} onChange={setName} placeholder="Spider-Man" />
          <Field label="Universe" value={universe} onChange={setUniverse} placeholder="Marvel Comics" />
          <Field label="Version" value={version} onChange={setVersion} placeholder="MCU / Comics" />
          <Field label="Card line" value={title} onChange={setTitle} placeholder="Your friendly neighbourhood" />
          <Field label="Actor (films)" value={actor} onChange={setActor} placeholder="Keanu Reeves" />
          <Field label="Tags (comma separated)" value={tags} onChange={setTags} placeholder="avengers, street" />
          <Field label="Abilities (comma separated)" value={abilities} onChange={setAbilities} placeholder="Web-Slinging" />
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Game stats — {category.name}</SectionTitle>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3">
          {category.stats.map((s) => (
            <label key={s.key} className="text-xs font-bold uppercase tracking-widest text-white/45">
              {s.icon} {s.label}
              <input
                type="number"
                min={1}
                max={100}
                value={stats[s.key] ?? ""}
                placeholder="60"
                onChange={(e) =>
                  setStats((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))
                }
                className="mt-1"
              />
            </label>
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Wikipedia</SectionTitle>
        <div className="space-y-3 px-4 pb-4">
          <Field
            label="Search term (defaults to the name)"
            value={search}
            onChange={setSearch}
            placeholder="Spider-Man (character)"
          />
          <button className="btn btn-primary w-full" disabled={busy || !name.trim()} onClick={() => fetchWiki()}>
            {busy ? "Fetching…" : "Fetch Wikipedia data"}
          </button>

          {status ? <p className="text-sm font-bold text-cyan-300">{status}</p> : null}

          {wiki?.ambiguous ? (
            <div className="rounded-xl border border-amber-400/30 p-3">
              <p className="text-xs font-bold text-amber-300">
                Ambiguous — pick the right page:
              </p>
              <ul className="mt-2 space-y-1">
                {wiki.candidates.map((c) => (
                  <li key={c.title}>
                    <button
                      className="text-left text-sm text-white/80 underline underline-offset-2"
                      onClick={() => fetchWiki(c.title)}
                    >
                      {c.title}
                      {c.description ? (
                        <span className="text-white/40"> — {c.description}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {wiki && !wiki.ambiguous ? (
            <div className="flex gap-3 rounded-xl border border-white/10 p-3">
              {wiki.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wiki.thumbnailUrl} alt="" className="h-24 w-20 rounded object-cover" />
              ) : (
                <div className="grid h-24 w-20 place-items-center rounded bg-white/5 text-center text-[9px] text-white/40">
                  No image
                </div>
              )}
              <div className="min-w-0 text-xs">
                <p className="font-bold">{wiki.wikiTitle}</p>
                <p className="mt-1 text-white/50">{wiki.description}</p>
                <p className="mt-1 text-[10px] text-white/35">
                  {wiki.imageLicense ?? "no licence reported"}
                  {wiki.imageCredit ? ` · ${wiki.imageCredit}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          <button className="btn btn-hot w-full" disabled={busy || !name.trim()} onClick={save}>
            Save character
          </button>
        </div>
      </Panel>
    </div>
  );
}

function BulkImport() {
  const [categoryId, setCategoryId] = useState(CATEGORIES[0].id);
  const [list, setList] = useState("");
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function resolve() {
    setBusy(true);
    setNote(null);
    try {
      const names = list.split("\n").map((n) => n.trim()).filter(Boolean);
      const res = await admin({ op: "BULK_RESOLVE", names });
      setRows(res.results);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    setBusy(true);
    let saved = 0;
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      const row = next[i];
      if (row.status === "not-found" || row.status === "ambiguous") continue;
      try {
        await admin({
          op: "SAVE",
          character: { name: row.name, categoryId, stats: {} },
          wiki: row.data,
        });
        next[i] = { ...row, saved: true };
        saved++;
      } catch {
        next[i] = { ...row, saved: false };
      }
    }
    setRows(next);
    setNote(`${saved} character(s) saved with neutral stats — edit them afterwards.`);
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle>Bulk list</SectionTitle>
        <div className="space-y-3 px-4 pb-4">
          <label className="text-xs font-bold uppercase tracking-widest text-white/45">
            Category
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#0a0d1a]">
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </label>

          <textarea
            rows={8}
            value={list}
            onChange={(e) => setList(e.target.value)}
            placeholder={"Spider-Man\nIron Man\nThor\nHulk"}
            className="font-mono text-sm"
          />
          <button className="btn btn-primary w-full" disabled={busy || !list.trim()} onClick={resolve}>
            {busy ? "Searching Wikipedia…" : "Search Wikipedia"}
          </button>
          {note ? <p className="text-sm font-bold text-cyan-300">{note}</p> : null}
        </div>
      </Panel>

      {rows.length ? (
        <Panel>
          <SectionTitle right={<span className="text-[11px] text-white/40">{rows.length} rows</span>}>
            Report
          </SectionTitle>
          <ul className="space-y-1 px-4 pb-4">
            {rows.map((r) => (
              <li key={r.name} className="flex items-center gap-2 text-sm">
                <span className="w-40 truncate font-bold">{r.name}</span>
                <span
                  className={
                    r.status === "ok"
                      ? "text-emerald-300"
                      : r.status === "not-found"
                        ? "text-rose-300"
                        : "text-amber-300"
                  }
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                {r.data?.wikiTitle ? (
                  <span className="truncate text-[11px] text-white/35">{r.data.wikiTitle}</span>
                ) : null}
                {r.saved ? <span className="ml-auto text-emerald-300">saved</span> : null}
              </li>
            ))}
          </ul>
          <div className="px-4 pb-4">
            <button className="btn btn-hot w-full" disabled={busy} onClick={saveAll}>
              Save everything that resolved
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-xs font-bold uppercase tracking-widest text-white/45">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1"
      />
    </label>
  );
}
