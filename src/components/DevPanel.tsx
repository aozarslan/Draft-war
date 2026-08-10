"use client";

import { useState } from "react";
import { devOp } from "@/lib/client/api";
import type { RoomStore } from "@/lib/client/useRoom";

/**
 * Development shortcuts. Rendered only when NEXT_PUBLIC_DRAFT_WAR_DEV is "1",
 * and the endpoint behind it 404s in production unless DRAFT_WAR_DEV_KEY is set,
 * so normal players never see or reach any of this.
 */
export function DevPanel({ store, code }: { store: RoomStore; code: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (process.env.NEXT_PUBLIC_DRAFT_WAR_DEV !== "1") return null;

  async function run(op: "RESET" | "ADD_BOT" | "SKIP_AUCTION" | "FORCE_BATTLE") {
    setBusy(true);
    try {
      await devOp(op, code);
      await store.refresh({ tick: true });
      store.pushToast("success", `${op} done`);
    } catch (err) {
      store.pushToast("error", err instanceof Error ? err.message : "Dev op failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-3 left-3 z-40">
      {open ? (
        <div className="glass mb-2 space-y-1.5 rounded-xl p-3 text-xs">
          <p className="font-black uppercase tracking-widest text-white/40">Dev tools</p>
          {(["ADD_BOT", "SKIP_AUCTION", "FORCE_BATTLE", "RESET"] as const).map((op) => (
            <button
              key={op}
              className="btn w-full !min-h-9 !text-[11px]"
              disabled={busy}
              onClick={() => run(op)}
            >
              {op.replace("_", " ")}
            </button>
          ))}
        </div>
      ) : null}
      <button
        className="btn !min-h-9 !px-3 !text-[11px]"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        🛠 Dev
      </button>
    </div>
  );
}
