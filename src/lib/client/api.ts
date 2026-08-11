"use client";

import type { Snapshot } from "@/lib/server/engine";
import type { Character, BattleMap, EventCard } from "@/lib/game/types";
import type { Category } from "@/lib/game/categories";
import type { StoredSession } from "./session";
import { accountHeaders } from "./account";

export interface Reference {
  characters: Character[];
  maps: BattleMap[];
  events: EventCard[];
  categories: Category[];
  categoryCounts: Record<string, number>;
}

export type StateResponse = Snapshot & { reference?: Reference };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError("BAD_RESPONSE", "The server sent an unreadable reply.", res.status);
  }
  const body = payload as { ok?: boolean; code?: string; message?: string };
  if (!res.ok || body?.ok === false) {
    throw new ApiError(
      body?.code ?? "REQUEST_FAILED",
      body?.message ?? "Something went wrong.",
      res.status,
    );
  }
  return payload as T;
}

export async function createRoom(input: {
  nickname: string;
  roomName?: string;
  config?: Record<string, unknown>;
}): Promise<{ roomId: string; playerId: string; code: string; token: string }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json", ...accountHeaders() },
    body: JSON.stringify(input),
  });
  return parse(res);
}

export async function joinRoom(input: {
  code: string;
  nickname: string;
}): Promise<{ roomId: string; playerId: string; code: string; token: string }> {
  const res = await fetch("/api/rooms/join", {
    method: "POST",
    headers: { "content-type": "application/json", ...accountHeaders() },
    body: JSON.stringify(input),
  });
  return parse(res);
}

export async function fetchState(
  code: string,
  opts: { tick?: boolean; full?: boolean } = {},
): Promise<StateResponse> {
  const params = new URLSearchParams();
  if (opts.tick) params.set("tick", "1");
  if (opts.full) params.set("full", "1");
  const res = await fetch(
    `/api/rooms/${encodeURIComponent(code)}/state?${params.toString()}`,
    { cache: "no-store" },
  );
  return parse(res);
}

export type ClientAction =
  | { type: "HEARTBEAT" }
  | { type: "READY"; ready: boolean }
  | { type: "START"; mode?: "HOST" | "VOTE" | "RANDOM" }
  | { type: "PICK_CATEGORY"; categoryIds: string[] }
  | { type: "SET_MAX_PLAYERS"; maxPlayers: number }
  | { type: "VOTE_CATEGORY"; categoryId: string }
  | { type: "BID"; auctionId: string; amount: number }
  | { type: "PASS"; auctionId: string }
  | { type: "CHAT"; body: string }
  | { type: "REACTION"; body: string }
  | { type: "VOTE_MAP"; mapId: string }
  | { type: "ADVANCE" }
  | { type: "PLAY_AGAIN" };

export async function sendAction(
  code: string,
  session: StoredSession,
  action: ClientAction,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dw-player": session.playerId,
      "x-dw-token": session.token,
    },
    body: JSON.stringify(action),
  });
  return parse(res);
}

export async function devOp(
  op: "RESET" | "ADD_BOT" | "SKIP_AUCTION" | "FORCE_BATTLE",
  code: string,
  nickname?: string,
): Promise<void> {
  const res = await fetch("/api/dev", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, code, nickname }),
  });
  await parse(res);
}
