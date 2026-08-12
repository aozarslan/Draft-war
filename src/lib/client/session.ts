"use client";

/**
 * Account-free identity, stored per room code so one browser can hold sessions
 * for several rooms at once (handy when testing with multiple tabs).
 */
export interface StoredSession {
  playerId: string;
  token: string;
  nickname: string;
}

const key = (code: string) => `draftwar:session:${code.toUpperCase()}`;
const LAST_NICKNAME = "draftwar:nickname";
const LAST_ROOM = "draftwar:room";

export function getSession(code: string): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function setSession(code: string, session: StoredSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(code), JSON.stringify(session));
  window.localStorage.setItem(LAST_NICKNAME, session.nickname);
  window.localStorage.setItem(LAST_ROOM, code.toUpperCase());
}

export function clearSession(code: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(code));
  if (window.localStorage.getItem(LAST_ROOM) === code.toUpperCase()) {
    window.localStorage.removeItem(LAST_ROOM);
  }
}

/**
 * The room this browser last sat down in, if the seat is still held.
 *
 * Sessions are stored per code so several rooms can be open at once, which
 * means "the current room" is not something the storage answers on its own —
 * this records it. Used by the friends page to offer an invite; the server
 * still checks that the inviter really is in that room.
 */
export function lastRoom(): string | null {
  if (typeof window === "undefined") return null;
  const code = window.localStorage.getItem(LAST_ROOM);
  if (!code) return null;
  return getSession(code) ? code : null;
}

export function lastNickname(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_NICKNAME) ?? "";
}
