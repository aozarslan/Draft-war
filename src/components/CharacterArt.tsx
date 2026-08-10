"use client";

import type { Character } from "@/lib/game/types";

/**
 * Procedural character artwork.
 *
 * Shipping licensed portraits for 20 characters is not something a party game
 * repo should do, and remote images would be the slowest thing on the page. So
 * each character gets a deterministic poster generated from its own id: a
 * two-stop gradient from the character's palette, a silhouette-ish geometric
 * mark and its initials. If you later add real art, set `imageUrl` on the
 * character and it is used instead — nothing else changes.
 */
export function CharacterArt({
  character,
  className = "",
  showInitials = true,
}: {
  character: Character;
  className?: string;
  showInitials?: boolean;
}) {
  if (character.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={character.imageUrl}
        alt={character.name}
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  const [from, to] = character.palette;
  const id = character.id;
  // Stable pseudo-random values so the same character always looks the same.
  const hash = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rot = hash % 45;
  const bars = 5 + (hash % 4);
  const initials = character.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return (
    <svg
      viewBox="0 0 200 240"
      className={`h-full w-full ${className}`}
      role="img"
      aria-label={`${character.name} artwork`}
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <radialGradient id={`v-${id}`} cx="50%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.72" />
        </radialGradient>
      </defs>

      <rect width="200" height="240" fill={`url(#g-${id})`} />

      <g opacity="0.22" transform={`rotate(${rot} 100 120)`}>
        {Array.from({ length: bars }).map((_, i) => (
          <rect
            key={i}
            x={-40 + i * (280 / bars)}
            y={-60}
            width={12 + ((hash >> i) % 10)}
            height={360}
            fill="#000"
          />
        ))}
      </g>

      {/* Abstract figure: shoulders + head, enough to read as a character. */}
      <g opacity="0.34" fill="#05060c">
        <circle cx="100" cy="92" r="30" />
        <path d="M40 240c0-38 27-66 60-66s60 28 60 66z" />
      </g>

      <rect width="200" height="240" fill={`url(#v-${id})`} />

      {showInitials ? (
        <text
          x="100"
          y="152"
          textAnchor="middle"
          fontSize="62"
          fontWeight="900"
          fill="#fff"
          fillOpacity="0.9"
          letterSpacing="-3"
          style={{ paintOrder: "stroke" }}
        >
          {initials}
        </text>
      ) : null}
    </svg>
  );
}
