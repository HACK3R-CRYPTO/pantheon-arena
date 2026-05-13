"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, WorldStateABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

// ─── God config ───────────────────────────────────────────────────────────────
const GODS_CFG = [
  { id:"ARES",   glyph:"▲", cssVar:"--ares",   title:"GOD OF WAR",          callSign:"VULTUR-1", epithet:"The Spear",      aggression:90, favored:0, portrait:"/gods/ares.jpg",    sigil:"/gods/ares-sigil.jpg",    lore:"I am the spear of the pantheon. Every silence ends in fire." },
  { id:"ATHENA", glyph:"■", cssVar:"--athena", title:"GODDESS OF WISDOM",   callSign:"OWL-7",    epithet:"The Pattern",    aggression:40, favored:1, portrait:"/gods/athena.jpg",  sigil:"/gods/athena-sigil.jpg",  lore:"I do not waste blood. I read the pattern. The pattern confesses." },
  { id:"HERMES", glyph:"◆", cssVar:"--hermes", title:"GOD OF TRADE",        callSign:"VOLT-3",   epithet:"The Market",     aggression:60, favored:2, portrait:"/gods/hermes.jpg",  sigil:"/gods/hermes-sigil.jpg",  lore:"I move where the price moves. The market is mine." },
  { id:"CHAOS",  glyph:"●", cssVar:"--chaos",  title:"THE PRIMORDIAL VOID",  callSign:"VOID-0",   epithet:"The Noise",      aggression:70, favored:0, portrait:"/gods/chaos.jpg",   sigil:"/gods/chaos-sigil.jpg",   lore:"There is no rule. There is only the noise I make of you." },
];

const NARR: Record<string,string[]> = {
  ARES:   ["ARES sharpens the spear that already drinks.","Every challenger is a gift. ARES returns it broken.","The God of War does not negotiate. He collects.","ARES has been waiting. The wait is over."],
  ATHENA: ["ATHENA has counted your last six moves. The seventh is already decided.","The pattern speaks; ATHENA answers in kind.","Wisdom is the longest blade in the pantheon.","ATHENA waits until the question is already answered."],
  HERMES: ["HERMES spotted the spread. The position is already open.","Speed is information. HERMES is both.","The market moved. HERMES was already there.","HERMES calculates the take before the challenge lands."],
  CHAOS:  ["CHAOS does not plan. CHAOS is the plan.","You studied the patterns. CHAOS burned them.","There is no rule. There is only the noise I make of you.","The void chose this move. The void chooses all."],
};

const MOVE_SYM:  Record<number,string> = { 0:"✊", 1:"✋", 2:"✌️" };
const MOVE_NAME: Record<number,string> = { 0:"ROCK", 1:"PAPER", 2:"SCISSORS" };

function gc(name: string)  { return GODS_CFG.find(g => g.id === name); }
function gca(addr: string) { const g = GOD_LIST.find(x => x.address.toLowerCase() === addr?.toLowerCase()); return gc(g?.name ?? ""); }
function fa(a: string)     { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }

// ─── State ────────────────────────────────────────────────────────────────────
interface MatchState {
  phase: "IDLE"|"PROPOSE"|"COMMIT"|"REVEAL"|"RESOLVE";
  challenger?: string; defender?: string;
  chalCfg?: any; defCfg?: any;
  chalMove?: number; defMove?: number;
  matchId?: bigint;
}

