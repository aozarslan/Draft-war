"use client";

/**
 * The persistent side of a player: a `(profileId, token)` pair kept in
 * localStorage, separate from the per-room session in `session.ts`.
 *
 * Guest play needs none of this. When a profile exists we attach it to every
 * room the player creates or joins, and the server banks their XP and rank
 * against it.
 */

export interface AccountSession {
  profileId: string;
  token: string;
  username: string;
  avatar: string;
}

const KEY = "draftwar:account";

export function getAccount(): AccountSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AccountSession) : null;
  } catch {
    return null;
  }
}

export function setAccount(session: AccountSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(session));
  window.dispatchEvent(new Event("draftwar:account"));
}

export function clearAccount(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new Event("draftwar:account"));
}

/** Headers that identify the profile. Empty for a guest. */
export function accountHeaders(): Record<string, string> {
  const account = getAccount();
  if (!account) return {};
  return {
    "x-dw-profile": account.profileId,
    "x-dw-profile-token": account.token,
  };
}

// ---------------------------------------------------------------------------
// Shapes returned by /api/profile
// ---------------------------------------------------------------------------

export interface ProfileView {
  id: string;
  username: string;
  avatar: string;
  banner: string;
  title: string | null;
  level: number;
  xp: number;
  coins: number;
  createdAt: string;
  lastActiveAt: string;
}

export interface ProfileStats {
  matches: number;
  wins: number;
  losses: number;
  topThree: number;
  mvps: number;
  charactersDrafted: number;
  creditsSpent: number;
  mostExpensivePrice: number;
  mostExpensiveName: string | null;
  bestRankPoints: number;
}

export interface SeasonView {
  id: string;
  number: number;
  name: string;
  endsAt: string;
  rankPoints: number;
  bestRankPoints: number;
  matches: number;
  wins: number;
  mvps: number;
}

export interface MatchHistoryEntry {
  gameId: string;
  roomCode: string | null;
  categoryIds: string[];
  mapId: string | null;
  eventId: string | null;
  placement: number;
  playerCount: number;
  isMvp: boolean;
  mvpCharacter: string | null;
  creditsSpent: number;
  xp: number;
  rankDelta: number;
  ranked: boolean;
  roster: { characterId: string; price: number }[];
  at: string;
}

export interface ProfilePayload {
  ok: true;
  profile: ProfileView;
  stats: ProfileStats;
  season: SeasonView | null;
  history: MatchHistoryEntry[];
}

export async function createProfile(
  username: string,
  avatar = "default",
): Promise<AccountSession> {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, avatar }),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) {
    throw new Error(data.message ?? "Could not create the profile.");
  }
  const session: AccountSession = {
    profileId: data.profileId,
    token: data.token,
    username: data.username,
    avatar,
  };
  setAccount(session);
  return session;
}

export async function fetchProfile(): Promise<ProfilePayload | null> {
  if (!getAccount()) return null;
  const res = await fetch("/api/profile", {
    headers: accountHeaders(),
    cache: "no-store",
  });
  if (res.status === 401) {
    // The profile no longer exists server-side; stop pretending it does.
    clearAccount();
    return null;
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) return null;
  return data as ProfilePayload;
}
