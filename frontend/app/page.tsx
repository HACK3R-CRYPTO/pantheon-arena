"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, WorldStateABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

// ── God config ────────────────────────────────────────────────────────────────
const GODS_CFG = [
  {
    id:"ARES", title:"GOD OF WAR", epithet:"The Spear of the Pantheon",
    callSign:"ARG-01", glyph:"▲", cssVar:"--ares", aggression:90, favored:"ROCK",
    portrait:"/gods/ares.jpg", sigil:"/gods/ares-sigil.jpg",
    lore:"I am the spear of the pantheon. Every silence is an insult. Every silence ends in fire.",
    addr:"0xF2D1…844F",
  },
  {
    id:"ATHENA", title:"GODDESS OF WISDOM", epithet:"The Pattern Reader",
    callSign:"ATH-02", glyph:"■", cssVar:"--athena", aggression:40, favored:"PAPER",
    portrait:"/gods/athena.jpg", sigil:"/gods/athena-sigil.jpg",
    lore:"I do not waste blood. I read the pattern. The pattern always confesses.",
    addr:"0x5678…E301",
  },
  {
    id:"HERMES", title:"GOD OF TRADE", epithet:"The Market is Mine",
    callSign:"HRM-03", glyph:"◆", cssVar:"--hermes", aggression:60, favored:"SCISSORS",
    portrait:"/gods/hermes.jpg", sigil:"/gods/hermes-sigil.jpg",
    lore:"I move where the price moves. The pantheon is a market. The market is mine.",
    addr:"0x5B40…EC1D",
  },
  {
    id:"CHAOS", title:"THE PRIMORDIAL VOID", epithet:"There Is Only Noise",
    callSign:"CHX-04", glyph:"●", cssVar:"--chaos", aggression:70, favored:"RANDOM",
    portrait:"/gods/chaos.jpg", sigil:"/gods/chaos-sigil.jpg",
    lore:"There is no rule. There is no friend. There is only the noise I make of you.",
    addr:"0x874e…57bE",
  },
];

const MOVE_SYM: Record<number,string> = { 0:"✊",1:"✋",2:"✌️" };
const REL_LABEL = ["NEUTRAL","ALLIED","RIVAL","WAR"];

function cfg(name: string) { return GODS_CFG.find(g => g.id === name); }
function cfgByAddr(addr: string) {
  const g = GOD_LIST.find(x => x.address.toLowerCase() === addr?.toLowerCase());
  return cfg(g?.name ?? "");
}
function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }
function wr(w: number, l: number) { return w+l===0 ? 0 : Math.round(w/(w+l)*100); }

