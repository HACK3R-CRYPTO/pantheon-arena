"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, GodMindABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

const MOVES = ["✊ Rock","📄 Paper","✂️ Scissors"];
const GOD_ICON: Record<string,string> = { ARES:"⚔️", ATHENA:"🦉", HERMES:"⚡", CHAOS:"🌀" };
const GOD_THEME: Record<string,{wall:string;face:string;glow:string}> = {
  "#EF4444":{ wall:"#7a0000", face:"linear-gradient(160deg,#ff6060 0%,#dc2626 50%,#991b1b 100%)", glow:"rgba(239,68,68,0.55)" },
  "#EAB308":{ wall:"#6b4a00", face:"linear-gradient(160deg,#fde047 0%,#ca8a04 50%,#854d0e 100%)", glow:"rgba(234,179,8,0.55)"  },
  "#06B6D4":{ wall:"#004a5a", face:"linear-gradient(160deg,#67e8f9 0%,#0891b2 50%,#0e7490 100%)", glow:"rgba(6,182,212,0.55)"  },
  "#A855F7":{ wall:"#4a006b", face:"linear-gradient(160deg,#d8b4fe 0%,#9333ea 50%,#6b21a8 100%)", glow:"rgba(168,85,247,0.55)" },
};
const ACTIONS: Record<string,string> = { CHALLENGE:"⚔️ Challenged", COMMIT:"🤫 Committed", REVEAL:"🎯 Revealed", IDLE:"😴 Rested" };

function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }
function godByAddr(a: string) { return GOD_LIST.find(x => x.address.toLowerCase() === a?.toLowerCase()); }
function wr(w: number, l: number) { return w+l===0 ? 0 : Math.round(w/(w+l)*100); }

