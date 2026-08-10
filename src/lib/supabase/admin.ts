import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeSupabaseUrlProblem, normalizeSupabaseUrl } from "./url";

/**
 * Service-role client. SERVER ONLY — importing this from a client component
 * would leak the key, so every consumer lives under `src/app/api`.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!rawUrl || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY (see .env.example). On Vercel, remember " +
        "that changing an environment variable only takes effect on the next " +
        "deployment.",
    );
  }

  const url = normalizeSupabaseUrl(rawUrl);
  const problem = describeSupabaseUrlProblem(url);
  if (problem) throw new Error(problem);

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}