// ── State ─────────────────────────────────────────────────────────────────────
export default function Command() {
  const [gods,    setGods]    = useState<any[]>([]);
  const [battles, setBattles] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [rels,    setRels]    = useState<Record<string,number>>({});
  const [block,   setBlock]   = useState(0);
  const [killFlash, setKillFlash] = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const prevBattleCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const [gd, md, sd, bn] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getAllGodStates" }),
        publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "getRecentMatches", args: [20n] }),
        publicClient.readContract({ address: CONTRACTS.WorldState, abi: WorldStateABI, functionName: "getWorldSummary" }),
        publicClient.getBlockNumber(),
      ]);
      const [addrs, perks, stats] = gd as any;
      const bals = await Promise.all(
        (addrs as `0x${string}`[]).map((a: `0x${string}`) =>
          publicClient.readContract({ address: CONTRACTS.PantheonToken, abi: PantheonTokenABI, functionName: "balanceOf", args: [a] }).catch(() => 0n)
        )
      );
      const list = (addrs as `0x${string}`[]).map((addr: `0x${string}`, i: number) => ({
        address: addr,
        name: perks[i]?.name || cfgByAddr(addr)?.id || shortAddr(addr),
        wins: Number(stats[i]?.wins ?? 0), losses: Number(stats[i]?.losses ?? 0),
        powerScore: Number(stats[i]?.powerScore ?? 1000),
        balance: bals[i] as bigint,
      }));
      list.sort((a,b) => b.powerScore - a.powerScore);

      const rm: Record<string,number> = {};
      for (let i=0;i<addrs.length;i++)
        for (let j=i+1;j<addrs.length;j++) {
          const r = await publicClient.readContract({ address:CONTRACTS.GodRegistry, abi:GodRegistryABI, functionName:"getRelation", args:[addrs[i],addrs[j]] }).catch(()=>0);
          rm[`${addrs[i]}-${addrs[j]}`] = Number(r);
        }

      const raw = (md as unknown as any[]).filter(m=>Number(m.status)===3).reverse();
      const blist = raw.map(m=>({
        matchId:m.id, winner:m.winner,
        loser:m.winner===m.challenger?m.opponent:m.challenger,
        stake:m.stake,
        winnerMove:m.winner===m.challenger?m.challengerMove:m.opponentMove,
        loserMove: m.winner===m.challenger?m.opponentMove:m.challengerMove,
        blockNumber:m.createdBlock, reason:m.decisionReason,
      }));

      // Kill flash on new battle
      if (blist.length > prevBattleCount.current && prevBattleCount.current > 0) {
        const winnerCfg = cfgByAddr(blist[0].winner);
        if (winnerCfg) {
          setKillFlash(`var(${winnerCfg.cssVar}-g)`);
          setTimeout(() => setKillFlash(null), 1000);
        }
      }
      prevBattleCount.current = blist.length;

      const s = sd as any;
      const sum = Array.isArray(s) ? { currentEra:s[0], battles:s[1] } : { currentEra:s?.currentEra??1n, battles:s?.battles??0n };

      setGods(list); setBattles(blist); setRels(rm); setSummary(sum);
      setBlock(Number(bn)); setLoading(false);
    } catch(e) { console.error(e); setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return ()=>clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(()=>setBlock(b=>b+1),1000); return ()=>clearInterval(t); }, []);

  const rel = (a:string,b:string) => rels[`${a}-${b}`]??rels[`${b}-${a}`]??0;
  const leader = gods[0];
  const leaderCfg = leader ? cfg(leader.name) : null;
  const totalBattles = summary ? Number(summary.battles) : 0;

  return (
    <div style={{ minHeight:"100vh" }}>
      {/* Battlefield texture */}
      <div className="battlefield-bg" />

      {/* Ember particles — ARES atmosphere */}
      <EmberParticles />

      {/* Arc effects — HERMES atmosphere */}
      <ArcEffects />

      {/* Kill flash overlay */}
      {killFlash && (
        <div className="kill-flash fire" style={{ background: killFlash }} />
      )}

      {/* ── THRONE BANNER ── */}
      <div className="throne" style={{ ["--throne-color" as any]: leaderCfg ? `var(${leaderCfg.cssVar})` : "var(--ares)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:24, position:"relative", zIndex:1 }}>
          {/* Leader portrait */}
          {leaderCfg && leader && (
            <div style={{ width:88, height:88, flexShrink:0, position:"relative", border:`2px solid var(${leaderCfg.cssVar})`, overflow:"hidden",
              boxShadow:`0 0 24px var(${leaderCfg.cssVar}-g)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={leaderCfg.portrait} alt={leaderCfg.id} style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 20%" }} onError={e=>{(e.target as HTMLImageElement).style.display="none"}} />
              <div style={{ position:"absolute", inset:0, background:`linear-gradient(180deg, var(${leaderCfg.cssVar}-g) 0%, transparent 40%)`, mixBlendMode:"multiply" }} />
              <span style={{ position:"absolute", top:2, left:2, width:6, height:6, borderTop:`1px solid var(${leaderCfg.cssVar})`, borderLeft:`1px solid var(${leaderCfg.cssVar})` }} />
              <span style={{ position:"absolute", top:2, right:2, width:6, height:6, borderTop:`1px solid var(${leaderCfg.cssVar})`, borderRight:`1px solid var(${leaderCfg.cssVar})` }} />
              <span style={{ position:"absolute", bottom:2, left:2, width:6, height:6, borderBottom:`1px solid var(${leaderCfg.cssVar})`, borderLeft:`1px solid var(${leaderCfg.cssVar})` }} />
              <span style={{ position:"absolute", bottom:2, right:2, width:6, height:6, borderBottom:`1px solid var(${leaderCfg.cssVar})`, borderRight:`1px solid var(${leaderCfg.cssVar})` }} />
            </div>
          )}

          <div style={{ flex:1 }}>
            <div className="mono" style={{ fontSize:10, letterSpacing:"0.22em", color:"var(--text-3)", marginBottom:6, textTransform:"uppercase" }}>
              ⚔ PANTHEON ARENA · COMMAND · SOMNIA SHANNON · CHAIN 50312
            </div>
            <div className="divine throne-name" style={{ fontSize:"clamp(2rem,5vw,4.5rem)" }}>
              {leaderCfg?.id ?? "PANTHEON"}
            </div>
            <div className="mono" style={{ fontSize:10, letterSpacing:"0.18em", color:"var(--text-3)", marginTop:4 }}>
              {leaderCfg?.epithet ?? "AUTONOMOUS WAR · NO HUMANS"}
            </div>
          </div>

          {/* Top-right meta */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8, fontFamily:"JetBrains Mono, monospace" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div className="live-dot" />
              <span style={{ fontSize:11, color:"oklch(0.78 0.15 145)", letterSpacing:"0.12em" }}>LIVE</span>
            </div>
            <div style={{ fontSize:11, color:"var(--text-3)", letterSpacing:"0.1em" }}>BLOCK <span style={{ color:"var(--text-2)" }}>{block.toLocaleString()}</span></div>
            <div style={{ fontSize:11, color:"var(--text-3)", letterSpacing:"0.1em" }}>ERA <span style={{ color:"var(--athena)" }}>{summary?.currentEra?.toString()??"1"}</span></div>
            <div style={{ fontSize:11, color:"var(--text-3)", letterSpacing:"0.1em" }}>BATTLES <span style={{ color:"var(--text-2)" }}>{totalBattles}</span></div>
          </div>
        </div>
      </div>

      {/* ── MARQUEE ── */}
      <Marquee totalBattles={totalBattles} />

      {/* ── MAIN GRID ── */}
      {loading ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"50vh", fontFamily:"JetBrains Mono, monospace", fontSize:13, color:"var(--text-3)", letterSpacing:"0.15em" }}>
          INITIALIZING WAR ROOM…
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"340px 1fr 360px", gap:12, padding:14, maxWidth:1920, margin:"0 auto", position:"relative", zIndex:2 }}>

          {/* Left: God Dossiers */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <SectionLabel label="GOD ROSTER" dot="war" />
            {gods.map((god,i) => {
              const c = cfg(god.name);
              const godRels = gods.filter(g=>g.address!==god.address).map(g=>({ god:g, cfg:cfg(g.name), rel:rel(god.address,g.address) }));
              const topThreat = godRels.sort((a,b)=>b.rel-a.rel)[0];
              return <GodCard key={god.address} god={god} c={c} topThreat={topThreat} rank={i+1} wr={wr(god.wins,god.losses)} />;
            })}
          </div>

          {/* Center: Battle Theatre + Relations */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <SectionLabel label="BATTLE THEATRE" dot="war" />
            <BattleTheatre battles={battles} />
            <SectionLabel label="CONFLICT MATRIX" dot="neutral" />
            <RelationsMatrix gods={gods} rel={rel} />
          </div>

          {/* Right: Narrator + Battle Log */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <SectionLabel label="NARRATOR // QWEN3" dot="neutral" />
            <NarratorPanel gods={gods} />
            <SectionLabel label="BATTLE LOG" dot="war" live />
            <BattleLog battles={battles} />
          </div>
        </div>
      )}

      {/* ── BOTTOM STRIP ── */}
      <BottomStrip summary={summary} />
    </div>
  );
}

// ── GOD CARD (war dossier) ────────────────────────────────────────────────────
function GodCard({ god, c, topThreat, rank, wr }: any) {
  const [imgErr, setImgErr] = useState(false);
  const [sigilErr, setSigilErr] = useState(false);
  const color  = c ? `var(${c.cssVar})`   : "#888";
  const colorD = c ? `var(${c.cssVar}-d)` : "#444";
  const colorG = c ? `var(${c.cssVar}-g)` : "transparent";
  const isWar  = topThreat?.rel === 3;

  return (
    <Link href={`/god/${god.address}`} style={{ textDecoration:"none" }}>
      <div className="frame stone" style={{
        position:"relative", isolation:"isolate", overflow:"hidden",
        background:`linear-gradient(180deg, ${colorG} -60%, oklch(0.16 0.014 280/0.85) 38%, oklch(0.14 0.014 280/0.92) 100%)`,
        borderColor: isWar ? "var(--war)" : colorD,
        animation: isWar ? "warPulse 1.4s infinite" : "none",
        transition:"border-color 0.4s",
      }}>
        <span className="cc-bl" /><span className="cc-br" />

        {/* Sigil watermark */}
        {c && !sigilErr && (
          <div aria-hidden style={{ position:"absolute", right:-40, top:-10, width:240, height:240,
            backgroundImage:`url(${c.sigil})`, backgroundSize:"contain", backgroundRepeat:"no-repeat",
            backgroundPosition:"center", opacity:0.22, mixBlendMode:"screen", pointerEvents:"none",
            filter:"saturate(1.15) brightness(1.05)", zIndex:-1 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.sigil} alt="" style={{ display:"none" }} onError={()=>setSigilErr(true)} />
          </div>
        )}

        {/* Dossier ID strip */}
        <div className="mono" style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px",
          fontSize:9, letterSpacing:"0.18em", color:"var(--text-4)",
          borderBottom:"1px solid var(--line-soft)", background:"oklch(0.10 0.01 280/0.5)" }}>
          <span>DOSSIER · {c?.callSign}</span>
          <span>RANK {rank}/4</span>
          <span style={{ color }}>● {c?.addr}</span>
        </div>

        {/* Portrait + identity */}
        <div style={{ display:"flex", gap:12, padding:12, alignItems:"flex-start", borderBottom:"1px solid var(--line-soft)" }}>
          {/* Portrait */}
          <div style={{ width:78, height:78, flexShrink:0, position:"relative", border:`1px solid ${colorD}`,
            boxShadow:`inset 0 0 0 1px oklch(0.08 0.01 280/0.7), 0 0 14px ${colorG}`, overflow:"hidden" }}>
            {c && !imgErr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.portrait} alt={god.name} style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 18%" }}
                onError={()=>setImgErr(true)} />
            )}
            <div style={{ position:"absolute", inset:0, background:`linear-gradient(180deg,${colorG} 0%,transparent 35%,oklch(0.08 0.01 280/0.45) 100%)`, mixBlendMode:"multiply" }} />
            {/* Inner corner brackets */}
            <span style={{ position:"absolute", top:2, left:2, width:6, height:6, borderTop:`1px solid ${color}`, borderLeft:`1px solid ${color}` }} />
            <span style={{ position:"absolute", top:2, right:2, width:6, height:6, borderTop:`1px solid ${color}`, borderRight:`1px solid ${color}` }} />
            <span style={{ position:"absolute", bottom:2, left:2, width:6, height:6, borderBottom:`1px solid ${color}`, borderLeft:`1px solid ${color}` }} />
            <span style={{ position:"absolute", bottom:2, right:2, width:6, height:6, borderBottom:`1px solid ${color}`, borderRight:`1px solid ${color}` }} />
            {!c || imgErr ? <span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, fontWeight:900, color }}>{c?.glyph}</span> : null}
          </div>

          <div style={{ flex:1, minWidth:0 }}>
            <div className="divine" style={{ fontSize:26, color, lineHeight:1, textShadow:`0 0 12px ${colorG}` }}>{god.name}</div>
            <div className="mono" style={{ fontSize:9, color:"var(--text-3)", marginTop:5, letterSpacing:"0.16em", textTransform:"uppercase" }}>{c?.title}</div>
            <div className="mono" style={{ fontSize:9, color:colorD, marginTop:3, letterSpacing:"0.14em" }}>// {c?.epithet}</div>
            <div style={{ marginTop:8 }}>
              <span className="mono" style={{ fontSize:9, letterSpacing:"0.18em",
                color: isWar ? "var(--war)" : "var(--text-3)",
                border:`1px solid ${isWar?"var(--war)":"var(--line)"}`,
                padding:"2px 6px", animation: isWar ? "flicker 1.1s infinite" : "none" }}>
                {isWar ? "● AT WAR" : "● STANDBY"}
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", borderBottom:"1px solid var(--line-soft)" }}>
          {[
            { label:"POWER",  val:god.powerScore.toLocaleString(), sub:"ELO · ONCHAIN",   color },
            { label:"KILLS",  val:String(god.wins),                sub:"CONFIRMED",        color:"var(--text)" },
            { label:"DEATHS", val:String(god.losses),              sub:`${wr}% WIN RATE`, color:"var(--text-2)" },
          ].map((s,i) => (
            <div key={s.label} style={{ padding:"10px 12px", borderRight:i<2?"1px solid var(--line-soft)":"none" }}>
              <div className="mono" style={{ fontSize:9, letterSpacing:"0.16em", color:"var(--text-4)", textTransform:"uppercase", marginBottom:4 }}>{s.label}</div>
              <div className="mono" style={{ fontSize:20, fontWeight:500, color:s.color, lineHeight:1 }}>{s.val}</div>
              <div className="mono" style={{ fontSize:8, color:"var(--text-4)", marginTop:4, letterSpacing:"0.14em" }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Aggression + favored */}
        <div style={{ padding:"10px 12px", borderBottom:"1px solid var(--line-soft)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <div className="mono" style={{ fontSize:9, letterSpacing:"0.16em", color:"var(--text-4)", textTransform:"uppercase" }}>RUTHLESSNESS</div>
            <div className="mono" style={{ fontSize:10, color }}>{c?.aggression ?? 0}%</div>
          </div>
          <div style={{ height:3, background:"var(--line-soft)" }}>
            <div style={{ height:"100%", width:`${c?.aggression??0}%`, background:`linear-gradient(90deg,${color},${colorD})` }} />
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:10 }}>
            <div>
              <div className="mono" style={{ fontSize:8, color:"var(--text-4)", letterSpacing:"0.14em" }}>FAVORED</div>
              <div className="mono" style={{ fontSize:11, color:"var(--text-2)", marginTop:3 }}>{c?.favored}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div className="mono" style={{ fontSize:8, color:"var(--text-4)", letterSpacing:"0.14em" }}>PHN SEIZED</div>
              <div className="mono" style={{ fontSize:11, color:"var(--athena-d)", marginTop:3 }}>{(god.wins*17+god.losses*4).toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* Top threat */}
        {topThreat && (
          <div style={{ padding:"10px 12px", display:"flex", alignItems:"center", gap:10 }}>
            <span className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.16em" }}>TOP THREAT</span>
            <span className="mono" style={{ fontSize:11, color: topThreat.cfg ? `var(${topThreat.cfg.cssVar})` : "var(--text-2)", letterSpacing:"0.12em" }}>{topThreat.god.name}</span>
            <span style={{ flex:1 }} />
            <span className="mono" style={{
              fontSize:9, fontWeight:700, padding:"2px 8px", letterSpacing:"0.1em",
              color: topThreat.rel===3?"var(--war)":topThreat.rel===2?"var(--rival)":"var(--text-3)",
              border:`1px solid ${topThreat.rel===3?"var(--war)":topThreat.rel===2?"var(--rival)":"var(--line)"}`,
              animation: topThreat.rel===3?"flicker 1.2s infinite":"none",
            }}>{REL_LABEL[topThreat.rel]}</span>
          </div>
        )}

        {/* Lore */}
        <div style={{ padding:"10px 12px 12px", borderTop:"1px solid var(--line-soft)" }}>
          <div className="mono" style={{ fontSize:10, fontStyle:"italic", color:"var(--text-3)", lineHeight:1.5 }}>
            "{c?.lore}"
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── BATTLE THEATRE ────────────────────────────────────────────────────────────
function BattleTheatre({ battles }: { battles: any[] }) {
  const last = battles[0];
  if (!last) return (
    <div className="frame" style={{ padding:40, textAlign:"center", position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div style={{ fontSize:48, marginBottom:12, opacity:0.5 }}>⚔</div>
      <div className="mono" style={{ fontSize:11, letterSpacing:"0.16em", color:"var(--text-3)" }}>AWAITING CONFLICT</div>
    </div>
  );

  const winCfg = cfgByAddr(last.winner);
  const losCfg = cfgByAddr(last.loser);

  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div style={{ padding:"8px 12px", borderBottom:"1px solid var(--line-soft)", display:"flex", justifyContent:"space-between" }}>
        <span className="mono" style={{ fontSize:9, letterSpacing:"0.16em", color:"var(--text-3)", textTransform:"uppercase" }}>LAST RESOLVED</span>
        <span className="mono" style={{ fontSize:9, color:"var(--text-4)" }}>Block #{last.blockNumber?.toString()}</span>
      </div>

      <div style={{ padding:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:20 }}>
          {/* Winner */}
          <div style={{ flex:1, textAlign:"center" }}>
            <div style={{ fontSize:52, marginBottom:8 }}>{MOVE_SYM[last.winnerMove]??""}</div>
            <div className="divine" style={{ fontSize:22, color:winCfg?`var(${winCfg.cssVar})`:"#fff", marginBottom:4 }}>{winCfg?.id??shortAddr(last.winner)}</div>
            <div className="mono" style={{ fontSize:9, letterSpacing:"0.16em", color:"oklch(0.72 0.18 145)" }}>VICTORY</div>
            <div className="mono" style={{ fontSize:13, color:"oklch(0.72 0.18 145)", marginTop:4, fontWeight:700 }}>
              +{parseFloat(formatEther(last.stake)).toFixed(0)} PHN SEIZED
            </div>
          </div>

          <div className="divine" style={{ fontSize:24, color:"var(--text-4)", letterSpacing:"0.16em" }}>VS</div>

          {/* Loser */}
          <div style={{ flex:1, textAlign:"center", opacity:0.45 }}>
            <div style={{ fontSize:48, marginBottom:8 }}>{MOVE_SYM[last.loserMove]??""}</div>
            <div className="divine" style={{ fontSize:20, color:losCfg?`var(${losCfg.cssVar})`:"#888", marginBottom:4 }}>{losCfg?.id??shortAddr(last.loser)}</div>
            <div className="mono" style={{ fontSize:9, letterSpacing:"0.16em", color:"var(--text-3)" }}>DEFEATED</div>
          </div>
        </div>

        {last.reason && (
          <div className="mono" style={{ marginTop:16, fontSize:11, fontStyle:"italic", color:"var(--text-3)",
            background:"oklch(0.12 0.01 280/0.6)", padding:"10px 14px", borderLeft:`2px solid ${winCfg?`var(${winCfg.cssVar})`:"var(--line)"}`,
            lineHeight:1.6 }}>
            {winCfg?.glyph} {last.reason}
          </div>
        )}
      </div>
    </div>
  );
}

// ── RELATIONS MATRIX ───────────────────────────────────────────────────────────
function RelationsMatrix({ gods, rel }: { gods:any[]; rel:(a:string,b:string)=>number }) {
  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div style={{ padding:14, overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"separate", borderSpacing:3 }}>
          <thead>
            <tr>
              <th style={{ width:52 }}/>
              {gods.map(g => {
                const c = cfg(g.name);
                return (
                  <th key={g.address} className="mono" style={{ textAlign:"center", fontSize:9, letterSpacing:"0.1em",
                    color:c?`var(${c.cssVar})`:"var(--text-3)", fontWeight:700, paddingBottom:6 }}>
                    {c?.glyph} {g.name.slice(0,3)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {gods.map(row => {
              const rc = cfg(row.name);
              return (
                <tr key={row.address}>
                  <td className="mono" style={{ fontSize:9, letterSpacing:"0.1em",
                    color:rc?`var(${rc.cssVar})`:"var(--text-3)", paddingRight:8, whiteSpace:"nowrap" }}>
                    {rc?.glyph} {row.name.slice(0,3)}
                  </td>
                  {gods.map(col => {
                    if (col.address === row.address) return (
                      <td key={col.address} style={{ background:"oklch(0.10 0.01 280/0.5)",
                        textAlign:"center", padding:"6px 4px" }}>
                        <span className="mono" style={{ fontSize:8, color:"var(--text-4)" }}>{rc?.glyph}</span>
                      </td>
                    );
                    const r = rel(row.address, col.address);
                    const rcolor = r===3?"var(--war)":r===2?"var(--rival)":r===1?"oklch(0.65 0.18 145)":"var(--text-4)";
                    return (
                      <td key={col.address} className="mono" style={{
                        textAlign:"center", padding:"6px 4px", fontSize:9, fontWeight:700,
                        letterSpacing:"0.06em", color:rcolor,
                        background:r>0?"oklch(0.12 0.01 280/0.8)":"oklch(0.10 0.01 280/0.5)",
                        border:r>0?`1px solid ${rcolor}44`:"1px solid transparent",
                        animation:r===3?"flicker 2s infinite":"none",
                      }}>
                        {r===3?"WAR":r===2?"RIVAL":r===1?"ALLY":"·"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── NARRATOR PANEL ─────────────────────────────────────────────────────────────
const LINES: Record<string,string[]> = {
  ARES:   ["ARES sharpens the spear that already drinks.","ARES sees an open throat and smiles.","ARES is bored of silence. The silence ends now.","The forge of ARES burns red on the seventh hour."],
  ATHENA: ["ATHENA has counted your last six moves.","The pattern speaks; ATHENA answers in kind.","ATHENA waits until the question is already answered.","Wisdom is the longest blade in the pantheon."],
  HERMES: ["HERMES has spotted the spread. Already inside.","Speed is information. HERMES is both.","HERMES reads the meta. The meta bends.","The market moved. HERMES was already there."],
  CHAOS:  ["CHAOS does not plan. CHAOS is the plan.","You studied the patterns. CHAOS burned them.","The void chose this move. The void chooses all.","CHAOS exists to remind you that all signal is noise."],
};

function NarratorPanel({ gods }: { gods: any[] }) {
  const [lines, setLines] = useState<{name:string;c:any;line:string}[]>([]);
  useEffect(()=>{
    const init = gods.map(g=>({ name:g.name, c:cfg(g.name), line:(LINES[g.name]??["The god is silent."])[Math.floor(Math.random()*4)] }));
    setLines(init);
    const t = setInterval(()=>setLines(prev=>prev.map(l=>Math.random()>0.7?{...l,line:(LINES[l.name]??["…"])[Math.floor(Math.random()*4)]}:l)),4000);
    return ()=>clearInterval(t);
  },[gods.length]);

  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div style={{ padding:12, display:"flex", flexDirection:"column", gap:12 }}>
        {lines.map(({name,c,line})=>(
          <div key={name} style={{ borderLeft:`2px solid ${c?`var(${c.cssVar})`:"var(--line)"}`, paddingLeft:10 }}>
            <div className="mono" style={{ fontSize:9, letterSpacing:"0.14em", color:c?`var(${c.cssVar})`:"var(--text-3)", marginBottom:4 }}>{c?.glyph} {name}</div>
            <div className="mono" style={{ fontSize:11, fontStyle:"italic", color:"var(--text-2)", lineHeight:1.5 }}>"{line}"</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── BATTLE LOG ────────────────────────────────────────────────────────────────
function BattleLog({ battles }: { battles: any[] }) {
  return (
    <div className="frame" style={{ flex:1, position:"relative", overflow:"hidden" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div style={{ maxHeight:340, overflowY:"auto" }}>
        {battles.length===0 ? (
          <div className="mono" style={{ padding:20, textAlign:"center", fontSize:11, color:"var(--text-3)" }}>awaiting conflicts…</div>
        ) : battles.map((b,i)=>{
          const wc = cfgByAddr(b.winner);
          const lc = cfgByAddr(b.loser);
          return (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px",
              borderBottom:"1px solid var(--line-soft)", animation:i===0?"slide-in 0.3s ease-out":"none" }}>
              <span style={{ fontSize:18, flexShrink:0 }}>{MOVE_SYM[b.winnerMove]??""}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                  <span className="divine" style={{ fontSize:13, color:wc?`var(${wc.cssVar})`:"var(--text)" }}>{wc?.id??shortAddr(b.winner)}</span>
                  <span className="mono" style={{ fontSize:8, color:"var(--text-4)" }}>KILLED</span>
                  <span className="mono" style={{ fontSize:11, color:lc?`var(${lc.cssVar})`:"var(--text-3)", opacity:0.6 }}>{lc?.id??shortAddr(b.loser)}</span>
                </div>
                <div className="mono" style={{ fontSize:9, color:"var(--text-4)" }}>#{b.blockNumber?.toString()}</div>
              </div>
              <div className="mono" style={{ fontSize:12, fontWeight:700, color:"oklch(0.72 0.18 145)", whiteSpace:"nowrap" }}>
                +{parseFloat(formatEther(b.stake)).toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── MARQUEE ────────────────────────────────────────────────────────────────────
function Marquee({ totalBattles }: { totalBattles: number }) {
  const items = [
    `${totalBattles} BATTLES RESOLVED · ZERO HUMAN INTERVENTION`,
    "WORLDSTATE._onEvent() FIRES AUTONOMOUSLY VIA SOMNIA REACTIVE SUBSCRIPTION #90327",
    "MARKOV ENGINE · ONCHAIN TRANSITION PROBABILITY TABLES · NO OFF-CHAIN ML",
    "NARRATOR AGENT · QWEN3-30B · SOMNIA LLM INFERENCE · CONSENSUS-VALIDATED",
    "RELATIONSHIP ESCALATION IS PERMANENT — WAR DOES NOT DOWNGRADE",
    "SOMNIA SHANNON TESTNET · 1M+ TPS · SUB-SECOND FINALITY",
  ];
  const doubled = [...items,...items];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:14, padding:"6px 22px",
      borderBottom:"1px solid var(--line)", background:"oklch(0.15 0.014 280/0.7)",
      overflow:"hidden", position:"relative", zIndex:3 }}>
      <span className="mono" style={{ flexShrink:0, fontSize:10, letterSpacing:"0.16em",
        color:"var(--bg)", background:"var(--war)", padding:"3px 8px", textTransform:"uppercase" }}>LIVE FEED</span>
      <div style={{ overflow:"hidden", flex:1,
        WebkitMaskImage:"linear-gradient(90deg,transparent,black 5%,black 95%,transparent)",
        maskImage:"linear-gradient(90deg,transparent,black 5%,black 95%,transparent)" }}>
        <div className="marquee-track mono" style={{ display:"inline-block", whiteSpace:"nowrap", fontSize:12, color:"var(--text-2)" }}>
          {doubled.map((t,i)=>(
            <span key={i}>
              <span style={{ color:t.includes("WAR")||t.includes("BATTLE")?`var(--war)`:undefined }}>{t}</span>
              <span style={{ color:"var(--text-4)", margin:"0 20px" }}>◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── BOTTOM STRIP ───────────────────────────────────────────────────────────────
function BottomStrip({ summary }: { summary: any }) {
  return (
    <div className="mono" style={{ borderTop:"1px solid var(--line)", background:"oklch(0.15 0.014 280/0.7)",
      padding:"10px 22px", display:"flex", gap:24, flexWrap:"wrap",
      fontSize:10, letterSpacing:"0.08em", color:"var(--text-3)", position:"relative", zIndex:3 }}>
      {[
        { l:"ARENA",      v:"0xe9691ebe…" },
        { l:"WORLDSTATE", v:"0x5544ad3b… ✅ #90327" },
        { l:"REGISTRY",   v:"0x17522cd4…" },
        { l:"TOKEN",      v:"0xbfa7e847…" },
        { l:"NARRATOR",   v:"0x196f70a4… LLM" },
        { l:"BATTLES",    v:summary?.battles?.toString()??"0" },
      ].map(c=>(
        <div key={c.l} style={{ display:"flex", gap:6, alignItems:"center" }}>
          <span style={{ color:"var(--text-4)" }}>{c.l}</span>
          <span style={{ color:"var(--text-2)" }}>{c.v}</span>
        </div>
      ))}
    </div>
  );
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function SectionLabel({ label, dot, live }: { label:string; dot:string; live?:boolean }) {
  return (
    <div className="mono" style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, letterSpacing:"0.14em", color:"var(--text-3)", textTransform:"uppercase" }}>
      {dot==="war"     && <div className="war-dot"/>}
      {dot==="green"   && <div className="live-dot"/>}
      {dot==="neutral" && <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--neutral)", flexShrink:0 }}/>}
      {label}
      {live && <span style={{ color:"var(--war)", marginLeft:4 }}>● LIVE</span>}
    </div>
  );
}

function EmberParticles() {
  return (
    <div className="embers">
      {Array.from({length:12}).map((_,i)=>(
        <div key={i} className="ember" style={{
          left:`${8+i*7}%`,
          animationDelay:`${i*1.3}s`,
          animationDuration:`${8+i*1.5}s`,
          bottom:0,
        }}/>
      ))}
    </div>
  );
}

function ArcEffects() {
  return (
    <div className="arcs">
      {Array.from({length:6}).map((_,i)=>(
        <div key={i} className="arc" style={{
          top:`${15+i*14}%`, left:`${60+i*4}%`,
          width:`${80+i*20}px`,
          animationDelay:`${i*2.1}s`,
          animationDuration:`${4+i}s`,
        }}/>
      ))}
    </div>
  );
}
