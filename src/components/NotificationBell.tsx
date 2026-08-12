"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  fetchNotifications,
  getAccount,
  markNotificationsRead,
  type NotificationView,
} from "@/lib/client/account";

const ICON: Record<string, string> = {
  FRIEND_REQUEST: "👋",
  FRIEND_ACCEPTED: "🤝",
  ACHIEVEMENT: "🏅",
  ROOM_INVITE: "🎮",
};

/**
 * The inbox, in the site header.
 *
 * Polls rather than subscribes: the notifications table is server-only, so the
 * anon Realtime key cannot see it, and a 45-second poll is the honest cost of
 * keeping it that way. Nothing here is urgent enough to need less.
 */
export function NotificationBell() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  // Whether there is an account lives in state rather than being read from
  // localStorage while rendering: the server has no localStorage, so branching
  // on it during the first render is a hydration mismatch.
  const [signedIn, setSignedIn] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const data = await fetchNotifications();
    if (!data) return;
    setItems(data.notifications);
    setUnread(data.unread);
  }, []);

  useEffect(() => {
    const sync = () => {
      const has = Boolean(getAccount());
      setSignedIn(has);
      if (has) void load();
      else {
        setItems([]);
        setUnread(0);
      }
    };
    sync();
    const id = setInterval(sync, 45_000);
    window.addEventListener("draftwar:account", sync);
    return () => {
      clearInterval(id);
      window.removeEventListener("draftwar:account", sync);
    };
  }, [load]);

  // Clicking anywhere else closes the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!signedIn) return null;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      if (unread > 0) {
        // Opening the panel is reading them.
        await markNotificationsRead();
        setUnread(0);
      }
    }
  }

  return (
    <div className="relative shrink-0" ref={box}>
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-base transition hover:bg-white/5"
      >
        🔔
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {/* On a phone the bell sits close enough to the right edge that a panel
          anchored to it would hang off the left of the screen, so below sm it
          spans the viewport instead. Opaque rather than glassy: a list of
          messages has to be readable over whatever is behind it. */}
      {open ? (
        <div className="fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0f1c]/97 p-2 shadow-2xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-80">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11px] text-white/35">
              Nothing yet. Friend requests, invites and medals land here.
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((n) => {
                const room = typeof n.data?.roomCode === "string" ? n.data.roomCode : null;
                const inner = (
                  <>
                    <span className="text-base leading-none">{ICON[n.kind] ?? "•"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-black leading-tight">{n.title}</span>
                      {n.body ? (
                        <span className="block truncate text-[10px] text-white/40">{n.body}</span>
                      ) : null}
                      <span className="block text-[9px] text-white/25">
                        {new Date(n.at).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                  </>
                );

                const className = `flex items-start gap-2 rounded-xl px-2.5 py-2 ${
                  n.read ? "" : "bg-white/[0.06]"
                }`;

                return (
                  <li key={n.id}>
                    {room ? (
                      <Link
                        href={`/room/${room}`}
                        className={`${className} transition hover:bg-white/10`}
                        onClick={() => setOpen(false)}
                      >
                        {inner}
                      </Link>
                    ) : n.kind === "FRIEND_REQUEST" ? (
                      <Link
                        href="/friends"
                        className={`${className} transition hover:bg-white/10`}
                        onClick={() => setOpen(false)}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className={className}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
