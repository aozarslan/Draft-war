"use client";

import { useEffect, useState } from "react";
import type { Toast } from "@/lib/client/useRoom";

export function Panel({
  children,
  className = "",
  accent,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: string;
}) {
  return (
    <div
      className={`glass rounded-2xl ${className}`}
      style={accent ? { borderColor: `${accent}55` } : undefined}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
      <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">
        {children}
      </h2>
      {right}
    </div>
  );
}

/**
 * Countdown driven by the server clock. `endsAt` is an ISO string from the
 * database and `now()` returns the skew-corrected current server time, so every
 * phone in the room shows the same number.
 */
export function Countdown({
  endsAt,
  now,
  onZero,
  className = "",
}: {
  endsAt: string | null;
  now: () => number;
  onZero?: () => void;
  className?: string;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!endsAt) return;
    const target = new Date(endsAt).getTime();
    let fired = false;

    const tick = () => {
      const ms = Math.max(0, target - now());
      setRemaining(ms);
      if (ms === 0 && !fired) {
        fired = true;
        onZero?.();
      }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [endsAt, now, onZero]);

  if (!endsAt) return null;

  const seconds = Math.ceil(remaining / 1000);
  const urgent = seconds <= 5;

  return (
    <div
      className={`tabular-nums font-black leading-none ${className}`}
      style={{ color: urgent ? "#f43f5e" : "#e8ecf8" }}
      aria-live="off"
    >
      {String(seconds).padStart(2, "0")}
    </div>
  );
}

export function StatBar({
  label,
  value,
  color = "#22d3ee",
  max = 100,
}: {
  label: string;
  value: number;
  color?: string;
  max?: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] font-bold uppercase tracking-wider text-white/50">
        <span>{label}</span>
        <span className="tabular-nums text-white/85">{value}</span>
      </div>
      <div className="stat-bar mt-1">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.min(100, (value / max) * 100)}%`,
            background: `linear-gradient(90deg, ${color}55, ${color})`,
          }}
        />
      </div>
    </div>
  );
}

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className="glass pointer-events-auto animate-[rise_0.25s_ease-out] rounded-xl px-4 py-3 text-sm font-semibold"
          style={{
            borderColor:
              t.kind === "error"
                ? "#f43f5e88"
                : t.kind === "success"
                  ? "#22c55e88"
                  : "#22d3ee66",
          }}
        >
          {t.kind === "error" ? "⚠️ " : t.kind === "success" ? "✅ " : "ℹ️ "}
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
        <div className="absolute inset-2 animate-pulse rounded-full bg-gradient-to-br from-cyan-400/30 to-fuchsia-500/30" />
      </div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-white/55">
        {label}
      </p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-3xl opacity-60">{icon}</div>
      <p className="text-sm font-bold text-white/70">{title}</p>
      {hint ? <p className="text-xs text-white/40">{hint}</p> : null}
    </div>
  );
}

export function ConnectionPill({ state }: { state: string }) {
  const map: Record<string, { label: string; color: string }> = {
    live: { label: "LIVE", color: "#22c55e" },
    polling: { label: "SYNCING", color: "#fbbf24" },
    connecting: { label: "CONNECTING", color: "#22d3ee" },
    offline: { label: "RECONNECTING", color: "#f43f5e" },
  };
  const s = map[state] ?? map.connecting;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black tracking-widest"
      style={{ borderColor: `${s.color}55`, color: s.color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: s.color,
          animation: state === "live" ? "none" : "pulse 1.2s infinite",
        }}
      />
      {s.label}
    </span>
  );
}

/**
 * A character's shout-name, above its catalogue name.
 *
 * Two names do different jobs. `Lion` is what the character *is* — it joins the
 * roster, the replay and every stored result, and it never changes. `THE KING`
 * is what a player says out loud across the table while deciding whether to
 * spend seventeen credits denying it to somebody else. The catalogue name stays
 * the headline everywhere so the two can never be confused for one another;
 * this is a label above it, not a replacement for it.
 *
 * Renders nothing when a character has no nickname, which is most of them —
 * the thirteen animals authored in S4 are the only ones so far.
 */
export function Nickname({
  nickname,
  name,
  className,
}: {
  nickname: string;
  /** The canonical name. Used only to decide whether the nickname adds anything. */
  name: string;
  className?: string;
}) {
  if (!nickname || nickname === name) return null;
  return (
    <p
      className={
        className ??
        "text-[10px] font-black uppercase tracking-[0.28em] text-amber-300/80"
      }
    >
      {nickname}
    </p>
  );
}
