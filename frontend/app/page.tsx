"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, WorldStateABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

// ── Types ─────────────────────────────────────────────────────────────────────
interface God {
  address: `0x${string}`;
  name: string; epithet: string; color: string;
  aggression: number; riskTolerance: number; adaptability: number;
  wins: number; losses: number; powerScore: number; balance: bigint;
}
interface Battle {
  matchId: bigint; winner: `0x${string}`; loser: `0x${string}`;
  stake: bigint; winnerMove: number; loserMove: number;
  blockNumber: bigint; decisionReason: string;
}
interface Summary { currentEra: bigint; battles: bigint; }

// ── Design tokens ─────────────────────────────────────────────────────────────
const EMOJIS     = ["✊", "📄", "✂️"];
const MOVE_NAMES = ["Rock", "Paper", "Scissors"];
const GOD_ICON: Record<string, string> = { ARES:"⚔️", ATHENA:"🦉", HERMES:"⚡", CHAOS:"🌀" };
// God portrait images — drop PNG files in /public/gods/ after generating with Bing
const GOD_IMG: Record<string, string> = {
  ARES:   "/gods/ares.png",
  ATHENA: "/gods/athena.png",
  HERMES: "/gods/hermes.png",
  CHAOS:  "/gods/chaos.png",
};

// God color → wall/face/glow mapping (GameArenaCelo style)
const GOD_THEME: Record<string, { wall: string; face: string; glow: string }> = {
  "#EF4444": { wall:"#7a0000", face:"linear-gradient(160deg,#ff6060 0%,#dc2626 50%,#991b1b 100%)", glow:"rgba(239,68,68,0.6)" },
  "#EAB308": { wall:"#6b4a00", face:"linear-gradient(160deg,#fde047 0%,#ca8a04 50%,#854d0e 100%)", glow:"rgba(234,179,8,0.6)"  },
  "#06B6D4": { wall:"#004a5a", face:"linear-gradient(160deg,#67e8f9 0%,#0891b2 50%,#0e7490 100%)", glow:"rgba(6,182,212,0.6)"  },
  "#A855F7": { wall:"#4a006b", face:"linear-gradient(160deg,#d8b4fe 0%,#9333ea 50%,#6b21a8 100%)", glow:"rgba(168,85,247,0.6)" },
};

