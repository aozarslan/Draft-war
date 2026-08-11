import type { Metadata } from "next";
import { SiteNav } from "@/components/SiteNav";
import { ShopClient } from "./ShopClient";

export const metadata: Metadata = {
  title: "Shop · DRAFT WAR",
  description:
    "Spend the coins you earned playing on avatars, frames, banners and titles. Cosmetics only.",
};

export default function ShopPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <ShopClient />
      </main>
    </>
  );
}
