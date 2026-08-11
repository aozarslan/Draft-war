"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProfileBadge } from "./ProfileBadge";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/#play", label: "Play" },
  { href: "/categories", label: "Categories" },
  { href: "/characters", label: "Characters" },
  { href: "/rules", label: "Rules" },
  { href: "/leaderboard", label: "Ranks" },
];

/**
 * Site chrome for the pages outside a room. A live room deliberately does not
 * use this — once you are in a game the only thing on screen should be the
 * game.
 */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05060c]/80 backdrop-blur-xl">
      <nav className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-3">
        <Link href="/" className="headline mr-2 text-lg neon-text">
          DRAFT WAR
        </Link>
        <div className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.slice(1).map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wider transition ${
                  active ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
        <ProfileBadge />
      </nav>
    </header>
  );
}