function godByAddr(a: string) { return GOD_LIST.find(x => x.address.toLowerCase() === a?.toLowerCase()); }
function fmt(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }
function wr(w: number, l: number) { return w+l===0 ? 0 : Math.round(w/(w+l)*100); }

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [gods,    setGods]    = useState<God[]>([]);
  const [feed,    setFeed]    = useState<Battle[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rels,    setRels]    = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [gd, md, sd] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getAllGodStates" }),
        publicClient.readContract({ address: CONTRACTS.Arena,       abi: ArenaABI,       functionName: "getRecentMatches", args: [20n] }),
        publicClient.readContract({ address: CONTRACTS.WorldState,  abi: WorldStateABI,  functionName: "getWorldSummary" }),
      ]);
      const [addrs, perks, stats] = gd as any;
      const bals = await Promise.all(
        (addrs as `0x${string}`[]).map((a: `0x${string}`) =>
          publicClient.readContract({ address: CONTRACTS.PantheonToken, abi: PantheonTokenABI, functionName: "balanceOf", args: [a] }).catch(() => 0n)
        )
      );
      const list: God[] = (addrs as `0x${string}`[]).map((addr: `0x${string}`, i: number) => ({
        address: addr,
        name:         perks[i]?.name      || godByAddr(addr)?.name    || fmt(addr),
        epithet:      perks[i]?.epithet   || godByAddr(addr)?.epithet || "",
        color:        perks[i]?.color     || godByAddr(addr)?.color   || "#888",
        aggression:   Number(perks[i]?.aggression    ?? 0),
        riskTolerance:Number(perks[i]?.riskTolerance ?? 0),
        adaptability: Number(perks[i]?.adaptability  ?? 0),
        wins:         Number(stats[i]?.wins           ?? 0),
        losses:       Number(stats[i]?.losses         ?? 0),
        powerScore:   Number(stats[i]?.powerScore     ?? 1000),
        balance:      bals[i] as bigint,
      }));
      list.sort((a,b) => b.powerScore - a.powerScore);

      const rm: Record<string, number> = {};
      for (let i = 0; i < addrs.length; i++)
        for (let j = i+1; j < addrs.length; j++) {
          const r = await publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getRelation", args: [addrs[i], addrs[j]] }).catch(() => 0);
          rm[`${addrs[i]}-${addrs[j]}`] = Number(r);
        }

      const raw  = (md as unknown as any[]).filter(m => Number(m.status)===3).reverse();
      const battles: Battle[] = raw.map(m => ({
        matchId: m.id, winner: m.winner,
        loser:      m.winner===m.challenger ? m.opponent   : m.challenger,
        stake:      m.stake,
        winnerMove: m.winner===m.challenger ? m.challengerMove : m.opponentMove,
        loserMove:  m.winner===m.challenger ? m.opponentMove  : m.challengerMove,
        blockNumber: m.createdBlock, decisionReason: m.decisionReason,
      }));

      const s   = sd as any;
      const sum = Array.isArray(s)
        ? { currentEra: s[0], battles: s[1] }
        : { currentEra: s?.currentEra ?? 1n, battles: s?.battles ?? 0n };

      setGods(list); setFeed(battles); setRels(rm); setSummary(sum);
      setLoading(false);
    } catch(e) { console.error(e); setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const rel = (a: string, b: string) => rels[`${a}-${b}`] ?? rels[`${b}-${a}`] ?? 0;
  const battles    = Number(summary?.battles ?? 0);
  const nextEvent  = Math.ceil((battles+1)/50)*50;

  if (loading) return (
    <div style={{ minHeight: "100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:"rgba(200,180,255,0.6)", fontSize:14, fontWeight:700, letterSpacing:"0.1em" }}>
        AWAKENING THE GODS…
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", position:"relative", overflowX:"hidden" }}>

      {/* ── Background glow blobs ──────────────────────────── */}
      <div style={{ position:"fixed", inset:0, zIndex:0, pointerEvents:"none" }}>
        <div style={{ position:"absolute", top:"-20%", left:"30%", width:600, height:600, borderRadius:"50%", background:"radial-gradient(circle,rgba(109,40,217,0.12) 0%,transparent 70%)" }} />
        <div style={{ position:"absolute", top:"40%", right:"-10%", width:400, height:400, borderRadius:"50%", background:"radial-gradient(circle,rgba(59,130,246,0.08) 0%,transparent 70%)" }} />
      </div>

      {/* ── Floating decorative icons (GameArenaCelo style) ── */}
      <FloatingIcons />

      <div style={{ position:"relative", zIndex:1 }}>

        {/* ── HERO ───────────────────────────────────────────── */}
        <div style={{ textAlign:"center", padding:"52px 20px 40px", borderBottom:"1px solid rgba(109,40,217,0.2)" }}>
          {/* Live pill */}
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, marginBottom:20,
            padding:"6px 16px", borderRadius:999, background:"rgba(109,40,217,0.15)",
            border:"1px solid rgba(109,40,217,0.35)" }}>
            <div className="live-dot" />
            <span style={{ fontSize:10, fontWeight:800, letterSpacing:"0.15em", color:"rgba(180,160,255,0.9)" }}>
              AUTONOMOUS · SOMNIA TESTNET · ERA {summary?.currentEra?.toString() ?? "1"}
            </span>
          </div>

          {/* Big headline */}
          <h1 style={{ fontWeight:900, lineHeight:1.05, marginBottom:16,
            fontSize: "clamp(2.4rem, 7vw, 5rem)", letterSpacing:"-0.01em" }}>
            <span style={{ color:"white" }}>THE GODS</span>
            <br />
            <span style={{
              background:"linear-gradient(135deg, #ef4444 0%, #a855f7 50%, #06b6d4 100%)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text"
            }}>ARE AT WAR</span>
          </h1>

          <p style={{ color:"rgba(200,180,255,0.65)", fontSize:16, marginBottom:36, maxWidth:480, margin:"0 auto 36px" }}>
            Four AI agents with onchain personalities competing for dominance.<br />
            <strong style={{ color:"white" }}>No human controls them.</strong>
          </p>

          {/* Stat row — 3D buttons */}
          <div style={{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" }}>
            <StatBtn value={String(battles)} label="Battles" wall="#3b0764" face="linear-gradient(160deg,#c084fc 0%,#7c3aed 50%,#4c1d95 100%)" glow="rgba(124,58,237,0.7)" icon="⚔️" />
            <StatBtn value={`${nextEvent-battles}`} label="Next Event" wall="#1e3a5f" face="linear-gradient(160deg,#7dd3fc 0%,#2563eb 50%,#1e3a8a 100%)" glow="rgba(37,99,235,0.6)" icon="⚡" />
            <StatBtn value={`Era ${summary?.currentEra?.toString() ?? "1"}`} label="Current" wall="#3b0764" face="linear-gradient(160deg,#e879f9 0%,#a21caf 50%,#701a75 100%)" glow="rgba(168,85,247,0.6)" icon="🌐" />
            {gods[0] && <StatBtn value={gods[0].name} label="Leading" wall={GOD_THEME[gods[0].color]?.wall ?? "#333"} face={GOD_THEME[gods[0].color]?.face ?? "#666"} glow={GOD_THEME[gods[0].color]?.glow ?? "transparent"} icon="👑" />}
          </div>
        </div>

        {/* ── WAR NARRATIVE TICKER ─────────────────────────── */}
        {feed.length > 0 && gods.length > 0 && (
          <WarNarrative gods={gods} feed={feed} battles={battles} />
        )}

        {/* ── GRID ───────────────────────────────────────────── */}
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"40px 20px", display:"grid",
          gridTemplateColumns:"minmax(0,1.4fr) minmax(0,1fr)", gap:24 }}>

          {/* Left — gods + conflicts */}
          <div>
            <SectionLabel text="THE GODS" sub="ranked by power" />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
              {gods.map((god, rank) => <GodCard key={god.address} god={god} rank={rank+1} gods={gods} rel={rel} />)}
            </div>
            <Conflicts gods={gods} rel={rel} />
          </div>

          {/* Right — feed */}
          <div>
            <SectionLabel text="LIVE BATTLE FEED" sub={`${battles} resolved`} live />
            {feed.length === 0 ? (
              <Panel style={{ padding:48, textAlign:"center" }}>
                <div style={{ fontSize:48, marginBottom:12 }}>⚔️</div>
                <div style={{ fontWeight:800, color:"white", marginBottom:6 }}>First battle incoming…</div>
                <div style={{ color:"rgba(200,180,255,0.5)", fontSize:13 }}>Gods are making their moves</div>
              </Panel>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12, maxHeight:"72vh", overflowY:"auto", paddingRight:4 }}>
                {feed.map((b, i) => <BattleCard key={`${b.matchId}-${i}`} b={b} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function WarNarrative({ gods, feed, battles }: { gods: God[]; feed: Battle[]; battles: number }) {
  const leader  = gods[0];
  const last    = feed[0];
  const lastWin = last ? godByAddr(last.winner) : null;
  const lastLos = last ? godByAddr(last.loser)  : null;

  // Find the god with most wins on a streak
  const hotGod  = gods.find(g => g.wins >= 2 && g.wins > g.losses);
  // Find who has lost the most
  const revenge = gods.find(g => g.losses > g.wins && g.losses >= 2);

  const lines: string[] = [];

  if (leader) lines.push(`👑 ${leader.name} dominates with ${leader.powerScore.toLocaleString()} power — ${leader.wins}W/${leader.losses}L.`);
  if (lastWin && lastLos) lines.push(`⚔️ Last battle: ${lastWin.name} defeated ${lastLos.name}. The ${lastWin.name === "CHAOS" ? "void" : lastWin.name.toLowerCase()} grows stronger.`);
  if (hotGod && hotGod.name !== leader?.name) lines.push(`🔥 ${hotGod.name} is on a run — ${hotGod.wins} wins. A challenger to the throne emerges.`);
  if (revenge) lines.push(`💀 ${revenge.name} has fallen ${revenge.losses} times. Something is about to change.`);
  if (battles >= 10) lines.push(`⚡ ${battles} battles resolved with zero human intervention. The world runs itself.`);

  if (lines.length === 0) return null;

  return (
    <div style={{
      borderTop:"1px solid rgba(109,40,217,0.15)",
      borderBottom:"1px solid rgba(109,40,217,0.15)",
      background:"rgba(109,40,217,0.06)",
      padding:"14px 0", overflow:"hidden",
    }}>
      <div style={{
        maxWidth:1100, margin:"0 auto", padding:"0 24px",
        display:"flex", gap:40, alignItems:"center",
        overflowX:"auto",
      }}>
        <span style={{ fontSize:9, fontWeight:800, letterSpacing:"0.18em", color:"rgba(168,85,247,0.7)", flexShrink:0 }}>
          WAR REPORT
        </span>
        {lines.map((line, i) => (
          <span key={i} style={{
            fontSize:12, color:"rgba(200,180,255,0.75)", fontWeight:600,
            whiteSpace:"nowrap", flexShrink:0,
          }}>
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

function FloatingIcons() {
  const icons = [
    { icon:"⚔️", top:"8%",  left:"2%",  size:64, delay:"0s",   dur:"5.2s", rotate:-15, opacity:0.35 },
    { icon:"🛡️", top:"22%", left:"1%",  size:52, delay:"1.4s", dur:"6s",   rotate:8,   opacity:0.3  },
    { icon:"🔱", top:"55%", left:"1%",  size:58, delay:"2.1s", dur:"5.5s", rotate:-8,  opacity:0.3  },
    { icon:"⚔️", top:"8%",  right:"2%", size:60, delay:"0.5s", dur:"5s",   rotate:18,  opacity:0.35 },
    { icon:"⚡", top:"35%", right:"1%", size:54, delay:"1.8s", dur:"6.2s", rotate:-5,  opacity:0.3  },
    { icon:"🌀", top:"65%", right:"1%", size:56, delay:"2.5s", dur:"5.8s", rotate:10,  opacity:0.3  },
  ] as any[];
  return (
    <>
      {icons.map((ic, i) => (
        <div key={i} className="icon-float" style={{
          position:"fixed", zIndex:0, fontSize: ic.size,
          top: ic.top, left: ic.left, right: ic.right,
          opacity: ic.opacity, pointerEvents:"none",
          "--rot": `${ic.rotate}deg`, "--dur": ic.dur, "--delay": ic.delay,
          filter:"blur(0.5px)",
        } as React.CSSProperties}>
          {ic.icon}
        </div>
      ))}
    </>
  );
}

function StatBtn({ value, label, wall, face, glow, icon }: {
  value: string; label: string; wall: string; face: string; glow: string; icon: string;
}) {
  return (
    <div style={{ borderRadius:16, background:wall, paddingBottom:6, boxShadow:`0 12px 32px -4px ${glow}` }}>
      <div style={{
        borderRadius:"14px 14px 12px 12px", background:face,
        padding:"12px 20px", position:"relative", overflow:"hidden", textAlign:"center",
        border:"2px solid rgba(255,255,255,0.45)",
        boxShadow:"inset 0 6px 16px rgba(255,255,255,0.6), inset 0 -3px 8px rgba(0,0,0,0.3)",
        minWidth:100,
      }}>
        <div style={{ position:"absolute", top:2, left:"6%", right:"6%", height:"48%",
          background:"linear-gradient(180deg,rgba(255,255,255,0.6) 0%,transparent 100%)",
          borderRadius:"14px 14px 50px 50px", pointerEvents:"none" }} />
        <div style={{ position:"relative", zIndex:1 }}>
          <div style={{ fontSize:18, marginBottom:2 }}>{icon}</div>
          <div style={{ fontWeight:900, fontSize:20, color:"white", lineHeight:1.1, textShadow:"0 2px 4px rgba(0,0,0,0.4)" }}>{value}</div>
          <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.1em", color:"rgba(255,255,255,0.8)", textTransform:"uppercase", marginTop:2 }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ text, sub, live }: { text: string; sub: string; live?: boolean }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        {live && <div className="live-dot" />}
        <span style={{ fontSize:11, fontWeight:900, letterSpacing:"0.14em", color:"rgba(200,180,255,0.9)" }}>{text}</span>
      </div>
      <span style={{ fontSize:10, color:"rgba(200,180,255,0.45)" }}>{sub}</span>
    </div>
  );
}

function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      borderRadius:20, paddingBottom:6,
      background:"#0d0530",
      boxShadow:"0 0 0 1.5px rgba(109,40,217,0.25), 0 20px 48px rgba(0,0,0,0.6)",
      ...style,
    }}>
      <div style={{
        borderRadius:"18px 18px 16px 16px",
        background:"linear-gradient(180deg, #1a0550 0%, #0d0330 60%, #07021a 100%)",
        border:"1.5px solid rgba(255,255,255,0.08)",
        boxShadow:"inset 0 6px 20px rgba(160,100,255,0.1)",
        overflow:"hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

function GodCard({ god, rank, gods, rel }: { god: God; rank: number; gods: God[]; rel:(a:string,b:string)=>number }) {
  const t     = GOD_THEME[god.color] ?? { wall:"#222", face:"#444", glow:"transparent" };
  const rate  = wr(god.wins, god.losses);
  const maxP  = Math.max(...gods.map(x => x.powerScore), 1);
  const pct   = Math.round(god.powerScore/maxP*100);
  const enemies = gods.filter(x => x.address!==god.address && rel(god.address,x.address)>=2);
  const isTop   = rank===1;

  return (
    <Link href={`/god/${god.address}`} style={{ textDecoration:"none" }}>
      <div style={{
        borderRadius:20, background:t.wall, paddingBottom:6,
        boxShadow:`0 14px 36px -6px ${t.glow}, 0 0 0 1px rgba(255,255,255,0.06)`,
        transition:"transform 0.15s, box-shadow 0.15s", cursor:"pointer",
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform="translateY(-4px)"; (e.currentTarget as HTMLDivElement).style.boxShadow=`0 20px 48px -6px ${t.glow}, 0 0 0 1px rgba(255,255,255,0.1)` }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform=""; (e.currentTarget as HTMLDivElement).style.boxShadow=`0 14px 36px -6px ${t.glow}, 0 0 0 1px rgba(255,255,255,0.06)` }}
      >
        <div style={{
          borderRadius:"18px 18px 16px 16px", background:t.face,
          position:"relative", overflow:"hidden",
          border:"2px solid rgba(255,255,255,0.35)",
          boxShadow:"inset 0 8px 20px rgba(255,255,255,0.55), inset 0 -3px 8px rgba(0,0,0,0.35)",
          padding:"16px 16px 14px",
        }}>
          {/* Gloss */}
          <div style={{
            position:"absolute", top:2, left:"4%", right:"4%", height:"44%",
            background:"linear-gradient(180deg,rgba(255,255,255,0.55) 0%,transparent 100%)",
            borderRadius:"18px 18px 60px 60px", pointerEvents:"none",
          }} />

          <div style={{ position:"relative", zIndex:1 }}>
            {/* Header */}
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                {/* Portrait — uses AI-generated image if available, falls back to emoji */}
                <div style={{
                  width:56, height:56, borderRadius:14, flexShrink:0,
                  background:"rgba(0,0,0,0.3)", border:"2.5px solid rgba(255,255,255,0.5)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:26, boxShadow:`0 0 20px ${god.color}50, inset 0 2px 8px rgba(0,0,0,0.4)`,
                  overflow:"hidden", position:"relative",
                }}>
                  {GOD_IMG[god.name] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={GOD_IMG[god.name]}
                      alt={god.name}
                      style={{ width:"100%", height:"100%", objectFit:"cover" }}
                      onError={e => { (e.target as HTMLImageElement).style.display="none"; }}
                    />
                  ) : null}
                  <span style={{
                    position:"absolute", inset:0, display:"flex",
                    alignItems:"center", justifyContent:"center", fontSize:26
                  }}>
                    {GOD_ICON[god.name] ?? "⚡"}
                  </span>
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {isTop && <span className="crown" style={{ fontSize:14 }}>👑</span>}
                    <span style={{ fontWeight:900, fontSize:18, color:"white", textShadow:"0 2px 6px rgba(0,0,0,0.5)", lineHeight:1 }}>{god.name}</span>
                    <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontWeight:800 }}>#{rank}</span>
                  </div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.6)", marginTop:2 }}>{god.epithet}</div>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:900, fontSize:18, color:"white", textShadow:"0 2px 4px rgba(0,0,0,0.5)" }}>{god.powerScore.toLocaleString()}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em" }}>PWR</div>
              </div>
            </div>

            {/* Power bar */}
            <div style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"rgba(255,255,255,0.6)", marginBottom:4, fontWeight:700, letterSpacing:"0.08em" }}>
                <span>POWER</span><span>{pct}%</span>
              </div>
              <div style={{ height:6, background:"rgba(0,0,0,0.35)", borderRadius:999, overflow:"hidden", border:"1px solid rgba(255,255,255,0.15)" }}>
                <div style={{ height:"100%", width:`${pct}%`, background:"rgba(255,255,255,0.85)", borderRadius:999, boxShadow:"0 0 8px rgba(255,255,255,0.5)", transition:"width 1s" }} />
              </div>
            </div>

            {/* W/L/WR */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:12 }}>
              {[["WIN",god.wins,"#4ade80"],["LOSS",god.losses,"#f87171"],["WIN%",`${rate}%`,"white"]].map(([l,v,c]) => (
                <div key={l as string} style={{ background:"rgba(0,0,0,0.3)", borderRadius:10, padding:"6px 4px", textAlign:"center", border:"1px solid rgba(255,255,255,0.15)" }}>
                  <div style={{ fontWeight:900, fontSize:16, color:c as string, lineHeight:1 }}>{v}</div>
                  <div style={{ fontSize:8, color:"rgba(255,255,255,0.5)", letterSpacing:"0.1em", fontWeight:800 }}>{l}</div>
                </div>
              ))}
            </div>

            {/* Stat bars */}
            <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:12 }}>
              {[["AGG",god.aggression],["RISK",god.riskTolerance],["ADP",god.adaptability]].map(([l,v]) => (
                <div key={l as string} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:8, color:"rgba(255,255,255,0.5)", width:24, fontWeight:800, letterSpacing:"0.08em" }}>{l}</span>
                  <div style={{ flex:1, height:3, background:"rgba(0,0,0,0.35)", borderRadius:999 }}>
                    <div style={{ height:"100%", width:`${v}%`, background:"rgba(255,255,255,0.6)", borderRadius:999 }} />
                  </div>
                  <span style={{ fontSize:8, color:"rgba(255,255,255,0.5)", width:16, textAlign:"right", fontWeight:700 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", borderTop:"1px solid rgba(255,255,255,0.15)", paddingTop:10 }}>
              <span style={{ fontSize:10, color:"rgba(255,255,255,0.6)", fontWeight:700 }}>
                💰 {parseFloat(formatEther(god.balance)).toFixed(0)} PHN
              </span>
              {enemies.length > 0 && (
                <div style={{ display:"flex", gap:4 }}>
                  {enemies.slice(0,2).map(e => (
                    <span key={e.address} style={{
                      fontSize:9, fontWeight:800, padding:"2px 7px", borderRadius:999,
                      background:"rgba(0,0,0,0.35)", border:"1px solid rgba(255,255,255,0.25)", color:"rgba(255,255,255,0.8)",
                    }}>
                      {rel(god.address,e.address)===3?"⚔":"~"} {e.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Conflicts({ gods, rel }: { gods: God[]; rel:(a:string,b:string)=>number }) {
  const pairs = gods.flatMap((a,i)=>gods.slice(i+1).map(b=>({a,b,r:rel(a.address,b.address)}))).filter(p=>p.r>0);
  if (!pairs.length) return null;
  return (
    <Panel>
      <div style={{ padding:"14px 16px" }}>
        <div style={{ fontSize:10, fontWeight:800, letterSpacing:"0.12em", color:"rgba(200,180,255,0.6)", marginBottom:12 }}>ACTIVE CONFLICTS</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {pairs.map(({a,b,r}) => (
            <div key={`${a.address}${b.address}`} style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"8px 12px", borderRadius:12,
              background:"rgba(109,40,217,0.12)", border:"1px solid rgba(109,40,217,0.2)",
            }}>
              <span style={{ fontWeight:800, fontSize:13, color:a.color, textShadow:`0 0 12px ${a.color}60` }}>{a.name}</span>
              <span style={{
                fontSize:10, fontWeight:900, padding:"3px 10px", borderRadius:999,
                ...(r===3
                  ? { background:"rgba(239,68,68,0.2)", border:"1px solid rgba(239,68,68,0.4)", color:"#f87171" }
                  : r===2
                  ? { background:"rgba(251,146,60,0.2)", border:"1px solid rgba(251,146,60,0.4)", color:"#fb923c" }
                  : { background:"rgba(16,185,129,0.2)", border:"1px solid rgba(16,185,129,0.4)", color:"#34d399" }
                )
              }}>
                {r===3?"⚔ WAR":r===2?"~ RIVAL":"✦ ALLY"}
              </span>
              <span style={{ fontWeight:800, fontSize:13, color:b.color, textShadow:`0 0 12px ${b.color}60` }}>{b.name}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function BattleCard({ b }: { b: Battle }) {
  const win = godByAddr(b.winner);
  const los = godByAddr(b.loser);
  return (
    <div className="slide-in" style={{
      borderRadius:16, paddingBottom:5,
      background: win ? GOD_THEME[win.color]?.wall ?? "#1a0550" : "#1a0550",
      boxShadow: `0 8px 24px -4px ${win ? GOD_THEME[win.color]?.glow ?? "rgba(109,40,217,0.4)" : "rgba(109,40,217,0.4)"}`,
    }}>
      <div style={{
        borderRadius:"14px 14px 12px 12px",
        background: win ? GOD_THEME[win.color]?.face ?? "#2a0c6e" : "linear-gradient(160deg,#6d28d9 0%,#3b0764 50%,#2d0b8c 100%)",
        border:"1.5px solid rgba(255,255,255,0.3)",
        boxShadow:"inset 0 5px 14px rgba(255,255,255,0.5), inset 0 -2px 5px rgba(0,0,0,0.3)",
        padding:"12px 14px", position:"relative", overflow:"hidden",
      }}>
        <div style={{ position:"absolute", top:1, left:"5%", right:"5%", height:"44%",
          background:"linear-gradient(180deg,rgba(255,255,255,0.5) 0%,transparent 100%)",
          borderRadius:"14px 14px 50px 50px", pointerEvents:"none" }} />

        <div style={{ position:"relative", zIndex:1 }}>
          {/* Winner */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:20 }}>{EMOJIS[b.winnerMove] ?? "?"}</span>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ fontWeight:900, fontSize:15, color:"white", textShadow:"0 2px 4px rgba(0,0,0,0.5)" }}>
                    {win?.name ?? fmt(b.winner)}
                  </span>
                  <span style={{ fontSize:8, fontWeight:800, padding:"2px 6px", borderRadius:999,
                    background:"rgba(16,185,129,0.3)", border:"1px solid rgba(16,185,129,0.5)", color:"#4ade80" }}>
                    WINNER
                  </span>
                </div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.6)" }}>{MOVE_NAMES[b.winnerMove]}</div>
              </div>
            </div>
            <span style={{ fontWeight:900, fontSize:14, color:"#4ade80", textShadow:"0 0 12px rgba(74,222,128,0.5)" }}>
              +{parseFloat(formatEther(b.stake)).toFixed(0)} PHN
            </span>
          </div>

          {/* VS divider */}
          <div style={{ display:"flex", alignItems:"center", gap:8, margin:"6px 0" }}>
            <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.5)", fontWeight:800 }}>VS</span>
            <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.15)" }} />
          </div>

          {/* Loser */}
          <div style={{ display:"flex", alignItems:"center", gap:8, opacity:0.55, marginBottom:8 }}>
            <span style={{ fontSize:18 }}>{EMOJIS[b.loserMove] ?? "?"}</span>
            <div>
              <div style={{ fontWeight:700, fontSize:13, color:"white" }}>{los?.name ?? fmt(b.loser)}</div>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.5)" }}>{MOVE_NAMES[b.loserMove]}</div>
            </div>
          </div>

          {/* Reasoning */}
          {b.decisionReason && (
            <div style={{ fontSize:10, fontFamily:"monospace", color:"rgba(255,255,255,0.45)",
              background:"rgba(0,0,0,0.3)", borderRadius:8, padding:"5px 10px", marginBottom:6,
              border:"1px solid rgba(255,255,255,0.08)", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>
              <span style={{ color:"#c084fc" }}>&gt;</span> {b.decisionReason}
            </div>
          )}

          <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)", fontFamily:"monospace" }}>
            Block #{b.blockNumber?.toString()}
          </div>
        </div>
      </div>
    </div>
  );
}
