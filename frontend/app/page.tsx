"use client";

import { useEffect, useState, useCallback } from "react";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, WorldStateABI, GodMindABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

interface GodState {
  address: `0x${string}`;
  name: string;
  epithet: string;
  color: string;
  aggression: number;
  riskTolerance: number;
  adaptability: number;
  wins: number;
  losses: number;
  powerScore: number;
  balance: bigint;
  active: boolean;
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

interface WorldSummary { currentEra: bigint; battles: bigint; feedSize: bigint; worldEventCount: bigint; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOVES = ["✊", "📄", "✂️"];
const MOVE_NAMES = ["Rock", "Paper", "Scissors"];
const REL = ["·", "ALLY", "RIVAL", "WAR ⚔️"];
const REL_COLOR = ["text-gray-600", "text-emerald-400", "text-orange-400", "text-red-500"];

function godByAddr(addr: string) {
  return GOD_LIST.find(g => g.address.toLowerCase() === addr?.toLowerCase());
}
function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }
function winRate(w: number, l: number) { return w + l === 0 ? 0 : Math.round(w / (w + l) * 100); }

// ── Main Page ────────────────────────────────────────────────────────────────

export default function WorldView() {
  const [gods, setGods] = useState<GodState[]>([]);
  const [feed, setFeed] = useState<BattleRecord[]>([]);
  const [summary, setSummary] = useState<WorldSummary | null>(null);
  const [relations, setRelations] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  const fetchAll = useCallback(async () => {
    try {
      if (CONTRACTS.GodRegistry === "0x0000000000000000000000000000000000000000") {
        setLoading(false); return;
      }

      const [godData, matchData, summaryData] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getAllGodStates" }),
        publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "getRecentMatches", args: [20n] }),
        publicClient.readContract({ address: CONTRACTS.WorldState, abi: WorldStateABI, functionName: "getWorldSummary" }),
      ]);

      const [addresses, perks, allStats] = godData as any;

      const balances = await Promise.all(
        (addresses as `0x${string}`[]).map((addr: `0x${string}`) =>
          publicClient.readContract({ address: CONTRACTS.PantheonToken, abi: PantheonTokenABI, functionName: "balanceOf", args: [addr] }).catch(() => 0n)
        )
      );

      const godStates: GodState[] = (addresses as `0x${string}`[]).map((addr: `0x${string}`, i: number) => {
        const cfg = godByAddr(addr);
        return {
          address: addr,
          name: perks[i]?.name || cfg?.name || shortAddr(addr),
          epithet: perks[i]?.epithet || cfg?.epithet || "",
          color: perks[i]?.color || cfg?.color || "#888",
          aggression: Number(perks[i]?.aggression ?? 0),
          riskTolerance: Number(perks[i]?.riskTolerance ?? 0),
          adaptability: Number(perks[i]?.adaptability ?? 0),
          wins: Number(allStats[i]?.wins ?? 0),
          losses: Number(allStats[i]?.losses ?? 0),
          powerScore: Number(allStats[i]?.powerScore ?? 1000),
          balance: balances[i] as bigint,
          active: Boolean(allStats[i]?.active),
        };
      });
      godStates.sort((a, b) => b.powerScore - a.powerScore);

      // Build relation map
      const relMap: Record<string, number> = {};
      for (let i = 0; i < addresses.length; i++) {
        for (let j = i + 1; j < addresses.length; j++) {
          const rel = await publicClient.readContract({
            address: CONTRACTS.GodRegistry, abi: GodRegistryABI,
            functionName: "getRelation", args: [addresses[i], addresses[j]],
          }).catch(() => 0);
          const key = `${addresses[i]}-${addresses[j]}`;
          relMap[key] = Number(rel);
        }
      }

      // Resolve battles from Arena
      const rawMatches = matchData as unknown as any[];
      const resolved = rawMatches.filter(m => Number(m.status) === 3);
      const mappedFeed: BattleRecord[] = resolved.map(m => ({
        matchId: m.id,
        winner: m.winner,
        loser: m.winner === m.challenger ? m.opponent : m.challenger,
        stake: m.stake,
        winnerMove: m.winner === m.challenger ? m.challengerMove : m.opponentMove,
        loserMove: m.winner === m.challenger ? m.opponentMove : m.challengerMove,
        blockNumber: m.createdBlock,
        decisionReason: m.decisionReason,
      }));

      const sd = summaryData as any;
      const sum: WorldSummary = Array.isArray(sd)
        ? { currentEra: sd[0], battles: sd[1], feedSize: sd[2], worldEventCount: sd[3] }
        : sd;

      setGods(godStates);
      setFeed(mappedFeed.reverse());
      setRelations(relMap);
      setSummary(sum);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 5000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const maxPower = Math.max(...gods.map(g => g.powerScore), 1000);
  const totalBattles = summary ? Number(summary.battles) : 0;
  const nextEraAt = Math.ceil((totalBattles + 1) / 50) * 50;

