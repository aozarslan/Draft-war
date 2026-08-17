"use client";

/**
 * ---------------------------------------------------------------------------
 * RENDERER HARNESS (development)
 * ---------------------------------------------------------------------------
 * Simulates a battle in the browser, projects it to a replay, and plays it on
 * the Canvas 2D renderer with a scrub bar.
 *
 * It exists so the render pipeline can be judged before a single sprite is
 * drawn. Everything here runs client-side against the same pure functions the
 * real game uses — no room, no database, no service key — so it is also the
 * fastest way to reproduce a rendering bug from a seed.
 *
 * Not linked from anywhere. Not a game screen. `BattleStage` is untouched;
 * wiring the renderer into the actual match belongs to a later milestone.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { computeAxisBands, simulateBattle } from "@/lib/game/battle";
import { CHARACTERS } from "@/lib/game/characters";
import { MAPS } from "@/lib/game/maps";
import { EVENT_CARDS } from "@/lib/game/events";
import { FORMATIONS, type FormationId } from "@/lib/game/formations";
import { toReplay } from "@/lib/game/replay";
import { PLAYER_COLORS } from "@/lib/game/colors";
import { BattleRenderer } from "@/lib/render/canvas";
import type { CharacterArt } from "@/lib/render/assets";

const BANDS = computeAxisBands(CHARACTERS);

export default function RendererHarness() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const elapsedRef = useRef(0);

  const [seed, setSeed] = useState("harness-1");
  const [categoryId, setCategoryId] = useState("marvel");
  const [formationA, setFormationA] = useState<FormationId>("AGGRESSIVE");
  const [formationB, setFormationB] = useState<FormationId>("DEFENSIVE");
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [portraits, setPortraits] = useState(true);
  const [legacy, setLegacy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const categories = useMemo(
    () => [...new Set(CHARACTERS.map((c) => c.categoryId))],
    [],
  );

  const replay = useMemo(() => {
    const pool = CHARACTERS.filter((c) => c.categoryId === categoryId);
    if (pool.length < 10) return null;

    const result = simulateBattle({
      teams: [
        {
          playerId: "player-a",
          nickname: "Team A",
          characters: pool.slice(0, 5).map((c, i) => ({ characterId: c.id, price: 4 + i * 3 })),
          formation: formationA,
        },
        {
          playerId: "player-b",
          nickname: "Team B",
          characters: pool.slice(5, 10).map((c, i) => ({ characterId: c.id, price: 6 + i * 2 })),
          formation: formationB,
        },
      ],
      map: MAPS[0],
      event: EVENT_CARDS[0],
      charactersById: Object.fromEntries(CHARACTERS.map((c) => [c.id, c])),
      seed,
      categoryIds: [categoryId],
      bands: BANDS,
    });

    // Strips exactly what a pre-V5 stored result lacks, so the legacy path can
    // be looked at rather than only asserted: no maxHp, no hpAfter, no bars.
    const stored = legacy
      ? {
          ...result,
          rulesVersion: undefined,
          combatants: result.combatants.map(({ maxHp: _drop, ...rest }) => rest),
          log: result.log.map(({ hpAfter: _drop, ...rest }) => rest),
        }
      : result;

    return toReplay(stored, {
      battleId: "harness",
      players: [
        { playerId: "player-a", nickname: "Team A", formation: formationA },
        { playerId: "player-b", nickname: "Team B", formation: formationB },
      ],
    });
  }, [seed, categoryId, formationA, formationB, legacy]);

  // The static catalogue carries no artwork — thumbnails are enriched into the
  // database. Fetching them here is what actually exercises the portrait path;
  // without it the harness would only ever prove the placeholder works.
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/characters")
      .then((r) => r.json())
      .then((data: { characters?: { id: string; thumbnailUrl: string | null }[] }) => {
        if (cancelled || !data.characters) return;
        setThumbnails(
          Object.fromEntries(
            data.characters
              .filter((c) => c.thumbnailUrl)
              .map((c) => [c.id, c.thumbnailUrl as string]),
          ),
        );
      })
      .catch(() => {
        /* No database here? Then every disc is a placeholder, which is fine. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const art = useMemo<CharacterArt[]>(
    () =>
      CHARACTERS.map((c) => ({
        characterId: c.id,
        name: c.name,
        palette: c.palette,
        portraitUrl: portraits ? (thumbnails[c.id] ?? c.thumbnailUrl) : null,
      })),
    [portraits, thumbnails],
  );

  // One renderer per replay. It reads the clock we own, so scrubbing is just
  // writing to a ref — the renderer has no opinion about time passing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !replay) return;

    elapsedRef.current = 0;
    setElapsed(0);

    const renderer = new BattleRenderer({
      canvas,
      replay,
      art,
      clock: () => elapsedRef.current,
      teamColors: {
        "player-a": PLAYER_COLORS[0].hex,
        "player-b": PLAYER_COLORS[1].hex,
      },
    });
    rendererRef.current = renderer;
    renderer.start();

    const onResize = () => renderer.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [replay, art]);

  // The playback clock, kept here rather than in the renderer so a future
  // spectator can swap it for `Date.now() - battleStartedAt` unchanged.
  useEffect(() => {
    if (!playing || !replay) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      elapsedRef.current = Math.min(elapsedRef.current + dt * speed, replay.durationMs);
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= replay.durationMs) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, replay]);

  if (!replay) {
    return <main className="p-6 text-slate-300">Bu kategoride yeterli karakter yok.</main>;
  }

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 pb-24">
      <header>
        <h1 className="text-xl font-bold text-slate-100">Renderer harness</h1>
        <p className="text-sm text-slate-400">
          Canvas 2D motoru. Sanat varlıkları yok — portre/palet fallback&apos;i ile çiziliyor.
        </p>
      </header>

      <canvas
        ref={canvasRef}
        className="aspect-video w-full rounded-xl border border-slate-800 bg-slate-950"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (elapsedRef.current >= replay.durationMs) elapsedRef.current = 0;
            setPlaying((p) => !p);
          }}
          className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900"
        >
          {playing ? "Duraklat" : "Oynat"}
        </button>
        <input
          type="range"
          min={0}
          max={replay.durationMs}
          value={elapsed}
          onChange={(e) => {
            const value = Number(e.target.value);
            elapsedRef.current = value;
            setElapsed(value);
            rendererRef.current?.renderAt(value);
          }}
          className="flex-1"
        />
        <span className="w-24 text-right font-mono text-xs text-slate-400">
          {seconds(elapsed)} / {seconds(replay.durationMs)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">Seed</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
          />
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">Kategori</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
          >
            {categories.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">Hız</span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
          >
            {[0.25, 0.5, 1, 2, 4].map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">Formasyon A</span>
          <select
            value={formationA}
            onChange={(e) => setFormationA(e.target.value as FormationId)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
          >
            {Object.values(FORMATIONS).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-slate-400">Formasyon B</span>
          <select
            value={formationB}
            onChange={(e) => setFormationB(e.target.value as FormationId)}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
          >
            {Object.values(FORMATIONS).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={portraits}
            onChange={(e) => setPortraits(e.target.checked)}
          />
          <span className="text-slate-300">Portreler</span>
        </label>

        <label className="flex items-end gap-2 pb-1.5">
          <input
            type="checkbox"
            checked={legacy}
            onChange={(e) => setLegacy(e.target.checked)}
          />
          <span className="text-slate-300">Eski maç (V4)</span>
        </label>
      </div>

      <p className="text-xs text-slate-500">
        replayVersion {replay.replayVersion} · rulesVersion {replay.rulesVersion ?? "—"} ·{" "}
        {replay.events.length} olay · kazanan{" "}
        {replay.teams.find((t) => t.playerId === replay.winnerPlayerId)?.nickname}
        {replay.replayVersion === 0 ? " · can barı yok (eski maç)" : ""}
      </p>
    </main>
  );
}
