/**
 * ---------------------------------------------------------------------------
 * WIKIMEDIA / WIKIPEDIA SERVICE
 * ---------------------------------------------------------------------------
 * A small, reusable client over the documented MediaWiki APIs. No HTML
 * scraping: everything comes from
 *
 *   - REST search      /w/rest.php/v1/search/page
 *   - REST summary     /api/rest_v1/page/summary/{title}
 *   - Action API       ?action=query&prop=pageimages|imageinfo
 *
 * Three rules the Wikimedia terms of use expect of us, all enforced here:
 *   1. Identify yourself with a real User-Agent.
 *   2. Do not hammer the API — requests are serialised with a minimum gap.
 *   3. Cache. Nothing in the game calls this per render; the character pool is
 *      enriched once and stored in the database.
 *
 * We never re-host images. We keep the Wikimedia URL, plus whatever licence and
 * author metadata Wikimedia reports, and display that as attribution.
 */

const API_ROOT = "https://en.wikipedia.org";
// Wikimedia's user-agent policy asks for a way to contact whoever is calling.
// A UA without one gets throttled quickly, which is exactly what happened the
// first time this ran.
const USER_AGENT =
  process.env.WIKIMEDIA_USER_AGENT ??
  "DraftWar/2.0 (https://draft-war.vercel.app; party game character database)";

/** Minimum milliseconds between outbound calls. */
const MIN_GAP_MS = 200;
const MAX_RETRIES = 4;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface WikiSearchResult {
  title: string;
  key: string;
  description: string | null;
  excerpt: string | null;
  thumbnailUrl: string | null;
}

export interface WikiImageCredit {
  /** Wikimedia file page, e.g. https://commons.wikimedia.org/wiki/File:X.jpg */
  fileUrl: string | null;
  license: string | null;
  artist: string | null;
  credit: string | null;
}

export interface WikiSummary {
  title: string;
  wikiUrl: string;
  description: string | null;
  extract: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  /** "disambiguation" means the caller must pick a specific page. */
  type: string;
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

const cache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.value as T;
}

/** Set when a call fails, so callers can log why instead of guessing. */
export let lastFailure: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serialises calls, keeps a polite gap between them, and backs off when
 * Wikimedia asks us to. A throttled response must not look the same as
 * "no such page" — that hid a bug for a whole run.
 */
async function fetchJson<T>(url: string): Promise<T | null> {
  const run = async (): Promise<T | null> => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const gap = Date.now() - lastCallAt;
      if (gap < MIN_GAP_MS) await sleep(MIN_GAP_MS - gap);
      lastCallAt = Date.now();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(url, {
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
          signal: controller.signal,
        });

        if (res.status === 404) {
          lastFailure = "404";
          return null;
        }
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 800 * 2 ** attempt;
          lastFailure = `HTTP ${res.status}, ${wait}ms bekleniyor`;
          if (attempt < MAX_RETRIES) {
            await sleep(wait);
            continue;
          }
          return null;
        }
        if (!res.ok) {
          lastFailure = `HTTP ${res.status}`;
          return null;
        }

        lastFailure = null;
        return (await res.json()) as T;
      } catch (err) {
        lastFailure = err instanceof Error ? err.message : "network error";
        if (attempt < MAX_RETRIES) {
          await sleep(800 * 2 ** attempt);
          continue;
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  };

  const result = queue.then(run, run) as Promise<T | null>;
  queue = result.catch(() => undefined);
  return result;
}

/** Wikimedia returns HTML in credit fields; the UI wants plain text. */
function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text.slice(0, 300) : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Page search. Used by the admin importer to resolve ambiguous names. */
export async function searchPages(
  query: string,
  limit = 6,
): Promise<WikiSearchResult[]> {
  const key = `search:${query}:${limit}`;
  const hit = cached<WikiSearchResult[]>(key);
  if (hit) return hit;

  const url = `${API_ROOT}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`;
  const data = await fetchJson<{
    pages?: {
      title: string;
      key: string;
      description?: string | null;
      excerpt?: string | null;
      thumbnail?: { url?: string } | null;
    }[];
  }>(url);

  const results: WikiSearchResult[] = (data?.pages ?? []).map((p) => ({
    title: p.title,
    key: p.key,
    description: p.description ?? null,
    excerpt: stripHtml(p.excerpt),
    thumbnailUrl: p.thumbnail?.url
      ? p.thumbnail.url.startsWith("//")
        ? `https:${p.thumbnail.url}`
        : p.thumbnail.url
      : null,
  }));

  cache.set(key, { at: Date.now(), value: results });
  return results;
}

