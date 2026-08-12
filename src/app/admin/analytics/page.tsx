import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { AnalyticsClient } from "./AnalyticsClient";

export const metadata: Metadata = {
  title: "Analytics · DRAFT WAR",
  description: "How the game is actually being played. Development only.",
};

export default function AnalyticsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <AnalyticsClient />
      </main>
    </>
  );
}