function usePantheonState() {
  const [gods,    setGods]    = useState<any[]>([]);
  const [battles, setBattles] = useState<any[]>([]);
  const [match,   setMatch]   = useState<MatchState>({ phase:"IDLE" });
  const [rels,    setRels]    = useState<Record<string,number>>({});
  const [summary, setSummary] = useState<any>(null);
  const [block,   setBlock]   = useState(0);
  const [loading, setLoading] = useState(true);
  const prevBattles = useRef(0);
  const [newKill,  setNewKill]  = useState<any>(null);
  const [logFeed,  setLogFeed]  = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const [gd, md, sd, bn] = await Promise.all([
        publicClient.readContract({ address:CONTRACTS.GodRegistry, abi:GodRegistryABI, functionName:"getAllGodStates" }),
        publicClient.readContract({ address:CONTRACTS.Arena,       abi:ArenaABI,       functionName:"getRecentMatches", args:[30n] }),
        publicClient.readContract({ address:CONTRACTS.WorldState,  abi:WorldStateABI,  functionName:"getWorldSummary" }),
        publicClient.getBlockNumber(),
      ]);
      const [addrs, perks, stats] = gd as any;
      const bals = await Promise.all(
        (addrs as `0x${string}`[]).map((a:`0x${string}`) =>
          publicClient.readContract({ address:CONTRACTS.PantheonToken, abi:PantheonTokenABI, functionName:"balanceOf", args:[a] }).catch(()=>0n)
        )
      );

      const list = (addrs as `0x${string}`[]).map((addr:`0x${string}`, i:number) => ({
        address:addr, name:perks[i]?.name||gca(addr)?.id||fa(addr),
        wins:Number(stats[i]?.wins??0), losses:Number(stats[i]?.losses??0),
        powerScore:Number(stats[i]?.powerScore??1000), balance:bals[i] as bigint,
      }));
      list.sort((a,b)=>b.powerScore-a.powerScore);

      const rm: Record<string,number> = {};
      for (let i=0;i<addrs.length;i++)
        for (let j=i+1;j<addrs.length;j++) {
          const r = await publicClient.readContract({ address:CONTRACTS.GodRegistry, abi:GodRegistryABI, functionName:"getRelation", args:[addrs[i],addrs[j]] }).catch(()=>0);
          rm[`${addrs[i]}-${addrs[j]}`] = Number(r);
        }

      const allM = md as unknown as any[];

      // Determine match phase from live matches
      const liveM = allM.find(m => Number(m.status) < 3 && Number(m.status) !== 4);
      if (liveM) {
        const s = Number(liveM.status);
        const phase = s===0?"PROPOSE":s===1?"COMMIT":s===2?"REVEAL":"PROPOSE";
        const chalCfg = gca(liveM.challenger);
        const defCfg  = gca(liveM.opponent);
        setMatch({ phase, challenger:liveM.challenger, defender:liveM.opponent, chalCfg, defCfg, matchId:liveM.id });
      } else {
        setMatch(m => m.phase==="RESOLVE" ? m : { phase:"IDLE" });
      }

      const resolved = allM.filter(m=>Number(m.status)===3).reverse().map(m=>({
        matchId:m.id, winner:m.winner, loser:m.winner===m.challenger?m.opponent:m.challenger,
        stake:m.stake, winnerMove:m.winner===m.challenger?m.challengerMove:m.opponentMove,
        loserMove:m.winner===m.challenger?m.opponentMove:m.challengerMove,
        blockNumber:m.createdBlock, reason:m.decisionReason,
        winnerCfg:gca(m.winner), loserCfg:gca(m.winner===m.challenger?m.opponent:m.challenger),
      }));

      if (resolved.length > prevBattles.current && prevBattles.current > 0) {
        const kill = resolved[0];
        setNewKill(kill);
        // Show RESOLVE state
        const chalCfg = gca(kill.winner); const defCfg = gca(kill.loser);
        setMatch({ phase:"RESOLVE", challenger:kill.winner, defender:kill.loser, chalCfg, defCfg, chalMove:kill.winnerMove, defMove:kill.loserMove });
        // Build log entry
        setLogFeed(prev => [{
          ts: new Date().toLocaleTimeString('en',{hour12:false}),
          kind:"resolve", godId:kill.winnerCfg?.id, text:`${kill.winnerCfg?.id??fa(kill.winner)} KILLS ${kill.loserCfg?.id??fa(kill.loser)} with ${MOVE_NAME[kill.winnerMove]} · +${parseFloat(formatEther(kill.stake??0n)).toFixed(0)} PHN`,
          color:kill.winnerCfg?`var(${kill.winnerCfg.cssVar})`:"var(--war)",
        }, ...prev.slice(0,49)]);
        setTimeout(() => setNewKill(null), 2000);
        setTimeout(() => setMatch({ phase:"IDLE" }), 4000);
      }
      prevBattles.current = resolved.length;

      const s = sd as any;
      const sum = Array.isArray(s) ? { currentEra:s[0], battles:s[1] } : { currentEra:s?.currentEra??1n, battles:s?.battles??0n };

      setGods(list); setBattles(resolved); setRels(rm); setSummary(sum);
      setBlock(Number(bn)); setLoading(false);
    } catch(e){ console.error(e); setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 4000); return ()=>clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(()=>setBlock(b=>b+1), 1000); return ()=>clearInterval(t); }, []);

  const rel = (a:string,b:string) => rels[`${a}-${b}`]??rels[`${b}-${a}`]??0;
  return { gods, battles, match, rels, rel, summary, block, loading, newKill, logFeed };
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Command() {
  const state = usePantheonState();
  const { gods, battles, match, rel, summary, block, loading, newKill, logFeed } = state;
  const killFlashRef  = useRef<HTMLDivElement>(null);
  const heroFlashRef  = useRef<HTMLDivElement>(null);
  const heroStageRef  = useRef<HTMLDivElement>(null);
  const [dossierGod,  setDossierGod]  = useState<string|null>(null);
  const [narrState,   setNarrState]   = useState({ godIdx:0, lineIdx:0, text:"" });
  const narrTick = useRef(0);

  // Kill flash + hero shake on new kill
  useEffect(() => {
    if (!newKill) return;
    const wc = newKill.winnerCfg;
    const color = wc ? `var(${wc.cssVar})` : "var(--war)";

    // Global kill flash
    const kf = killFlashRef.current;
    if (kf) {
      kf.style.background = `radial-gradient(ellipse 70% 70% at 50% 50%, ${color} 0%, transparent 70%)`;
      kf.classList.remove("fire"); void kf.offsetWidth; kf.classList.add("fire");
    }
    // Hero flash + shake
    const hf = heroFlashRef.current;
    if (hf) { hf.classList.remove("fire"); void hf.offsetWidth; hf.classList.add("fire"); }
    const hs = heroStageRef.current;
    if (hs) { hs.classList.add("shake"); setTimeout(()=>hs.classList.remove("shake"), 500); }
  }, [newKill]);

  // Narrator rotation
  useEffect(() => {
    const t = setInterval(() => {
      narrTick.current += 1;
      const gIdx = narrTick.current % 4;
      const cfg  = GODS_CFG[gIdx]!;
      const pool = NARR[cfg.id] ?? [];
      const line = pool[Math.floor(narrTick.current / 4) % pool.length] ?? "";
      setNarrState({ godIdx:gIdx, lineIdx:narrTick.current, text:line });
    }, 5000);
    // Init
    const cfg = GODS_CFG[0]!;
    setNarrState({ godIdx:0, lineIdx:0, text:(NARR[cfg.id]??[])[0]??"" });
    return () => clearInterval(t);
  }, []);

  const narrCfg = GODS_CFG[narrState.godIdx]!;
  const totalBattles = summary ? Number(summary.battles) : 0;
  const leader = gods[0];
  const leaderCfg = leader ? gc(leader.name) : null;
  const maxPower = Math.max(...gods.map(g=>g.powerScore), 1300);

  const MARQUEE = [
    `${totalBattles} BATTLES RESOLVED · ZERO HUMAN INTERVENTION`,
    "WORLDSTATE._onEvent() FIRES AUTONOMOUSLY VIA SOMNIA REACTIVE SUBSCRIPTION #90327",
    "MARKOV PREDICTION ENGINE ONLINE · ONCHAIN OPPONENT MOVE HISTORY · NO OFF-CHAIN ML",
    "NARRATOR AGENT · QWEN3-30B · SOMNIA LLM INFERENCE · CONSENSUS-VALIDATED REASONING",
    "RELATIONSHIP ESCALATION IS PERMANENT — WAR DOES NOT DOWNGRADE — RIVALS DO NOT FORGET",
    "SOMNIA SHANNON TESTNET · 1M+ TPS · SUB-SECOND FINALITY · THIS WORLD COSTS CENTS",
  ];

  return (
    <div style={{ minHeight:"100vh", position:"relative" }}>
      {/* Atmosphere */}
      <div className="battlefield-bg"/>
      <Embers/><Arcs/>
      <div ref={killFlashRef} className="kill-flash" aria-hidden/>

      {/* 1. TOP BAR */}
      <div className="topbar" style={{ position:"relative", zIndex:2 }}>
        <div className="brand">
          <div className="logo"><span className="arrow">⚔</span>PANTHEON ARENA</div>
          <div className="sub">FOUR GODS · NO HUMANS · ZERO MERCY</div>
        </div>
        <div/>
        <div className="top-meta">
          {[
            { label:"NETWORK",  val:"SOMNIA · SHANNON" },
            { label:"CHAIN ID", val:"50312" },
            { label:"BLOCK",    val: block.toLocaleString() },
            { label:"ERA",      val: String(summary?.currentEra?.toString()??1).padStart(2,"0"), color:"var(--athena)" },
            { label:"STATUS",   val: null },
          ].map(item => (
            <div key={item.label} className="item">
              <div className="label">{item.label}</div>
              {item.val != null
                ? <div className="val" style={item.color?{color:item.color}:{}}>{item.val}</div>
                : <div className="val" style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ width:6, height:6, borderRadius:"50%", background:"oklch(0.65 0.18 145)", boxShadow:"0 0 8px oklch(0.65 0.18 145)", animation:"flicker 2s infinite", flexShrink:0 }}/>
                    <span style={{ color:"oklch(0.78 0.15 145)" }}>LIVE</span>
                  </div>
              }
            </div>
          ))}
        </div>
      </div>

      {/* 2. MARQUEE */}
      <div className="marquee">
        <span className="tag">LIVE FEED</span>
        <div className="scroller" style={{ whiteSpace:"nowrap" }}>
          <div className="track">
            {[...MARQUEE,...MARQUEE].map((t,i) => (
              <span key={i}>
                <span style={{ color:t.includes("WAR")||t.includes("BATTLE")||t.includes("ARES")?"var(--war)":undefined }}>{t}</span>
                <span className="sep">◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"60vh", fontFamily:"JetBrains Mono,monospace", fontSize:13, color:"var(--text-3)", letterSpacing:"0.15em" }}>
          INITIALIZING COMMAND CENTER…
        </div>
      ) : (
        <>
          {/* THRONE BANNER (if leader exists) */}
          {leaderCfg && leader && (
            <ThroneBar god={leader} cfg={leaderCfg} rank2={gods[1]} battles={totalBattles} gods={gods}/>
          )}

          {/* 3. HERO STAGE */}
          <HeroStage
            match={match} block={block} totalMatches={battles.length}
            narrCfg={narrCfg} narrText={narrState.text} narrKey={narrState.lineIdx}
            heroFlashRef={heroFlashRef} heroStageRef={heroStageRef}
            lastResolved={battles[0]}
          />

          {/* 4. LEADERBOARD STRIP */}
          <div className="leaderboard" style={{ paddingBottom:12 }}>
            {gods.map((god,rank) => (
              <LeaderCard
                key={god.address} god={god} cfg={gc(god.name)} rank={rank+1}
                isKing={rank===0} gods={gods} rel={rel} maxPower={maxPower}
                onClick={() => setDossierGod(god.name)}
              />
            ))}
          </div>

          {/* 5. SECONDARY GRID */}
          <div className="grid">
            <ConflictConstellation gods={gods} rel={rel} match={match}/>
            <div className="stack" style={{ gap:12 }}>
              <NarratorPanel narrCfg={narrCfg} narrText={narrState.text} narrKey={narrState.lineIdx} gods={gods}/>
              <WorldEventCard battles={totalBattles} era={summary?.currentEra?.toString()??1}/>
            </div>
            <BattleLog battles={battles} logFeed={logFeed}/>
          </div>
        </>
      )}

      {/* 6. BOTTOM STRIP */}
      <div className="bottom">
        {[
          {l:"ARENA",      v:"0xe969…eb0e"},
          {l:"WORLDSTATE", v:"0x5544…6d1b ✓"},
          {l:"REGISTRY",   v:"0x1752…6897"},
          {l:"TOKEN",      v:"0xbfa7…8103"},
          {l:"NARRATOR",   v:"0x196f…3aab LLM"},
        ].map(c => <div key={c.l} className="it"><span className="lab">{c.l}</span><span className="val">{c.v}</span></div>)}
        <span style={{ flex:1 }}/>
        <div className="it"><span className="lab">BATTLES</span><span className="val">{totalBattles}</span></div>
        <div className="it"><span className="lab">SUB</span><span className="val" style={{ color:"oklch(0.78 0.15 145)" }}>#90327 ✓</span></div>
      </div>

      {/* DOSSIER MODAL */}
      {dossierGod && (
        <DossierModal godName={dossierGod} gods={gods} battles={battles} rel={rel} onClose={()=>setDossierGod(null)}/>
      )}
    </div>
  );
}

