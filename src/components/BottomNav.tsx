"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchNotifications, getAccount } from "@/lib/client/account";

const TABS = [
  { href: "/", label: "Play", icon: "⚔️" },
  { href: "/shop", label: "Shop", icon: "🛒" },
  { href: "/achievements", label: "Medals", icon: "🏅" },
  { href: "/friends", label: "Friends", icon: "👥" },
  { href: "/profile", label: "You", icon: "🙂" },
];

/**
 * Thumb-reach navigation for a phone.
 *
 * The top bar keeps working on a laptop; below `sm` it drops its links and
 * this takes over, because the whole hub is meant to be used one-handed on the
 * sofa with everybody else in the room. A live game deliberately does not
 * render it — once the auction starts, the only thing on screen is the game.
 */
export function BottomNav() {
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);

  // The friends tab carries the unread count: on a phone the bell is the
  // easiest thing in the header to miss.
  useEffect(() => {
    if (!getAccount()) return;
    const load = () =>
      void fetchNotifications().then((n) => setWaiting(n?.unread ?? 0));
    load();
    const id = setInterval(load, 45_000);
    window.addEventListener("draftwar:account", load);
    return () => {
      clearInterval(id);
      window.removeEventListener("draftwar:account", load);
    };
  }, []);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#05060c]/95 backdrop-blur-xl sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-col items-center gap-0.5 py-2.5 transition active:scale-95"
              >
                <span className="text-lg leading-none" style={{ opacity: active ? 1 : 0.5 }}>
                  {tab.icon}
                </span>
                <span
                  className="text-[9px] font-black uppercase tracking-wider"
                  style={{ color: active ? "#22d3ee" : "rgba(255,255,255,0.4)" }}
                >
                  {tab.label}
                </span>
                {tab.href === "/friends" && waiting > 0 ? (
                  <span className="absolute right-[22%] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
                    {waiting > 9 ? "9+" : waiting}
                  </span>
                ) : null}
                {active ? (
                  <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-cyan-400" />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
