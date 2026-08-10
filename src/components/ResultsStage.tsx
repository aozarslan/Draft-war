"use client";

import { useMemo, useState } from "react";
import type { RoomStore } from "@/lib/client/useRoom";
import type { BattleMap, Character, CombatantResult, EventCard } from "@/lib/game/types";
import { playerColor } from "@/lib/game/colors";
import { getCategory } from "@/lib/game/categories";
import { play } from "@/lib/client/sound";
import { CharacterArt } from "./CharacterArt";
import { Panel, SectionTitle } from "./ui";

const MEDALS = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];

export function ResultsStage({
  store,
  charactersById,
  maps,
  events,
}: {
  store: RoomStore;
  charactersById: Record<string, Character>;
  maps: BattleMap[];
  events: EventCard[];
}) {
  const { snapshot, me, act } = store;
  const [copied, setCopied] = useState<string | null>(null);

  const result = snapshot?.game?.battleResult ?? null;

  const summary = useMemo(() => {
    if (!snapshot || !result) return "";
    const winner = snapshot.players.find((p) => p.id === result.winnerPlayerId);
    const mvpChar = result.mvp ? charactersById[result.mvp.characterId] : null;
    const map = maps.find((m) => m.id === result.mapId);
    const event = events.find((e) => e.id === result.eventId);

    const lines = [
      "DRAFT WAR",
      `🏆 ${winner?.nickname ?? "—"}`,
      `MVP: ${mvpChar?.name ?? "—"}`,
      `${(result.categoryIds ?? []).map((id) => getCategory(id).name).join(" + ")}`,
      `${map?.name ?? ""} · ${event?.name ?? ""}`,
      "",
    ];

    for (const team of result.teams) {
      const p = snapshot.players.find((x) => x.id === team.playerId);
      if (!p) continue;
      lines.push(`${MEDALS[team.rank - 1] ?? ""} ${p.nickname} — ${team.points} pts`);
      for (const r of p.roster) {
        lines.push(`   ${charactersById[r.characterId]?.name ?? r.characterId} — ${r.price}`);
      }
    }
    return lines.join("\n");
  }, [snapshot, result, charactersById, maps, events]);

  if (!snapshot || !result) return null;

  const winner = snapshot.players.find((p) => p.id === result.winnerPlayerId);
  const winnerColor = winner ? playerColor(winner.colorIndex) : null;
  const mvpChar = result.mvp ? charactersById[result.mvp.characterId] : null;
  const mvpStats = result.combatants.find((c) => c.characterId === result.mvp?.characterId);

  const nameOf = (c: CombatantResult | null) =>
    c ? (charactersById[c.characterId]?.name ?? c.characterId) : "—";
  const ownerOf = (c: CombatantResult | null) =>
    c ? (snapshot.players.find((p) => p.id === c.playerId)?.nickname ?? "—") : "—";

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      play("click");
      setTimeout(() => setCopied(null), 1800);
    } catch {
      store.pushToast("error", "Copy failed.");
    }
  }

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/room/${snapshot.room.code}` : "";

  return (
    <div className="space-y-4">
      {/* ---------- Champion ---------- */}
      <Panel className="overflow-hidden" accent={winnerColor?.hex}>
        <div
          className="relative px-5 py-8 text-center"
          style={{
            background: winnerColor
              ? `radial-gradient(600px 200px at 50% 0%, ${winnerColor.hex}33, transparent)`
              : undefined,
          }}
        >
          <p className="text-[11px] font-black uppercase tracking-[0.4em] text-white/40">
            Champion
          </p>
          <h2
            className="headline animate-[slam_0.6s_both] text-[clamp(2.4rem,13vw,4.5rem)]"
            style={{ color: winnerColor?.hex }}
          >
            {winner?.nickname ?? "—"}
          </h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/40">
            {(result.categoryIds ?? []).map((id) => getCategory(id).name).join(" + ")} ·{" "}
            {maps.find((m) => m.id === result.mapId)?.name} ·{" "}
            {events.find((e) => e.id === result.eventId)?.name}
          </p>
        </div>

        {mvpChar ? (
          <div className="flex items-center gap-4 border-t border-white/10 p-4">
            <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-amber-400/40">
              <CharacterArt character={mvpChar} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">
                ⚡ MVP
              </p>
              <h3 className="headline truncate text-2xl">{mvpChar.name}</h3>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] font-bold text-white/55">
                <span>Damage {mvpStats?.damageDealt ?? 0}</span>
                <span>Survival {mvpStats?.survivalPct ?? 0}%</span>
                <span>Specials {mvpStats?.specials ?? 0}</span>
                <span>Eliminations {mvpStats?.kills ?? 0}</span>
              </div>
            </div>
          </div>
        ) : null}
      </Panel>

      {/* ---------- Standings ---------- */}
      <Panel>
        <SectionTitle>Final standings</SectionTitle>
        <ul className="space-y-2 px-4 pb-4">
          {result.teams.map((team) => {
            const p = snapshot.players.find((x) => x.id === team.playerId);
            if (!p) return null;
            const color = playerColor(p.colorIndex);
            return (
              <li
                key={team.playerId}
                className="rounded-xl border px-3 py-3"
                style={{
                  borderColor: `${color.hex}44`,
                  background: `linear-gradient(90deg, ${color.hex}14, transparent)`,
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{MEDALS[team.rank - 1]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-black" style={{ color: color.hex }}>
                      {p.nickname}
                    </span>
                    <span className="block text-[11px] text-white/40">
                      {team.survivors} survived · {team.totalDamage} damage ·{" "}
                      {team.remainingHpPct}% health · power {Math.round(team.teamRating)} ·
                      forecast {team.winProbability}%
                    </span>
                    {team.synergies?.length ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {team.synergies.map((sg) => (
                          <span
                            key={sg.label}
                            className="rounded-full border border-cyan-400/25 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300"
                          >
                            {sg.label} +{Math.round(sg.bonus * 100)}%
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right">
                    <span className="block text-xl font-black tabular-nums">+{team.points}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/35">
                      points
                    </span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* ---------- Awards ---------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          { icon: "🌟", label: "Best performer", c: result.awards.bestPerformer, extra: (c: CombatantResult) => `${c.performance} score` },
          { icon: "🎁", label: "Biggest surprise", c: result.awards.biggestSurprise, extra: (c: CombatantResult) => `${c.performance} score for ${c.price} cr` },
          { icon: "💎", label: "Most valuable purchase", c: result.awards.bestValue, extra: (c: CombatantResult) => `value ${c.valueScore}` },
          { icon: "🧾", label: "Worst purchase", c: result.awards.worstValue, extra: (c: CombatantResult) => `value ${c.valueScore}` },
        ].map((a) => (
          <Panel key={a.label}>
            <div className="flex items-center gap-3 p-4">
              <span className="text-2xl">{a.icon}</span>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  {a.label}
                </p>
                <p className="truncate font-bold">{nameOf(a.c)}</p>
                <p className="text-[11px] text-white/40">
                  {ownerOf(a.c)} · {a.c ? a.extra(a.c) : "—"}
                </p>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      {/* ---------- Value board ---------- */}
      <Panel>
        <SectionTitle right={<span className="text-[10px] text-white/35">performance ÷ price</span>}>
          Auction value scores
        </SectionTitle>
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wider text-white/35">
                <th className="pb-2">Character</th>
                <th className="pb-2">Owner</th>
                <th className="pb-2 text-right">Paid</th>
                <th className="pb-2 text-right">Score</th>
                <th className="pb-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {[...result.combatants]
                .sort((a, b) => b.valueScore - a.valueScore)
                .map((c) => {
                  const p = snapshot.players.find((x) => x.id === c.playerId);
                  const color = p ? playerColor(p.colorIndex).hex : "#94a3b8";
                  return (
                    <tr key={c.characterId} className="border-t border-white/5">
                      <td className="py-1.5 font-semibold">{nameOf(c)}</td>
                      <td className="py-1.5 font-bold" style={{ color }}>
                        {p?.nickname ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-white/50">{c.price}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.performance}</td>
                      <td className="py-1.5 text-right font-black tabular-nums text-amber-300">
                        {c.valueScore}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---------- Actions ---------- */}
      <div className="sticky bottom-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {me?.isHost ? (
          <button
            className="btn btn-primary sm:col-span-2"
            onClick={() => {
              play("click");
              void act({ type: "PLAY_AGAIN" });
            }}
          >
            Play again · back to lobby
          </button>
        ) : (
          <p className="glass rounded-xl px-4 py-3 text-center text-xs font-semibold text-white/45 sm:col-span-2">
            Waiting for the host to start the next round…
          </p>
        )}
        <button className="btn" onClick={() => copy(summary, "results")}>
          {copied === "results" ? "✅ Copied" : "📋 Copy results"}
        </button>
        <button className="btn" onClick={() => copy(shareUrl, "link")}>
          {copied === "link" ? "✅ Copied" : "🔗 Share room"}
        </button>
      </div>
    </div>
  );
}
