"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import { playerColor } from "@/lib/game/colors";
import { EmptyState, Panel, SectionTitle } from "./ui";

const REACTIONS = ["😂", "🔥", "💀", "😱", "🤡", "💰"];

export function ChatPanel({ store, open, onClose }: { store: RoomStore; open: boolean; onClose: () => void }) {
  const { snapshot, act } = store;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [snapshot?.chat.length, open]);

  if (!snapshot) return null;

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const ok = await act({ type: "CHAT", body });
    if (ok) setDraft("");
    setSending(false);
  }

  return (
    <Panel className={`flex flex-col ${open ? "" : "hidden"} lg:flex`}>
      <SectionTitle
        right={
          <button className="text-xs font-bold text-white/40 lg:hidden" onClick={onClose}>
            Close
          </button>
        }
      >
        Room chat
      </SectionTitle>

      <div ref={listRef} className="max-h-64 min-h-[120px] flex-1 overflow-y-auto px-4">
        {snapshot.chat.length === 0 ? (
          <EmptyState icon="💬" title="No messages yet." hint="Trash talk is encouraged." />
        ) : (
          <ul className="space-y-1.5 pb-2">
            {snapshot.chat.map((m) => {
              const p = snapshot.players.find((x) => x.id === m.playerId);
              const color = p ? playerColor(p.colorIndex).hex : "#64748b";

              if (m.kind === "SYSTEM") {
                return (
                  <li key={m.id} className="text-center text-[11px] italic text-white/30">
                    {m.body}
                  </li>
                );
              }
              if (m.kind === "REACTION") {
                return (
                  <li key={m.id} className="flex items-center gap-2 text-sm">
                    <span className="font-bold" style={{ color }}>
                      {p?.nickname ?? "?"}
                    </span>
                    <span className="text-xl">{m.body}</span>
                  </li>
                );
              }
              return (
                <li key={m.id} className="text-sm">
                  <span className="font-bold" style={{ color }}>
                    {p?.nickname ?? "?"}
                  </span>
                  <span className="text-white/30"> · </span>
                  <span className="text-white/85">{m.body}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex gap-1.5">
          {REACTIONS.map((r) => (
            <button
              key={r}
              className="grid h-10 flex-1 place-items-center rounded-lg border border-white/10 text-lg transition active:scale-90"
              onClick={() => void act({ type: "REACTION", body: r })}
              aria-label={`React with ${r}`}
            >
              {r}
            </button>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Say something…"
            maxLength={240}
            aria-label="Chat message"
          />
          <button className="btn btn-primary shrink-0 px-4" disabled={!draft.trim() || sending}>
            Send
          </button>
        </form>
      </div>
    </Panel>
  );
}
