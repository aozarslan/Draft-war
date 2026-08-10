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
 * Images are lazy-loaded and fade in over a skeleton, because a category page
 * can easily put fifty of them on screen at once on a phone.
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
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    character.thumbnailUrl ? "loading" : "failed",
  );

  const showFallback = state === "failed" || !character.thumbnailUrl;

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
          {state === "loading" ? (
            <div
              className="absolute inset-0 animate-pulse"
              style={{
                background: `linear-gradient(135deg, ${character.palette[0]}, ${character.palette[1]}55)`,
              }}
            />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={character.thumbnailUrl!}
            alt={character.name}
            sizes={sizes}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
            className={`h-full w-full object-cover object-top transition-opacity duration-500 ${
              state === "loaded" ? "opacity-100" : "opacity-0"
            }`}
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
