import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { LeaguesClient } from "./LeaguesClient";

export const metadata: Metadata = {
  title: "Leagues · DRAFT WAR",
  description: "A private, long-running table for your group. Draft night, settled.",
};

export default function LeaguesPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <LeaguesClient />
      </main>
    </>
  );
}