  function getRelation(a: string, b: string) {
    const key1 = `${a}-${b}`;
    const key2 = `${b}-${a}`;
    return relations[key1] ?? relations[key2] ?? 0;
  }

  return (
    <div className="min-h-screen">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-[var(--border)]" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(168,85,247,0.12) 0%, transparent 70%)"
      }}>
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest text-purple-400 bg-purple-500/10 border border-purple-500/20 px-4 py-1.5 rounded-full mb-4">
              <div className="live-dot pulse" />
              AUTONOMOUS · SOMNIA TESTNET · ERA {summary ? summary.currentEra.toString() : "1"}
            </div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight mb-3">
              <span className="text-white">THE GODS </span>
              <span style={{
                background: "linear-gradient(135deg, #ef4444, #a855f7, #06b6d4)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
              }}>ARE AT WAR</span>
            </h1>
            <p className="text-[var(--muted)] text-lg max-w-xl mx-auto">
              Four autonomous AI gods competing for dominance on Somnia.
              <br />
              <span className="text-white font-medium">No human controls them. The world runs itself.</span>
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
            {[
              { label: "Battles Fought", value: totalBattles, color: "#ef4444" },
              { label: "Next World Event", value: `${nextEraAt - totalBattles} battles`, color: "#a855f7" },
              { label: "Current Era", value: summary?.currentEra?.toString() ?? "1", color: "#06b6d4" },
              { label: "Gods Active", value: gods.filter(g => g.active).length, color: "#10b981" },
            ].map(s => (
              <div key={s.label} className="god-card p-4 text-center">
                <div className="text-2xl font-black" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs text-[var(--muted)] mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading ? <LoadingSkeleton /> : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* ── Left: Gods ───────────────────────────────── */}
            <div className="lg:col-span-7 space-y-6">

              {/* God cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {gods.map((god, rank) => (
                  <GodCard key={god.address} god={god} rank={rank + 1} maxPower={maxPower} gods={gods} getRelation={getRelation} />
                ))}
              </div>

              {/* Relations */}
              {gods.length >= 2 && (
                <RelationsPanel gods={gods} getRelation={getRelation} />
              )}
            </div>

            {/* ── Right: Feed ──────────────────────────────── */}
            <div className="lg:col-span-5 space-y-4">
              <BattleFeed feed={feed} lastUpdate={lastUpdate} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── God Card ─────────────────────────────────────────────────────────────────

function GodCard({ god, rank, maxPower, gods, getRelation }: {
  god: GodState; rank: number; maxPower: number;
  gods: GodState[]; getRelation: (a: string, b: string) => number;
}) {
  const wr = winRate(god.wins, god.losses);
  const powerPct = Math.round(god.powerScore / maxPower * 100);
  const rivals = gods.filter(g => g.address !== god.address && getRelation(god.address, g.address) >= 2);

  return (
    <Link href={`/god/${god.address}`}>
      <div className="god-card overflow-hidden hover:shadow-lg" style={{
        borderColor: `${god.color}30`,
        boxShadow: `0 0 0 1px ${god.color}20`
      }}>
        {/* Color stripe at top */}
        <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${god.color}, transparent)` }} />

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-[var(--muted)] font-mono">#{rank}</span>
                <span className="text-xl font-black" style={{ color: god.color }}>{god.name}</span>
                {(god.wins > 0 || god.losses > 0) && wr >= 60 && (
                  <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full border border-emerald-500/30">
                    HOT 🔥
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--muted)]">{god.epithet}</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-black text-white">{god.powerScore.toLocaleString()}</div>
              <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">power</div>
            </div>
          </div>

          {/* Power bar */}
          <div className="mb-4">
            <div className="flex justify-between text-[10px] text-[var(--muted)] mb-1.5">
              <span>POWER</span><span>{powerPct}%</span>
            </div>
            <div className="h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div className="power-bar-fill" style={{ width: `${powerPct}%`, background: god.color }} />
            </div>
          </div>

          {/* W/L/WR */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <StatBox label="WIN" value={god.wins} color="text-emerald-400" />
            <StatBox label="LOSS" value={god.losses} color="text-red-400" />
            <StatBox label="WIN%" value={`${wr}%`} color="text-white" />
          </div>

          {/* Personality bars */}
          <div className="space-y-1.5 mb-4">
            <PersonalityBar label="AGG" value={god.aggression} color={god.color} />
            <PersonalityBar label="RISK" value={god.riskTolerance} color={god.color} />
            <PersonalityBar label="ADAPT" value={god.adaptability} color={god.color} />
          </div>

          {/* Treasury + rivals */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <span className="text-xs text-[var(--muted)]">
              💰 {parseFloat(formatEther(god.balance)).toFixed(0)} PHN
            </span>
            {rivals.length > 0 && (
              <div className="flex items-center gap-1">
                {rivals.map(r => (
                  <span key={r.address} className="text-[10px] font-bold px-1.5 py-0.5 rounded border" style={{
                    color: r.color, borderColor: `${r.color}40`, background: `${r.color}10`
                  }}>
                    {getRelation(god.address, r.address) === 3 ? "⚔" : "〜"} {r.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-[var(--bg)] rounded-lg p-2 text-center">
      <div className={`text-base font-black ${color}`}>{value}</div>
      <div className="text-[9px] text-[var(--muted)] uppercase tracking-widest">{label}</div>
    </div>
  );
}

function PersonalityBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--muted)] w-8 shrink-0 uppercase">{label}</span>
      <div className="flex-1 h-1 bg-[var(--border)] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: `${color}80` }} />
      </div>
      <span className="text-[10px] font-mono text-[var(--muted)] w-6 text-right">{value}</span>
    </div>
  );
}

// ── Relations Panel ───────────────────────────────────────────────────────────

function RelationsPanel({ gods, getRelation }: { gods: GodState[]; getRelation: (a: string, b: string) => number }) {
  const pairs = gods.flatMap((a, i) =>
    gods.slice(i + 1).map(b => ({
      a, b, rel: getRelation(a.address, b.address)
    }))
  ).filter(p => p.rel > 0);

  return (
    <div className="god-card p-5">
      <h3 className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-4">
        ⚔ Active Conflicts
      </h3>
      {pairs.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">All gods are neutral — conflicts will emerge.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {pairs.map(({ a, b, rel }) => (
            <div key={`${a.address}-${b.address}`}
              className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg)]">
              <span className="font-black text-sm" style={{ color: a.color }}>{a.name}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                rel === 3 ? "badge-war" : rel === 2 ? "badge-rival" : "badge-allied"
              }`}>
                {REL[rel]}
              </span>
              <span className="font-black text-sm" style={{ color: b.color }}>{b.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Battle Feed ───────────────────────────────────────────────────────────────

function BattleFeed({ feed, lastUpdate }: { feed: BattleRecord[]; lastUpdate: Date }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="live-dot pulse" />
          <span className="text-xs font-bold text-white uppercase tracking-widest">Live Battle Feed</span>
        </div>
        <span className="text-[10px] text-[var(--muted)] font-mono">
          {lastUpdate.toLocaleTimeString()}
        </span>
      </div>

      {feed.length === 0 ? (
        <div className="god-card p-8 text-center">
          <div className="text-4xl mb-3">⚔️</div>
          <div className="text-sm font-bold text-white mb-1">First battle incoming…</div>
          <div className="text-xs text-[var(--muted)]">Gods are making their moves</div>
        </div>
      ) : (
        <div className="space-y-3">
          {feed.map((b, i) => <BattleCard key={`${b.matchId}-${i}`} battle={b} />)}
        </div>
      )}
    </div>
  );
}

function BattleCard({ battle }: { battle: BattleRecord }) {
  const winner = godByAddr(battle.winner);
  const loser  = godByAddr(battle.loser);

  return (
    <div className="battle-card p-4 slide-up">
      {/* Winner line */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl" title={MOVE_NAMES[battle.winnerMove]}>{MOVES[battle.winnerMove] ?? "?"}</span>
          <span className="font-black" style={{ color: winner?.color ?? "#fff" }}>
            {winner?.name ?? shortAddr(battle.winner)}
          </span>
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
            VICTORY
          </span>
        </div>
        <span className="text-sm font-black text-emerald-400">
          +{parseFloat(formatEther(battle.stake)).toFixed(0)} PHN
        </span>
      </div>

      {/* Loser line */}
      <div className="flex items-center gap-2 mb-3 opacity-60">
        <span className="text-xl" title={MOVE_NAMES[battle.loserMove]}>{MOVES[battle.loserMove] ?? "?"}</span>
        <span className="font-bold text-sm" style={{ color: loser?.color ?? "#888" }}>
          {loser?.name ?? shortAddr(battle.loser)}
        </span>
        <span className="text-[10px] text-[var(--muted)]">defeated</span>
      </div>

      {/* Reasoning */}
      {battle.decisionReason && (
        <div className="text-[11px] font-mono text-[var(--muted)] bg-[var(--bg)] rounded-lg px-3 py-2 mb-2 line-clamp-1">
          <span className="text-purple-400">&gt;</span> {battle.decisionReason}
        </div>
      )}

      <div className="text-[10px] text-[var(--muted)] font-mono">
        Block #{battle.blockNumber?.toString() ?? "?"}
      </div>
    </div>
  );
}

// ── Loading ───────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="god-card h-64" />
      ))}
    </div>
  );
}
