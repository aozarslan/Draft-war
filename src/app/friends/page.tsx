import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { FriendsClient } from "./FriendsClient";

export const metadata: Metadata = {
  title: "Friends · DRAFT WAR",
  description: "Add the people you play with, see who is around, and invite them into a room.",
};

export default function FriendsPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <FriendsClient />
      </main>
    </>
  );
}
