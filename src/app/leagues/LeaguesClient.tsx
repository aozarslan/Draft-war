"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { accountHeaders, getAccount } from "@/lib/client/account";
import { Avatar, TitleTag } from "@/components/ProfileBadge";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";
import { play } from "@/lib/client/sound";

interface LeagueSummary {
  id: string;
  name: string;
  code: string;
  isOwner: boolean;
  members: number;
  joinedAt: string;
}

interface Standing {
  profileId: string;
  username: string;
  avatar: string;
  frame: string | null;
  title: string | null;
  level: number;
  matches: number;
  wins: number;
  mvps: number;
  points: number;
  averagePower: number | null;
  draftEfficiency: number | null;
}

interface Table {
  ok: true;
  league: { id: string; name: string; code: string; startsAt: string; endsAt: string | null };
  members: number;
  games: number;
  standings: Standing[];
}

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Private leagues: a table for one group of friends that means something after
 * twenty games.
 *
 * Which matches count is derived, never tagged — a game counts when at least
 * two members were in it. Nobody has to remember to mark a room as a league
 * game at the exact moment everybody is trying to start playing, and a match
 * played before you joined does not retroactively appear on your row.
 */
export function LeaguesClient() {
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/leagues", { headers: accountHeaders(), cache: "no-store" });
    const body = await res.json().catch(() => null);
    setLeagues(body?.ok ? (body.leagues as LeagueSummary[]) : []);
  }, []);

  useEffect(() => {
    if (!getAccount()) {
      setLeagues([]);
      return;
    }
    void load();
  }, [load]);

  const openTable = useCallback(async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setTable(null);
    const res = await fetch(`/api/leagues?id=${id}`, {
      headers: accountHeaders(),
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (body?.ok) setTable(body as Table);
  }, [openId]);

  async function run(key: string, body: unknown, okText: string) {
    setBusy(key);
    setFlash(null);
    try {
      const res = await fetch("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json", ...accountHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.message ?? "That did not work.");
      await load();
      setFlash({ kind: "ok", text: okText });
      play("sold");
    } catch (err) {
      setFlash({ kind: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(null);
    }
  }

  if (leagues === null) return <LoadingScreen label="Finding your leagues…" />;

  if (!getAccount()) {
    return (
      <EmptyState
        icon="🏆"
        title="Leagues need a name."
        hint="Claim a profile and you can start a table for your group."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Panel accent="#fbbf24">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="text-3xl">🏆</span>
          <div className="min-w-0 flex-1">
            <h1 className="headline text-2xl">Leagues</h1>
            <p className="text-[11px] text-white/45">
              A private table for your group. Any game with two members in it counts.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length < 3) return;
              void run("create", { action: "CREATE", name: name.trim() }, `${name.trim()} created.`);
              setName("");
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Draft Night"
              maxLength={32}
              className="min-w-0 flex-1"
            />
            <button className="btn btn-primary shrink-0" disabled={busy === "create" || name.trim().length < 3}>
              Create
            </button>
          </form>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!code.trim()) return;
              void run("join", { action: "JOIN", code: code.trim().toUpperCase() }, "Joined.");
              setCode("");
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="Join code"
              maxLength={6}
              autoCapitalize="characters"
              className="min-w-0 flex-1"
            />
            <button className="btn shrink-0" disabled={busy === "join" || code.trim().length < 4}>
              Join
            </button>
          </form>
        </div>
      </Panel>

      {flash ? (
        <p
          className={`rounded-xl border px-3 py-2 text-center text-xs font-bold ${
            flash.kind === "ok"
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              : "border-rose-400/30 bg-rose-400/10 text-rose-200"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      {leagues.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No leagues yet."
          hint="Create one and share the code with the people you play with."
        />
      ) : (
        leagues.map((l) => (
          <Panel key={l.id}>
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
              onClick={() => void openTable(l.id)}
              aria-expanded={openId === l.id}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black">{l.name}</span>
                <span className="block text-[10px] text-white/40">
                  {l.members} member{l.members === 1 ? "" : "s"} · code{" "}
                  <span className="font-black tracking-widest text-amber-300">{l.code}</span>
                  {l.isOwner ? " · you run this" : ""}
                </span>
              </span>
              <span className="shrink-0 text-white/30">{openId === l.id ? "▾" : "▸"}</span>
            </button>

            {openId === l.id ? (
              !table ? (
                <p className="px-4 pb-4 text-[11px] text-white/30">Counting…</p>
              ) : (
                <>
                  <SectionTitle
                    right={
                      <span className="text-[10px] text-white/35">
                        {table.games} game{table.games === 1 ? "" : "s"} counted
                      </span>
                    }
                  >
                    Table
                  </SectionTitle>

                  {table.standings.length === 0 ? (
                    <p className="px-4 pb-4 text-[11px] text-white/35">
                      Nothing counted yet. A game counts once two members of this
                      league play in it together.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 px-4 pb-3">
                      {table.standings.map((s, i) => (
                        <li
                          key={s.profileId}
                          className="flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-2"
                        >
                          <span className="w-6 text-center text-sm">{MEDALS[i] ?? i + 1}</span>
                          <Avatar avatar={s.avatar} frame={s.frame} size={30} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-black">{s.username}</span>
                            <span className="flex items-center gap-1.5 text-[10px] text-white/40">
                              {s.matches} played · {s.wins}W · {s.mvps} MVP
                              {s.draftEfficiency ? ` · ${s.draftEfficiency} eff` : ""}
                              <TitleTag title={s.title} className="!text-[9px]" />
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm font-black tabular-nums text-amber-300">
                              {s.points}
                            </span>
                            <span className="block text-[9px] font-bold uppercase text-white/35">
                              pts
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex gap-2 px-4 pb-4">
                    <button
                      className="btn !min-h-9 flex-1 !text-[11px]"
                      onClick={() => {
                        void navigator.clipboard.writeText(l.code);
                        setFlash({ kind: "ok", text: `Code ${l.code} copied.` });
                      }}
                    >
                      📋 Copy code
                    </button>
                    <button
                      className="btn btn-ghost !min-h-9 shrink-0 !px-3 !text-[11px] text-white/40"
                      onClick={() => {
                        const message = l.isOwner
                          ? `Delete ${l.name}? This removes the league for everybody.`
                          : `Leave ${l.name}?`;
                        if (!confirm(message)) return;
                        void run("leave", { action: "LEAVE", leagueId: l.id }, l.isOwner ? "Deleted." : "Left.");
                        setOpenId(null);
                      }}
                    >
                      {l.isOwner ? "Delete" : "Leave"}
                    </button>
                  </div>
                </>
              )
            ) : null}
          </Panel>
        ))
      )}

      <p className="text-center text-[10px] leading-relaxed text-white/25">
        Points follow the same 3 / 2 / 1 the game already awards, so a league
        table and a room&apos;s season table can never disagree about what a
        result was worth.
      </p>

      <div className="flex gap-2">
        <Link href="/friends" className="btn flex-1">
          Friends
        </Link>
        <Link href="/#play" className="btn btn-primary flex-1">
          Play
        </Link>
      </div>
    </div>
  );
}
