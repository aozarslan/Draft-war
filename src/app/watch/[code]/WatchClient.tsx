"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRoom } from "@/lib/client/useRoom";
import { getCategory } from "@/lib/game/categories";
import { playerColor } from "@/lib/game/colors";
import { LoadingScreen, Panel } from "@/components/ui";
import { AuctionStage } from "@/components/AuctionStage";
import { BattleStage } from "@/components/BattleStage";
import { TeamReview } from "@/components/TeamReview";
import { ResultsStage } from "@/components/ResultsStage";
import { MapSelection } from "@/components/MapSelection";
import { EventReveal } from "@/components/EventReveal";
import { CategorySelection } from "@/components/CategorySelection";
import type { RoomStore } from "@/lib/client/useRoom";

const WATCHER_KEY = "draftwar:watcher";

/** A stable per-browser id, so refreshing does not count as a new viewer. */
function watcherId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(WATCHER_KEY);
  if (!id) {
    id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(WATCHER_KEY, id);
  }
  return id;
}

/**
 * Watching a game.
 *
 * The same stage components the players see, driven by the same snapshot —
 * which is how V4's rule about not exposing hidden information is satisfied by
 * construction rather than by filtering. There is no separate spectator
 * payload that could drift and start showing something the players cannot see.
 *
 * What makes it read-only is not the UI: it is that every mutation requires a
 * (playerId, token) pair issued by joining, and a watcher has neither. The
 * store below hands the stages a null `me` and an `act` that refuses, so the
 * controls render inert instead of throwing.
 */
export function WatchClient({ code }: { code: string }) {
  const room = useRoom(code);
  const [watching, setWatching] = useState(0);

  // Heartbeat. Also how the players find out somebody is here.
  useEffect(() => {
    const id = watcherId();
    if (!id) return;
    const beat = async () => {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/watch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ watcherId: id }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (body?.ok) setWatching(Number(body.watching ?? 0));
    };
    void beat();
    const timer = setInterval(beat, 25_000);
    return () => clearInterval(timer);
  }, [code]);

  /**
   * A spectator's store: everything the players' store has, except a seat and
   * the ability to act. `me` being null is what the stages already use to
   * decide a control is not yours to press.
   */
  const store: RoomStore = useMemo(
    () => ({
      ...room,
      session: null,
      me: null,
      act: async () => false,
    }),
    [room],
  );

  const { snapshot, reference, loading, fatal } = room;

  if (fatal) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <p className="text-4xl">📺</p>
        <h1 className="headline mt-3 text-2xl">Nothing to watch</h1>
        <p className="mt-2 text-sm text-white/50">{fatal}</p>
        <Link href="/#play" className="btn btn-primary mt-5 w-full">
          Play instead
        </Link>
      </main>
    );
  }

  if (loading || !snapshot || !reference) return <LoadingScreen label="Tuning in…" />;

  const charactersById = Object.fromEntries(reference.characters.map((c) => [c.id, c]));
  const phase = snapshot.room.phase;
  const categories = (snapshot.room.categoryIds ?? []).map(getCategory);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4">
      {/* Unmistakably a broadcast, not a seat. */}
      <Panel accent="#f0abfc" className="mb-4">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-2xl">📺</span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fuchsia-300">
              Watching · read only
            </p>
            <p className="truncate text-sm font-black">
              {snapshot.room.name ?? `Room ${snapshot.room.code}`}
              {categories.length ? (
                <span className="text-white/40">
                  {" · "}
                  {categories.map((c) => c.name).join(" + ")}
                </span>
              ) : null}
            </p>
          </div>
          <span className="shrink-0 text-right">
            <span className="block text-[11px] font-black text-fuchsia-300">
              👁 {Math.max(watching, snapshot.room.watching ?? 0)}
            </span>
            <span className="block text-[9px] font-bold uppercase tracking-wider text-white/35">
              watching
            </span>
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {snapshot.players.map((p) => {
            const colour = playerColor(p.colorIndex).hex;
            return (
              <span
                key={p.id}
                className="rounded-lg border px-2 py-1 text-[10px] font-black"
                style={{ borderColor: `${colour}55`, color: colour }}
              >
                {p.nickname}
                <span className="ml-1 text-white/35">
                  {p.credits}c · {p.roster.length}
                </span>
              </span>
            );
          })}
        </div>
      </Panel>

      <main className="min-w-0">
        {phase === "LOBBY" ? (
          <Panel>
            <p className="px-4 py-10 text-center text-sm text-white/45">
              Waiting for the game to start…
            </p>
          </Panel>
        ) : null}
        {phase === "CATEGORY" ? (
          <CategorySelection store={store} counts={reference.categoryCounts ?? {}} />
        ) : null}
        {phase === "AUCTION" ? (
          <AuctionStage store={store} charactersById={charactersById} />
        ) : null}
        {phase === "TEAM_REVIEW" ? (
          <TeamReview store={store} charactersById={charactersById} />
        ) : null}
        {phase === "MAP_SELECTION" ? (
          <MapSelection store={store} maps={reference.maps} />
        ) : null}
        {phase === "EVENT" ? (
          <EventReveal store={store} maps={reference.maps} events={reference.events} />
        ) : null}
        {phase === "BATTLE" ? (
          <BattleStage
            store={store}
            charactersById={charactersById}
            maps={reference.maps}
            events={reference.events}
          />
        ) : null}
        {phase === "RESULTS" || phase === "FINISHED" ? (
          <ResultsStage
            store={store}
            charactersById={charactersById}
            maps={reference.maps}
            events={reference.events}
          />
        ) : null}
      </main>

      <Link href="/#play" className="btn btn-primary mt-4 w-full">
        Play your own
      </Link>
    </div>
  );
}
