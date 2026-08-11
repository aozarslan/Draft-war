import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { ProfileClient } from "./ProfileClient";

export const metadata: Metadata = {
  title: "Profile · DRAFT WAR",
  description: "Your level, rank, career statistics and match history.",
};

export default function ProfilePage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <ProfileClient />
      </main>
    </>
  );
}
