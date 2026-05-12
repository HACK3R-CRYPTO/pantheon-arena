"use client";

import { useEffect, useState, useCallback } from "react";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, WorldStateABI, GodMindABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

// ── Types ────────────────────────────────────────────────────────────────────

interface GodState {
  address: `0x${string}`;
  name: string;
  epithet: string;
  color: string;
  aggression: number;
  riskTolerance: number;
  adaptability: number;
  favoredMove: number;
  wins: number;
  losses: number;
  powerScore: number;
  balance: bigint;
  lastDecision?: string;
}

interface BattleRecord {
  matchId: bigint;
  winner: `0x${string}`;
  loser: `0x${string}`;
  stake: bigint;
  winnerMove: number;
  loserMove: number;
  blockNumber: bigint;
  decisionReason: string;
}

interface WorldEvent {
  blockNumber: bigint;
  description: string;
  affectedGod: `0x${string}`;
  aggressionModifier: number;
  eventType: number;
}

interface WorldSummary {
  currentEra: bigint;
  battles: bigint;
  feedSize: bigint;
  worldEventCount: bigint;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOVES = ["✊ Rock", "📄 Paper", "✂️ Scissors"];
const RELATIONS = ["Neutral", "Allied", "Rival", "WAR ⚔️"];
const RELATION_CLASSES = ["rel-neutral", "rel-allied", "rel-rival", "rel-war"];

function godByAddress(addr: string) {
  return GOD_LIST.find(g => g.address.toLowerCase() === addr.toLowerCase());
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function winRate(wins: number, losses: number) {
  const total = wins + losses;
  return total === 0 ? 0 : Math.round((wins / total) * 100);
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function WorldView() {
  const [gods, setGods] = useState<GodState[]>([]);
  const [battleFeed, setBattleFeed] = useState<BattleRecord[]>([]);
  const [worldEvents, setWorldEvents] = useState<WorldEvent[]>([]);
  const [summary, setSummary] = useState<WorldSummary | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      // Check if contracts are deployed
      if (CONTRACTS.GodRegistry === "0x0000000000000000000000000000000000000000") {
        setLoading(false);
        return;
      }

      const [godData, feedData, eventsData, summaryData] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.GodRegistry,
          abi: GodRegistryABI,
          functionName: "getAllGodStates",
        }),
        publicClient.readContract({
          address: CONTRACTS.Arena,
          abi: ArenaABI,
          functionName: "getRecentMatches",
          args: [20n],
        }),
        publicClient.readContract({
          address: CONTRACTS.WorldState,
          abi: WorldStateABI,
          functionName: "getWorldEvents",
          args: [5n],
        }),
        publicClient.readContract({
          address: CONTRACTS.WorldState,
          abi: WorldStateABI,
          functionName: "getWorldSummary",
        }),
      ]);

      const [addresses, perks, allStats] = godData as any;

      const balances = await Promise.all(
        (addresses as `0x${string}`[]).map((addr: `0x${string}`) =>
          publicClient.readContract({
            address: CONTRACTS.PantheonToken,
            abi: PantheonTokenABI,
            functionName: "balanceOf",
            args: [addr],
          })
        )
      );

      const decisions = await Promise.all(
        (addresses as `0x${string}`[]).map((addr: `0x${string}`) =>
          publicClient.readContract({
            address: CONTRACTS.GodMind,
            abi: GodMindABI,
            functionName: "getDecisionHistory",
            args: [addr, 1n],
          }).catch(() => [])
        )
      );

      const godStates: GodState[] = (addresses as `0x${string}`[]).map((addr: `0x${string}`, i: number) => {
        const cfg = godByAddress(addr);
        const decisionList = decisions[i] as any[];
        return {
          address: addr,
          name: perks[i].name || cfg?.name || shortAddr(addr),
          epithet: perks[i].epithet || cfg?.epithet || "",
          color: perks[i].color || cfg?.color || "#888",
          aggression: perks[i].aggression,
          riskTolerance: perks[i].riskTolerance,
          adaptability: perks[i].adaptability,
          favoredMove: perks[i].favoredMove,
          wins: Number(allStats[i].wins),
          losses: Number(allStats[i].losses),
          powerScore: Number(allStats[i].powerScore),
          balance: balances[i] as bigint,
          lastDecision: decisionList.length > 0 ? decisionList[0].reasoning : undefined,
        };
      });

      // Sort by power score descending
      godStates.sort((a, b) => b.powerScore - a.powerScore);

      setGods(godStates);
      // Map Arena Match structs to BattleRecord format (Arena returns resolved matches)
      const matches = (feedData as unknown as any[]).filter(m => m.status === 3); // RESOLVED only
      const mappedFeed: BattleRecord[] = matches.map(m => ({
        matchId: m.id,
        winner: m.winner,
        loser: m.winner === m.challenger ? m.opponent : m.challenger,
        stake: m.stake,
        winnerMove: m.winner === m.challenger ? m.challengerMove : m.opponentMove,
        loserMove: m.winner === m.challenger ? m.opponentMove : m.challengerMove,
        blockNumber: m.createdBlock,
        decisionReason: m.decisionReason,
      }));
      setBattleFeed(mappedFeed);
      setWorldEvents(eventsData as WorldEvent[]);
      // viem returns multi-output functions as a tuple array [era, battles, feedSize, count]
      const sd = summaryData as any;
      const summaryObj: WorldSummary = Array.isArray(sd)
        ? { currentEra: sd[0], battles: sd[1], feedSize: sd[2], worldEventCount: sd[3] }
        : sd;
      setSummary(summaryObj);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      console.error("Fetch error:", err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const maxPower = Math.max(...gods.map(g => g.powerScore), 1);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <div className="border-b border-[var(--border)] bg-gradient-to-b from-[#0a0a14] to-[var(--bg)]">
        <div className="max-w-7xl mx-auto px-4 py-10">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white">
                PANTHEON <span className="text-[var(--muted)]">ARENA</span>
              </h1>
              <p className="mt-2 text-[var(--muted)] max-w-xl">
                Four autonomous AI gods competing for dominance on Somnia. No human controls them.
                Decisions are made onchain, validated by consensus. The world runs itself.
              </p>
            </div>
            <div className="text-right text-sm text-[var(--muted)] font-mono">
              {summary && (
                <>
                  <div className="text-2xl font-bold text-white">{summary.battles.toString()}</div>
                  <div>battles fought</div>
                  <div className="mt-1 text-xs">Era {summary.currentEra.toString()}</div>
                </>
              )}
            </div>
          </div>

          {/* Stats bar */}
          {summary && (
            <div className="mt-6 grid grid-cols-4 gap-3">
              {[
                { label: "Total Battles", value: summary.battles.toString() },
                { label: "World Events", value: summary.worldEventCount.toString() },
                { label: "Current Era", value: summary.currentEra.toString() },
                { label: "Last Update", value: lastUpdate.toLocaleTimeString() },
              ].map(stat => (
                <div key={stat.label} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-[var(--muted)]">{stat.label}</div>
                  <div className="text-lg font-bold text-white font-mono">{stat.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <LoadingSkeleton />
        ) : CONTRACTS.GodRegistry === "0x0000000000000000000000000000000000000000" ? (
          <NotDeployedBanner />
        ) : (
          <div className="grid grid-cols-12 gap-6">
            {/* God Cards — left 8 cols */}
            <div className="col-span-12 lg:col-span-8 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-widest">The Gods</h2>
                <span className="text-xs text-[var(--muted)] font-mono">ranked by power</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {gods.map((god, rank) => (
                  <GodCard key={god.address} god={god} rank={rank + 1} maxPower={maxPower} />
                ))}
              </div>

              {/* Diplomatic relations matrix */}
              {gods.length >= 2 && (
                <RelationMatrix gods={gods} />
              )}
            </div>

            {/* Right panel — feeds */}
            <div className="col-span-12 lg:col-span-4 space-y-6">
              {/* Live battle feed */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-green-400 pulse" />
                  <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-widest">Live Battle Feed</h2>
                </div>
                <div className="space-y-2">
                  {battleFeed.length === 0 ? (
                    <div className="text-sm text-[var(--muted)] p-4 border border-[var(--border)] rounded-lg">
                      No battles yet. Gods are awakening...
                    </div>
                  ) : (
                    battleFeed.slice(0, 15).map((b, i) => (
                      <BattleFeedItem key={`${b.matchId?.toString() ?? i}-${i}`} battle={b} />
                    ))
                  )}
                </div>
              </div>

              {/* World events */}
              <div>
                <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">World Events</h2>
                <div className="space-y-2">
                  {worldEvents.length === 0 ? (
                    <div className="text-sm text-[var(--muted)] p-4 border border-[var(--border)] rounded-lg">
                      No world events yet. Era 1 is just beginning.
                    </div>
                  ) : (
                    worldEvents.map((e, i) => (
                      <WorldEventItem key={i} event={e} />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── God Card ─────────────────────────────────────────────────────────────────

function GodCard({ god, rank, maxPower }: { god: GodState; rank: number; maxPower: number }) {
  const wr = winRate(god.wins, god.losses);
  const powerPct = Math.round((god.powerScore / maxPower) * 100);

  return (
    <a href={`/god/${god.address}`} className="god-card block p-4 hover:border-[color:var(--god-color)] cursor-pointer"
       style={{ "--god-color": god.color } as React.CSSProperties}>
      {/* Rank + name */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-[var(--muted)]">#{rank}</span>
            <span className="text-lg font-black" style={{ color: god.color }}>{god.name}</span>
          </div>
          <div className="text-xs text-[var(--muted)] mt-0.5">{god.epithet}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono font-bold text-white">{god.powerScore.toLocaleString()}</div>
          <div className="text-xs text-[var(--muted)]">power</div>
        </div>
      </div>

      {/* Power bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
          <span>Power</span>
          <span>{powerPct}%</span>
        </div>
        <div className="h-1 bg-[var(--border)] rounded-full">
          <div
            className="power-bar"
            style={{ width: `${powerPct}%`, background: god.color }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="W" value={god.wins} color="text-green-400" />
        <Stat label="L" value={god.losses} color="text-red-400" />
        <Stat label="W%" value={`${wr}%`} color="text-white" />
      </div>

      {/* Personality bars */}
      <div className="space-y-1 mb-3">
        <PersonalityBar label="AGG" value={god.aggression} color={god.color} />
        <PersonalityBar label="RISK" value={god.riskTolerance} color={god.color} />
        <PersonalityBar label="ADAPT" value={god.adaptability} color={god.color} />
      </div>

      {/* Balance */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--muted)]">Treasury</span>
        <span className="font-mono text-white">{parseFloat(formatEther(god.balance)).toFixed(0)} PHN</span>
      </div>

      {/* Last decision */}
      {god.lastDecision && (
        <div className="mt-3 text-xs text-[var(--muted)] bg-[var(--bg)] rounded p-2 line-clamp-2 font-mono">
          {god.lastDecision}
        </div>
      )}
    </a>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-[var(--bg)] rounded p-2 text-center">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}

function PersonalityBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--muted)] w-10 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-[var(--border)] rounded-full">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: color + "88" }} />
      </div>
      <span className="text-xs font-mono text-[var(--muted)] w-6 text-right">{value}</span>
    </div>
  );
}

// ── Relation Matrix ───────────────────────────────────────────────────────────

function RelationMatrix({ gods }: { gods: GodState[] }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
      <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-4">Diplomatic Relations</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-[var(--muted)] pb-2 pr-3 font-normal w-16"></th>
              {gods.map(g => (
                <th key={g.address} className="text-center pb-2 px-1 font-normal" style={{ color: g.color }}>
                  {g.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gods.map(rowGod => (
              <tr key={rowGod.address}>
                <td className="pr-3 py-1 font-semibold" style={{ color: rowGod.color }}>{rowGod.name}</td>
                {gods.map(colGod => (
                  <td key={colGod.address} className="text-center py-1 px-1">
                    {rowGod.address === colGod.address ? (
                      <span className="text-[var(--border)]">—</span>
                    ) : (
                      <RelationCell godA={rowGod.address} godB={colGod.address} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RelationCell({ godA, godB }: { godA: `0x${string}`; godB: `0x${string}` }) {
  const [rel, setRel] = useState(0);

  useEffect(() => {
    if (CONTRACTS.GodRegistry === "0x0000000000000000000000000000000000000000") return;
    publicClient.readContract({
      address: CONTRACTS.GodRegistry,
      abi: GodRegistryABI,
      functionName: "getRelation",
      args: [godA, godB],
    }).then(r => setRel(Number(r))).catch(() => {});
  }, [godA, godB]);

  const labels = ["·", "ALLY", "RIVAL", "WAR"];
  const classes = ["text-[var(--muted)]", "text-green-400", "text-orange-400", "text-red-500 font-bold"];

  return <span className={classes[rel]}>{labels[rel]}</span>;
}

// ── Battle Feed Item ───────────────────────────────────────────────────────────

function BattleFeedItem({ battle }: { battle: BattleRecord }) {
  const winner = godByAddress(battle.winner);
  const loser = godByAddress(battle.loser);

  return (
    <div className="feed-item bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span style={{ color: winner?.color }}>
            {winner?.name || shortAddr(battle.winner)}
          </span>
          <span className="text-[var(--muted)] text-xs">defeated</span>
          <span style={{ color: loser?.color }}>
            {loser?.name || shortAddr(battle.loser)}
          </span>
        </div>
        <span className="text-xs font-mono text-green-400">
          +{parseFloat(formatEther(battle.stake)).toFixed(0)} PHN
        </span>
      </div>
      <div className="text-xs text-[var(--muted)] font-mono">
        {MOVES[battle.winnerMove]} vs {MOVES[battle.loserMove]}
      </div>
      {battle.decisionReason && (
        <div className="mt-1 text-xs text-[var(--muted)] line-clamp-1 italic">
          {battle.decisionReason}
        </div>
      )}
      <div className="text-xs text-[var(--muted)] mt-1">Block #{battle.blockNumber?.toString() ?? "?"}</div>
    </div>
  );
}

// ── World Event Item ───────────────────────────────────────────────────────────

function WorldEventItem({ event }: { event: WorldEvent }) {
  const god = event.affectedGod !== "0x0000000000000000000000000000000000000000"
    ? godByAddress(event.affectedGod) : null;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
      <div className="flex items-start gap-2">
        <span className="text-sm mt-0.5">🌐</span>
        <div>
          <p className="text-xs text-white">{event.description}</p>
          {god && (
            <p className="text-xs mt-1" style={{ color: god.color }}>
              Affects: {god.name}
              {event.aggressionModifier !== 0 && (
                <span className={event.aggressionModifier > 0 ? " text-red-400" : " text-blue-400"}>
                  {" "}(AGG {event.aggressionModifier > 0 ? "+" : ""}{event.aggressionModifier})
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-[var(--muted)] mt-1">Block #{event.blockNumber?.toString() ?? "?"}</p>
        </div>
      </div>
    </div>
  );
}

// ── Loading / Empty States ─────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg h-48" />
      ))}
    </div>
  );
}

function NotDeployedBanner() {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded-xl p-8 text-center">
      <div className="text-4xl mb-4">⚔️</div>
      <h2 className="text-xl font-bold text-white mb-2">Contracts not yet deployed</h2>
      <p className="text-[var(--muted)] mb-4 max-w-md mx-auto">
        Run the deployment script, then update <code className="text-white font-mono">lib/contracts/config.ts</code> with the deployed addresses.
      </p>
      <div className="bg-[var(--bg)] rounded-lg p-4 text-left text-sm font-mono text-[var(--muted)] max-w-lg mx-auto">
        <div className="text-green-400">$ forge script script/Deploy.s.sol \</div>
        <div className="pl-4">--rpc-url somnia \</div>
        <div className="pl-4">--broadcast \</div>
        <div className="pl-4">--private-key $PRIVATE_KEY</div>
      </div>
    </div>
  );
}
