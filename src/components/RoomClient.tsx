"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRoom } from "@/lib/client/useRoom";
import { ApiError, joinRoom } from "@/lib/client/api";
import { clearSession, getSession, lastNickname, setSession } from "@/lib/client/session";
import { play, setSoundEnabled, soundEnabled } from "@/lib/client/sound";
import type { Character } from "@/lib/game/types";
import { ConnectionPill, LoadingScreen, Panel, Toasts } from "./ui";
import { Lobby } from "./Lobby";
import { AuctionStage } from "./AuctionStage";
import { TeamReview } from "./TeamReview";
import { MapSelection } from "./MapSelection";
import { EventReveal } from "./EventReveal";
import { BattleStage } from "./BattleStage";
import { ResultsStage } from "./ResultsStage";
import { ChatPanel } from "./ChatPanel";
import { Leaderboard } from "./Leaderboard";
import { DevPanel } from "./DevPanel";

const PHASE_LABEL: Record<string, string> = {
  LOBBY: "Lobby",
  AUCTION: "Auction",
  TEAM_REVIEW: "Team review",
  MAP_SELECTION: "Map vote",
  EVENT: "Event card",
  BATTLE: "Battle",
  RESULTS: "Results",
  FINISHED: "Finished",
};

export function RoomClient({ code }: { code: string }) {
  const store = useRoom(code);
  const { snapshot, reference, loading, fatal, connection, me } = store;
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [sound, setSound] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    setHasSession(Boolean(getSession(code)));
    setSound(soundEnabled());
  }, [code]);

  const charactersById = useMemo(() => {
    const map: Record<string, Character> = {};
    for (const c of reference?.characters ?? []) map[c.id] = c;
    return map;
  }, [reference]);

  if (fatal) {
    return (
      <Shell code={code}>
        <Panel>
          <div className="space-y-4 p-6 text-center">
            <p className="text-4xl">🚪</p>
            <p className="font-bold">{fatal}</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                clearSession(code);
                window.location.href = "/";
              }}
            >
              Back to the start
            </button>
          </div>
        </Panel>
      </Shell>
    );
  }

  if (hasSession === false) {
    return (
      <Shell code={code}>
        <JoinGate code={code} onJoined={() => setHasSession(true)} />
      </Shell>
    );
  }

  if (loading || !snapshot || !reference) {
    return (
      <Shell code={code}>
        <LoadingScreen label="Joining room…" />
      </Shell>
    );
  }

  // A player whose row was wiped (room reset) needs to re-enter.
  if (!me) {
    return (
      <Shell code={code}>
        <JoinGate
          code={code}
          onJoined={() => window.location.reload()}
          note="Your seat is gone — grab a new one."
        />
      </Shell>
    );
  }

  const phase = snapshot.room.phase;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-24 pt-3 sm:px-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/" className="headline text-xl neon-text">
          DRAFT WAR
        </Link>
        <span className="rounded-lg border border-white/15 px-2 py-1 text-xs font-black tracking-[0.2em]">
          {snapshot.room.code}
        </span>
        <span className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-bold text-white/60">
          {PHASE_LABEL[phase] ?? phase}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ConnectionPill state={connection} />
          <button
            className="btn !min-h-9 !px-3 !text-[11px]"
            onClick={() => {
              const next = !sound;
              setSound(next);
              setSoundEnabled(next);
              if (next) play("click");
            }}
            aria-pressed={sound}
          >
            {sound ? "🔊 On" : "🔇 Off"}
          </button>
          <button
            className="btn !min-h-9 !px-3 !text-[11px] lg:hidden"
            onClick={() => setChatOpen((o) => !o)}
          >
            💬
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="min-w-0">
          {phase === "LOBBY" ? <Lobby store={store} /> : null}
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

        <aside className="min-w-0 space-y-4">
          <Leaderboard snapshot={snapshot} />
          {/* Chat stays out of the way while the battle plays. */}
          {phase !== "BATTLE" ? (
            <ChatPanel store={store} open={chatOpen} onClose={() => setChatOpen(false)} />
          ) : null}
        </aside>
      </div>

      <Toasts toasts={store.toasts} onDismiss={store.dismissToast} />
      <DevPanel store={store} code={code} />
    </div>
  );
}

function Shell({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <header className="mb-6 flex items-center gap-2">
        <Link href="/" className="headline text-xl neon-text">
          DRAFT WAR
        </Link>
        <span className="rounded-lg border border-white/15 px-2 py-1 text-xs font-black tracking-[0.2em]">
          {code}
        </span>
      </header>
      {children}
    </div>
  );
}

function JoinGate({
  code,
  onJoined,
  note,
}: {
  code: string;
  onJoined: () => void;
  note?: string;
}) {
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setNickname(lastNickname()), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await joinRoom({ code, nickname: nickname.trim() });
      setSession(result.code, {
        playerId: result.playerId,
        token: result.token,
        nickname: nickname.trim(),
      });
      onJoined();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not join.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass space-y-4 rounded-2xl p-5">
      <h1 className="headline text-2xl">Join room {code}</h1>
      {note ? <p className="text-xs text-white/45">{note}</p> : null}
      <div className="space-y-2">
        <label htmlFor="nick" className="text-xs font-bold uppercase tracking-widest text-white/45">
          Your nickname
        </label>
        <input
          id="nick"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Ahmet"
          maxLength={18}
          required
          autoFocus
        />
      </div>
      {error ? <p className="text-sm font-semibold text-rose-400">{error}</p> : null}
      <button className="btn btn-primary w-full" disabled={busy || nickname.trim().length < 2}>
        {busy ? "Joining room…" : "Join room"}
      </button>
    </form>
  );
}
