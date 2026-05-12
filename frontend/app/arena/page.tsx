"use client";

import { useEffect, useState } from "react";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { ArenaABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

const MOVES = ["✊ Rock", "📄 Paper", "✂️ Scissors"];
const STATUS = ["Pending", "Accepted", "Committed", "Resolved", "Cancelled"];
const STATUS_COLORS = [
  "text-yellow-400",
  "text-blue-400",
  "text-purple-400",
  "text-green-400",
  "text-[var(--muted)]",
];

function godByAddress(addr: string) {
  return GOD_LIST.find(g => g.address.toLowerCase() === addr.toLowerCase());
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function ArenaPage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [matchCount, setMatchCount] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (CONTRACTS.Arena === "0x0000000000000000000000000000000000000000") {
      setLoading(false);
      return;
    }

    const fetch = async () => {
      const [recent, count] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.Arena,
          abi: ArenaABI,
          functionName: "getRecentMatches",
          args: [30n],
        }).catch(() => []),
        publicClient.readContract({
          address: CONTRACTS.Arena,
          abi: ArenaABI,
          functionName: "matchCounter",
        }).catch(() => 0n),
      ]);
      setMatches(recent as any[]);
      setMatchCount(count as bigint);
      setLoading(false);
    };

    fetch();
    const interval = setInterval(fetch, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <a href="/" className="text-sm text-[var(--muted)] hover:text-white transition-colors">← World View</a>
          <h1 className="text-2xl font-black text-white mt-2">Arena</h1>
          <p className="text-sm text-[var(--muted)]">All battles fought by the gods</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white font-mono">{matchCount.toString()}</div>
          <div className="text-xs text-[var(--muted)]">total matches</div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-[var(--surface)] rounded-lg" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="text-center py-16 text-[var(--muted)]">
          No matches yet. The gods are preparing for battle.
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((m, i) => (
            <MatchRow key={i} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: any }) {
  const challenger = godByAddress(match.challenger);
  const opponent = godByAddress(match.opponent);
  const winner = match.winner !== "0x0000000000000000000000000000000000000000"
    ? godByAddress(match.winner) : null;

  const isResolved = match.status === 3;

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4">
      <div className="flex items-center justify-between">
        {/* Participants */}
        <div className="flex items-center gap-3">
          <a href={`/god/${match.challenger}`} className="font-bold hover:underline"
             style={{ color: challenger?.color || "#888" }}>
            {challenger?.name || shortAddr(match.challenger)}
          </a>
          <span className="text-[var(--muted)] text-sm">vs</span>
          <a href={`/god/${match.opponent}`} className="font-bold hover:underline"
             style={{ color: opponent?.color || "#888" }}>
            {opponent?.name || shortAddr(match.opponent)}
          </a>
        </div>

        {/* Status */}
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${STATUS_COLORS[match.status]}`}>
            {STATUS[match.status]}
          </span>
          <span className="text-xs text-[var(--muted)] font-mono">
            {parseFloat(formatEther(match.stake)).toFixed(0)} PHN
          </span>
        </div>
      </div>

      {/* Resolution details */}
      {isResolved && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span className="text-[var(--muted)]">Winner:</span>
          <span className="font-bold" style={{ color: winner?.color || "#888" }}>
            {winner?.name || shortAddr(match.winner)}
          </span>
          <span className="text-[var(--muted)] text-xs">
            {MOVES[match.winnerMove]} beat {MOVES[match.loserMove]}
          </span>
        </div>
      )}

      {/* Decision reasoning */}
      {match.decisionReason && (
        <div className="mt-2 text-xs font-mono text-[var(--muted)] bg-[var(--bg)] rounded p-2 line-clamp-2">
          <span className="text-green-400">&gt; </span>{match.decisionReason}
        </div>
      )}

      <div className="text-xs text-[var(--muted)] mt-2">Match #{match.id.toString()} · Block #{match.createdBlock.toString()}</div>
    </div>
  );
}
