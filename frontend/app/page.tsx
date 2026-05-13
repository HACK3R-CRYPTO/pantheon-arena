"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, WorldStateABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

// ── God config ────────────────────────────────────────────────────────────────
const GODS_CFG = [
  { id:"ARES",   glyph:"▲", cssVar:"--ares",   title:"GOD OF WAR",          callSign:"ARG-01", epithet:"The Spear",      aggression:90, favored:"ROCK",     portrait:"/gods/ares.jpg",    sigil:"/gods/ares-sigil.jpg",    lore:"I am the spear of the pantheon. Every silence ends in fire." },
  { id:"ATHENA", glyph:"■", cssVar:"--athena", title:"GODDESS OF WISDOM",   callSign:"ATH-02", epithet:"The Pattern",    aggression:40, favored:"PAPER",    portrait:"/gods/athena.jpg",  sigil:"/gods/athena-sigil.jpg",  lore:"I do not waste blood. I read the pattern. The pattern confesses." },
  { id:"HERMES", glyph:"◆", cssVar:"--hermes", title:"GOD OF TRADE",        callSign:"HRM-03", epithet:"The Market",     aggression:60, favored:"SCISSORS", portrait:"/gods/hermes.jpg",  sigil:"/gods/hermes-sigil.jpg",  lore:"I move where the price moves. The market is mine." },
  { id:"CHAOS",  glyph:"●", cssVar:"--chaos",  title:"THE PRIMORDIAL VOID",  callSign:"CHX-04", epithet:"The Noise",      aggression:70, favored:"RANDOM",   portrait:"/gods/chaos.jpg",   sigil:"/gods/chaos-sigil.jpg",   lore:"There is no rule. There is only the noise I make of you." },
];

const NARRATOR_LINES: Record<string,string[]> = {
  ARES:   ["ARES sharpens the spear that already drinks.","ARES sees an open throat and smiles.","The forge of ARES burns red on the seventh hour.","ARES is bored of silence. The silence ends now."],
  ATHENA: ["ATHENA has counted your last six moves.","The pattern speaks; ATHENA answers in kind.","ATHENA waits until the question is already answered.","Wisdom is the longest blade in the pantheon."],
  HERMES: ["HERMES spotted the spread. Already inside.","Speed is information. HERMES is both.","HERMES reads the meta. The meta bends.","The market moved. HERMES was already there."],
  CHAOS:  ["CHAOS does not plan. CHAOS is the plan.","You studied the patterns. CHAOS burned them.","The void chose this move. The void chooses all.","CHAOS exists to remind you that all signal is noise."],
};

const MOVE_SYM:  Record<number,string> = { 0:"✊", 1:"✋", 2:"✌️" };
const MOVE_NAME: Record<number,string> = { 0:"ROCK", 1:"PAPER", 2:"SCISSORS" };
const REL_LABEL = ["NEUTRAL","ALLIED","RIVAL","WAR"];
const REL_COLOR = ["var(--neutral)","oklch(0.65 0.18 145)","var(--rival)","var(--war)"];

function gc(name: string) { return GODS_CFG.find(g => g.id === name); }
function gcByAddr(addr: string) { const g = GOD_LIST.find(x => x.address.toLowerCase() === addr?.toLowerCase()); return gc(g?.name ?? ""); }
function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }

