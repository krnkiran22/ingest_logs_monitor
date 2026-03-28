import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Build AI Ingest Monitor",
  description: "Dashboard for existing ingest fleet logs and runtime telemetry",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full scroll-smooth antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
