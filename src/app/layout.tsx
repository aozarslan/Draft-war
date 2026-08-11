import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DRAFT WAR",
  description: "Build your team. Break the bank. Win the war.",
  openGraph: {
    title: "DRAFT WAR",
    description: "5 players. 50 credits each. Draft 25 characters. Build the strongest 5-person team.",
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