/** Lead image, short description and canonical URL for one page. */
export async function getSummary(title: string): Promise<WikiSummary | null> {
  const key = `summary:${title}`;
  const hit = cached<WikiSummary>(key);
  if (hit) return hit;

  const url = `${API_ROOT}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const data = await fetchJson<{
    title?: string;
    description?: string;
    extract?: string;
    type?: string;
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  }>(url);

  if (!data?.title) return null;

  const summary: WikiSummary = {
    title: data.title,
    wikiUrl:
      data.content_urls?.desktop?.page ??
      `${API_ROOT}/wiki/${encodeURIComponent(data.title.replace(/ /g, "_"))}`,
    description: data.description ?? null,
    extract: data.extract ? data.extract.trim() : null,
    thumbnailUrl: data.thumbnail?.source ?? null,
    imageUrl: data.originalimage?.source ?? data.thumbnail?.source ?? null,
    type: data.type ?? "standard",
  };

  cache.set(key, { at: Date.now(), value: summary });
  return summary;
}

/**
 * Licence and author for a page's lead image.
 *
 * Two hops: pageimages gives the File: name, imageinfo's extmetadata gives the
 * licence short name and artist. Both are best-effort — plenty of images report
 * nothing useful, and we would rather show no claim than a wrong one.
 */
export async function getImageCredit(
  title: string,
  thumbSize = 800,
): Promise<WikiImageCredit & { thumbnailUrl: string | null }> {
  const key = `credit:${title}:${thumbSize}`;
  const hit = cached<WikiImageCredit & { thumbnailUrl: string | null }>(key);
  if (hit) return hit;

  const empty = {
    fileUrl: null,
    license: null,
    artist: null,
    credit: null,
    thumbnailUrl: null,
  };

  const pageUrl =
    `${API_ROOT}/w/api.php?action=query&format=json&formatversion=2&origin=*` +
    `&prop=pageimages&piprop=name|thumbnail&pithumbsize=${thumbSize}` +
    `&titles=${encodeURIComponent(title)}`;

  const pageData = await fetchJson<{
    query?: { pages?: { pageimage?: string; thumbnail?: { source?: string } }[] };
  }>(pageUrl);

  const page = pageData?.query?.pages?.[0];
  const fileName = page?.pageimage;
  const thumbnailUrl = page?.thumbnail?.source ?? null;
  if (!fileName) {
    const value = { ...empty, thumbnailUrl };
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  const fileUrl =
    `${API_ROOT}/w/api.php?action=query&format=json&formatversion=2&origin=*` +
    `&prop=imageinfo&iiprop=extmetadata|url&iiextmetadatafilter=LicenseShortName|Artist|Credit|AttributionRequired` +
    `&titles=${encodeURIComponent(`File:${fileName}`)}`;

  const fileData = await fetchJson<{
    query?: {
      pages?: {
        imageinfo?: {
          descriptionurl?: string;
          extmetadata?: Record<string, { value?: string }>;
        }[];
      }[];
    };
  }>(fileUrl);

  const info = fileData?.query?.pages?.[0]?.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};

  const value = {
    fileUrl: info?.descriptionurl ?? null,
    license: stripHtml(meta.LicenseShortName?.value),
    artist: stripHtml(meta.Artist?.value),
    credit: stripHtml(meta.Credit?.value),
    thumbnailUrl,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * One-shot lookup used by the importer: resolve a name to a page and collect
 * everything the character record needs.
 */
export interface ResolvedCharacterData {
  wikiTitle: string;
  wikiUrl: string;
  description: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  imageSource: string | null;
  imageLicense: string | null;
  imageCredit: string | null;
  /** True when the search hit a disambiguation page and needs a human. */
  ambiguous: boolean;
  candidates: WikiSearchResult[];
}

export async function resolveCharacter(
  searchTerm: string,
  exactTitle?: string,
): Promise<ResolvedCharacterData | null> {
  let title = exactTitle ?? null;
  let candidates: WikiSearchResult[] = [];

  if (!title) {
    candidates = await searchPages(searchTerm, 6);
    if (candidates.length === 0) return null;
    title = candidates[0].title;
  }

  const summary = await getSummary(title);
  if (!summary) return null;

  if (summary.type === "disambiguation") {
    if (candidates.length === 0) candidates = await searchPages(searchTerm, 6);
    return {
      wikiTitle: summary.title,
      wikiUrl: summary.wikiUrl,
      description: null,
      imageUrl: null,
      thumbnailUrl: null,
      imageSource: null,
      imageLicense: null,
      imageCredit: null,
      ambiguous: true,
      candidates,
    };
  }

  const credit = await getImageCredit(summary.title);

  return {
    wikiTitle: summary.title,
    wikiUrl: summary.wikiUrl,
    description: summary.description ?? summary.extract,
    imageUrl: summary.imageUrl,
    thumbnailUrl: credit.thumbnailUrl ?? summary.thumbnailUrl,
    imageSource: credit.fileUrl ?? summary.wikiUrl,
    imageLicense: credit.license,
    imageCredit: credit.artist ?? credit.credit,
    ambiguous: false,
    candidates,
  };
}
