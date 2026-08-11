import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { AchievementsClient } from "./AchievementsClient";

export const metadata: Metadata = {
  title: "Achievements · DRAFT WAR",
  description:
    "Everything there is to chase in DRAFT WAR, and how close you are to each of it.",
};

export default function AchievementsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <AchievementsClient />
      </main>
    </>
  );
}
