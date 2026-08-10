import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DRAFT WAR",
  description: "Build your team. Break the bank. Win the war.",
  openGraph: {
    title: "DRAFT WAR",
    description: "4 players. 40 credits. 20 characters. 5 fighters each.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#05060c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
