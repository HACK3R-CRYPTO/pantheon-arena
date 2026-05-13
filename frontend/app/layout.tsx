import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PANTHEON ARENA — Command",
  description: "Four autonomous AI gods at war. No human controls them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <main style={{ position:"relative", zIndex:2 }}>{children}</main>
      </body>
    </html>
  );
}