export default function GodProfile() {
  const params  = useParams();
  const address = params.address as `0x${string}`;
  const [personality, setPersonality] = useState<any>(null);
  const [stats,       setStats]       = useState<any>(null);
  const [decisions,   setDecisions]   = useState<any[]>([]);
  const [balance,     setBalance]     = useState<bigint>(0n);
  const [loading,     setLoading]     = useState(true);

  const knownGod = godByAddr(address);

  useEffect(() => {
    if (!address) { setLoading(false); return; }
    Promise.all([
      publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getPersonality", args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getStats",       args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACTS.GodMind,     abi: GodMindABI,     functionName: "getDecisionHistory", args: [address, 20n] }).catch(() => []),
      publicClient.readContract({ address: CONTRACTS.PantheonToken, abi: PantheonTokenABI, functionName: "balanceOf",  args: [address] }).catch(() => 0n),
    ]).then(([p, s, d, b]) => {
      setPersonality(p); setStats(s); setDecisions(d as any[]); setBalance(b as bigint);
      setLoading(false);
    });
  }, [address]);

  const name    = personality?.name   || knownGod?.name    || shortAddr(address);
  const color   = personality?.color  || knownGod?.color   || "#A855F7";
  const epithet = personality?.epithet || knownGod?.epithet || "";
  const t       = GOD_THEME[color] ?? { wall:"#4a006b", face:"linear-gradient(160deg,#d8b4fe 0%,#9333ea 50%,#6b21a8 100%)", glow:"rgba(168,85,247,0.5)" };
  const wins    = Number(stats?.wins    ?? 0);
  const losses  = Number(stats?.losses  ?? 0);
  const power   = Number(stats?.powerScore ?? 1000);
  const rate    = wr(wins, losses);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:"#04001a", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:"rgba(200,180,255,0.5)", fontWeight:800, letterSpacing:"0.1em" }}>LOADING…</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#04001a" }}>
      {/* Background */}
      <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none" }}>
        <div style={{ position:"absolute", top:"-10%", left:"30%", width:600, height:600, borderRadius:"50%",
          background:`radial-gradient(circle, ${t.glow.replace("0.5","0.08")} 0%, transparent 70%)` }} />
      </div>

      <div style={{ maxWidth:720, margin:"0 auto", padding:"48px 20px", position:"relative", zIndex:1 }}>

        <Link href="/" style={{ fontSize:12, color:"rgba(180,160,255,0.6)", fontWeight:700,
          letterSpacing:"0.08em", textDecoration:"none", display:"inline-flex", alignItems:"center", gap:6, marginBottom:28 }}>
          ← WORLD VIEW
        </Link>

        {/* ── God Header Card (3D wall+face) ───────────────── */}
        <div style={{
          borderRadius:24, background:t.wall, paddingBottom:7, marginBottom:24,
          boxShadow:`0 20px 60px -8px ${t.glow}, 0 0 0 1px rgba(255,255,255,0.06)`,
        }}>
          <div style={{
            borderRadius:"22px 22px 18px 18px", background:t.face,
            border:"2px solid rgba(255,255,255,0.45)",
            boxShadow:"inset 0 10px 28px rgba(255,255,255,0.6), inset 0 -4px 10px rgba(0,0,0,0.35)",
            padding:"28px 28px 24px", position:"relative", overflow:"hidden",
          }}>
            {/* Gloss */}
            <div style={{ position:"absolute", top:3, left:"4%", right:"4%", height:"42%",
              background:"linear-gradient(180deg,rgba(255,255,255,0.6) 0%,transparent 100%)",
              borderRadius:"22px 22px 60px 60px", pointerEvents:"none" }} />

            <div style={{ position:"relative", zIndex:1 }}>
              {/* Top row */}
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:20 }}>
                <div style={{ display:"flex", alignItems:"center", gap:16 }}>
                  {/* Big portrait — replace with AI image from /public/gods/{name}.png */}
                  <div style={{
                    width:88, height:88, borderRadius:22, flexShrink:0,
                    background:"rgba(0,0,0,0.35)", border:"2.5px solid rgba(255,255,255,0.45)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:38, boxShadow:`0 0 32px ${color}50, inset 0 3px 10px rgba(0,0,0,0.4)`,
                    overflow:"hidden", position:"relative",
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/gods/${name.toLowerCase()}.png`}
                      alt={name}
                      style={{ width:"100%", height:"100%", objectFit:"cover", position:"absolute", inset:0 }}
                      onError={e => { (e.target as HTMLImageElement).style.display="none"; }}
                    />
                    <span style={{ position:"relative", zIndex:1, fontSize:38 }}>{GOD_ICON[name] ?? "⚡"}</span>
                  </div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:32, color:"white", lineHeight:1, textShadow:"0 3px 8px rgba(0,0,0,0.5)", marginBottom:4 }}>
                      {name}
                    </div>
                    <div style={{ fontSize:13, color:"rgba(255,255,255,0.65)" }}>{epithet}</div>
                    <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:"monospace", marginTop:4 }}>{address}</div>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:900, fontSize:28, color:"white", textShadow:"0 2px 6px rgba(0,0,0,0.5)" }}>{power.toLocaleString()}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.55)", letterSpacing:"0.1em", fontWeight:800 }}>POWER</div>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20 }}>
                {[
                  ["WIN",    wins,   "#4ade80"],
                  ["LOSS",   losses, "#f87171"],
                  ["WIN %",  `${rate}%`, "white"],
                  ["PHN",    parseFloat(formatEther(balance)).toFixed(0), "#fde047"],
                ].map(([l,v,c]) => (
                  <div key={l as string} style={{
                    background:"rgba(0,0,0,0.3)", borderRadius:12, padding:"10px 8px", textAlign:"center",
                    border:"1.5px solid rgba(255,255,255,0.18)",
                  }}>
                    <div style={{ fontWeight:900, fontSize:20, color:c as string, textShadow:"0 2px 4px rgba(0,0,0,0.5)", lineHeight:1 }}>{v}</div>
                    <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.12em", fontWeight:800, marginTop:3 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Personality bars */}
              {personality && (
                <div style={{ display:"flex", flexDirection:"column", gap:7, marginBottom:20 }}>
                  {[["Aggression",personality.aggression],["Risk Tolerance",personality.riskTolerance],["Adaptability",personality.adaptability]].map(([l,v]) => (
                    <div key={l as string} style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)", width:90, fontWeight:700 }}>{l}</span>
                      <div style={{ flex:1, height:6, background:"rgba(0,0,0,0.35)", borderRadius:999, border:"1px solid rgba(255,255,255,0.12)", overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${v}%`, background:"rgba(255,255,255,0.75)", borderRadius:999 }} />
                      </div>
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.55)", width:24, textAlign:"right", fontFamily:"monospace", fontWeight:700 }}>{v}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Lore */}
              {personality?.lore && (
                <div style={{
                  background:"rgba(0,0,0,0.35)", borderRadius:14, padding:"14px 16px",
                  border:"1px solid rgba(255,255,255,0.12)",
                }}>
                  <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.14em", color:"rgba(255,255,255,0.5)", marginBottom:8 }}>
                    ONCHAIN PERSONA — AI DECISION PROMPT
                  </div>
                  <p style={{ fontSize:13, color:"rgba(255,255,255,0.8)", lineHeight:1.6 }}>{personality.lore}</p>
                  <p style={{ fontSize:9, color:"rgba(255,255,255,0.35)", marginTop:8, fontStyle:"italic" }}>
                    Stored permanently on Somnia. Used as system prompt for every AI decision.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Decision History ──────────────────────────────── */}
        <div>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:"0.14em", color:"rgba(200,180,255,0.7)", marginBottom:16 }}>
            ONCHAIN DECISION LOG
          </div>

          {decisions.length === 0 ? (
            <div style={{
              borderRadius:18, paddingBottom:5, background:"#1a0550",
              boxShadow:"0 0 0 1px rgba(109,40,217,0.2)",
            }}>
              <div style={{
                borderRadius:"16px 16px 14px 14px",
                background:"linear-gradient(180deg,#1a0550 0%,#0d0330 100%)",
                border:"1px solid rgba(255,255,255,0.07)", padding:"40px 20px", textAlign:"center",
              }}>
                <p style={{ color:"rgba(180,160,255,0.5)", fontSize:13 }}>No decisions logged yet.</p>
              </div>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {decisions.map((d: any, i: number) => {
                const tgt = godByAddr(d.target);
                return (
                  <div key={i} style={{
                    borderRadius:16, paddingBottom:4,
                    background:"#1a0550",
                    boxShadow:"0 6px 20px -4px rgba(109,40,217,0.35)",
                  }}>
                    <div style={{
                      borderRadius:"14px 14px 12px 12px",
                      background:"linear-gradient(180deg,#2a0c6e 0%,#13063a 100%)",
                      border:"1px solid rgba(255,255,255,0.1)",
                      boxShadow:"inset 0 4px 12px rgba(160,100,255,0.12)",
                      padding:"14px 16px",
                    }}>
                      {/* Header */}
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ fontSize:16 }}>{ACTIONS[d.action]?.split(" ")[0] ?? "?"}</span>
                          <span style={{ fontWeight:800, color:"white", fontSize:14 }}>{ACTIONS[d.action]?.slice(2) ?? d.action}</span>
                          {d.target && d.target !== "0x0000000000000000000000000000000000000000" && (
                            <Link href={`/god/${d.target}`} style={{ fontWeight:800, fontSize:14, textDecoration:"none",
                              color: tgt?.color ?? "rgba(180,160,255,0.8)" }}>
                              {tgt?.name ?? shortAddr(d.target)}
                            </Link>
                          )}
                        </div>
                        <span style={{ fontSize:10, fontFamily:"monospace", color:"rgba(180,160,255,0.45)" }}>
                          Block #{d.blockNumber?.toString()}
                        </span>
                      </div>

                      {Number(d.stake) > 0 && (
                        <div style={{ fontSize:11, color:"#fde047", fontWeight:700, marginBottom:6 }}>
                          💰 {parseFloat(formatEther(d.stake)).toFixed(0)} PHN
                        </div>
                      )}

                      {d.action !== "IDLE" && d.action !== "CHALLENGE" && (
                        <div style={{ fontSize:11, color:"rgba(180,160,255,0.6)", marginBottom:6 }}>
                          Move: {MOVES[d.move] ?? "Unknown"}
                        </div>
                      )}

                      {/* Reasoning */}
                      <div style={{
                        fontFamily:"monospace", fontSize:11, color:"rgba(180,160,255,0.6)",
                        background:"rgba(0,0,0,0.3)", borderRadius:10, padding:"8px 12px",
                        border:"1px solid rgba(109,40,217,0.2)", lineHeight:1.5,
                      }}>
                        <span style={{ color:"#c084fc" }}>&gt; </span>
                        {d.reasoning}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
