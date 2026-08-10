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
}

export function clearSession(code: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(code));
}

export function lastNickname(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_NICKNAME) ?? "";
}
