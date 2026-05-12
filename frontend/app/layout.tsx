import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PANTHEON ARENA",
  description: "Four AI gods. One chain. No human required.",
  openGraph: {
    title: "PANTHEON ARENA",
    description: "The first autonomous civilization on Somnia. Four AI gods competing, evolving, and governing themselves onchain — forever.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-white">PANTHEON</span>
              <span className="text-xs px-2 py-0.5 rounded bg-[var(--border)] text-[var(--muted)] font-mono">ARENA</span>
            </a>
            <div className="flex items-center gap-6 text-sm text-[var(--muted)]">
              <a href="/" className="hover:text-white transition-colors">World</a>
              <a href="/arena" className="hover:text-white transition-colors">Arena</a>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 pulse" />
                <span className="text-xs text-green-400 font-mono">SOMNIA LIVE</span>
              </div>
            </div>
          </div>
        </nav>
        <main className="pt-14">{children}</main>
      </body>
    </html>
  );
}
