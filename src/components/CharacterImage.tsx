"use client";

import { useState } from "react";
import type { Character } from "@/lib/game/types";
import { CharacterArt } from "./CharacterArt";

/**
 * Character artwork with a graceful ladder:
 *
 *   Wikimedia thumbnail  ->  generated placeholder  ->  never a broken image
 *
 * Plenty of Wikipedia articles about fictional characters carry only non-free
 * cover art, which the Wikimedia APIs correctly refuse to hand out. Those
 * characters get the procedural poster instead, and it is designed to look
 * deliberate rather than like a failure.
 *
 * The image is NOT faded in by JavaScript. An earlier version kept it at
 * opacity 0 until `onLoad` fired, and that event is unreliable: a cached image
 * can finish before React attaches the handler, and the picture then stays
 * invisible forever. The skeleton simply sits behind the image instead, so a
 * missed event costs nothing — only a genuine `onError` changes what renders.
 */
export function CharacterImage({
  character,
  className = "",
  priority = false,
  sizes = "300px",
}: {
  character: Character;
  className?: string;
  /** Load immediately instead of lazily — used for the auction centrepiece. */
  priority?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = failed || !character.thumbnailUrl;

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black/40 ${className}`}>
      {showFallback ? (
        <>
          <CharacterArt character={character} />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-center text-[8px] font-bold uppercase tracking-widest text-white/45 backdrop-blur-sm">
            Image not available
          </span>
        </>
      ) : (
        <>
          {/* Sits behind the image: covers the gap while it downloads, and
              shows through transparent PNG artwork afterwards. */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(150deg, ${character.palette[0]}, ${character.palette[1]}44)`,
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={character.thumbnailUrl}
            src={character.thumbnailUrl!}
            alt={character.name}
            sizes={sizes}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        </>
      )}
    </div>
  );
}

/**
 * Unobtrusive provenance line. We show exactly what Wikimedia reported and no
 * more — if it did not report a licence we say where the image came from
 * without implying anything about how it may be reused.
 */
export function ImageCredit({
  character,
  className = "",
}: {
  character: Character;
  className?: string;
}) {
  if (!character.thumbnailUrl) return null;

  const parts: string[] = [];
  if (character.imageCredit) parts.push(character.imageCredit);
  if (character.imageLicense) parts.push(character.imageLicense);

  return (
    <p className={`text-[10px] leading-snug text-white/35 ${className}`}>
      Image:{" "}
      <a
        href={character.imageSource ?? character.wikiUrl ?? "#"}
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-white/20 underline-offset-2 hover:text-white/60"
      >
        Wikimedia
      </a>
      {parts.length ? ` · ${parts.join(" · ")}` : ""}
    </p>
  );
}
