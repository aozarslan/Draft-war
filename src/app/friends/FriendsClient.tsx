"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchFriends,
  friendAction,
  getAccount,
  type FriendsPayload,
  type FriendView,
} from "@/lib/client/account";
import { lastRoom } from "@/lib/client/session";
import { Avatar, TitleTag } from "@/components/ProfileBadge";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";
import { play } from "@/lib/client/sound";

/**
 * Friends.
 *
 * You add somebody by typing their exact name — there is no directory to
 * browse, which is the privacy floor the server enforces too. Requests can
 * only be answered by the person they were sent to, and a decline is silent:
 * the other side is never told they were turned down.
 */
export function FriendsClient() {
  const [data, setData] = useState<FriendsPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    setData(await fetchFriends());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, okText?: string) {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      await load();
      if (okText) setFlash({ kind: "ok", text: okText });
      play("bid");
    } catch (err) {
      setFlash({ kind: "bad", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return <LoadingScreen label="Finding your people…" />;

  if (!getAccount() || !data) {
    return (
      <EmptyState
        icon="👥"
        title="Friends need a name."
        hint="Claim a profile and you can add the people you play with."
      />
    );
  }

  // Only worth offering an invite if this browser still holds a seat
  // somewhere. The server checks it properly before sending anything.
  const roomCode = lastRoom();

  return (
    <div className="space-y-4">
      <Panel accent="#22d3ee">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="text-3xl">👥</span>
          <div className="min-w-0 flex-1">
            <h1 className="headline text-2xl">Friends</h1>
            <p className="text-[11px] text-white/45">
              {data.friends.length} added
              {data.incoming.length > 0 ? ` · ${data.incoming.length} waiting on you` : ""}
            </p>
          </div>
        </div>

        <form
          className="flex gap-2 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = username.trim();
            if (!name) return;
            void run("add", () => friendAction({ action: "ADD", username: name }), `Request sent to ${name}.`);
            setUsername("");
          }}
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
            placeholder="Their exact username"
            maxLength={16}
            autoCapitalize="none"
            className="min-w-0 flex-1"
          />
          <button className="btn btn-primary shrink-0" disabled={busy === "add" || username.trim().length < 3}>
            {busy === "add" ? "…" : "Add"}
          </button>
        </form>
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

      {/* ---- Requests waiting on you ---- */}
      {data.incoming.length > 0 ? (
        <Panel accent="#fbbf24">
          <SectionTitle>Wants to be friends</SectionTitle>
          <ul className="space-y-1.5 px-4 pb-4">
            {data.incoming.map((f) => (
              <li key={f.friendshipId} className="flex items-center gap-2.5 rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2.5">
                <Avatar avatar={f.avatar} frame={f.frame} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black">{f.username}</span>
                  <span className="block text-[10px] text-white/35">Level {f.level}</span>
                </span>
                <button
                  className="btn btn-primary !min-h-8 shrink-0 !px-2.5 !text-[10px]"
                  disabled={busy === f.friendshipId}
                  onClick={() =>
                    run(
                      f.friendshipId,
                      () => friendAction({ action: "RESPOND", friendshipId: f.friendshipId, accept: true }),
                      `${f.username} is now a friend.`,
                    )
                  }
                >
                  Accept
                </button>
                <button
                  className="btn !min-h-8 shrink-0 !px-2.5 !text-[10px]"
                  disabled={busy === f.friendshipId}
                  onClick={() =>
                    run(f.friendshipId, () =>
                      friendAction({ action: "RESPOND", friendshipId: f.friendshipId, accept: false }),
                    )
                  }
                >
                  No
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* ---- Friends ---- */}
      <Panel>
        <SectionTitle
          right={
            roomCode ? (
              <span className="text-[10px] text-white/35">in room {roomCode}</span>
            ) : null
          }
        >
          Your friends
        </SectionTitle>

        {data.friends.length === 0 ? (
          <EmptyState
            icon="🫂"
            title="Nobody yet."
            hint="Type a username above. They will get a request."
          />
        ) : (
          <ul className="space-y-1.5 px-4 pb-4">
            {data.friends.map((f) => (
              <FriendRow
                key={f.friendshipId}
                friend={f}
                roomCode={roomCode}
                busy={busy === f.profileId}
                onInvite={() =>
                  run(
                    f.profileId,
                    () => friendAction({ action: "INVITE", profileId: f.profileId, roomCode: roomCode! }),
                    `Invited ${f.username} to ${roomCode}.`,
                  )
                }
                onRemove={() => {
                  if (!confirm(`Remove ${f.username}?`)) return;
                  void run(f.profileId, () =>
                    friendAction({ action: "REMOVE", profileId: f.profileId }),
                  );
                }}
              />
            ))}
          </ul>
        )}
      </Panel>

      {/* ---- Sent ---- */}
      {data.outgoing.length > 0 ? (
        <Panel>
          <SectionTitle>Waiting on them</SectionTitle>
          <ul className="space-y-1.5 px-4 pb-4">
            {data.outgoing.map((f) => (
              <li
                key={f.friendshipId}
                className="flex items-center gap-2.5 rounded-xl border border-white/8 px-3 py-2 opacity-60"
              >
                <Avatar avatar={f.avatar} frame={f.frame} size={28} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-bold">{f.username}</span>
                <span className="shrink-0 text-[10px] text-white/30">Sent</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

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

function FriendRow({
  friend: f,
  roomCode,
  busy,
  onInvite,
  onRemove,
}: {
  friend: FriendView;
  roomCode: string | null;
  busy: boolean;
  onInvite: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-2.5">
      <span className="relative shrink-0">
        <Avatar avatar={f.avatar} frame={f.frame} size={34} />
        {/* A two-minute window on their last authenticated read — a hint, not
            a presence system, so it is drawn as a dot and not a claim. */}
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#05060c]"
          style={{ background: f.online ? "#34d399" : "rgba(255,255,255,0.2)" }}
          title={f.online ? "Around now" : "Not around"}
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-black">{f.username}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/35">Lv {f.level}</span>
          <TitleTag title={f.title} className="!text-[9px]" />
        </span>
      </span>

      {roomCode ? (
        <button
          className="btn btn-primary !min-h-8 shrink-0 !px-2.5 !text-[10px]"
          disabled={busy}
          onClick={onInvite}
        >
          {busy ? "…" : "Invite"}
        </button>
      ) : null}

      <button
        className="btn btn-ghost !min-h-8 shrink-0 !px-2 !text-[10px] text-white/30"
        disabled={busy}
        onClick={onRemove}
        title="Remove"
      >
        ✕
      </button>
    </li>
  );
}
