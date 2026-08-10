"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Anon client, used for exactly one thing: subscribing to Realtime change
 * events on `rooms` and `chat_messages`. It never writes and never reads game
 * state — the authoritative snapshot always comes from our own API.
 */
let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return cached;
}
