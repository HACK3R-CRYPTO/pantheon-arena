"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { ArenaABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

const EMOJIS     = ["✊","📄","✂️"];
const MOVE_NAMES = ["Rock","Paper","Scissors"];
const STATUS_LABEL = ["Pending","Accepted","Committed","Resolved","Cancelled"];

const GOD_THEME: Record<string, { wall:string; face:string; glow:string }> = {
  "#EF4444":{ wall:"#7a0000", face:"linear-gradient(160deg,#ff6060 0%,#dc2626 50%,#991b1b 100%)", glow:"rgba(239,68,68,0.5)" },
  "#EAB308":{ wall:"#6b4a00", face:"linear-gradient(160deg,#fde047 0%,#ca8a04 50%,#854d0e 100%)", glow:"rgba(234,179,8,0.5)"  },
  "#06B6D4":{ wall:"#004a5a", face:"linear-gradient(160deg,#67e8f9 0%,#0891b2 50%,#0e7490 100%)", glow:"rgba(6,182,212,0.5)"  },
  "#A855F7":{ wall:"#4a006b", face:"linear-gradient(160deg,#d8b4fe 0%,#9333ea 50%,#6b21a8 100%)", glow:"rgba(168,85,247,0.5)" },
};

function godByAddr(a: string) { return GOD_LIST.find(x => x.address.toLowerCase() === a?.toLowerCase()); }
function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }

