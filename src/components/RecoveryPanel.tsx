"use client";

import { useCallback, useEffect, useState } from "react";
import { hasRecoveryCode, issueRecoveryCode, recoverAccount } from "@/lib/client/account";
import { Panel, SectionTitle } from "./ui";
import { play } from "@/lib/client/sound";

/**
 * The way back into your own account.
 *
 * Before this, a profile lived in exactly one browser: close the tab, open it
 * tomorrow, and the rank, coins and collection were gone. There is no email
 * and no password — a code you save is the smallest thing that solves it, and
 * it keeps sign-up to one field.
 *
 * The code is shown once and never again, because a code the server can
 * reprint is a code an attacker can ask it to reprint.
 */
export function RecoveryPanel() {
  const [state, setState] = useState<"loading" | "missing" | "set">("loading");
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setState((await hasRecoveryCode()) ? "set" : "missing");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const issued = await issueRecoveryCode();
      setCode(issued);
      setState("set");
      play("sold");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a code.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  // Just issued: this is the only time it is ever on screen.
  if (code) {
    return (
      <Panel accent="#34d399">
        <SectionTitle>Save this code</SectionTitle>
        <div className="px-4 pb-4">
          <p className="text-[11px] leading-relaxed text-white/50">
            This is the only way back into your account on another phone or
            after clearing your browser. It is shown once and cannot be shown
            again.
          </p>
          <p className="my-3 select-all rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-3 text-center font-mono text-lg font-black tracking-widest text-emerald-200">
            {code}
          </p>
          <button
            className="btn btn-primary w-full"
            onClick={() => {
              void navigator.clipboard.writeText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "✅ Copied — now save it somewhere" : "📋 Copy the code"}
          </button>
        </div>
      </Panel>
    );
  }

  if (state === "set") {
    return (
      <Panel>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-lg">🔐</span>
          <p className="min-w-0 flex-1 text-[11px] text-white/45">
            This account has a recovery code. Keep it somewhere safe — it is the
            only way back in on another device.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel accent="#fbbf24">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="text-2xl">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black">This account only exists in this browser</p>
          <p className="text-[11px] text-white/45">
            Clear your history and your rank, coins and collection are gone. Get
            a recovery code — it takes one tap.
          </p>
        </div>
      </div>
      {error ? <p className="px-4 pb-2 text-[11px] text-rose-400">{error}</p> : null}
      <div className="px-4 pb-4">
        <button className="btn btn-primary w-full" disabled={busy} onClick={issue}>
          {busy ? "Creating…" : "🔐 Get my recovery code"}
        </button>
      </div>
    </Panel>
  );
}

/**
 * The other half: using a code to sign back in.
 *
 * Lives with the "claim a name" form, because somebody who has been here
 * before and lost their session lands in exactly the same place as somebody
 * brand new.
 */
export function RecoverForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        className="btn btn-ghost w-full !text-[11px]"
        onClick={() => setOpen(true)}
      >
        Already have an account? Sign in with a recovery code
      </button>
    );
  }

  return (
    <form
      className="glass space-y-3 rounded-2xl p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await recoverAccount(username.trim(), code.trim());
          play("sold");
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : "That name and code do not match.");
          setBusy(false);
        }
      }}
    >
      <p className="text-xs font-black uppercase tracking-widest text-white/45">
        Sign back in
      </p>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
        placeholder="Your username"
        maxLength={16}
        autoCapitalize="none"
        required
      />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD-EFGH-JKLM"
        maxLength={20}
        autoCapitalize="characters"
        className="font-mono tracking-widest"
        required
      />
      {error ? <p className="text-[11px] font-semibold text-rose-400">{error}</p> : null}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      <button
        type="button"
        className="btn btn-ghost w-full !text-[11px]"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </form>
  );
}