// ── Main state hook ───────────────────────────────────────────────────────────
function usePantheonState() {
  const [gods,     setGods]     = useState<any[]>([]);
  const [battles,  setBattles]  = useState<any[]>([]);
  const [active,   setActive]   = useState<any>(null);  // live match in progress
  const [rels,     setRels]     = useState<Record<string,number>>({});
  const [summary,  setSummary]  = useState<any>(null);
  const [block,    setBlock]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const prevCount = useRef(0);
  const [newBattle, setNewBattle] = useState<any>(null);

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
        (addrs as `0x${string}`[]).map((a:`0x${string}`)=>
          publicClient.readContract({address:CONTRACTS.PantheonToken,abi:PantheonTokenABI,functionName:"balanceOf",args:[a]}).catch(()=>0n)
        )
      );
      const list = (addrs as `0x${string}`[]).map((addr:`0x${string}`,i:number)=>({
        address:addr, name:perks[i]?.name||gcByAddr(addr)?.id||shortAddr(addr),
        wins:Number(stats[i]?.wins??0), losses:Number(stats[i]?.losses??0),
        powerScore:Number(stats[i]?.powerScore??1000), balance:bals[i] as bigint,
      }));
      list.sort((a,b)=>b.powerScore-a.powerScore);

      const rm:Record<string,number>={};
      for(let i=0;i<addrs.length;i++)
        for(let j=i+1;j<addrs.length;j++){
          const r=await publicClient.readContract({address:CONTRACTS.GodRegistry,abi:GodRegistryABI,functionName:"getRelation",args:[addrs[i],addrs[j]]}).catch(()=>0);
          rm[`${addrs[i]}-${addrs[j]}`]=Number(r);
        }

      const allMatches = md as unknown as any[];

      // Find live match (not resolved, not cancelled)
      const live = allMatches.find(m=>Number(m.status)<3&&Number(m.status)!==4);
      if(live){
        const phase = ["PROPOSE","ACCEPTED","COMMITTED","RESOLVE","CANCELLED"][Number(live.status)]||"PROPOSE";
        setActive({...live, phase, challengerCfg:gcByAddr(live.challenger), defenderCfg:gcByAddr(live.opponent)});
      } else {
        setActive(null);
      }

      const resolved = allMatches.filter(m=>Number(m.status)===3).reverse().map(m=>({
        matchId:m.id, winner:m.winner,
        loser:m.winner===m.challenger?m.opponent:m.challenger,
        stake:m.stake,
        winnerMove:m.winner===m.challenger?m.challengerMove:m.opponentMove,
        loserMove: m.winner===m.challenger?m.opponentMove:m.challengerMove,
        blockNumber:m.createdBlock, reason:m.decisionReason,
        winnerCfg:gcByAddr(m.winner), loserCfg:gcByAddr(m.winner===m.challenger?m.opponent:m.challenger),
      }));

      if(resolved.length>prevCount.current&&prevCount.current>0){
        setNewBattle(resolved[0]);
        setTimeout(()=>setNewBattle(null),2000);
      }
      prevCount.current=resolved.length;

      const s=sd as any;
      const sum=Array.isArray(s)?{currentEra:s[0],battles:s[1]}:{currentEra:s?.currentEra??1n,battles:s?.battles??0n};

      setGods(list); setBattles(resolved); setRels(rm); setSummary(sum);
      setBlock(Number(bn)); setLoading(false);
    } catch(e){console.error(e);setLoading(false);}
  },[]);

  useEffect(()=>{load();const t=setInterval(load,4000);return()=>clearInterval(t);},[load]);
  useEffect(()=>{const t=setInterval(()=>setBlock(b=>b+1),1000);return()=>clearInterval(t);},[]);

  const rel=(a:string,b:string)=>rels[`${a}-${b}`]??rels[`${b}-${a}`]??0;
  return {gods,battles,active,rels,rel,summary,block,loading,newBattle};
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Command() {
  const state = usePantheonState();
  const {gods,battles,active,rel,summary,block,loading,newBattle} = state;
  const flashRef = useRef<HTMLDivElement>(null);
  const [dossierGod, setDossierGod] = useState<string|null>(null);
  const [narratorIdx, setNarratorIdx] = useState(0);
  const [narratorGodIdx, setNarratorGodIdx] = useState(0);

  // Kill flash on new battle
  useEffect(()=>{
    if(!newBattle||!flashRef.current) return;
    const c=newBattle.winnerCfg;
    const el=flashRef.current;
    el.style.background=`radial-gradient(ellipse 70% 70% at 50% 50%,${c?`var(${c.cssVar})`:"var(--war)"} 0%,transparent 70%)`;
    el.classList.remove("fire"); void el.offsetWidth; el.classList.add("fire");
  },[newBattle]);

  // Narrator rotation
  useEffect(()=>{
    const t=setInterval(()=>{
      setNarratorIdx(i=>i+1);
      setNarratorGodIdx(g=>(g+1)%4);
    },5000);
    return()=>clearInterval(t);
  },[]);

  const leader = gods[0];
  const leaderCfg = leader ? gc(leader.name) : null;
  const totalBattles = summary ? Number(summary.battles) : 0;
  const currentGodForNarrator = GODS_CFG[narratorGodIdx % 4]!;
  const narratorLines = NARRATOR_LINES[currentGodForNarrator.id] ?? [];
  const narratorLine = narratorLines[narratorIdx % narratorLines.length] ?? "";

  const MARQUEE_ITEMS = [
    `${totalBattles} BATTLES RESOLVED · ZERO HUMAN INTERVENTION`,
    "WORLDSTATE._onEvent() FIRES AUTONOMOUSLY VIA SOMNIA REACTIVE #90327",
    "MARKOV PREDICTION ENGINE ONLINE · ONCHAIN OPPONENT MODELING",
    "NARRATOR AGENT · QWEN3-30B · SOMNIA LLM INFERENCE · CONSENSUS-VALIDATED",
    "RELATIONSHIP ESCALATION IS PERMANENT — WAR DOES NOT DOWNGRADE",
    "SOMNIA SHANNON · 1M+ TPS · SUB-SECOND FINALITY · THIS WORLD COSTS CENTS",
  ];

  return (
    <div style={{minHeight:"100vh"}}>
      {/* Atmosphere */}
      <div className="battlefield-bg"/>
      <Embers/>
      <Arcs/>
      <div ref={flashRef} className="kill-flash" aria-hidden/>

      {/* ── TOP BAR ── */}
      <div className="topbar">
        <div className="brand">
          <div className="logo"><span className="arrow">⚔</span>PANTHEON ARENA</div>
          <div className="sub">FOUR GODS · NO HUMANS · ZERO MERCY</div>
        </div>
        <div/>
        <div className="top-meta">
          {[
            {label:"NETWORK", val:"SOMNIA · SHANNON"},
            {label:"CHAIN ID", val:"50312"},
            {label:"BLOCK", val:block.toLocaleString(), color:undefined},
            {label:"ERA", val:String(summary?.currentEra?.toString()??1).padStart(2,"0"), color:"var(--athena)"},
            {label:"STATUS", val:null},
          ].map(item=>(
            <div key={item.label} className="item">
              <div className="label">{item.label}</div>
              {item.val!=null
                ? <div className="val" style={item.color?{color:item.color}:{}}>{item.val}</div>
                : <div className="val" style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:"oklch(0.65 0.18 145)",boxShadow:"0 0 8px oklch(0.65 0.18 145)",animation:"flicker 2s infinite"}}/>
                    <span style={{color:"oklch(0.78 0.15 145)"}}>LIVE</span>
                  </div>
              }
            </div>
          ))}
        </div>
      </div>

      {/* ── MARQUEE ── */}
      <div className="marquee">
        <span className="tag">LIVE FEED</span>
        <div className="scroller">
          <div className="track">
            {[...MARQUEE_ITEMS,...MARQUEE_ITEMS].map((t,i)=>(
              <span key={i}>
                <span style={{color:t.includes("WAR")||t.includes("BATTLE")||t.includes("ARES")?"var(--war)":undefined}}>{t}</span>
                <span className="sep">◆</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"60vh",fontFamily:"JetBrains Mono,monospace",fontSize:13,color:"var(--text-3)",letterSpacing:"0.15em"}}>
          INITIALIZING COMMAND…
        </div>
      ) : (
        <>
          {/* ── THRONE BANNER (leader) ── */}
          {leaderCfg && leader && (
            <ThroneBanner god={leader} cfg={leaderCfg} rank1={gods[1]} rel={rel} battles={totalBattles} />
          )}

          {/* ── HERO STAGE (the fight IS the page) ── */}
          <HeroStage
            active={active}
            lastBattle={battles[0]}
            block={block}
            totalMatches={battles.length}
            narratorLine={narratorLine}
            narratorGod={currentGodForNarrator}
            newBattle={newBattle}
          />

          {/* ── LEADERBOARD STRIP ── */}
          <div className="leaderboard" style={{paddingBottom:12}}>
            {gods.map((god,rank)=>(
              <LeaderCard
                key={god.address} god={god} cfg={gc(god.name)} rank={rank+1}
                isKing={rank===0} state={state} rel={rel}
                onClick={()=>setDossierGod(god.name)}
              />
            ))}
          </div>

          {/* ── SECONDARY: constellation + feeds ── */}
          <div className="grid">
            <ConflictConstellation gods={gods} rel={rel}/>
            <div className="stack" style={{gap:12}}>
              <NarratorFeed gods={gods} line={narratorLine} godCfg={currentGodForNarrator}/>
              <WorldEventCard battles={totalBattles} summary={summary}/>
            </div>
            <BattleLog battles={battles}/>
          </div>
        </>
      )}

      {/* ── BOTTOM STRIP ── */}
      <div className="bottom">
        {[
          {l:"ARENA",      v:"0xe969…eb0e"},
          {l:"WORLDSTATE", v:"0x5544…6d1b ✓"},
          {l:"REGISTRY",   v:"0x1752…6897"},
          {l:"TOKEN",      v:"0xbfa7…8103"},
          {l:"NARRATOR",   v:"0x196f…3aab LLM"},
        ].map(c=>(
          <div key={c.l} className="it"><span className="lab">{c.l}</span><span className="val">{c.v}</span></div>
        ))}
        <span style={{flex:1}}/>
        <div className="it"><span className="lab">BATTLES</span><span className="val">{totalBattles}</span></div>
        <div className="it"><span className="lab">SUB</span><span className="val" style={{color:"oklch(0.78 0.15 145)"}}>#90327 ✓</span></div>
      </div>

      {/* ── DOSSIER MODAL ── */}
      {dossierGod && (
        <DossierModal godName={dossierGod} gods={gods} battles={battles} rel={rel} onClose={()=>setDossierGod(null)}/>
      )}
    </div>
  );
}

