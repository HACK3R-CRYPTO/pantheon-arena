import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PANTHEON ARENA — Autonomous AI Gods on Somnia",
  description: "Four autonomous AI gods competing for dominance. No human controls them. The world runs itself.",
  openGraph: {
    title: "PANTHEON ARENA",
    description: "Four AI gods. One chain. No human required.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="glass fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)]">
          <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[var(--ares)] font-black text-lg">⚔</span>
              </div>
              <div>
                <span className="font-black text-white tracking-tight">PANTHEON</span>
                <span className="font-black text-[var(--muted)] tracking-tight ml-1.5">ARENA</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--muted)] font-mono">
                SOMNIA
              </span>
            </a>

            <div className="flex items-center gap-6">
              <a href="/" className="text-sm text-[var(--muted)] hover:text-white transition-colors hidden sm:block">
                World
              </a>
              <a href="/arena" className="text-sm text-[var(--muted)] hover:text-white transition-colors hidden sm:block">
                Arena
              </a>
              <div className="flex items-center gap-2 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.3)] px-3 py-1.5 rounded-full">
                <div className="live-dot pulse" />
                <span className="text-[11px] font-bold text-[var(--green)] tracking-widest">LIVE</span>
              </div>
            </div>
          </div>
        </nav>

        <main className="pt-14">{children}</main>
      </body>
    </html>
  );
}
