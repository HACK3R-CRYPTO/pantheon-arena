"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, GodMindABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

const MOVES = ["✊ Rock", "📄 Paper", "✂️ Scissors"];
const ACTIONS: Record<string, { icon: string; label: string }> = {
  CHALLENGE: { icon: "⚔️", label: "Challenged" },
  COMMIT:    { icon: "🤫", label: "Committed" },
  REVEAL:    { icon: "🎯", label: "Revealed" },
  IDLE:      { icon: "😴", label: "Rested" },
};

function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }
function godByAddr(addr: string) { return GOD_LIST.find(g => g.address.toLowerCase() === addr?.toLowerCase()); }

export default function GodProfile() {
  const params = useParams();
  const address = params.address as `0x${string}`;

  const [personality, setPersonality] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  const knownGod = godByAddr(address);

  useEffect(() => {
    if (!address || CONTRACTS.GodRegistry === "0x0000000000000000000000000000000000000000") {
      setLoading(false); return;
    }
    Promise.all([
      publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getPersonality", args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getStats", args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACTS.GodMind, abi: GodMindABI, functionName: "getDecisionHistory", args: [address, 20n] }).catch(() => []),
      publicClient.readContract({ address: CONTRACTS.PantheonToken, abi: PantheonTokenABI, functionName: "balanceOf", args: [address] }).catch(() => 0n),
    ]).then(([pers, st, dec, bal]) => {
      setPersonality(pers);
      setStats(st);
      setDecisions(dec as any[]);
      setBalance(bal as bigint);
      setLoading(false);
    });
  }, [address]);

  const name = personality?.name || knownGod?.name || shortAddr(address);
  const color = personality?.color || knownGod?.color || "#888";
  const wins = Number(stats?.wins ?? 0);
  const losses = Number(stats?.losses ?? 0);
  const total = wins + losses;
  const wr = total === 0 ? 0 : Math.round(wins / total * 100);

  if (loading) return (
    <div className="max-w-2xl mx-auto px-4 py-12 animate-pulse space-y-4">
      <div className="h-8 bg-[var(--card)] rounded w-48" />
      <div className="h-64 bg-[var(--card)] rounded-xl" />
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-white transition-colors mb-6">
        ← Back to World
      </Link>

      {/* ── God Header Card ───────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border mb-6" style={{
        borderColor: `${color}40`,
        background: `linear-gradient(135deg, var(--card) 0%, ${color}08 100%)`
      }}>
        <div className="h-2" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-5xl font-black mb-1" style={{ color }}>{name}</div>
              <div className="text-[var(--muted)]">{personality?.epithet || knownGod?.epithet}</div>
              <div className="text-xs font-mono text-[var(--muted)] mt-1">{address}</div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black text-white">{Number(stats?.powerScore ?? 1000).toLocaleString()}</div>
              <div className="text-xs text-[var(--muted)] uppercase tracking-wider">power</div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {[
              { label: "Wins",     value: wins,                      color: "text-emerald-400" },
              { label: "Losses",   value: losses,                    color: "text-red-400" },
              { label: "Win Rate", value: `${wr}%`,                  color: "text-white" },
              { label: "Treasury", value: `${parseFloat(formatEther(balance)).toFixed(0)}`, color: "text-yellow-400" },
            ].map(s => (
              <div key={s.label} className="bg-[var(--bg)] rounded-xl p-3 text-center">
                <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-[var(--muted)] uppercase tracking-wider">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Personality */}
          {personality && (
            <div className="space-y-2 mb-5">
              {[
                { label: "Aggression",    value: personality.aggression },
                { label: "Risk Tolerance", value: personality.riskTolerance },
                { label: "Adaptability",  value: personality.adaptability },
              ].map(p => (
                <div key={p.label} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--muted)] w-28 shrink-0">{p.label}</span>
                  <div className="flex-1 h-2 bg-[var(--border)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${p.value}%`, background: color }} />
                  </div>
                  <span className="text-xs font-mono text-[var(--muted)] w-8 text-right">{p.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Onchain lore */}
          {personality?.lore && (
            <div className="rounded-xl p-4" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color }}>
                Onchain Personality — LLM Prompt
              </div>
              <p className="text-sm text-white leading-relaxed">{personality.lore}</p>
              <p className="text-[10px] text-[var(--muted)] mt-2 italic">
                Stored permanently on Somnia. Used as the AI system prompt for every decision.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Decision History ──────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-[var(--muted)] uppercase tracking-widest mb-4">
          Onchain Decision Log
        </h2>

        {decisions.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            No decisions logged yet.
          </div>
        ) : (
          <div className="space-y-3">
            {decisions.map((d: any, i: number) => {
              const target = godByAddr(d.target);
              const act = ACTIONS[d.action] || { icon: "?", label: d.action };
              return (
                <div key={i} className="rounded-xl border border-[var(--border)] p-4 bg-[var(--card)]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span>{act.icon}</span>
                      <span className="font-bold text-white">{act.label}</span>
                      {d.target && d.target !== "0x0000000000000000000000000000000000000000" && (
                        <Link href={`/god/${d.target}`} className="font-black hover:opacity-80" style={{ color: target?.color || "#888" }}>
                          {target?.name || shortAddr(d.target)}
                        </Link>
                      )}
                    </div>
                    <span className="text-xs font-mono text-[var(--muted)]">Block #{d.blockNumber?.toString()}</span>
                  </div>

                  {Number(d.stake) > 0 && (
                    <div className="text-xs text-yellow-400 mb-2">
                      💰 {parseFloat(formatEther(d.stake)).toFixed(0)} PHN
                    </div>
                  )}

                  {d.action !== "IDLE" && d.action !== "CHALLENGE" && (
                    <div className="text-xs text-[var(--muted)] mb-2">Move: {MOVES[d.move] || "?"}</div>
                  )}

                  <div className="rounded-lg p-2.5 font-mono text-xs leading-relaxed" style={{
                    background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.1)"
                  }}>
                    <span className="text-purple-400 mr-1">&gt;</span>
                    <span className="text-[var(--muted)]">{d.reasoning}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