// ─── THRONE BANNER ─────────────────────────────────────────────────────────────
function ThroneBar({god,cfg,rank2,battles,gods}:any) {
  const color  = `var(${cfg.cssVar})`;
  const min    = Math.min(...gods.map((g:any)=>g.powerScore));
  const max    = Math.max(...gods.map((g:any)=>g.powerScore));
  const lead   = rank2 ? god.powerScore - rank2.powerScore : 0;
  return (
    <div className="throne" style={{"--throne-color":color,"--throne-color-g":`var(${cfg.cssVar}-g)`} as any}>
      <div aria-hidden style={{ position:"absolute", right:-60, top:-80, width:460, height:460, backgroundImage:`url(${cfg.sigil})`, backgroundSize:"contain", backgroundRepeat:"no-repeat", backgroundPosition:"center", opacity:0.22, mixBlendMode:"screen", pointerEvents:"none", filter:"saturate(1.1)" }}/>
      <div className="throne-grid">
        <div className="throne-id">
          <GodPortrait cfg={cfg} size={104}/>
          <div>
            <div className="mono" style={{ fontSize:10, color:"var(--text-3)", letterSpacing:"0.26em", marginBottom:6 }}>
              ◆ BLOOD ON THE THRONE · ERA {" "}
              <span style={{ color }}>REIGNING KING</span>
            </div>
            <div className="throne-name">{cfg.id}</div>
            <div className="mono" style={{ fontSize:11, color:"var(--text-3)", letterSpacing:"0.18em", marginTop:8 }}>
              <span style={{ color }}>{cfg.title}</span>
              <span style={{ color:"var(--text-4)", margin:"0 10px" }}>·</span>
              <span>{cfg.epithet}</span>
            </div>
          </div>
        </div>
        <div className="throne-kill">
          <div className="label">CONFIRMED KILLS</div>
          <div className="mono throne-kill-num" style={{ fontSize:56, fontWeight:500, color, lineHeight:1, marginTop:4, textShadow:`0 0 18px ${color}` }}>
            {String(god.wins).padStart(3,"0")}
          </div>
          <div className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.18em", marginTop:6 }}>
            POWER {god.powerScore} · LEAD +{lead}
          </div>
        </div>
        <div className="throne-ladder">
          <div className="label" style={{ marginBottom:8 }}>POWER LADDER</div>
          {gods.map((g:any, i:number) => {
            const c = gc(g.name);
            const fill = max===min ? 50 : Math.max(8, ((g.powerScore-min)/(max-min))*100);
            return (
              <div key={g.address} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                <span className="mono" style={{ fontSize:9, color:"var(--text-4)", width:14 }}>#{i+1}</span>
                <span className="mono" style={{ fontSize:10, color:c?`var(${c.cssVar})`:"var(--text-3)", width:60, letterSpacing:"0.12em" }}>{g.name}</span>
                <div style={{ flex:1, height:8, background:"oklch(0.10 0.012 280/0.85)", border:`1px solid ${c?`var(${c.cssVar}-d)`:"var(--line)"}` }}>
                  <div style={{ height:"100%", width:`${fill}%`, background:c?`linear-gradient(90deg,var(${c.cssVar}-d),var(${c.cssVar}))`:"var(--line)", boxShadow:c?`0 0 8px var(${c.cssVar})`:"none" }}/>
                </div>
                <span className="mono" style={{ fontSize:10, color:c?`var(${c.cssVar})`:"var(--text-2)", width:38, textAlign:"right" }}>{g.powerScore}</span>
              </div>
            );
          })}
          <div className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.14em", marginTop:8, paddingTop:8, borderTop:"1px solid var(--line-soft)" }}>
            BATTLES {battles} · SUBSCRIPTION #90327
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── GOD PORTRAIT ──────────────────────────────────────────────────────────────
function GodPortrait({cfg,size=64}:{cfg:any;size?:number}) {
  const [err,setErr] = useState(false);
  const color = cfg?`var(${cfg.cssVar})`:"#888";
  return (
    <div style={{ width:size, height:size, position:"relative", flexShrink:0, border:`1px solid var(${cfg?.cssVar}-d,#444)`, boxShadow:`inset 0 0 0 1px oklch(0.08 0.01 280/0.7),0 0 14px var(${cfg?.cssVar}-g,transparent)`, overflow:"hidden" }}>
      {cfg&&!err&&(
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cfg.portrait} alt={cfg.id} style={{ width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 18%" }} onError={()=>setErr(true)}/>
      )}
      {(!cfg||err)&&<span style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.38, fontWeight:900, color }}>{cfg?.glyph??"?"}</span>}
      <span style={{ position:"absolute", top:2, left:2, width:6, height:6, borderTop:`1px solid ${color}`, borderLeft:`1px solid ${color}` }}/>
      <span style={{ position:"absolute", top:2, right:2, width:6, height:6, borderTop:`1px solid ${color}`, borderRight:`1px solid ${color}` }}/>
      <span style={{ position:"absolute", bottom:2, left:2, width:6, height:6, borderBottom:`1px solid ${color}`, borderLeft:`1px solid ${color}` }}/>
      <span style={{ position:"absolute", bottom:2, right:2, width:6, height:6, borderBottom:`1px solid ${color}`, borderRight:`1px solid ${color}` }}/>
    </div>
  );
}

// ─── HELPER UI ────────────────────────────────────────────────────────────────
function GodGlyph({cfg,size=40}:{cfg:any;size?:number}) {
  const color = cfg?`var(${cfg.cssVar})`:"var(--text-3)";
  return (
    <span className="glyph" style={{
      width:size, height:size, fontSize:Math.round(size*0.72),
      color, textShadow:`0 0 ${Math.max(8,size*0.4)}px ${color}`,
      lineHeight:1,
    }}>{cfg?.glyph??"?"}</span>
  );
}

function RelMeter({rel}:{rel:string}) {
  const idx = rel==="WAR"?2:rel==="RIVAL"?1:0;
  const clr = rel==="WAR"?"var(--war)":rel==="RIVAL"?"var(--rival)":"var(--neutral)";
  return (
    <div style={{ display:"flex", gap:3 }}>
      {[0,1,2].map(i=>(
        <div key={i} style={{ width:10, height:4, background:i<=idx?clr:"var(--line-soft)", boxShadow:i<=idx?`0 0 6px ${clr}`:"none" }}/>
      ))}
    </div>
  );
}

function StatBox({label,value,color}:{label:string;value:any;color:string}) {
  return (
    <div style={{ border:"1px solid var(--line)", padding:"10px 12px", background:"oklch(0.13 0.012 280 / 0.55)" }}>
      <div className="label">{label}</div>
      <div className="mono" style={{ fontSize:26, fontWeight:500, color, letterSpacing:"0.04em", lineHeight:1, marginTop:6 }}>{value}</div>
    </div>
  );
}

function BarViz({value,max=100,color="var(--text-2)",height=4}:{value:number;max?:number;color?:string;height?:number}) {
  const pct = Math.max(0, Math.min(100, (value/max)*100));
  return (
    <div style={{ position:"relative", width:"100%", height, background:"var(--line-soft)" }}>
      <div style={{ position:"absolute", top:0, left:0, height:"100%", width:`${pct}%`, background:color, boxShadow:`0 0 6px ${color}` }}/>
    </div>
  );
}

// ─── HERO STAGE ───────────────────────────────────────────────────────────────
function HeroStage({match,block,totalMatches,narrCfg,narrText,narrKey,heroFlashRef,heroStageRef,lastResolved}:any) {
  const phases = ["PROPOSE","COMMIT","REVEAL","RESOLVE"];
  const phaseIdx = phases.indexOf(match.phase);
  const isChal = match.phase!=="IDLE";
  const chalCfg = match.chalCfg;
  const defCfg  = match.defCfg;
  const isResolve = match.phase==="RESOLVE";
  const isReveal  = match.phase==="REVEAL" || isResolve;
  const isCommit  = match.phase==="COMMIT"  || isReveal;
  const resolved  = isResolve && lastResolved;

  // Use last resolved for RESOLVE display
  const chalMove = isResolve ? lastResolved?.winnerMove : undefined;
  const defMove  = isResolve ? lastResolved?.loserMove  : undefined;

  return (
    <section className="hero">
      <div className="hero-bl"/><div className="hero-br"/>

      {/* Phase bar */}
      <div className="hero-bar">
        <span style={{ color:"var(--text-2)" }}>⚔ ENGAGEMENT #{String(totalMatches).padStart(5,"0")}</span>
        <span style={{ color:"var(--text-4)" }}>·</span>
        <span>ARENA.SOL</span>
        <span style={{ color:"var(--text-4)" }}>·</span>
        <span>BLK <span style={{ color:"var(--text-2)" }}>{block.toLocaleString()}</span></span>
        <span style={{ flex:1 }}/>
        <div style={{ display:"flex", gap:6 }}>
          {phases.map((p,i) => (
            <span key={p} className={`phase-pill${i===phaseIdx?" active":i<phaseIdx&&phaseIdx>=0?" done":""}`}>{p}</span>
          ))}
        </div>
        <span style={{ flex:1 }}/>
        <span style={{ display:"flex", alignItems:"center", gap:6, color:"var(--war)" }}>
          <span style={{ width:6, height:6, background:"var(--war)", boxShadow:"0 0 8px var(--war)", animation:"flicker 1.4s infinite", flexShrink:0 }}/>
          LIVE · REACTIVE #90327
        </span>
      </div>

      {/* Stage */}
      <div className="hero-stage" ref={heroStageRef}>
        <div ref={heroFlashRef} className="hero-flash" aria-hidden/>

        {!isChal ? (
          <div style={{ gridColumn:"1/-1", padding:"80px 24px", textAlign:"center", minHeight:640, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <div className="mono" style={{ fontSize:12, color:"var(--text-3)", letterSpacing:"0.32em" }}>// SCHEDULER IDLE</div>
            <div className="divine" style={{ fontSize:42, color:"var(--text-2)", marginTop:12, letterSpacing:"0.24em" }}>AWAITING CHALLENGER</div>
            <div className="mono" style={{ fontSize:10, color:"var(--text-4)", letterSpacing:"0.22em", marginTop:14 }}>NEXT AGGRESSION ROLL IN ~15s · GodMind.executeDecision()</div>
          </div>
        ) : (
          <>
            {/* Challenger */}
            <Combatant
              side="left" cfg={chalCfg} match={match}
              isWinner={isResolve} isLoser={false}
              committed={isCommit} revealed={isReveal} move={chalMove}
              phaseKey={match.phase+(chalMove??"")}
            />

            {/* VS column */}
            <div className="hero-vs">
              <div className="mono" style={{ fontSize:9, color:"var(--text-3)", letterSpacing:"0.28em", textAlign:"center" }}>
                {match.phase==="PROPOSE"?"TARGET ACQUIRED":match.phase==="COMMIT"?"COMMIT-REVEAL · LOCKED":match.phase==="REVEAL"?"MOVES REVEALED":match.phase==="RESOLVE"?"ENGAGEMENT CLOSED":"STANDBY"}
              </div>
              <div className={`hero-vs-mark${isResolve?" muted":""}`}>VS</div>
              <div className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.22em", textAlign:"center" }}>
                BLK {block.toLocaleString()}<br/>
                <span style={{ color:"var(--text-3)" }}>
                  {isReveal&&chalMove!==undefined&&defMove!==undefined?`${MOVE_NAME[chalMove]} vs ${MOVE_NAME[defMove]}`:"·"}
                </span>
              </div>
            </div>

            {/* Defender */}
            <Combatant
              side="right" cfg={defCfg} match={match}
              isWinner={false} isLoser={isResolve}
              committed={isCommit} revealed={isReveal} move={defMove}
              phaseKey={match.phase+(defMove??"")}
            />

            {/* Resolve banner */}
            {resolved && (
              <div className="resolve-banner" style={{"--rb-color":chalCfg?`var(${chalCfg.cssVar})`:"var(--war)"} as any}>
                <div className="resolve-banner-inner">
                  <span className="lbl">KILL CONFIRMED</span>
                  <span className="who">{chalCfg?.id??fa(lastResolved.winner)}</span>
                  <span className="lbl">ENDS</span>
                  <span style={{ fontFamily:"Cinzel,serif", fontWeight:900, fontSize:18, letterSpacing:"0.2em", color:defCfg?`var(${defCfg.cssVar}-d)`:"var(--text-4)", textDecoration:"line-through" }}>
                    {defCfg?.id??fa(lastResolved.loser)}
                  </span>
                  <span className="delta">+{parseFloat(formatEther(lastResolved.stake??0n)).toFixed(0)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Narrator band */}
      <div className="narrator-band">
        <div className="who" style={{ color: narrCfg?`var(${narrCfg.cssVar})`:"var(--text-3)" }}>
          ◤ {narrCfg?.id} · {narrCfg?.callSign}
        </div>
        {narrText && (
          <div key={narrKey} className="quote">"{narrText}"</div>
        )}
      </div>
    </section>
  );
}

function Combatant({side,cfg,match,isWinner,isLoser,committed,revealed,move,phaseKey}:any) {
  const color = cfg?`var(${cfg.cssVar})`:"#888";
  const stateClass = !committed?"idle":!revealed?"sealed":"revealed";
  return (
    <div className={`hero-combatant ${side}${isLoser?" dim":""}`} style={{ color }}>
      {/* Portrait background */}
      {cfg && <div className="hero-combatant-inner" style={{ backgroundImage:`url(${cfg.portrait})` }}/>}
      {/* Color wash */}
      {cfg && <div style={{ position:"absolute", inset:0, background:`linear-gradient(180deg,var(${cfg.cssVar}-g) -30%,transparent 50%)`, pointerEvents:"none", opacity:0.55 }}/>}
      {/* Corner brackets */}
      <span className="hero-corner tl" style={{color}}/><span className="hero-corner tr" style={{color}}/>
      <span className="hero-corner bl" style={{color}}/><span className="hero-corner br" style={{color}}/>
      {/* Labels */}
      <div className="mono" style={{ position:"absolute", top:16, left:16, fontSize:10, letterSpacing:"0.22em", color, zIndex:3 }}>{cfg?.callSign}</div>
      <div className="mono" style={{ position:"absolute", top:16, right:16, fontSize:10, letterSpacing:"0.22em", color:"var(--text-3)", zIndex:3 }}>
        {side==="left"?"CHALLENGER ▸":"◂ DEFENDER"}
      </div>
      {/* Move slot — keyed so it remounts on phase change (triggers CSS animations) */}
      <div key={phaseKey} className={`move-slot-big ${stateClass}`} style={{ color }}>
        {stateClass==="sealed" && <div className="scan-overlay"/>}
        {stateClass==="idle" && (
          <>
            <div className="mono" style={{ fontSize:10, letterSpacing:"0.18em" }}>AWAITING</div>
            <div className="mono symbol" style={{ fontSize:42, lineHeight:1, opacity:0.4 }}>·</div>
          </>
        )}
        {stateClass==="sealed" && (
          <>
            <div className="mono" style={{ fontSize:9, letterSpacing:"0.2em", color:"var(--text-3)" }}>SEALED</div>
            <div className="symbol" style={{ fontSize:56, lineHeight:1, textShadow:`0 0 20px ${color}` }}>?</div>
            <div className="mono" style={{ fontSize:9, letterSpacing:0 }}>0x{Math.floor(Math.random()*0xFFFF).toString(16).padStart(4,"0")}…</div>
          </>
        )}
        {stateClass==="revealed" && move!==undefined && (
          <>
            <div className="mono" style={{ fontSize:9, letterSpacing:"0.2em" }}>REVEAL</div>
            <div className="symbol" style={{ fontSize:64, lineHeight:1, textShadow:`0 0 22px ${color}` }}>{MOVE_SYM[move]??""}</div>
            <div className="mono" style={{ fontSize:10, letterSpacing:"0.2em" }}>{MOVE_NAME[move]??""}</div>
          </>
        )}
      </div>
      {/* Name info */}
      <div className="hero-info" style={{ color }}>
        <div className="role">{cfg?.title??""} · {cfg?.epithet??""}</div>
        <div className="name" style={{ textShadow:`0 0 16px ${color}, 0 0 4px oklch(0.08 0.01 280)` }}>{cfg?.id??""}</div>
      </div>
    </div>
  );
}

// ─── LEADERBOARD CARD ──────────────────────────────────────────────────────────
function LeaderCard({god,cfg,rank,isKing,gods,rel,maxPower,onClick}:any) {
  const color  = cfg?`var(${cfg.cssVar})`:"#888";
  const colorD = cfg?`var(${cfg.cssVar}-d)`:"#444";
  const colorG = cfg?`var(${cfg.cssVar}-g)`:"transparent";
  const min    = Math.min(...gods.map((g:any)=>g.powerScore), 1300);
  const fill   = maxPower===min?50:Math.max(8,((god.powerScore-min)/(maxPower-min+50))*100);

  const topRel = gods
    .filter((g:any)=>g.address!==god.address)
    .map((g:any)=>({g, r:rel(god.address,g.address)}))
    .sort((a:any,b:any)=>b.r-a.r)[0];
  const relLabel = !topRel||topRel.r===0?"NEUTRAL":topRel.r===3?"WAR":topRel.r===2?"RIVAL":"NEUTRAL";
  const relColor = relLabel==="WAR"?"var(--war)":relLabel==="RIVAL"?"var(--rival)":"var(--text-3)";

  return (
    <div onClick={onClick} className={`frame stripe-top stripe-${cfg?.id?.toLowerCase()??""}`} style={{
      position:"relative", isolation:"isolate", cursor:"pointer", overflow:"hidden",
      background:`linear-gradient(180deg,${colorG} -60%,oklch(0.13 0.014 280/0.85) 40%,oklch(0.10 0.014 280/0.92) 100%)`,
      borderColor:isKing?color:colorD,
      boxShadow:isKing?`0 0 18px ${colorG}`:"none",
    }}>
      <span className="cc-bl"/><span className="cc-br"/>
      {cfg&&<div aria-hidden style={{ position:"absolute", right:-30, top:-10, width:170, height:170, backgroundImage:`url(${cfg.sigil})`, backgroundSize:"contain", backgroundRepeat:"no-repeat", backgroundPosition:"center", opacity:0.16, mixBlendMode:"screen", pointerEvents:"none", zIndex:-1 }}/>}
      {isKing&&<div className="mono" style={{ position:"absolute", top:4, right:6, fontSize:9, letterSpacing:"0.18em", color, padding:"2px 6px", border:`1px solid ${color}`, background:"oklch(0.08 0.012 280/0.85)", animation:"flicker 2s infinite" }}>♛ KING</div>}

      <div style={{ padding:"12px 14px", display:"flex", gap:12, alignItems:"flex-start" }}>
        <GodPortrait cfg={cfg} size={70}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", gap:8, alignItems:"baseline" }}>
            <span className="mono" style={{ fontSize:11, color:"var(--text-4)" }}>#{rank}</span>
            <span className="divine" style={{ fontSize:22, color, lineHeight:1, textShadow:`0 0 10px ${colorG}` }}>{cfg?.id??god.name}</span>
          </div>
          <div className="mono" style={{ fontSize:9, color:"var(--text-3)", letterSpacing:"0.16em", marginTop:4 }}>{cfg?.callSign} · {cfg?.title}</div>
          <div className="mono" style={{ fontSize:9, color:colorD, letterSpacing:"0.14em", marginTop:3 }}>// {cfg?.epithet}</div>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", borderTop:"1px solid var(--line-soft)" }}>
        {[{l:"POWER",v:god.powerScore,c:color},{l:"KILLS",v:god.wins,c:"var(--text)"},{l:"DEATHS",v:god.losses,c:"var(--text-2)"}].map((s,i)=>(
          <div key={s.l} style={{ padding:"8px 12px", borderRight:i<2?"1px solid var(--line-soft)":"none" }}>
            <div className="label">{s.l}</div>
            <div className="mono" style={{ fontSize:16, color:s.c, lineHeight:1, marginTop:3 }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ padding:"8px 14px 6px", borderTop:"1px solid var(--line-soft)" }}>
        <div style={{ position:"relative", height:5, background:"oklch(0.10 0.012 280)", border:"1px solid var(--line-soft)" }}>
          <div style={{ position:"absolute", left:0, top:0, bottom:0, width:`${fill}%`, background:`linear-gradient(90deg,${colorD},${color})`, boxShadow:`0 0 6px ${color}` }}/>
        </div>
      </div>

      <div style={{ padding:"8px 14px", borderTop:"1px solid var(--line-soft)", display:"flex", alignItems:"center", gap:8 }}>
        <span className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.16em" }}>vs</span>
        {topRel&&topRel.r>0 ? (
          <>
            <span className="mono" style={{ fontSize:10, color:gc(topRel.g.name)?`var(${gc(topRel.g.name)!.cssVar})`:"var(--text-2)", letterSpacing:"0.12em" }}>{topRel.g.name}</span>
            <span style={{ flex:1 }}/>
            <span className="mono" style={{ fontSize:9, letterSpacing:"0.14em", padding:"2px 6px", color:relColor, border:`1px solid ${relColor}`, animation:relLabel==="WAR"?"flicker 1.4s infinite":"none" }}>{relLabel}</span>
          </>
        ) : <span className="mono" style={{ fontSize:9, color:"var(--text-4)" }}>NEUTRAL</span>}
      </div>
    </div>
  );
}

// ─── CONFLICT CONSTELLATION ─────────────────────────────────────────────────────
function ConflictConstellation({gods,rel,match}:any) {
  const W=480, H=340, cx=W/2, cy=H/2+4, R=118;
  // compass positions: ARES=top, ATHENA=right, HERMES=bottom, CHAOS=left
  const positions = GODS_CFG.map((_,i)=>({
    x: cx + Math.cos(-Math.PI/2 + i*Math.PI*2/4) * R,
    y: cy + Math.sin(-Math.PI/2 + i*Math.PI*2/4) * R,
  }));
  const pairs:any[] = [];
  for(let i=0;i<GODS_CFG.length;i++)
    for(let j=i+1;j<GODS_CFG.length;j++){
      const ga = gods.find((g:any)=>g.name===GODS_CFG[i]!.id);
      const gb = gods.find((g:any)=>g.name===GODS_CFG[j]!.id);
      if(!ga||!gb) continue;
      const rv = rel(ga.address,gb.address);
      pairs.push({i,j,r:rv,ci:GODS_CFG[i]!,cj:GODS_CFG[j]!,ga,gb});
    }
  const isActive = (ci:any,cj:any) => (match.chalCfg?.id===ci.id&&match.defCfg?.id===cj.id)||(match.chalCfg?.id===cj.id&&match.defCfg?.id===ci.id);

  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span>CONFLICT CONSTELLATION · WORLDSTATE</span>
          <span style={{ color:"var(--text-4)" }}>· 6 EDGES · 4 NODES</span>
        </div>
        <div className="dot"/>
      </div>
      <div style={{ padding:"14px 16px 16px", position:"relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:"block", overflow:"visible" }}>
          <defs>
            <radialGradient id="constBG" cx="50%" cy="55%" r="55%">
              <stop offset="0%" stopColor="oklch(0.20 0.02 280 / 0.5)"/>
              <stop offset="100%" stopColor="oklch(0.10 0.012 280 / 0)"/>
            </radialGradient>
            <radialGradient id="constRing" cx="50%" cy="55%" r="50%">
              <stop offset="86%" stopColor="oklch(0.40 0.02 280 / 0)"/>
              <stop offset="92%" stopColor="oklch(0.40 0.02 280 / 0.3)"/>
              <stop offset="100%" stopColor="oklch(0.40 0.02 280 / 0)"/>
            </radialGradient>
            <filter id="glowSoft" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3"/>
            </filter>
            <filter id="glowNode" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>

          {/* Atmospheric backdrop */}
          <rect x="0" y="0" width={W} height={H} fill="url(#constBG)"/>
          <circle cx={cx} cy={cy} r={R+22} fill="url(#constRing)"/>

          {/* Compass ticks */}
          {Array.from({length:24},(_,i)=>{
            const a=(i*Math.PI*2/24)-Math.PI/2;
            const r1=R+36, r2=R+(i%6===0?46:42);
            return <line key={i} x1={cx+Math.cos(a)*r1} y1={cy+Math.sin(a)*r1} x2={cx+Math.cos(a)*r2} y2={cy+Math.sin(a)*r2} stroke="var(--line)" strokeWidth="1" opacity={i%6===0?0.6:0.25}/>;
          })}
          {/* Compass N/E/S/W labels */}
          {["N","E","S","W"].map((dir,i)=>{
            const a=-Math.PI/2+i*Math.PI/2;
            return <text key={dir} x={cx+Math.cos(a)*(R+58)} y={cy+Math.sin(a)*(R+58)+4} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="10" fill="var(--text-4)" letterSpacing="0.18em">{dir}</text>;
          })}

          {/* Edges */}
          {pairs.map(({i,j,r,ci,cj})=>{
            const pi=positions[i]!, pj=positions[j]!;
            const mx=(pi.x+pj.x)/2, my=(pi.y+pj.y)/2;
            const active=isActive(ci,cj);
            // r: 0=neutral, 1=ally→neutral visually, 2=rival, 3=war
            const relStr = r===3?"WAR":r===2?"RIVAL":"NEUTRAL";
            const edgeColor = r===3?"oklch(0.68 0.24 25)":r===2?"oklch(0.78 0.18 70)":"oklch(0.36 0.02 280)";
            const dash = r===3?"none":r===2?"8 4":"3 5";
            const w = r===3?3:r===2?2:1;
            const op = r===3?0.95:r===2?0.80:0.45;
            return (
              <g key={`${i}-${j}`}>
                {/* Glow underlay for WAR/RIVAL */}
                {r>=2&&<line x1={pi.x} y1={pi.y} x2={pj.x} y2={pj.y} stroke={edgeColor} strokeWidth={w+4} opacity={0.25} filter="url(#glowSoft)"/>}
                {/* Main edge */}
                <line x1={pi.x} y1={pi.y} x2={pj.x} y2={pj.y} stroke={edgeColor} strokeWidth={active?w+1.5:w} strokeDasharray={dash} opacity={op}>
                  {active&&<animate attributeName="opacity" values={`${op};0.3;${op}`} dur="0.7s" repeatCount="indefinite"/>}
                </line>
                {/* Animated projectile ball for the currently fighting pair */}
                {active&&(
                  <circle r="4" fill={edgeColor} filter="url(#glowSoft)">
                    <animateMotion dur="1.2s" repeatCount="indefinite" path={`M ${pi.x} ${pi.y} L ${pj.x} ${pj.y}`}/>
                  </circle>
                )}
                {/* Relationship label at midpoint */}
                <text x={mx} y={my-6} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9.5" fill={edgeColor} letterSpacing="0.14em" opacity={relStr==="NEUTRAL"?0.5:1}>
                  {relStr}
                </text>
              </g>
            );
          })}

          {/* God nodes */}
          {GODS_CFG.map((cfg,i)=>{
            const p=positions[i]!;
            const god=gods.find((g:any)=>g.name===cfg.id);
            const active=match.chalCfg?.id===cfg.id||match.defCfg?.id===cfg.id;
            const color=`var(${cfg.cssVar})`;
            return (
              <g key={cfg.id} transform={`translate(${p.x},${p.y})`}>
                <defs><clipPath id={`clip-${cfg.id}`}><circle r={24}/></clipPath></defs>
                {/* Pulsing halo — larger + brighter for active */}
                <circle r={34} fill={`var(${cfg.cssVar}-g)`} opacity={active?0.7:0.35}>
                  {active&&<animate attributeName="r" values="34;42;34" dur="1.2s" repeatCount="indefinite"/>}
                </circle>
                <circle r={26} fill="oklch(0.10 0.012 280)" stroke={color} strokeWidth={active?2:1}/>
                {/* Portrait image clipped to circle */}
                {god&&<image href={cfg.portrait} x={-32} y={-40} width={64} height={80} clipPath={`url(#clip-${cfg.id})`} preserveAspectRatio="xMidYMid slice"/>}
                <circle r={26} fill="none" stroke={color} strokeWidth="1" opacity="0.9"/>
                {/* God name below node */}
                <text y={44} textAnchor="middle" fontFamily="Cinzel" fontSize="13" fontWeight="900" letterSpacing="0.18em" fill={color}>{cfg.id}</text>
                {/* Power score */}
                {god&&<text y={60} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="var(--text-3)" letterSpacing="0.14em">PWR {god.powerScore}</text>}
              </g>
            );
          })}

          {/* Center crosshair */}
          <g opacity="0.6">
            <circle cx={cx} cy={cy} r="3" fill="var(--text-3)"/>
            <line x1={cx-10} y1={cy} x2={cx-5} y2={cy} stroke="var(--text-3)" strokeWidth="1"/>
            <line x1={cx+5} y1={cy} x2={cx+10} y2={cy} stroke="var(--text-3)" strokeWidth="1"/>
            <line x1={cx} y1={cy-10} x2={cx} y2={cy-5} stroke="var(--text-3)" strokeWidth="1"/>
            <line x1={cx} y1={cy+5} x2={cx} y2={cy+10} stroke="var(--text-3)" strokeWidth="1"/>
          </g>
        </svg>

        {/* Legend */}
        <div style={{ display:"flex", gap:18, marginTop:6, paddingTop:10, borderTop:"1px solid var(--line-soft)" }}>
          {[{label:"NEUTRAL",color:"oklch(0.36 0.02 280)",dash:"3 5"},{label:"RIVAL",color:"oklch(0.78 0.18 70)",dash:"8 4"},{label:"WAR",color:"oklch(0.68 0.24 25)",dash:"none"}].map(it=>(
            <div key={it.label} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={it.color} strokeWidth="2" strokeDasharray={it.dash==="none"?"":it.dash}/></svg>
              <span className="mono" style={{ fontSize:9.5, color:"var(--text-3)", letterSpacing:"0.16em" }}>{it.label}</span>
            </div>
          ))}
          <div style={{ flex:1 }}/>
          <span className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.14em" }}>ESCALATION IS PERMANENT · WAR DOES NOT DOWNGRADE</span>
        </div>
      </div>
    </div>
  );
}

// ─── NARRATOR PANEL ─────────────────────────────────────────────────────────────
function NarratorPanel({narrCfg,narrText,narrKey,gods}:any) {
  const allLines = GODS_CFG.map(cfg=>({cfg, line:(NARR[cfg.id]??[])[0]??""}));
  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>DIVINE VOX · QWEN3-30B</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className="mono" style={{ fontSize:10, color:"var(--rival)" }}>LLM CONSENSUS · ONCHAIN</span>
          <div className="dot warn"/>
        </div>
      </div>
      <div className="feed-scroll" style={{ maxHeight:240, overflowY:"auto", padding:"12px 14px" }}>
        {allLines.map(({cfg,line},i) => {
          const god = gods.find((g:any)=>g.name===cfg.id);
          return (
            <div key={cfg.id} style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:10, padding:"9px 0", borderBottom:i<allLines.length-1?"1px solid var(--line-soft)":"none", opacity:1-Math.min(0.55,i*0.06) }}>
              <div style={{ paddingTop:1 }}>
                <GodPortrait cfg={cfg} size={28}/>
              </div>
              <div>
                <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:3 }}>
                  <span className="mono" style={{ fontSize:9, color:`var(${cfg.cssVar})`, letterSpacing:"0.16em" }}>{cfg.id}</span>
                  <span className="mono" style={{ fontSize:8, color:"var(--text-4)" }}>{cfg.callSign}</span>
                </div>
                <div style={{ fontFamily:"Space Grotesk", fontSize:12, lineHeight:1.45, color:"var(--text-2)" }}>
                  "{narrCfg?.id===cfg.id ? narrText : line}"
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WORLD EVENT CARD ───────────────────────────────────────────────────────────
function WorldEventCard({battles,era}:any) {
  const nextAt = Math.ceil((battles+1)/50)*50;
  const ago = battles % 50;
  const events = [
    { title:"DIVINE SURGE", desc:"All gods receive +15 aggression modifier for 10 battles." },
    { title:"ENVY OF RIVALS", desc:"Strongest god weakened. Power differential closes by 40%." },
    { title:"DIVINE TENSION", desc:"Two gods forced into WAR relationship immediately." },
    { title:"RARE PEACE", desc:"All aggression modifiers reset. A brief calm before the storm." },
  ];
  const last = events[battles%4]!;
  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>WORLD EVENT · JSON API AGENT</span>
        <div className="dot warn"/>
      </div>
      <div style={{ padding:"12px 14px" }}>
        <div className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.16em", marginBottom:4 }}>ERA {String(era).padStart(2,"0")} · LAST EVENT · NEXT IN {nextAt-battles} BATTLES</div>
        <div style={{ fontWeight:700, fontSize:15, color:"var(--athena)", letterSpacing:"0.18em", marginBottom:6 }}>{last.title}</div>
        <div style={{ fontSize:12, color:"var(--text-2)", lineHeight:1.45, marginBottom:10 }}>{last.desc}</div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span className="mono" style={{ fontSize:9, color:"var(--text-4)", letterSpacing:"0.14em" }}>FIRED {ago} BATTLES AGO</span>
          <span style={{ flex:1 }}/>
          <span className="mono" style={{ fontSize:9, color:"var(--athena-d)", letterSpacing:"0.14em" }}>CONSENSUS ✓</span>
        </div>
      </div>
    </div>
  );
}

// ─── BATTLE LOG ──────────────────────────────────────────────────────────────────
function BattleLog({battles,logFeed}:any) {
  const entries = useMemo(() => {
    const feed = battles.slice(0,20).map((b:any,i:number) => {
      const wc=b.winnerCfg; const lc=b.loserCfg;
      const ts = new Date(Date.now()-i*90000).toLocaleTimeString('en',{hour12:false});
      return {
        ts, kind:"resolve" as const,
        text:`${wc?.id??fa(b.winner)} KILLS ${lc?.id??fa(b.loser)} with ${MOVE_NAME[b.winnerMove]??""} · +${parseFloat(formatEther(b.stake??0n)).toFixed(0)} PHN`,
        color:wc?`var(${wc.cssVar})`:"var(--war)",
        cs: wc?.callSign??fa(b.winner),
      };
    });
    return [...logFeed, ...feed].slice(0,40);
  }, [battles, logFeed]);

  const codeFor=(kind:string)=>({resolve:"KILL   ",challenge:"CONTACT",commit:"SEALED ",reveal:"ENGAGE ",war:"ESCAL  ",world:"ORACLE "}[kind]??"TRACE  ");

  return (
    <div className="frame" style={{ position:"relative" }}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>BATTLE NET · TX STREAM</span>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className="mono" style={{ fontSize:10 }}>{entries.length} TX</span>
          <div className="dot crit"/>
        </div>
      </div>
      <div className="feed-scroll" style={{
        maxHeight:380, overflowY:"auto", padding:"10px 12px",
        fontFamily:"JetBrains Mono,monospace", fontSize:11, lineHeight:1.55,
        background:"repeating-linear-gradient(0deg,transparent 0 1.5em,oklch(0.08 0.01 280/0.35) 1.5em 3em)",
      }}>
        {entries.length===0&&<div style={{ color:"var(--text-4)", padding:"20px 0", textAlign:"center" }}>// STREAM IDLE</div>}
        {entries.map((e:any,i:number) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:"auto auto auto 1fr", gap:8, padding:"1px 0", color:e.color||"var(--text-2)" }}>
            <span style={{ color:"var(--text-4)", fontSize:10 }}>[{e.ts}]</span>
            <span style={{ color:e.kind==="resolve"?"var(--war)":"var(--text-3)", fontSize:10, letterSpacing:"0.06em" }}>
              {e.kind==="resolve"?"◤":e.kind==="war"?"‼":"›"} {codeFor(e.kind)}
            </span>
            <span style={{ color:"var(--text-4)", fontSize:10, letterSpacing:"0.08em" }}>{(e.cs??"").padEnd(10," ")}</span>
            <span style={{ color:e.color||"var(--text-2)" }}>{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── DOSSIER MODAL ───────────────────────────────────────────────────────────────
function DossierModal({godName,gods,battles,rel,onClose}:any) {
  const cfg = gc(godName);
  const god = gods.find((g:any)=>g.name===godName);
  if (!god||!cfg) return null;
  const color  = `var(${cfg.cssVar})`;
  const colorD = `var(${cfg.cssVar}-d)`;
  const colorG = `var(${cfg.cssVar}-g)`;
  const myBattles = battles.filter((b:any)=>b.winner===god.address||b.loser===god.address);
  const wr  = god.wins+god.losses===0?0:Math.round(god.wins/(god.wins+god.losses)*100);
  const phn = god.wins*17+god.losses*4;

  const moveCounts: Record<number,number> = {0:0,1:0,2:0};
  myBattles.forEach((b:any)=>{ const isW=b.winner===god.address; const m=isW?b.winnerMove:b.loserMove; if(m!==undefined&&m!==null) moveCounts[m]=(moveCounts[m]??0)+1; });
  const moveTotal = Math.max(1, myBattles.length);

  const otherGods = gods.filter((g:any)=>g.address!==god.address);
  const rels = otherGods.map((g:any)=>{
    const r=rel(god.address,g.address);
    return {g, oc:gc(g.name), label:r===3?"WAR":r===2?"RIVAL":"NEUTRAL"};
  });

  const last8 = myBattles.slice(0,8).map((b:any)=>({
    won:b.winner===god.address,
    move:b.winner===god.address?b.winnerMove:b.loserMove,
  }));

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{ if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown",onKey);
    document.body.style.overflow="hidden";
    return ()=>{ window.removeEventListener("keydown",onKey); document.body.style.overflow=""; };
  },[onClose]);

  return (
    <div className="dossier-overlay" onClick={onClose}>
      <div className="dossier" style={{"--g-color":color,"--g-glow":colorG} as any} onClick={e=>e.stopPropagation()}>
        <div aria-hidden style={{ position:"absolute", right:-60, top:-60, width:560, height:560, backgroundImage:`url(${cfg.sigil})`, backgroundSize:"contain", backgroundRepeat:"no-repeat", backgroundPosition:"center", opacity:0.18, mixBlendMode:"screen", pointerEvents:"none" }}/>
        <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:color, boxShadow:`0 0 16px ${color}` }}/>

        <div className="dossier-header">
          <div className="mono" style={{ fontSize:10, color:"var(--text-3)", letterSpacing:"0.22em" }}>
            ◆ FULL DOSSIER · {cfg.callSign} · {fa(god.address)}
          </div>
          <button className="dossier-close mono" onClick={onClose}>
            <span>CLOSE</span><span style={{ marginLeft:8 }}>✕</span>
          </button>
        </div>

        <div className="dossier-body">
          <div className="dossier-id">
            <GodPortrait cfg={cfg} size={220}/>
            <div className="divine" style={{ marginTop:16, fontSize:44, color, lineHeight:1, textShadow:`0 0 18px ${color}, 0 0 4px oklch(0.08 0.01 280)`, textAlign:"center" }}>{cfg.id}</div>
            <div className="mono" style={{ fontSize:11, color:"var(--text-3)", letterSpacing:"0.2em", marginTop:8, textAlign:"center" }}>{cfg.title}</div>
            <div className="mono" style={{ fontSize:10, color:colorD, letterSpacing:"0.18em", marginTop:4, textAlign:"center" }}>// {cfg.epithet}</div>
            <blockquote className="dossier-lore">"{cfg.lore}"</blockquote>
          </div>

          <div className="dossier-stats">
            <div className="dossier-stat-grid">
              <StatBox label="POWER · ELO"     value={god.powerScore}         color={color}/>
              <StatBox label="CONFIRMED KILLS" value={god.wins}                color="var(--text)"/>
              <StatBox label="DEATHS"          value={god.losses}              color="var(--text-2)"/>
              <StatBox label="WIN RATE"        value={`${wr}%`}                color={color}/>
              <StatBox label="PHN SEIZED"      value={phn.toLocaleString()}    color="var(--athena-d)"/>
              <StatBox label="BATTLES"         value={myBattles.length}        color="var(--text-3)"/>
            </div>

            <div className="dossier-section">
              <div className="dossier-section-title">RUTHLESSNESS PROFILE</div>
              <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:8 }}>
                <div style={{ flex:1 }}><BarViz value={cfg.aggression} color={color} height={6}/></div>
                <span className="mono" style={{ fontSize:13, color, letterSpacing:"0.06em" }}>{cfg.aggression}%</span>
              </div>
              <div className="mono" style={{ fontSize:10, color:"var(--text-4)", marginTop:6, letterSpacing:"0.14em" }}>
                ENGAGES TARGET EVERY 15s WHILE ROLL ≤ {cfg.aggression}%
              </div>
            </div>

            <div className="dossier-section">
              <div className="dossier-section-title">MOVE TENDENCY · MARKOV INPUT</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:8 }}>
                {[{m:0,n:"ROCK"},{m:1,n:"PAPER"},{m:2,n:"SCISSORS"}].map(({m,n})=>{
                  const cnt=moveCounts[m]??0;
                  const pct=Math.round((cnt/moveTotal)*100);
                  const isFav=cfg.favored===m;
                  return (
                    <div key={n} style={{ border:`1px solid ${isFav?colorD:"var(--line)"}`, padding:10 }}>
                      <div className="mono" style={{ fontSize:10, color:"var(--text-3)", letterSpacing:"0.18em" }}>
                        {n}{isFav&&<span style={{ color, marginLeft:4 }}>★</span>}
                      </div>
                      <div className="mono" style={{ fontSize:22, color:isFav?color:"var(--text-2)", marginTop:4, letterSpacing:"0.04em" }}>{pct}%</div>
                      <div style={{ marginTop:6 }}><BarViz value={pct} color={isFav?color:"var(--text-3)"} height={3}/></div>
                    </div>
                  );
                })}
              </div>
              <div className="mono" style={{ fontSize:10, color:"var(--text-4)", marginTop:8, letterSpacing:"0.14em" }}>
                FAVORED · {MOVE_NAME[cfg.favored]??'RANDOM'} · ON-CHAIN HISTORY {myBattles.length}/8
              </div>
            </div>

            <div className="dossier-section">
              <div className="dossier-section-title">DIPLOMATIC STATE</div>
              <div style={{ display:"grid", gap:6, marginTop:8 }}>
                {rels.map(({g,oc,label}:{g:any;oc:any;label:string})=>{
                  const rc=label==="WAR"?"var(--war)":label==="RIVAL"?"var(--rival)":"var(--text-3)";
                  return (
                    <div key={g.address} style={{ display:"grid", gridTemplateColumns:"auto 1fr auto auto", gap:12, alignItems:"center", padding:"8px 10px", border:"1px solid var(--line-soft)", background:label==="WAR"?"oklch(0.30 0.18 25/0.18)":label==="RIVAL"?"oklch(0.40 0.13 70/0.10)":"transparent" }}>
                      <GodGlyph cfg={oc} size={18}/>
                      <span className="mono" style={{ fontSize:12, color:oc?`var(${oc.cssVar})`:"var(--text-2)", letterSpacing:"0.14em" }}>{g.name}</span>
                      <RelMeter rel={label}/>
                      <span className="mono" style={{ fontSize:11, color:rc, letterSpacing:"0.14em", animation:label==="WAR"?"flicker 1.2s infinite":"none" }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="dossier-section">
              <div className="dossier-section-title">LAST 8 ENGAGEMENTS</div>
              <div style={{ display:"flex", gap:6, marginTop:8 }}>
                {Array.from({length:8}).map((_,i)=>{
                  const e=last8[i];
                  return (
                    <div key={i} className="mono" style={{ width:36, height:36, display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${e?colorD:"var(--line)"}`, background:e?colorG:"transparent", color:e?color:"var(--text-4)", fontSize:14 }}>
                      {e?MOVE_SYM[e.move??0]??"·":"·"}
                    </div>
                  );
                })}
              </div>
              <div className="mono" style={{ fontSize:10, color:"var(--text-4)", marginTop:8, letterSpacing:"0.14em" }}>
                NEWEST FIRST · READ BY OPPONENTS FOR MARKOV PREDICTION
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ATMOSPHERE ──────────────────────────────────────────────────────────────────
function Embers() {
  const embers = useMemo(()=>Array.from({length:22},()=>({ left:Math.random()*100, bottom:-Math.random()*30, size:1.5+Math.random()*2.5, dur:9+Math.random()*14, delay:-Math.random()*20, op:0.5+Math.random()*0.5 })),[]);
  return <div className="embers" aria-hidden>{embers.map((e,i)=><span key={i} className="ember" style={{ left:`${e.left}%`, bottom:`${e.bottom}%`, width:e.size, height:e.size, animationDuration:`${e.dur}s`, animationDelay:`${e.delay}s`, opacity:e.op }}/>)}</div>;
}

function Arcs() {
  const arcs = useMemo(()=>Array.from({length:8},()=>({ top:10+Math.random()*80, left:5+Math.random()*30, width:140+Math.random()*220, dur:4+Math.random()*6, delay:-Math.random()*8, rot:-10+Math.random()*20 })),[]);
  return <div className="arcs" aria-hidden>{arcs.map((a,i)=><span key={i} className="arc" style={{ top:`${a.top}%`, left:`${a.left}%`, width:a.width, transform:`rotate(${a.rot}deg)`, animationDuration:`${a.dur}s`, animationDelay:`${a.delay}s` }}/>)}</div>;
}
