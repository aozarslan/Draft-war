"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProfileBadge } from "./ProfileBadge";
import { NotificationBell } from "./NotificationBell";
import { BottomNav } from "./BottomNav";

const LINKS = [
  { href: "/#play", label: "Play" },
  { href: "/categories", label: "Categories" },
  { href: "/characters", label: "Characters" },
  { href: "/rules", label: "Rules" },
  { href: "/leaderboard", label: "Ranks" },
  { href: "/shop", label: "Shop" },
  { href: "/achievements", label: "Medals" },
  { href: "/collection", label: "Collection" },
  { href: "/friends", label: "Friends" },
];

/**
 * Site chrome for the pages outside a room. A live room deliberately does not
 * use this — once you are in a game the only thing on screen should be the
 * game.
 *
 * Two shapes, one component. On a laptop the links live in the top bar; on a
 * phone they move to a bottom bar within thumb reach and the top bar keeps
 * only what has to be glanceable — who you are, what you have, and whether
 * anything is waiting.
 */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05060c]/80 backdrop-blur-xl">
        <nav className="mx-auto flex w-full max-w-6xl items-center gap-1 px-4 py-3">
          <Link href="/" className="headline mr-2 shrink-0 text-lg neon-text">
            DRAFT WAR
          </Link>

          {/* Below sm these are the bottom bar's job. */}
          <div className="no-scrollbar hidden flex-1 items-center gap-1 overflow-x-auto sm:flex">
            {LINKS.map((l) => {
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

          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <NotificationBell />
            <ProfileBadge />
          </div>
        </nav>
      </header>

      <BottomNav />
    </>
  );
}