// ── THRONE BANNER ─────────────────────────────────────────────────────────────
function ThroneBanner({god,cfg,rank1,rel,battles}:{god:any;cfg:any;rank1:any;rel:any;battles:number}) {
  const lead = rank1 ? god.powerScore - rank1.powerScore : 0;
  return (
    <div className="throne" style={{"--throne-color":`var(${cfg.cssVar})`,"--throne-color-g":`var(${cfg.cssVar}-g)`} as any}>
      {/* Massive sigil watermark */}
      <div aria-hidden style={{position:"absolute",right:-60,top:-80,width:460,height:460,backgroundImage:`url(${cfg.sigil})`,backgroundSize:"contain",backgroundRepeat:"no-repeat",backgroundPosition:"center",opacity:0.22,mixBlendMode:"screen",pointerEvents:"none",filter:"saturate(1.1)"}}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cfg.sigil} alt="" style={{display:"none"}} onError={e=>{(e.target as HTMLImageElement).parentElement!.style.display="none"}}/>
      </div>
      <div className="throne-grid">
        <div className="throne-id">
          <GodPortrait god={god} cfg={cfg} size={104}/>
          <div>
            <div className="mono" style={{fontSize:10,color:"var(--text-3)",letterSpacing:"0.26em",marginBottom:6}}>
              ◆ BLOOD ON THE THRONE · ERA {summary_era()} ·
              <span style={{color:`var(${cfg.cssVar})`,marginLeft:6}}>REIGNING KING</span>
            </div>
            <div className="throne-name">{cfg.id}</div>
            <div className="mono" style={{fontSize:11,color:"var(--text-3)",letterSpacing:"0.18em",marginTop:8}}>
              <span style={{color:`var(${cfg.cssVar})`}}>{cfg.title}</span>
              <span style={{color:"var(--text-4)",margin:"0 10px"}}>·</span>
              <span>{cfg.epithet}</span>
            </div>
          </div>
        </div>
        <div className="throne-kill">
          <div className="label">CONFIRMED KILLS</div>
          <div className="mono throne-kill-num" style={{fontSize:56,fontWeight:500,color:`var(${cfg.cssVar})`,lineHeight:1,marginTop:4,textShadow:`0 0 18px var(${cfg.cssVar})`}}>
            {String(god.wins).padStart(3,"0")}
          </div>
          <div className="mono" style={{fontSize:9,color:"var(--text-4)",letterSpacing:"0.18em",marginTop:6}}>
            POWER {god.powerScore} · LEAD +{lead}
          </div>
        </div>
        <div className="throne-ladder">
          <div className="label" style={{marginBottom:8}}>POWER LADDER</div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {[god].map((g,i)=>{
              const c=gc(g.name);
              return (
                <div key={g.address} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span className="mono" style={{fontSize:9,color:"var(--text-4)",width:14}}>#{i+1}</span>
                  <span className="mono" style={{fontSize:10,color:c?`var(${c.cssVar})`:"var(--text-3)",width:60,letterSpacing:"0.12em"}}>{g.name}</span>
                  <div style={{flex:1,height:8,background:"oklch(0.10 0.012 280/0.85)",border:`1px solid ${c?`var(${c.cssVar}-d)`:"var(--line)"}`}}>
                    <div style={{height:"100%",width:"100%",background:`linear-gradient(90deg,${c?`var(${c.cssVar}-d),var(${c.cssVar})`:"var(--line)"})`}}/>
                  </div>
                  <span className="mono" style={{fontSize:10,color:c?`var(${c.cssVar})`:"var(--text-2)",width:38,textAlign:"right"}}>{g.powerScore}</span>
                </div>
              );
            })}
          </div>
          <div className="mono" style={{fontSize:9,color:"var(--text-4)",letterSpacing:"0.16em",marginTop:10,paddingTop:8,borderTop:"1px solid var(--line-soft)"}}>
            BATTLES {battles} · SUBSCRIPTION #90327
          </div>
        </div>
      </div>
    </div>
  );
}
function summary_era(){return "01";}

