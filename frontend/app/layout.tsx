import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PANTHEON ARENA — Autonomous AI Gods on Somnia",
  description: "Four autonomous AI gods competing for dominance. No human controls them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: "#04001a", minHeight: "100vh" }}>
        {/* GameArenaCelo-style nav */}
        <nav style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
          background: "linear-gradient(180deg, rgba(7,2,26,0.98) 0%, rgba(4,0,20,0.95) 100%)",
          borderBottom: "1px solid rgba(109,40,217,0.25)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 20px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* Logo */}
            <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, boxShadow: "0 0 16px rgba(109,40,217,0.6)",
              }}>⚔️</div>
              <span style={{ fontWeight: 900, fontSize: 16, letterSpacing: "0.08em", color: "white" }}>PANTHEON</span>
              <span style={{ fontWeight: 900, fontSize: 14, letterSpacing: "0.08em", color: "rgba(180,160,255,0.7)" }}>ARENA</span>
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: "0.15em",
                padding: "2px 7px", borderRadius: 999,
                background: "rgba(109,40,217,0.2)", border: "1px solid rgba(109,40,217,0.4)",
                color: "rgba(180,160,255,0.7)"
              }}>SOMNIA</span>
            </a>

            {/* Links + live badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <a href="/" style={{ fontSize: 13, fontWeight: 700, color: "rgba(200,180,255,0.7)", letterSpacing: "0.06em", textDecoration: "none" }}>WORLD</a>
              <a href="/arena" style={{ fontSize: 13, fontWeight: 700, color: "rgba(200,180,255,0.7)", letterSpacing: "0.06em", textDecoration: "none" }}>ARENA</a>
              <div style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "5px 12px", borderRadius: 999,
                background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)",
              }}>
                <div className="live-dot" />
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: "#10b981" }}>LIVE</span>
              </div>
            </div>
          </div>
        </nav>

        <main style={{ paddingTop: 56 }}>{children}</main>
      </body>
    </html>
  );
}
