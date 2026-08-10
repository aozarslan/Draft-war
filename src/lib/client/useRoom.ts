"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { ApiError, fetchState, sendAction, type ClientAction, type Reference, type StateResponse } from "./api";
import { getSession, type StoredSession } from "./session";
import { play } from "./sound";

/**
 * The client's whole relationship with the server lives here.
 *
 *  * Realtime is a doorbell, not a data channel: any change bumps
 *    `rooms.state_version`, we hear about it and refetch the authoritative
 *    snapshot from our own API.
 *  * Timers are never trusted locally. We render a countdown against a
 *    server-clock offset, and when it hits zero we ask the server to apply the
 *    expiry (`?tick=1`). Every client does this; the SQL is idempotent, so the
 *    first one wins and the rest are no-ops. That is also what makes a host
 *    disconnect harmless.
 *  * A polling fallback keeps the game playable if the websocket dies.
 */

export type Connection = "connecting" | "live" | "polling" | "offline";

export interface Toast {
  id: number;
  kind: "error" | "info" | "success";
  message: string;
}

const FALLBACK_POLL_MS = 6000;
const DEGRADED_POLL_MS = 1500;
const HEARTBEAT_MS = 9000;
const DRIVE_INTERVAL_MS = 400;

export interface RoomStore {
  snapshot: StateResponse | null;
  reference: Reference | null;
  loading: boolean;
  fatal: string | null;
  connection: Connection;
  toasts: Toast[];
  session: StoredSession | null;
  me: StateResponse["players"][number] | null;
  /** Server time in ms, corrected for clock skew. */
  serverNow: () => number;
  refresh: (opts?: { tick?: boolean; force?: boolean }) => Promise<void>;
  act: (action: ClientAction) => Promise<boolean>;
  dismissToast: (id: number) => void;
  pushToast: (kind: Toast["kind"], message: string) => void;
}