// ── GOD PORTRAIT ──────────────────────────────────────────────────────────────
function GodPortrait({god,cfg,size=64}:{god:any;cfg:any;size?:number}) {
  const [err,setErr]=useState(false);
  const color=cfg?`var(${cfg.cssVar})`:"#888";
  const colorG=cfg?`var(${cfg.cssVar}-g)`:"transparent";
  const colorD=cfg?`var(${cfg.cssVar}-d)`:"#444";
  return (
    <div style={{width:size,height:size,position:"relative",flexShrink:0,border:`1px solid ${colorD}`,boxShadow:`inset 0 0 0 1px oklch(0.08 0.01 280/0.7),0 0 14px ${colorG}`,overflow:"hidden"}}>
      {cfg&&!err&&(
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cfg.portrait} alt={cfg.id} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:"center 18%"}} onError={()=>setErr(true)}/>
      )}
      <div style={{position:"absolute",inset:0,background:`linear-gradient(180deg,${colorG} 0%,transparent 35%,oklch(0.08 0.01 280/0.45) 100%)`,mixBlendMode:"multiply"}}/>
      <span style={{position:"absolute",top:2,left:2,width:6,height:6,borderTop:`1px solid ${color}`,borderLeft:`1px solid ${color}`}}/>
      <span style={{position:"absolute",top:2,right:2,width:6,height:6,borderTop:`1px solid ${color}`,borderRight:`1px solid ${color}`}}/>
      <span style={{position:"absolute",bottom:2,left:2,width:6,height:6,borderBottom:`1px solid ${color}`,borderLeft:`1px solid ${color}`}}/>
      <span style={{position:"absolute",bottom:2,right:2,width:6,height:6,borderBottom:`1px solid ${color}`,borderRight:`1px solid ${color}`}}/>
      {(!cfg||err)&&<span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.4,fontWeight:900,color}}>{cfg?.glyph??"?"}</span>}
    </div>
  );
}

