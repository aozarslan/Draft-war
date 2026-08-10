import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { CharacterBrowser } from "./CharacterBrowser";

export const metadata: Metadata = {
  title: "Character database · DRAFT WAR",
  description:
    "Every character in DRAFT WAR, across Marvel, DC, Hollywood, action movies, animals, fantasy, video games and anime.",
};

export default function CharactersPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <header className="mb-5">
          <h1 className="headline text-[clamp(2rem,8vw,3.5rem)] neon-text">
            Character database
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-white/50">
            Search and filter the full roster. Every rating is a game score created
            for DRAFT WAR — it is not an official ranking, and for the real people
            and real animals in here it is not a measurement of anything.
          </p>
        </header>
        <CharacterBrowser />
      </main>
    </>
  );
}
