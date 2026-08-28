"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCategory } from "@/lib/game/categories";
import { CHARACTERS } from "@/lib/game/characters";
import { playerColor } from "@/lib/game/colors";
import { draftEfficiency, efficiencyLabel } from "@/lib/game/archetypes";
import { getFormation } from "@/lib/game/formations";
import { useLocalPlayback } from "@/lib/client/useLocalPlayback";
import { revealOf } from "@/lib/render/reveal";
import { highlightsOf } from "@/lib/render/highlights";
import { narrativeOf } from "@/lib/render/narrative";
import { BattleReveal } from "@/components/BattleReveal";
import { BattleNarration } from "@/components/BattleNarration";
import { buildStage } from "@/lib/render/stage";
import { summaryOf } from "@/lib/render/summary";
import { BattleCanvas } from "@/components/BattleCanvas";
import { BattleSummaryCard } from "@/components/BattleSummaryCard";
import { Avatar } from "@/components/ProfileBadge";
import { EmptyState, LoadingScreen, Panel, SectionTitle } from "@/components/ui";
import type { ProjectableResult } from "@/lib/game/replay";

interface PublicTeam {
  playerId: string;
  nickname: string;
  colorIndex: number;
  formation: string;
  username: string | null;
  avatar: string | null;
  frame: string | null;
  title: string | null;
  level: number | null;
  roster: { characterId: string; price: number }[];
  spent: number;
}

interface Payload {
  ok: true;
  gameId: string;
  roomCode: string;
  playedAt: string;
  categoryIds: string[];
  mapId: string | null;
  eventId: string | null;
  teams: PublicTeam[];
  /**
   * The authoritative result, as much of it as the endpoint forwards.
   *
   * Deliberately typed as the shape the endpoint really sends rather than as
   * the projection's input: the battlefield fields live at the *top* level of
   * the payload, not inside `result`, and annotating this as a
   * `ProjectableResult` asserted otherwise — a lie TypeScript then had no way
   * to catch. `projectable()` below does the joining, in one visible place.
   */
  result: Omit<ProjectableResult, "categoryIds" | "mapId" | "eventId">;
  moments: {
    averagePrice?: number;
    bargain?: { characterId: string; nickname: string; price: number } | null;
    overpay?: { characterId: string; nickname: string; price: number } | null;
  } | null;
}

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
const pretty = (id: string) => id.replace(/^[a-z-]+?-/, "").replace(/-/g, " ");

/**
 * A finished match, readable by anybody with the link.
 *
 * No sign-in and no room session: this is the page you paste into the group
 * chat. The server only serves finished games, so nothing here could leak a
 * roster or a credit balance out of a match still being played.
 */