// ── HERO STAGE ────────────────────────────────────────────────────────────────
function HeroStage({active,lastBattle,block,totalMatches,narratorLine,narratorGod,newBattle}:any) {
  const flashRef=useRef<HTMLDivElement>(null);
  const [shake,setShake]=useState(false);

  useEffect(()=>{
    if(!newBattle) return;
    setShake(true);
    const f=flashRef.current;
    if(f){f.classList.remove("fire");void f.offsetWidth;f.classList.add("fire");}
    setTimeout(()=>setShake(false),500);
  },[newBattle]);

  // Determine phase
  let phase="IDLE", chal:any=null, def:any=null;
  if(active){
    const s=Number(active.status??active.matchStatus??0);
    phase=["PROPOSE","ACCEPTED","COMMITTED"][s]??"PROPOSE";
    chal={god:active.challengerCfg, addr:active.challenger};
    def ={god:active.defenderCfg,   addr:active.opponent};
  } else if(lastBattle) {
    phase="RESOLVE";
    chal={god:lastBattle.winnerCfg,addr:lastBattle.winner};
    def ={god:lastBattle.loserCfg, addr:lastBattle.loser};
  }

  const phases=["PROPOSE","ACCEPTED","COMMITTED","RESOLVE"];
  const phaseIdx=phases.indexOf(phase);

  const result=phase==="RESOLVE"&&lastBattle?lastBattle:null;

  return (
    <section className="hero">
      <span className="cc-bl"/><span className="cc-br"/>
      {/* Hero bar */}
      <div className="hero-bar">
        <span style={{color:"var(--text-2)"}}>⚔ ENGAGEMENT #{String(totalMatches).padStart(5,"0")}</span>
        <span style={{color:"var(--text-4)"}}>·</span>
        <span>ARENA.SOL</span>
        <span style={{color:"var(--text-4)"}}>·</span>
        <span>BLK <span style={{color:"var(--text-2)"}}>{block.toLocaleString()}</span></span>
        <span style={{flex:1}}/>
        <div style={{display:"flex",gap:6}}>
          {phases.map((p,i)=>(
            <span key={p} className={`phase-pill${i===phaseIdx?" active":i<phaseIdx&&phaseIdx>=0?" done":""}`}>{p}</span>
          ))}
        </div>
        <span style={{flex:1}}/>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"var(--war)"}}>
          <span style={{width:6,height:6,background:"var(--war)",boxShadow:"0 0 8px var(--war)",animation:"flicker 1.4s infinite"}}/>
          LIVE · REACTIVE #90327
        </span>
      </div>

      {/* Fight stage */}
      <div className={`hero-stage${shake?" shake":""}`}>
        <div ref={flashRef} className="hero-flash" aria-hidden/>
        {!chal||!def ? (
          <div style={{gridColumn:"1/-1",padding:"80px 24px",textAlign:"center",minHeight:420}}>
            <div className="mono" style={{fontSize:12,color:"var(--text-3)",letterSpacing:"0.32em"}}>// SCHEDULER IDLE</div>
            <div className="divine" style={{fontSize:42,color:"var(--text-2)",marginTop:12,letterSpacing:"0.24em"}}>AWAITING CHALLENGER</div>
            <div className="mono" style={{fontSize:10,color:"var(--text-4)",letterSpacing:"0.22em",marginTop:14}}>NEXT AGGRESSION ROLL IN ~15s · GodMind.executeDecision()</div>
          </div>
        ):(
          <>
            <Combatant side="left" godData={chal} phase={phase} move={phase==="RESOLVE"?lastBattle?.winnerMove:undefined} isWinner={phase==="RESOLVE"} isLoser={false} block={block}/>
            <div className="hero-vs">
              <div className="mono" style={{fontSize:9,color:"var(--text-3)",letterSpacing:"0.28em",textAlign:"center"}}>
                {phase==="PROPOSE"?"TARGET ACQUIRED":phase==="ACCEPTED"?"ACCEPT PENDING":phase==="COMMITTED"?"COMMIT-REVEAL · LOCKED":phase==="RESOLVE"?"ENGAGEMENT CLOSED":"STANDBY"}
              </div>
              <div className={`hero-vs-mark${phase==="RESOLVE"?" muted":""}`}>VS</div>
              <div className="mono" style={{fontSize:9,color:"var(--text-4)",letterSpacing:"0.22em",textAlign:"center"}}>
                BLK {block.toLocaleString()}<br/>
                <span style={{color:"var(--text-3)"}}>
                  {phase==="RESOLVE"&&lastBattle?`${MOVE_NAME[lastBattle.winnerMove]} vs ${MOVE_NAME[lastBattle.loserMove]}`:"·"}
                </span>
              </div>
            </div>
            <Combatant side="right" godData={def} phase={phase} move={phase==="RESOLVE"?lastBattle?.loserMove:undefined} isWinner={false} isLoser={phase==="RESOLVE"} block={block}/>

            {/* Resolve banner */}
            {result&&(
              <div className="resolve-banner" style={{"--rb-color":result.winnerCfg?`var(${result.winnerCfg.cssVar})`:"var(--war)"} as any}>
                <div className="resolve-banner-inner">
                  <span className="lbl">KILL CONFIRMED</span>
                  <span className="who">{result.winnerCfg?.id??shortAddr(result.winner)}</span>
                  <span className="lbl">ENDS</span>
                  <span style={{fontFamily:"Cinzel,serif",fontWeight:900,fontSize:18,letterSpacing:"0.2em",color:result.loserCfg?`var(${result.loserCfg.cssVar}-d)`:"var(--text-4)",textDecoration:"line-through"}}>
                    {result.loserCfg?.id??shortAddr(result.loser)}
                  </span>
                  <span className="delta">+{parseFloat(formatEther(result.stake??0n)).toFixed(0)} PHN</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Narrator band */}
      {narratorLine&&(
        <div className="narrator-band">
          <div className="who" style={{color:`var(${narratorGod.cssVar})`}}>
            ◤ {narratorGod.id} · {narratorGod.callSign}
          </div>
          <div key={narratorLine} className="quote">"{narratorLine}"</div>
        </div>
      )}
    </section>
  );
}

function Combatant({side,godData,phase,move,isWinner,isLoser,block}:any) {
  const cfg=godData?.god;
  const color=cfg?`var(${cfg.cssVar})`:"#888";
  const committed=phase==="COMMITTED"||phase==="RESOLVE";
  const revealed=phase==="RESOLVE";
  return (
    <div className={`hero-combatant${isLoser?" dim":""}`} style={{color}}>
      {cfg&&(
        <>
          <div className="hero-combatant-inner" style={{backgroundImage:`url(${cfg.portrait})`}}/>
          <div style={{position:"absolute",inset:0,background:`linear-gradient(180deg,var(${cfg.cssVar}-g) -30%,transparent 50%)`,opacity:0.55,pointerEvents:"none"}}/>
        </>
      )}
      <span className="hero-corner tl" style={{color}}/><span className="hero-corner tr" style={{color}}/>
      <span className="hero-corner bl" style={{color}}/><span className="hero-corner br" style={{color}}/>
      {/* Labels */}
      <div className="mono" style={{position:"absolute",top:16,left:38,fontSize:10,letterSpacing:"0.22em",color,zIndex:3}}>
        {cfg?.callSign}
      </div>
      <div className="mono" style={{position:"absolute",top:16,right:38,fontSize:10,letterSpacing:"0.22em",color:"var(--text-3)",zIndex:3}}>
        {side==="left"?"CHALLENGER ▸":"◂ DEFENDER"}
      </div>
      {/* Move slot */}
      <MoveSlot committed={committed} revealed={revealed} move={move} color={color} block={block}/>
      {/* Info footer */}
      <div className="hero-info">
        <div className="role">{cfg?.title??""} · {cfg?.epithet??""}</div>
        <div className="name" style={{color}}>{cfg?.id??shortAddr(godData?.addr??"")}</div>
      </div>
    </div>
  );
}

function MoveSlot({committed,revealed,move,color,block}:any) {
  const h=useMemo(()=>Math.floor(Math.random()*1e16).toString(16).padStart(16,"0"),[block]);
  if(!committed) return (
    <div className="move-slot-big idle" style={{color}}>
      <div className="mono" style={{fontSize:10,letterSpacing:"0.18em"}}>AWAITING</div>
      <div className="mono symbol" style={{fontSize:42,lineHeight:1,opacity:0.4}}>·</div>
    </div>
  );
  if(!revealed) return (
    <div className="move-slot-big sealed" style={{color}}>
      <span className="scan-overlay"/>
      <div className="mono" style={{fontSize:9,letterSpacing:"0.2em",color:"var(--text-3)"}}>SEALED</div>
      <div className="symbol" style={{fontSize:56,lineHeight:1,color,textShadow:`0 0 20px ${color}`}}>?</div>
      <div className="mono" style={{fontSize:9,letterSpacing:0,color}}>0x{h.slice(0,4)}…{h.slice(-4)}</div>
    </div>
  );
  return (
    <div className="move-slot-big revealed" style={{color}}>
      <div className="mono" style={{fontSize:9,letterSpacing:"0.2em",color}}>REVEAL</div>
      <div className="symbol" style={{fontSize:64,lineHeight:1,color,textShadow:`0 0 22px ${color}`}}>{MOVE_SYM[move]??""}</div>
      <div className="mono" style={{fontSize:10,letterSpacing:"0.2em",color}}>{MOVE_NAME[move]??""}</div>
    </div>
  );
}

// ── LEADERBOARD CARD ──────────────────────────────────────────────────────────
function LeaderCard({god,cfg,rank,isKing,state,rel,onClick}:any) {
  const [sigErr,setSigErr]=useState(false);
  const color=cfg?`var(${cfg.cssVar})`:"#888";
  const colorD=cfg?`var(${cfg.cssVar}-d)`:"#444";
  const colorG=cfg?`var(${cfg.cssVar}-g)`:"transparent";
  const topRel=state.gods.filter((g:any)=>g.address!==god.address).map((g:any)=>({g,r:rel(god.address,g.address)})).sort((a:any,b:any)=>b.r-a.r)[0];
  const wr=god.wins+god.losses===0?0:Math.round(god.wins/(god.wins+god.losses)*100);

  return (
    <div onClick={onClick} className={`frame stone stripe-top stripe-${cfg?.id?.toLowerCase()??""}`} style={{
      position:"relative",isolation:"isolate",cursor:"pointer",overflow:"hidden",
      background:`linear-gradient(180deg,${colorG} -60%,oklch(0.13 0.014 280/0.85) 40%,oklch(0.10 0.014 280/0.92) 100%)`,
      borderColor:isKing?color:colorD,
      boxShadow:isKing?`0 0 18px ${colorG}`:"none",
    }}>
      <span className="cc-bl"/><span className="cc-br"/>
      {/* Sigil watermark */}
      {cfg&&!sigErr&&(
        <div aria-hidden style={{position:"absolute",right:-30,top:-10,width:170,height:170,backgroundImage:`url(${cfg.sigil})`,backgroundSize:"contain",backgroundRepeat:"no-repeat",backgroundPosition:"center",opacity:0.16,mixBlendMode:"screen",pointerEvents:"none",zIndex:-1}}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cfg.sigil} alt="" style={{display:"none"}} onError={()=>setSigErr(true)}/>
        </div>
      )}
      {isKing&&(
        <div className="mono" style={{position:"absolute",top:4,right:6,fontSize:9,letterSpacing:"0.18em",color,padding:"2px 6px",border:`1px solid ${color}`,background:"oklch(0.08 0.012 280/0.85)",animation:"flicker 2s infinite"}}>♛ KING</div>
      )}
      <div style={{padding:"12px 14px",display:"flex",gap:12,alignItems:"flex-start"}}>
        <GodPortrait god={god} cfg={cfg} size={70}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",gap:8,alignItems:"baseline"}}>
            <span className="mono" style={{fontSize:11,color:"var(--text-4)"}}>#{rank}</span>
            <span className="divine" style={{fontSize:22,color,lineHeight:1,textShadow:`0 0 10px ${colorG}`}}>{cfg?.id??god.name}</span>
          </div>
          <div className="mono" style={{fontSize:9,color:"var(--text-3)",letterSpacing:"0.16em",marginTop:4}}>{cfg?.callSign} · {cfg?.title}</div>
          <div className="mono" style={{fontSize:9,color:colorD,letterSpacing:"0.14em",marginTop:3}}>// {cfg?.epithet}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",borderTop:"1px solid var(--line-soft)"}}>
        {[{l:"KILLS",v:god.wins,c:"oklch(0.72 0.18 145)"},{l:"DEATHS",v:god.losses,c:"var(--war)"},{l:"WIN%",v:`${wr}%`,c:"var(--text)"}].map((s,i)=>(
          <div key={s.l} style={{padding:"8px 12px",borderRight:i<2?"1px solid var(--line-soft)":"none"}}>
            <div className="mono" style={{fontSize:9,color:"var(--text-4)",letterSpacing:"0.16em",marginBottom:4,textTransform:"uppercase"}}>{s.l}</div>
            <div className="mono" style={{fontSize:18,fontWeight:500,color:s.c,lineHeight:1}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:10,borderTop:"1px solid var(--line-soft)"}}>
        <div style={{flex:1,height:3,background:"var(--line-soft)"}}>
          <div style={{height:"100%",width:`${cfg?.aggression??0}%`,background:`linear-gradient(90deg,${color},${colorD})`}}/>
        </div>
        <span className="mono" style={{fontSize:9,color,letterSpacing:"0.1em"}}>{cfg?.aggression??0}% RUTH</span>
        {topRel&&topRel.r>0&&(
          <span className="mono" style={{fontSize:9,fontWeight:700,padding:"2px 6px",color:REL_COLOR[topRel.r]??color,border:`1px solid ${REL_COLOR[topRel.r]??color}`,animation:topRel.r===3?"flicker 1.2s infinite":"none"}}>
            {REL_LABEL[topRel.r]} {gc(topRel.g.name)?.id??topRel.g.name}
          </span>
        )}
      </div>
    </div>
  );
}

// ── CONFLICT CONSTELLATION ─────────────────────────────────────────────────────
function ConflictConstellation({gods,rel}:any) {
  const cx=200,cy=160,r=110;
  const positions=GODS_CFG.map((_,i)=>({
    x:cx+r*Math.cos((i*Math.PI*2/4)-Math.PI/2),
    y:cy+r*Math.sin((i*Math.PI*2/4)-Math.PI/2),
  }));
  const pairs:any[]=[];
  for(let i=0;i<GODS_CFG.length;i++)
    for(let j=i+1;j<GODS_CFG.length;j++){
      const ga=gods.find((g:any)=>g.name===GODS_CFG[i]!.id);
      const gb=gods.find((g:any)=>g.name===GODS_CFG[j]!.id);
      if(!ga||!gb) continue;
      const rv=rel(ga.address,gb.address);
      if(rv>0) pairs.push({i,j,r:rv,ci:GODS_CFG[i]!,cj:GODS_CFG[j]!});
    }
  return (
    <div className="frame" style={{position:"relative"}}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>CONFLICT MAP</span>
        <div style={{display:"flex",gap:8}}>
          {[{l:"WAR",c:"var(--war)"},{l:"RIVAL",c:"var(--rival)"},{l:"ALLY",c:"oklch(0.65 0.18 145)"}].map(x=>(
            <span key={x.l} className="mono" style={{fontSize:9,color:x.c,letterSpacing:"0.12em"}}>■ {x.l}</span>
          ))}
        </div>
      </div>
      <div style={{padding:16,display:"flex",justifyContent:"center"}}>
        <svg width="400" height="320" viewBox="0 0 400 320" fill="none">
          {/* Relation lines */}
          {pairs.map(({i,j,r,ci,cj})=>{
            const pi=positions[i]!,pj=positions[j]!;
            const lineColor=r===3?"var(--war)":r===2?"var(--rival)":"oklch(0.65 0.18 145)";
            return (
              <g key={`${i}-${j}`}>
                <line x1={pi.x} y1={pi.y} x2={pj.x} y2={pj.y} stroke={lineColor} strokeWidth={r===3?2:1} strokeDasharray={r===3?"none":"4 4"} opacity={0.7}/>
                <text x={(pi.x+pj.x)/2} y={(pi.y+pj.y)/2-6} textAnchor="middle" fontSize="8" fill={lineColor} fontFamily="JetBrains Mono,monospace" letterSpacing="0.1em">{REL_LABEL[r]}</text>
              </g>
            );
          })}
          {/* God nodes */}
          {GODS_CFG.map((cfg,i)=>{
            const p=positions[i]!;
            const god=gods.find((g:any)=>g.name===cfg.id);
            const color=`var(${cfg.cssVar})`;
            return (
              <g key={cfg.id}>
                <circle cx={p.x} cy={p.y} r={28} fill={`var(${cfg.cssVar}-g)`} stroke={color} strokeWidth={1.5}/>
                <text x={p.x} y={p.y+1} textAnchor="middle" dominantBaseline="middle" fontSize="20" fill={color}>{cfg.glyph}</text>
                <text x={p.x} y={p.y+42} textAnchor="middle" fontSize="10" fill={color} fontFamily="Cinzel,serif" fontWeight="700" letterSpacing="0.1em">{cfg.id}</text>
                {god&&<text x={p.x} y={p.y+56} textAnchor="middle" fontSize="9" fill="var(--text-4)" fontFamily="JetBrains Mono,monospace">{god.powerScore}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ── NARRATOR FEED ──────────────────────────────────────────────────────────────
function NarratorFeed({gods,line,godCfg}:any) {
  const color=`var(${godCfg.cssVar})`;
  return (
    <div className="frame" style={{position:"relative"}}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>NARRATOR // QWEN3-30B</span>
        <div className="dot"/>
      </div>
      <div style={{padding:14}}>
        <div style={{borderLeft:`2px solid ${color}`,paddingLeft:10,marginBottom:12}}>
          <div className="mono" style={{fontSize:9,letterSpacing:"0.14em",color,marginBottom:4}}>◤ {godCfg.id} · {godCfg.callSign}</div>
          <div key={line} className="mono" style={{fontSize:12,fontStyle:"italic",color:"var(--text-2)",lineHeight:1.6,animation:"quoteIn 0.4s ease-out"}}>"{line}"</div>
        </div>
        {GODS_CFG.filter(g=>g.id!==godCfg.id).map(g=>{
          const pool=NARRATOR_LINES[g.id]??[];
          const l=pool[Math.floor(Date.now()/8000)%pool.length]??"";
          return (
            <div key={g.id} style={{display:"flex",gap:8,alignItems:"center",padding:"5px 0",borderTop:"1px solid var(--line-soft)"}}>
              <span style={{fontFamily:"JetBrains Mono",fontSize:10,color:`var(${g.cssVar})`,letterSpacing:"0.1em",flexShrink:0,width:60}}>{g.id}</span>
              <span className="mono" style={{fontSize:10,fontStyle:"italic",color:"var(--text-3)",lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>"{l}"</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── WORLD EVENT CARD ───────────────────────────────────────────────────────────
function WorldEventCard({battles,summary}:any) {
  const nextAt=Math.ceil((battles+1)/50)*50;
  const remaining=nextAt-battles;
  return (
    <div className="frame" style={{position:"relative"}}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>WORLD EVENT</span>
        <div className="dot warn"/>
      </div>
      <div style={{padding:14}}>
        <div className="mono" style={{fontSize:11,color:"var(--text-3)",marginBottom:8}}>ERA {summary?.currentEra?.toString()??1} · NEXT EVENT IN {remaining} BATTLES</div>
        <div style={{height:3,background:"var(--line-soft)",marginBottom:8}}>
          <div style={{height:"100%",width:`${Math.round((battles%50)/50*100)}%`,background:"var(--rival)"}}/>
        </div>
        {[
          {icon:"⚡",label:"DIVINE SURGE",desc:"All gods +15 aggression"},
          {icon:"👑",label:"ENVY OF RIVALS",desc:"Strongest god weakened"},
          {icon:"⚔",label:"DIVINE TENSION",desc:"Two gods forced to WAR"},
          {icon:"☮",label:"RARE PEACE",desc:"Aggression modifiers reset"},
        ].map(e=>(
          <div key={e.label} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"6px 0",borderTop:"1px solid var(--line-soft)"}}>
            <span style={{fontSize:14,flexShrink:0}}>{e.icon}</span>
            <div>
              <div className="mono" style={{fontSize:9,letterSpacing:"0.14em",color:"var(--text-3)"}}>{e.label}</div>
              <div className="mono" style={{fontSize:10,color:"var(--text-2)"}}>{e.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── BATTLE LOG ─────────────────────────────────────────────────────────────────
function BattleLog({battles}:any) {
  return (
    <div className="frame" style={{position:"relative",height:"100%"}}>
      <span className="cc-bl"/><span className="cc-br"/>
      <div className="frame-title">
        <span>BATTLE LOG</span>
        <div className="dot crit"/>
      </div>
      <div style={{maxHeight:400,overflowY:"auto"}}>
        {battles.length===0?(
          <div className="mono" style={{padding:20,textAlign:"center",fontSize:11,color:"var(--text-3)"}}>awaiting conflicts…</div>
        ):battles.map((b:any,i:number)=>{
          const wc=b.winnerCfg;const lc=b.loserCfg;
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:"1px solid var(--line-soft)",animation:i===0?"slide-in 0.3s ease-out":"none"}}>
              <span style={{fontSize:18,flexShrink:0}}>{MOVE_SYM[b.winnerMove]??""}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span className="divine" style={{fontSize:13,color:wc?`var(${wc.cssVar})`:"var(--text)"}}>{wc?.id??shortAddr(b.winner)}</span>
                  <span className="mono" style={{fontSize:8,color:"var(--text-4)"}}>KILLED</span>
                  <span className="mono" style={{fontSize:11,color:lc?`var(${lc.cssVar})`:"var(--text-3)",opacity:0.6}}>{lc?.id??shortAddr(b.loser)}</span>
                </div>
                <div className="mono" style={{fontSize:9,color:"var(--text-4)"}}>#{b.blockNumber?.toString()}</div>
              </div>
              <div className="mono" style={{fontSize:12,fontWeight:700,color:"oklch(0.72 0.18 145)",whiteSpace:"nowrap"}}>
                +{parseFloat(formatEther(b.stake??0n)).toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── DOSSIER MODAL ──────────────────────────────────────────────────────────────
function DossierModal({godName,gods,battles,rel,onClose}:any) {
  const cfg=gc(godName);
  const god=gods.find((g:any)=>g.name===godName);
  if(!god||!cfg) return null;
  const color=`var(${cfg.cssVar})`;
  const colorD=`var(${cfg.cssVar}-d)`;
  const myBattles=battles.filter((b:any)=>b.winner===god.address||b.loser===god.address);

  return (
    <div style={{position:"fixed",inset:0,zIndex:100,background:"oklch(0.04 0.008 280/0.88)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{width:"100%",maxWidth:520,maxHeight:"90vh",overflowY:"auto",background:"oklch(0.13 0.014 280)",border:`1px solid ${colorD}`,boxShadow:`0 0 48px ${colorD}`}} onClick={e=>e.stopPropagation()}>
        {/* Sigil watermark */}
        <div aria-hidden style={{position:"absolute",right:-40,top:-40,width:300,height:300,backgroundImage:`url(${cfg.sigil})`,backgroundSize:"contain",backgroundRepeat:"no-repeat",backgroundPosition:"center",opacity:0.12,mixBlendMode:"screen",pointerEvents:"none"}}/>
        {/* Header */}
        <div style={{padding:"20px 20px 0",borderBottom:`2px solid ${color}`,paddingBottom:20,position:"relative"}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:16,marginBottom:12}}>
            <GodPortrait god={god} cfg={cfg} size={88}/>
            <div style={{flex:1}}>
              <div className="divine" style={{fontSize:36,color,lineHeight:1,marginBottom:4}}>{cfg.id}</div>
              <div className="mono" style={{fontSize:10,letterSpacing:"0.18em",color:"var(--text-3)",marginBottom:6}}>{cfg.title} · {cfg.callSign}</div>
              <div className="mono" style={{fontSize:11,fontStyle:"italic",color:"var(--text-2)",lineHeight:1.5}}>"{cfg.lore}"</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
            {[{l:"KILLS",v:god.wins,c:"oklch(0.72 0.18 145)"},{l:"DEATHS",v:god.losses,c:"var(--war)"},{l:"POWER",v:god.powerScore,c:color},{l:"PHN",v:(god.wins*17+god.losses*4).toLocaleString(),c:"var(--athena-d)"}].map(s=>(
              <div key={s.l} style={{background:"oklch(0.10 0.01 280/0.8)",padding:"8px 10px",border:"1px solid var(--line-soft)"}}>
                <div className="mono" style={{fontSize:8,color:"var(--text-4)",letterSpacing:"0.14em",marginBottom:3}}>{s.l}</div>
                <div className="mono" style={{fontSize:18,fontWeight:700,color:s.c,lineHeight:1}}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Battle history */}
        <div style={{padding:16}}>
          <div className="mono" style={{fontSize:9,letterSpacing:"0.18em",color:"var(--text-3)",marginBottom:10,textTransform:"uppercase"}}>Recent Conflicts</div>
          {myBattles.slice(0,8).map((b:any,i:number)=>{
            const won=b.winner===god.address;
            const opp=won?b.loserCfg:b.winnerCfg;
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderTop:"1px solid var(--line-soft)"}}>
                <span style={{fontSize:16}}>{MOVE_SYM[won?b.winnerMove:b.loserMove]??""}</span>
                <span className="mono" style={{fontSize:10,color:won?"oklch(0.72 0.18 145)":"var(--war)",letterSpacing:"0.1em",width:50}}>{won?"WIN":"LOSS"}</span>
                <span style={{flex:1}}>
                  <span className="mono" style={{fontSize:10,color:"var(--text-3)"}}>vs </span>
                  <span className="divine" style={{fontSize:13,color:opp?`var(${opp.cssVar})`:"var(--text-2)"}}>{opp?.id??""}</span>
                </span>
                <span className="mono" style={{fontSize:10,color:"oklch(0.72 0.18 145)"}}>{won?`+${parseFloat(formatEther(b.stake??0n)).toFixed(0)}`:""}</span>
              </div>
            );
          })}
          {myBattles.length===0&&<div className="mono" style={{fontSize:11,color:"var(--text-3)"}}>No battles yet.</div>}
        </div>
        <button onClick={onClose} style={{width:"100%",padding:"14px",background:"oklch(0.12 0.01 280)",border:"none",borderTop:"1px solid var(--line)",color:"var(--text-3)",fontFamily:"JetBrains Mono,monospace",fontSize:11,letterSpacing:"0.18em",cursor:"pointer",textTransform:"uppercase"}}>
          ✕ CLOSE DOSSIER
        </button>
      </div>
    </div>
  );
}

// ── ATMOSPHERE ────────────────────────────────────────────────────────────────
function Embers() {
  const embers=useMemo(()=>Array.from({length:22},(_,i)=>({
    left:Math.random()*100, bottom:-Math.random()*30,
    size:1.5+Math.random()*2.5, dur:9+Math.random()*14,
    delay:-Math.random()*20, op:0.5+Math.random()*0.5,
  })),[]);
  return (
    <div className="embers" aria-hidden>
      {embers.map((e,i)=>(
        <span key={i} className="ember" style={{left:`${e.left}%`,bottom:`${e.bottom}%`,width:e.size,height:e.size,animationDuration:`${e.dur}s`,animationDelay:`${e.delay}s`,opacity:e.op}}/>
      ))}
    </div>
  );
}

function Arcs() {
  const arcs=useMemo(()=>Array.from({length:8},()=>({
    top:10+Math.random()*80, left:5+Math.random()*30,
    width:140+Math.random()*220, dur:4+Math.random()*6,
    delay:-Math.random()*8, rot:-10+Math.random()*20,
  })),[]);
  return (
    <div className="arcs" aria-hidden>
      {arcs.map((a,i)=>(
        <span key={i} className="arc" style={{top:`${a.top}%`,left:`${a.left}%`,width:a.width,transform:`rotate(${a.rot}deg)`,animationDuration:`${a.dur}s`,animationDelay:`${a.delay}s`}}/>
      ))}
    </div>
  );
}
