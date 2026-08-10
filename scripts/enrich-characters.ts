/**
 * Fetches Wikipedia metadata for every character in the pools and writes it to
 * `data/wiki-cache.json`, which the SQL seed generator merges in.
 *
 *   npm run wiki:enrich          # only characters missing from the cache
 *   npm run wiki:enrich -- --all # re-fetch everything
 *
 * Doing this offline rather than at runtime means the deployed game never calls
 * Wikimedia during a match, and the cache is committed so a fresh clone can
 * seed the database without any network access at all.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CHARACTERS } from "../src/lib/game/characters";
import { getImageCredit, getSummary, lastFailure, searchPages } from "../src/lib/server/wikipedia";

export interface WikiRecord {
  wikiTitle: string | null;
  wikiUrl: string | null;
  description: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  imageSource: string | null;
  imageLicense: string | null;
  imageCredit: string | null;
  /** Notes for the report: "ok" | "no-image" | "not-found" | "ambiguous". */
  status: string;
  fetchedAt: string;
}

const DATA_DIR = join(process.cwd(), "data");
const CACHE_PATH = join(DATA_DIR, "wiki-cache.json");

function loadCache(): Record<string, WikiRecord> {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, WikiRecord>;
  } catch {
    return {};
  }
}

async function main() {
  const refetchAll = process.argv.includes("--all");
  const onlyCategory = process.argv.find((a) => a.startsWith("--category="))?.split("=")[1];

  mkdirSync(DATA_DIR, { recursive: true });
  const cache = loadCache();

  const targets = CHARACTERS.filter(
    (c) =>
      (!onlyCategory || c.categoryId === onlyCategory) &&
      (refetchAll || !cache[c.id]),
  );

  console.log(`${targets.length} karakter işlenecek (önbellekte ${Object.keys(cache).length} kayıt var)\n`);

  let ok = 0;
  let noImage = 0;
  let notFound = 0;

  for (let i = 0; i < targets.length; i++) {
    const character = targets[i];
    const term = character.wikiTitle ?? character.name;
    const prefix = `[${String(i + 1).padStart(3)}/${targets.length}] ${character.name}`;

    let summary = await getSummary(term);

    // The authored title may be wrong or a redirect that has since moved.
    // Fall back to search rather than silently storing nothing.
    if (!summary || summary.type === "disambiguation") {
      const hits = await searchPages(`${character.name} ${character.universe}`, 5);
      const best =
        hits.find((h) => h.title.toLowerCase() === character.name.toLowerCase()) ??
        hits[0];
      if (best) summary = await getSummary(best.title);
    }

    if (!summary || summary.type === "disambiguation") {
      cache[character.id] = {
        wikiTitle: null, wikiUrl: null, description: null, imageUrl: null,
        thumbnailUrl: null, imageSource: null, imageLicense: null,
        imageCredit: null, status: "not-found", fetchedAt: new Date().toISOString(),
      };
      notFound++;
      console.log(`${prefix} — ⚠ sayfa bulunamadı (${term})${lastFailure ? " :: " + lastFailure : ""}`);
      continue;
    }

    const credit = await getImageCredit(summary.title);
    const thumbnailUrl = credit.thumbnailUrl ?? summary.thumbnailUrl;
    const hasImage = Boolean(thumbnailUrl);

    cache[character.id] = {
      wikiTitle: summary.title,
      wikiUrl: summary.wikiUrl,
      description: summary.description ?? summary.extract,
      imageUrl: summary.imageUrl,
      thumbnailUrl,
      imageSource: credit.fileUrl ?? summary.wikiUrl,
      imageLicense: credit.license,
      imageCredit: credit.artist ?? credit.credit,
      status: hasImage ? "ok" : "no-image",
      fetchedAt: new Date().toISOString(),
    };

    if (hasImage) ok++;
    else noImage++;
    console.log(`${prefix} — ${hasImage ? "✓" : "⚠ görsel yok"} ${summary.title}`);

    if ((i + 1) % 25 === 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
    }
  }

  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  console.log(`\n✓ görselli: ${ok}   ⚠ görselsiz: ${noImage}   ✗ bulunamadı: ${notFound}`);
  console.log(`Önbellek: ${CACHE_PATH}`);
}

void main();
