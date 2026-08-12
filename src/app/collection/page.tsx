import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { CollectionClient } from "./CollectionClient";

export const metadata: Metadata = {
  title: "Collection · DRAFT WAR",
  description: "Every character you have drafted, how well you know them, and how much of each category you have collected.",
};

export default function CollectionPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <CollectionClient />
      </main>
    </>
  );
}
