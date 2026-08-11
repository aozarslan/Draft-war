import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { LeaderboardClient } from "./LeaderboardClient";

export const metadata: Metadata = {
  title: "Leaderboard · DRAFT WAR",
  description: "This season's standings.",
};

export default function LeaderboardPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <header className="mb-5">
          <h1 className="headline text-[clamp(2rem,8vw,3.5rem)] neon-text">Leaderboard</h1>
          <p className="mt-1 text-sm text-white/50">
            Ranked matches only. Casual games still award XP but never move rank
            points.
          </p>
        </header>
        <LeaderboardClient />
      </main>
    </>
  );
}
