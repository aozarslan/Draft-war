import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { PublicMatch } from "./PublicMatch";

export const metadata: Metadata = {
  title: "Match · DRAFT WAR",
  description: "A finished DRAFT WAR match: the draft, the battle and the result.",
};

export default async function MatchPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <PublicMatch gameId={gameId} />
      </main>
    </>
  );
}