export function PublicMatch({ gameId }: { gameId: string }) {
  // Whether the viewer has started the battle. Held here rather than inside
  // the replay because it gates the result section too.
  const [started, setStarted] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/match/${gameId}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.ok === false) {
        setState("missing");
        return;
      }
      setData(body as Payload);
      setState("ready");
    })();
  }, [gameId]);

  if (state === "loading") return <LoadingScreen label="Loading the match…" />;
  if (state === "missing" || !data) {
    return (
      <EmptyState
        icon="🔍"
        title="No such match."
        hint="It may still be in progress — only finished games can be shared."
      />
    );
  }

  const standings = [...data.result.teams].sort((a, b) => a.rank - b.rank);
  const winner = data.teams.find((t) => t.playerId === data.result.winnerPlayerId);
  const winnerOdds = standings.find((t) => t.playerId === data.result.winnerPlayerId);

  return (
    <div className="space-y-4">
      <PublicReplay data={data} started={started} onStart={() => setStarted(true)} />

      {/*
        The result waits until the viewer has started the battle.

        Not decoration: `revealOf` goes to some trouble to seat the squads by
        draft order and to carry no outcome field at all, and every bit of that
        is wasted if "Ege beat Mikail" sits one scroll below it. A spoiler is a
        spoiler whether it comes from the reveal or from the page it is on.
        One tap opens everything, so nothing is hidden from someone who only
        wants the score.
      */}
      {started ? (
        <>
          <PublicSummary data={data} />

          <Panel accent={playerColor(winner?.colorIndex ?? 0).hex} className="overflow-hidden">
        <div className="px-5 py-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-white/40">
            {data.categoryIds.map((id) => getCategory(id).name).join(" + ")} · room{" "}
            {data.roomCode}
          </p>
          <h1
            className="headline text-[clamp(2rem,11vw,3.5rem)]"
            style={{ color: playerColor(winner?.colorIndex ?? 0).hex }}
          >
            {winner?.username ?? winner?.nickname ?? "—"}
          </h1>
          <p className="text-xs font-bold uppercase tracking-widest text-white/35">
            {new Date(data.playedAt).toLocaleDateString("en-GB")}
          </p>
          {data.result.upset ? (
            <p className="mt-3 inline-block rounded-xl border border-amber-400/50 bg-amber-400/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-300">
              🔥 Major upset · won at {Math.round(winnerOdds?.winProbability ?? 0)}%
            </p>
          ) : null}
        </div>
      </Panel>

      {data.result.turningPoint ? (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-center text-sm font-bold">
          🔥 {data.result.turningPoint.text}
        </p>
      ) : null}

      <Panel>
        <SectionTitle
          right={
            data.moments?.averagePrice ? (
              <span className="text-[10px] text-white/35">
                average price {data.moments.averagePrice}
              </span>
            ) : null
          }
        >
          Final standings
        </SectionTitle>
        <ul className="space-y-1.5 px-4 pb-4">
          {standings.map((t) => {
            const team = data.teams.find((x) => x.playerId === t.playerId);
            if (!team) return null;
            const colour = playerColor(team.colorIndex).hex;
            const eff = draftEfficiency(t.teamRating, team.spent, team.roster.length);
            const formation = getFormation(team.formation);
            return (
              <li
                key={t.playerId}
                className="rounded-xl border px-3 py-2.5"
                style={{ borderColor: `${colour}44` }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">{MEDALS[t.rank - 1] ?? t.rank}</span>
                  <Avatar avatar={team.avatar} frame={team.frame} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-black" style={{ color: colour }}>
                      {team.username ?? team.nickname}
                    </span>
                    <span className="block text-[10px] text-white/40">
                      power {Math.round(t.teamRating)} · {team.spent} credits ·{" "}
                      <span className="text-cyan-300">{eff}</span> efficiency ·{" "}
                      {efficiencyLabel(eff)}
                      {formation.id !== "BALANCED" ? (
                        <span style={{ color: formation.colour }}>
                          {" · "}
                          {formation.icon} {formation.name}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[10px] text-white/30">
                  {team.roster.map((r) => `${pretty(r.characterId)} (${r.price})`).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      </Panel>

      {data.moments?.bargain || data.moments?.overpay ? (
        <Panel>
          <SectionTitle>The draft</SectionTitle>
          <ul className="space-y-1.5 px-4 pb-4 text-[11px]">
            {data.moments.bargain ? (
              <li className="flex items-center gap-2">
                <span>💎</span>
                <span className="min-w-0 flex-1 text-white/55">
                  Best bargain — {data.moments.bargain.nickname} took{" "}
                  {pretty(data.moments.bargain.characterId)}
                </span>
                <span className="font-black tabular-nums">{data.moments.bargain.price}</span>
              </li>
            ) : null}
            {data.moments.overpay ? (
              <li className="flex items-center gap-2">
                <span>🧾</span>
                <span className="min-w-0 flex-1 text-white/55">
                  Biggest overpay — {data.moments.overpay.nickname} on{" "}
                  {pretty(data.moments.overpay.characterId)}
                </span>
                <span className="font-black tabular-nums">{data.moments.overpay.price}</span>
              </li>
            ) : null}
          </ul>
        </Panel>
          ) : null}
        </>
      ) : null}

      <Link href="/#play" className="btn btn-primary w-full">
        Play your own
      </Link>
    </div>
  );
}

/**
 * The battle itself, played back locally.
 *
 * Everything here is assembled by the *same* `buildStage` the live room uses,
 * so the scene at a given elapsed is the scene at that elapsed — there is one
 * renderer and one replay format. Only the clock differs: a finished match has
 * nobody to stay in step with, so it gets play, pause, restart and a scrub bar
 * instead of the server's timestamp.
 */
/**
 * The payload's two halves, joined into what the projection consumes.
 *
 * The endpoint reports the battlefield alongside the match and the result
 * inside it; the projection wants them together. Doing that here, once, keeps
 * the joining honest and keeps `buildStage` the only thing that knows how to
 * make a scene.
 */
function projectable(data: Payload): ProjectableResult {
  return {
    ...data.result,
    categoryIds: data.categoryIds,
    mapId: data.mapId ?? "",
    eventId: data.eventId ?? "",
  };
}

function PublicReplay({
  data,
  started,
  onStart,
}: {
  data: Payload;
  started: boolean;
  onStart: () => void;
}) {
  const charactersById = useMemo(
    () => Object.fromEntries(CHARACTERS.map((c) => [c.id, c])),
    [],
  );

  const stage = useMemo(
    () =>
      buildStage({
        battleId: data.gameId,
        result: projectable(data),
        players: data.teams.map((t) => ({
          id: t.playerId,
          nickname: t.username ?? t.nickname,
          formation: t.formation,
          colorHex: playerColor(t.colorIndex).hex,
        })),
        charactersById,
      }),
    [data, charactersById],
  );

  // Opens paused on the head-to-head. Only this page's own clock waits; a
  // live battle's timing belongs to the server and nothing here touches it.
  const playback = useLocalPlayback(stage?.durationMs ?? 0, true);
  const reveal = useMemo(() => (stage ? revealOf(stage.replay) : null), [stage]);
  const cues = useMemo(
    () => (stage ? narrativeOf(stage.replay, highlightsOf(stage.replay)) : []),
    [stage],
  );
  const colorOf = useMemo(() => {
    const colors = new Map(
      data.teams.map((t) => [t.playerId, playerColor(t.colorIndex).hex]),
    );
    return (playerId: string) => colors.get(playerId) ?? "#94a3b8";
  }, [data.teams]);

  // A payload from before the endpoint forwarded `durationMs` has nothing to
  // play back against. The rest of the page still works; only the arena is
  // withheld, which is better than a canvas stuck on frame zero.
  //
  // Written as `!(x > 0)` rather than `x <= 0` on purpose: the missing field
  // arrives as `undefined`, and `undefined <= 0` is false, so the tidier
  // comparison would have waved it straight through.
  if (!stage || !(stage.durationMs > 0)) return null;

  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  // The reveal stands in front of the arena only until the viewer starts the
  // fight, and never comes back — once you have seen the battle, a card
  // introducing the fighters is in the way.
  if (reveal && !started) {
    return (
      <div className="space-y-3">
        <BattleReveal
          reveal={reveal}
          charactersById={charactersById}
          colorOf={colorOf}
          countdownMs={null}
        />
        <button
          className="btn btn-primary w-full"
          onClick={() => {
            onStart();
            playback.play();
          }}
        >
          ▶ Watch the battle
        </button>
      </div>
    );
  }

  return (
    <Panel className="overflow-hidden">
      <BattleCanvas
        className="aspect-video w-full bg-[#0b1220]"
        replay={stage.replay}
        art={stage.art}
        interactions={stage.interactions}
        teamColors={stage.teamColors}
        elapsedMs={playback.elapsedMs}
      />
      <div className="px-3 pt-3">
        <BattleNarration cues={cues} elapsedMs={playback.elapsedMs} />
      </div>
      <div className="flex items-center gap-3 p-3">
        <button
          className="btn btn-ghost shrink-0"
          onClick={playback.finished ? playback.restart : playback.toggle}
        >
          {playback.finished ? "↻ Replay" : playback.playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <input
          type="range"
          min={0}
          max={stage.durationMs}
          value={Math.min(playback.displayMs, stage.durationMs)}
          onChange={(e) => playback.seek(Number(e.target.value))}
          className="flex-1"
          aria-label="Scrub the battle"
        />
        <span className="shrink-0 font-mono text-[11px] text-white/40">
          {seconds(playback.displayMs)} / {seconds(stage.durationMs)}
        </span>
      </div>
    </Panel>
  );
}

/**
 * The same summary the results screen shows, from the same projection.
 *
 * A shared match and a freshly finished one describe the battle identically
 * because they ask the same function; the alternative is two summaries that
 * quietly drift apart, and the shared one is the copy strangers read.
 */
function PublicSummary({ data }: { data: Payload }) {
  const summary = useMemo(() => {
    const stage = buildStage({
      battleId: data.gameId,
      result: projectable(data),
      players: data.teams.map((t) => ({
        id: t.playerId,
        nickname: t.username ?? t.nickname,
        formation: t.formation,
        colorHex: playerColor(t.colorIndex).hex,
      })),
      charactersById: {},
    });
    return stage ? summaryOf(stage.replay) : null;
  }, [data]);

  const colorOf = (playerId: string) =>
    playerColor(data.teams.find((t) => t.playerId === playerId)?.colorIndex ?? 0).hex;

  // The catalogue's own name, not the id with its prefix filed off: `pretty`
  // turns "video-games-dante" into "games dante", which is fine in a dense
  // roster list and wrong as the headline naming the player of the match.
  const nameOf = (characterId: string) =>
    CHARACTERS.find((c) => c.id === characterId)?.name ?? pretty(characterId);

  if (!summary) return null;
  return <BattleSummaryCard summary={summary} nameOf={nameOf} colorOf={colorOf} />;
}
