"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeSupabaseUrlProblem, normalizeSupabaseUrl } from "./url";

/**
 * Anon client, used for exactly one thing: subscribing to Realtime change
 * events on `rooms` and `chat_messages`. It never writes and never reads game
 * state — the authoritative snapshot always comes from our own API.
 */
let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  if (cached) return cached;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !key) return null;

  const url = normalizeSupabaseUrl(rawUrl);
  const problem = describeSupabaseUrlProblem(url);
  if (problem) {
    // Realtime is optional — the polling fallback keeps the game playable —
    // so warn loudly instead of taking the page down.
    console.warn(`[DRAFT WAR] Realtime disabled. ${problem}`);
    return null;
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return cached;
}