export default function ArenaPage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [count,   setCount]   = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      const [raw, cnt] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "getRecentMatches", args: [30n] }).catch(() => []),
        publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "matchCounter" }).catch(() => 0n),
      ]);
      setMatches((raw as any[]).reverse());
      setCount(cnt as bigint);
      setLoading(false);
    };
    fetch();
    const t = setInterval(fetch, 5000);
    return () => clearInterval(t);
  }, []);

  const resolved = matches.filter(m => Number(m.status) === 3).length;

  return (
    <div style={{ minHeight:"100vh", background:"#04001a" }}>
      {/* Background glow */}
      <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none" }}>
        <div style={{ position:"absolute", top:"-10%", left:"20%", width:500, height:500, borderRadius:"50%",
          background:"radial-gradient(circle,rgba(109,40,217,0.1) 0%,transparent 70%)" }} />
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"48px 20px", position:"relative", zIndex:1 }}>

        {/* Header */}
        <div style={{ marginBottom:36 }}>
          <Link href="/" style={{ fontSize:12, color:"rgba(180,160,255,0.6)", fontWeight:700,
            letterSpacing:"0.08em", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:6, marginBottom:16 }}>
            ← WORLD VIEW
          </Link>

          <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
            <div>
              <h1 style={{ fontWeight:900, fontSize:36, color:"white", letterSpacing:"-0.01em", marginBottom:4 }}>
                ARENA
              </h1>
              <p style={{ color:"rgba(180,160,255,0.5)", fontSize:13 }}>All battles between the gods</p>
            </div>

            {/* Stats */}
            <div style={{ display:"flex", gap:12 }}>
              {[
                { val: count.toString(), label:"Total Matches", wall:"#3b0764", face:"linear-gradient(160deg,#c084fc 0%,#7c3aed 50%,#4c1d95 100%)", glow:"rgba(124,58,237,0.6)" },
                { val: String(resolved), label:"Resolved",      wall:"#064e3b", face:"linear-gradient(160deg,#6ee7b7 0%,#059669 50%,#065f46 100%)", glow:"rgba(5,150,105,0.6)"  },
              ].map(s => (
                <div key={s.label} style={{ borderRadius:14, background:s.wall, paddingBottom:5, boxShadow:`0 10px 24px -4px ${s.glow}` }}>
                  <div style={{
                    borderRadius:"12px 12px 10px 10px", background:s.face, padding:"12px 18px", textAlign:"center",
                    border:"2px solid rgba(255,255,255,0.4)", position:"relative", overflow:"hidden",
                    boxShadow:"inset 0 6px 16px rgba(255,255,255,0.55), inset 0 -3px 6px rgba(0,0,0,0.3)",
                  }}>
                    <div style={{ position:"absolute", top:2, left:"8%", right:"8%", height:"44%",
                      background:"linear-gradient(180deg,rgba(255,255,255,0.55) 0%,transparent 100%)",
                      borderRadius:"12px 12px 50px 50px", pointerEvents:"none" }} />
                    <div style={{ position:"relative", zIndex:1 }}>
                      <div style={{ fontWeight:900, fontSize:22, color:"white", textShadow:"0 2px 4px rgba(0,0,0,0.4)" }}>{s.val}</div>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.7)", letterSpacing:"0.1em", fontWeight:800 }}>{s.label}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Match list */}
        {loading ? (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[...Array(5)].map((_,i) => (
              <div key={i} style={{ height:100, borderRadius:16, background:"rgba(109,40,217,0.08)", border:"1px solid rgba(109,40,217,0.15)", animation:"pulse 2s infinite" }} />
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div style={{ textAlign:"center", padding:"80px 20px" }}>
            <div style={{ fontSize:56, marginBottom:16 }}>⚔️</div>
            <p style={{ fontWeight:800, color:"white", fontSize:18, marginBottom:8 }}>No battles yet</p>
            <p style={{ color:"rgba(180,160,255,0.5)", fontSize:13 }}>The gods are preparing…</p>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {matches.map((m, i) => <MatchRow key={i} match={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function MatchRow({ match }: { match: any }) {
  const status    = Number(match.status);
  const isResolved = status === 3;
  const winnerAddr = match.winner;
  const loserAddr  = winnerAddr === match.challenger ? match.opponent : match.challenger;
  const win  = godByAddr(winnerAddr);
  const los  = godByAddr(loserAddr);
  const chal = godByAddr(match.challenger);
  const opp  = godByAddr(match.opponent);
  const t    = win ? GOD_THEME[win.color] : undefined;

  const wMove = isResolved ? (winnerAddr===match.challenger ? match.challengerMove : match.opponentMove) : null;
  const lMove = isResolved ? (winnerAddr===match.challenger ? match.opponentMove : match.challengerMove) : null;

  return (
    <div style={{
      borderRadius:18, paddingBottom:5,
      background: t?.wall ?? "#1a0550",
      boxShadow: `0 10px 30px -6px ${t?.glow ?? "rgba(109,40,217,0.4)"}`,
    }}>
      <div style={{
        borderRadius:"16px 16px 14px 14px",
        background: isResolved ? (t?.face ?? "linear-gradient(160deg,#6d28d9 0%,#3b0764 100%)") : "linear-gradient(160deg,#2a0c6e 0%,#1a0550 100%)",
        border:"2px solid rgba(255,255,255,0.3)",
        boxShadow:"inset 0 6px 16px rgba(255,255,255,0.45), inset 0 -2px 6px rgba(0,0,0,0.3)",
        padding:"16px 20px", position:"relative", overflow:"hidden",
      }}>
        {/* Gloss */}
        <div style={{ position:"absolute", top:2, left:"4%", right:"4%", height:"42%",
          background:"linear-gradient(180deg,rgba(255,255,255,0.45) 0%,transparent 100%)",
          borderRadius:"16px 16px 60px 60px", pointerEvents:"none" }} />

        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>

            {/* Match display */}
            {isResolved ? (
              <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                {/* Winner */}
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:28 }}>{EMOJIS[wMove ?? 0] ?? "?"}</span>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <Link href={`/god/${winnerAddr}`} style={{ fontWeight:900, fontSize:18, color:"white", textDecoration:"none", textShadow:"0 2px 6px rgba(0,0,0,0.5)" }}>
                        {win?.name ?? shortAddr(winnerAddr)}
                      </Link>
                      <span style={{ fontSize:9, fontWeight:800, padding:"2px 8px", borderRadius:999,
                        background:"rgba(16,185,129,0.3)", border:"1px solid rgba(16,185,129,0.5)", color:"#4ade80" }}>
                        WINNER
                      </span>
                    </div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)" }}>{MOVE_NAMES[wMove ?? 0]}</div>
                  </div>
                </div>

                <div style={{ fontSize:18, color:"rgba(255,255,255,0.4)", fontWeight:900 }}>VS</div>

                {/* Loser */}
                <div style={{ display:"flex", alignItems:"center", gap:10, opacity:0.55 }}>
                  <span style={{ fontSize:24 }}>{EMOJIS[lMove ?? 0] ?? "?"}</span>
                  <div>
                    <Link href={`/god/${loserAddr}`} style={{ fontWeight:700, fontSize:15, color:"white", textDecoration:"none" }}>
                      {los?.name ?? shortAddr(loserAddr)}
                    </Link>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.5)" }}>{MOVE_NAMES[lMove ?? 0]}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <Link href={`/god/${match.challenger}`} style={{ fontWeight:900, fontSize:16, textDecoration:"none", color: chal?.color ?? "white" }}>
                  {chal?.name ?? shortAddr(match.challenger)}
                </Link>
                <span style={{ color:"rgba(255,255,255,0.4)", fontWeight:900 }}>VS</span>
                <Link href={`/god/${match.opponent}`} style={{ fontWeight:900, fontSize:16, textDecoration:"none", color: opp?.color ?? "rgba(200,180,255,0.7)" }}>
                  {opp?.name ?? shortAddr(match.opponent)}
                </Link>
              </div>
            )}

            {/* Right side */}
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
              <span style={{
                fontSize:10, fontWeight:800, padding:"3px 10px", borderRadius:999,
                ...(isResolved
                  ? { background:"rgba(16,185,129,0.25)", border:"1px solid rgba(16,185,129,0.4)", color:"#4ade80" }
                  : status===1 ? { background:"rgba(59,130,246,0.2)", border:"1px solid rgba(59,130,246,0.4)", color:"#93c5fd" }
                  : status===2 ? { background:"rgba(168,85,247,0.2)", border:"1px solid rgba(168,85,247,0.4)", color:"#d8b4fe" }
                  : { background:"rgba(251,191,36,0.2)", border:"1px solid rgba(251,191,36,0.4)", color:"#fde047" }
                )
              }}>
                {STATUS_LABEL[status] ?? "Unknown"}
              </span>
              {isResolved && (
                <span style={{ fontWeight:900, fontSize:14, color:"#4ade80", textShadow:"0 0 10px rgba(74,222,128,0.4)" }}>
                  +{parseFloat(formatEther(match.stake ?? 0n)).toFixed(0)} PHN
                </span>
              )}
              {!isResolved && (
                <span style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontWeight:700 }}>
                  {parseFloat(formatEther(match.stake ?? 0n)).toFixed(0)} PHN
                </span>
              )}
            </div>
          </div>

          {/* Reasoning + block */}
          {match.decisionReason && (
            <div style={{ marginTop:10, fontSize:10, fontFamily:"monospace",
              color:"rgba(255,255,255,0.4)", background:"rgba(0,0,0,0.25)",
              borderRadius:8, padding:"5px 10px", border:"1px solid rgba(255,255,255,0.08)",
              overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>
              <span style={{ color:"#c084fc" }}>&gt;</span> {match.decisionReason}
            </div>
          )}
          <div style={{ marginTop:6, fontSize:9, color:"rgba(255,255,255,0.3)", fontFamily:"monospace" }}>
            Match #{match.id?.toString()} · Block #{match.createdBlock?.toString()}
          </div>
        </div>
      </div>
    </div>
  );
}
