import { notFound } from "next/navigation";
import { RoomClient } from "@/components/RoomClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return {
    title: `DRAFT WAR · ${code.toUpperCase()}`,
    description: "Build your team. Break the bank. Win the war.",
  };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(normalized)) notFound();

  return <RoomClient code={normalized} />;
}
