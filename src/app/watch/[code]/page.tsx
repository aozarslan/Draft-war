import type { Metadata } from "next";
import { WatchClient } from "./WatchClient";

export const metadata: Metadata = {
  title: "Watching · DRAFT WAR",
  description: "Watch a DRAFT WAR auction and battle as it happens.",
};

export default async function WatchPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <WatchClient code={code.toUpperCase()} />;
}