export function useRoom(code: string): RoomStore {
  const [snapshot, setSnapshot] = useState<StateResponse | null>(null);
  const [reference, setReference] = useState<Reference | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [session, setSessionState] = useState<StoredSession | null>(null);

  const offsetRef = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastTick = useRef(0);
  const prev = useRef<StateResponse | null>(null);
  const toastId = useRef(0);
  const lastError = useRef<string | null>(null);
  // Spread out the moment each client drives the clock forward.
  const jitter = useRef(Math.floor(Math.random() * 350));

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  /** Sound + notification cues derived from what actually changed. */
  const reactToChange = useCallback(
    (next: StateResponse, myId: string | null) => {
      const before = prev.current;
      if (!before) return;

      const a = next.auction;
      const b = before.auction;

      if (a && b && a.id === b.id && a.currentBid > b.currentBid) {
        if (a.highBidderId === myId) play("bid");
        else if (b.highBidderId === myId) {
          play("outbid");
          pushToast("info", "You have been outbid.");
        } else play("bid");
      }
      if (a && b && a.id !== b.id) play("reveal");

      const soldNow = next.events.find(
        (e) => e.type === "SOLD" && !before.events.some((x) => x.at === e.at),
      );
      if (soldNow) play("sold");

      if (next.room.phase !== before.room.phase) {
        if (next.room.phase === "BATTLE") play("reveal");
        if (next.room.phase === "RESULTS") {
          const won = next.game?.battleResult?.winnerPlayerId === myId;
          play(won ? "victory" : "defeat");
        }
      }
    },
    [pushToast],
  );

  const applySnapshot = useCallback(
    (next: StateResponse) => {
      offsetRef.current = new Date(next.serverTime).getTime() - Date.now();
      if (next.reference) setReference(next.reference);
      const stored = getSession(code);
      reactToChange(next, stored?.playerId ?? null);
      prev.current = next;
      setSnapshot(next);
    },
    [code, reactToChange],
  );

  const refresh = useCallback(
    async (opts: { tick?: boolean; force?: boolean } = {}) => {
      if (inFlight.current) {
        // A request already in flight may have been issued *before* the change
        // we are trying to observe, so `force` waits it out and asks again.
        if (!opts.force) return inFlight.current;
        await inFlight.current;
      }
      const run = (async () => {
        try {
          const data = await fetchState(code, {
            tick: opts.tick,
            full: !reference,
          });
          applySnapshot(data);
          setFatal(null);
          lastError.current = null;
          setConnection((c) => (c === "offline" ? "polling" : c));
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            setFatal("This room does not exist. It may have been closed.");
          } else {
            setConnection("offline");
            // Surface a server-side problem once rather than spinning silently
            // behind a "reconnecting" pill — a misconfigured deployment would
            // otherwise look identical to a flaky network.
            if (err instanceof ApiError && err.status >= 500) {
              if (lastError.current !== err.message) {
                lastError.current = err.message;
                pushToast("error", err.message);
              }
            }
          }
        } finally {
          setLoading(false);
          inFlight.current = null;
        }
      })();
      inFlight.current = run;
      return run;
    },
    [applySnapshot, code, pushToast, reference],
  );

  // Keep the stored session in sync (it changes right after create/join).
  useEffect(() => {
    setSessionState(getSession(code));
    const onStorage = () => setSessionState(getSession(code));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [code, snapshot?.room.stateVersion]);

  // First load.
  useEffect(() => {
    void refresh({ tick: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Realtime doorbell.
  const roomId = snapshot?.room.id ?? null;
  useEffect(() => {
    if (!roomId) return;
    const client = supabaseBrowser();
    if (!client) {
      setConnection("polling");
      return;
    }

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const ping = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 70);
    };

    const channel = client
      .channel(`draftwar:${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        ping,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
        ping,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnection("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setConnection("polling");
      });

    return () => {
      if (debounce) clearTimeout(debounce);
      void client.removeChannel(channel);
    };
  }, [roomId, refresh]);

  // Safety poll — slow when realtime is healthy, fast when it is not.
  useEffect(() => {
    const period = connection === "live" ? FALLBACK_POLL_MS : DEGRADED_POLL_MS;
    const id = setInterval(() => void refresh(), period);
    return () => clearInterval(id);
  }, [connection, refresh]);

  // Clock driver: whoever notices an expired deadline asks the server to apply it.
  useEffect(() => {
    const id = setInterval(() => {
      const snap = snapshot;
      if (!snap) return;
      const now = Date.now() + offsetRef.current;

      let due: number | null = null;
      if (snap.room.phase === "AUCTION" && snap.auction) {
        due = new Date(snap.auction.endsAt).getTime();
      } else if (snap.game?.phaseDeadline) {
        due = new Date(snap.game.phaseDeadline).getTime();
      }

      if (due === null) return;
      if (now < due + jitter.current) return;
      if (Date.now() - lastTick.current < 900) return;

      lastTick.current = Date.now();
      void refresh({ tick: true });
    }, DRIVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [snapshot, refresh]);

  // Presence heartbeat — also the mechanism that migrates a dead host.
  useEffect(() => {
    if (!session) return;
    const beat = () => {
      void sendAction(code, session, { type: "HEARTBEAT" }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        beat();
        void refresh({ tick: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [code, session, refresh]);

  const act = useCallback(
    async (action: ClientAction) => {
      if (!session) {
        pushToast("error", "Session expired. Please join again.");
        return false;
      }
      try {
        await sendAction(code, session, action);
        await refresh({ force: true });
        return true;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 401) {
            setFatal("Session expired. Please join again.");
          } else {
            pushToast("error", err.message);
          }
          // A rejected action usually means our view is stale.
          void refresh();
        } else {
          pushToast("error", "Connection lost. Reconnecting...");
        }
        return false;
      }
    },
    [code, pushToast, refresh, session],
  );

  const me = useMemo(() => {
    if (!snapshot || !session) return null;
    return snapshot.players.find((p) => p.id === session.playerId) ?? null;
  }, [snapshot, session]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return {
    snapshot,
    reference,
    loading,
    fatal,
    connection,
    toasts,
    session,
    me,
    serverNow,
    refresh,
    act,
    dismissToast,
    pushToast,
  };
}
