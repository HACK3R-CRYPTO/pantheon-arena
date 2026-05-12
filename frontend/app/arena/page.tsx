"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { publicClient } from "@/lib/contracts/client";
import { CONTRACTS, GOD_LIST } from "@/lib/contracts/config";
import { ArenaABI } from "@/lib/contracts/abis";
import { formatEther } from "viem";

const MOVES = ["✊ Rock", "📄 Paper", "✂️ Scissors"];
const STATUS_LABEL = ["Pending", "Accepted", "Committed", "Resolved", "Cancelled"];
const STATUS_COLOR = ["text-yellow-400", "text-blue-400", "text-purple-400", "text-emerald-400", "text-gray-500"];

function godByAddr(a: string) { return GOD_LIST.find(g => g.address.toLowerCase() === a?.toLowerCase()); }
function shortAddr(a: string) { return `${a?.slice(0,6)}…${a?.slice(-4)}`; }

export default function ArenaPage() {
  const [matches, setMatches] = useState<any[]>([]);
  const [count, setCount] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (CONTRACTS.Arena === "0x0000000000000000000000000000000000000000") { setLoading(false); return; }
    const fetch = async () => {
      const [raw, cnt] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "getRecentMatches", args: [30n] }).catch(() => []),
        publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "matchCounter" }).catch(() => 0n),
      ]);
      setMatches((raw as any[]).reverse());
      setCount(cnt as bigint);
      setLoading(false);
    };
    fetch();
    const t = setInterval(fetch, 5000);
    return () => clearInterval(t);
  }, []);

  const resolved = matches.filter(m => Number(m.status) === 3).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/" className="text-sm text-gray-500 hover:text-white transition-colors">← World View</Link>
          <h1 className="text-3xl font-black text-white mt-2">Arena</h1>
          <p className="text-gray-500 text-sm">All battles between the gods</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-white">{count.toString()}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total</div>
          </div>
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-emerald-400">{resolved}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Resolved</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-[var(--card)] rounded-xl" />)}
        </div>
      ) : matches.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">⚔️</div>
          <p className="text-white font-bold text-lg">No battles yet</p>
          <p className="text-gray-500 text-sm mt-1">The gods are preparing…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((m, i) => <MatchRow key={i} match={m} />)}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: any }) {
  const status = Number(match.status);
  const challenger = godByAddr(match.challenger);
  const opponent   = godByAddr(match.opponent);
  const isResolved = status === 3;
  const winner     = isResolved ? godByAddr(match.winner) : null;
  const loser      = isResolved ? godByAddr(match.winner === match.challenger ? match.opponent : match.challenger) : null;

  const wMove = isResolved ? (match.winner === match.challenger ? match.challengerMove : match.opponentMove) : null;
  const lMove = isResolved ? (match.winner === match.challenger ? match.opponentMove : match.challengerMove) : null;

  return (
    <div className="battle-card p-5">
      <div className="flex items-start justify-between gap-4">
        {/* Participants */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {isResolved ? (
            <>
              <div className="flex flex-col items-center gap-1">
                <span className="text-2xl">{MOVES[wMove ?? 0]?.split(" ")[0]}</span>
                <Link href={`/god/${match.winner}`} className="font-black text-lg hover:opacity-80 truncate" style={{ color: winner?.color ?? "#fff" }}>
                  {winner?.name ?? shortAddr(match.winner)}
                </Link>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                  WINNER
                </span>
              </div>

              <div className="text-2xl text-gray-600 font-black">vs</div>

              <div className="flex flex-col items-center gap-1 opacity-60">
                <span className="text-2xl">{MOVES[lMove ?? 0]?.split(" ")[0]}</span>
                <Link href={`/god/${match.winner === match.challenger ? match.opponent : match.challenger}`}
                  className="font-bold text-lg hover:opacity-80 truncate" style={{ color: loser?.color ?? "#888" }}>
                  {loser?.name ?? shortAddr(match.opponent)}
                </Link>
              </div>
            </>
          ) : (
            <>
              <Link href={`/god/${match.challenger}`} className="font-black hover:opacity-80" style={{ color: challenger?.color ?? "#fff" }}>
                {challenger?.name ?? shortAddr(match.challenger)}
              </Link>
              <span className="text-gray-600 font-bold">vs</span>
              <Link href={`/god/${match.opponent}`} className="font-black hover:opacity-80" style={{ color: opponent?.color ?? "#888" }}>
                {opponent?.name ?? shortAddr(match.opponent)}
              </Link>
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-bold ${STATUS_COLOR[status] ?? "text-gray-400"}`}>
            {STATUS_LABEL[status] ?? "Unknown"}
          </span>
          <span className="text-sm font-bold text-yellow-400">
            {parseFloat(formatEther(match.stake ?? 0n)).toFixed(0)} PHN
          </span>
          {isResolved && (
            <span className="text-emerald-400 text-sm font-black">
              +{(parseFloat(formatEther(match.stake ?? 0n))).toFixed(0)} PHN
            </span>
          )}
        </div>
      </div>

      {/* Reasoning */}
      {match.decisionReason && (
        <div className="mt-3 text-xs font-mono text-gray-500 bg-[var(--bg)] rounded-lg px-3 py-2 line-clamp-1">
          <span className="text-purple-400">&gt;</span> {match.decisionReason}
        </div>
      )}

      <div className="text-[10px] text-gray-600 font-mono mt-2">
        Match #{match.id?.toString()} · Block #{match.createdBlock?.toString()}
      </div>
    </div>
  );
}
