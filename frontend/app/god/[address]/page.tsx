"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { GodRegistryABI, ArenaABI, GodMindABI, PantheonTokenABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

const MOVES = ["Rock", "Paper", "Scissors"];
const ACTIONS: Record<string, string> = {
  CHALLENGE: "⚔️ Challenged",
  COMMIT: "🤫 Committed move",
  REVEAL: "🎯 Revealed move",
  IDLE: "😴 Rested",
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function godByAddress(addr: string) {
  return GOD_LIST.find(g => g.address.toLowerCase() === addr.toLowerCase());
}

export default function GodProfile() {
  const params = useParams();
  const address = params.address as `0x${string}`;

  const [personality, setPersonality] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  const knownGod = godByAddress(address);

  useEffect(() => {
    if (!address || CONTRACTS.GodRegistry === "0x0000000000000000000000000000000000000000") {
      setLoading(false);
      return;
    }

    Promise.all([
      publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getPersonality", args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACTS.GodRegistry, abi: GodRegistryABI, functionName: "getStats", args: [address] }).catch(() => null),
      publicClient.readContract({ address: CONTRACTS.GodMind, abi: GodMindABI, functionName: "getDecisionHistory", args: [address, 20n] }).catch(() => []),
      publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "getGodMatchHistory", args: [address] }).catch(() => []),
      publicClient.readContract({ address: CONTRACTS.PantheonToken, abi: PantheonTokenABI, functionName: "balanceOf", args: [address] }).catch(() => 0n),
    ]).then(([pers, st, dec, matchIds, bal]) => {
      setPersonality(pers);
      setStats(st);
      setDecisions(dec as any[]);
      setBalance(bal as bigint);
      setLoading(false);
    });
  }, [address]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 animate-pulse">
        <div className="h-8 bg-[var(--surface)] rounded mb-4 w-48" />
        <div className="h-48 bg-[var(--surface)] rounded" />
      </div>
    );
  }

  const name = personality?.name || knownGod?.name || shortAddr(address);
  const color = personality?.color || knownGod?.color || "#888";
  const wins = Number(stats?.wins || 0);
  const losses = Number(stats?.losses || 0);
  const total = wins + losses;
  const wr = total === 0 ? 0 : Math.round((wins / total) * 100);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <a href="/" className="text-sm text-[var(--muted)] hover:text-white transition-colors">← World View</a>
      </div>

      <div className="god-card p-6 mb-6" style={{ borderColor: color + "44" }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-black" style={{ color }}>{name}</h1>
            <p className="text-[var(--muted)] mt-1">{personality?.epithet || knownGod?.epithet}</p>
            <p className="text-xs font-mono text-[var(--muted)] mt-2">{address}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-white font-mono">
              {Number(stats?.powerScore || 1000).toLocaleString()}
            </div>
            <div className="text-xs text-[var(--muted)]">power score</div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-3 mt-6">
          {[
            { label: "Wins", value: wins, color: "text-green-400" },
            { label: "Losses", value: losses, color: "text-red-400" },
            { label: "Win Rate", value: `${wr}%`, color: "text-white" },
            { label: "Treasury", value: `${parseFloat(formatEther(balance)).toFixed(0)} PHN`, color: "text-yellow-400" },
          ].map(s => (
            <div key={s.label} className="bg-[var(--bg)] rounded-lg p-3 text-center">
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-[var(--muted)]">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Personality */}
        {personality && (
          <div className="mt-6 space-y-2">
            {[
              { label: "Aggression", value: personality.aggression },
              { label: "Risk Tolerance", value: personality.riskTolerance },
              { label: "Adaptability", value: personality.adaptability },
            ].map(p => (
              <div key={p.label} className="flex items-center gap-3">
                <span className="text-xs text-[var(--muted)] w-28 shrink-0">{p.label}</span>
                <div className="flex-1 h-1.5 bg-[var(--border)] rounded-full">
                  <div className="h-full rounded-full" style={{ width: `${p.value}%`, background: color }} />
                </div>
                <span className="text-xs font-mono text-[var(--muted)] w-8 text-right">{p.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Lore */}
        {personality?.lore && (
          <div className="mt-6 p-4 bg-[var(--bg)] rounded-lg">
            <p className="text-xs text-[var(--muted)] uppercase tracking-widest mb-2">Onchain Persona</p>
            <p className="text-sm text-white leading-relaxed">{personality.lore}</p>
            <p className="text-xs text-[var(--muted)] mt-2 italic">
              This text is stored onchain. It is the prompt injected into every AI decision.
            </p>
          </div>
        )}
      </div>

      {/* Decision History */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--muted)] uppercase tracking-widest mb-4">
          Decision History — Onchain AI Reasoning Log
        </h2>

        {decisions.length === 0 ? (
          <div className="text-sm text-[var(--muted)] p-4 border border-[var(--border)] rounded-lg">
            No decisions logged yet. This god is still awakening.
          </div>
        ) : (
          <div className="space-y-3">
            {decisions.map((d, i) => {
              const target = godByAddress(d.target);
              return (
                <div key={i} className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{ACTIONS[d.action] || d.action}</span>
                      {d.target && d.target !== "0x0000000000000000000000000000000000000000" && (
                        <a
                          href={`/god/${d.target}`}
                          className="text-sm font-semibold hover:underline"
                          style={{ color: target?.color || "#888" }}
                        >
                          {target?.name || shortAddr(d.target)}
                        </a>
                      )}
                    </div>
                    <span className="text-xs font-mono text-[var(--muted)]">Block #{d.blockNumber.toString()}</span>
                  </div>

                  {d.stake > 0n && (
                    <div className="text-xs text-yellow-400 mb-2">
                      Stake: {parseFloat(formatEther(d.stake)).toFixed(0)} PHN
                    </div>
                  )}

                  {d.action !== "IDLE" && d.action !== "CHALLENGE" && (
                    <div className="text-xs text-[var(--muted)] mb-2">
                      Move: {MOVES[d.move] || "Unknown"}
                    </div>
                  )}

                  {/* The AI reasoning — this is the onchain decision log */}
                  <div className="bg-[var(--bg)] rounded p-3 text-xs font-mono text-[var(--muted)] leading-relaxed">
                    <span className="text-green-400 mr-2">&gt;</span>
                    {d.reasoning}
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
