/**
 * Normalises whatever ended up in `NEXT_PUBLIC_SUPABASE_URL`.
 *
 * The Supabase dashboard shows several URLs and it is easy to copy the wrong
 * one. supabase-js wants the bare project URL and appends `/rest/v1`,
 * `/auth/v1` and so on itself — so pasting the REST endpoint produces
 * `.../rest/v1/rest/v1/characters`, and the gateway answers with a cryptic
 * "Invalid path specified in request URL" that says nothing about the cause.
 *
 * Rather than fail with that, we accept the common variants and repair them.
 */
const SERVICE_PATH = /\/(rest|auth|storage|realtime|functions)\/v\d+$/;

export function normalizeSupabaseUrl(raw: string): string {
  // Copy-paste often brings quotes or stray whitespace along.
  let url = raw.trim().replace(/^["']|["']$/g, "").trim();
  url = url.replace(/\/+$/, "");

  // Strip a service path, possibly repeated (".../rest/v1/rest/v1").
  while (SERVICE_PATH.test(url)) url = url.replace(SERVICE_PATH, "");

  return url;
}

/**
 * Returns an explanation of why a URL is unusable, or null when it is fine.
 * Kept separate so both the server and the browser client can report the same
 * message.
 */
export function describeSupabaseUrlProblem(url: string): string | null {
  if (!url) return "NEXT_PUBLIC_SUPABASE_URL is empty.";

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${url}". It should look like https://your-project-ref.supabase.co`;
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    return `NEXT_PUBLIC_SUPABASE_URL must use https, got "${parsed.protocol}//".`;
  }

  if (parsed.pathname && parsed.pathname !== "/") {
    return `NEXT_PUBLIC_SUPABASE_URL must be the project URL with no path, got "${url}". Use https://${parsed.hostname} instead.`;
  }

  if (parsed.hostname.endsWith("supabase.com")) {
    return `NEXT_PUBLIC_SUPABASE_URL points at the dashboard (${parsed.hostname}), not the project API. Copy the Project URL from Project Settings → Data API; it ends in .supabase.co`;
  }

  return null;
}
