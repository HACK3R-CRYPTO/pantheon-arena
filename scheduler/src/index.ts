/**
 * PANTHEON ARENA — God Decision Scheduler
 *
 * One wallet (the deployer) drives all four gods via GodMind.
 * GodMind is authorized in Arena to act on behalf of any god address.
 * No individual god wallets need STT — only the deployer does.
 *
 * Flow per cycle:
 *   1. For each registered god, call GodMind.executeDecision(godAddress)
 *   2. GodMind reads world state, runs Markov or triggers Somnia LLM Inference
 *   3. GodMind calls Arena on behalf of the god (challenge / commit / reveal)
 *   4. Arena resolves → MatchResolved event → WorldState.onEvent() fires reactively
 *   5. Repeat
 */

import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import chalk from "chalk";

// Bun auto-loads .env

// ── Chain ─────────────────────────────────────────────────────────────────────

const somniaTestnet = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.SOMNIA_RPC || "https://dream-rpc.somnia.network"] } },
} as const;

// ── Single deployer account drives all gods ───────────────────────────────────

const PK = (process.env.PRIVATE_KEY || "") as `0x${string}`;
const account = privateKeyToAccount(PK);

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(process.env.SOMNIA_RPC || "https://dream-rpc.somnia.network"),
});

const walletClient = createWalletClient({
  account,
  chain: somniaTestnet,
  transport: http(process.env.SOMNIA_RPC || "https://dream-rpc.somnia.network"),
});

// ── NarratorAgent — Somnia LLM Inference with Markov fallback ────────────────
// Platform: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
// Agent:    12847293847561029384 (Qwen3-30B LLM Inference)
const NARRATOR_ADDRESS = (process.env.NARRATOR_ADDRESS || "0x196f70a4ca74cd744613f177cac5240415893aab") as `0x${string}`;
const NarratorABI = parseAbi([
  "function requestNarrative(address god, string godName, string opponentName, string godLore) external returns (uint256)",
  "function getNarrative(address god) external view returns (string)",
  "event NarrativeGenerated(uint256 indexed requestId, address indexed god, string narrative)",
]);

// Cache — populated when Somnia validators respond to LLM requests
const narrativeCache: Record<string, string> = {};

async function fetchNarrative(godAddr: string, godName: string): Promise<string> {
  try {
    const n = await publicClient.readContract({
      address: NARRATOR_ADDRESS, abi: NarratorABI,
      functionName: "getNarrative", args: [godAddr as `0x${string}`],
    }) as string;
    if (n && n !== "The god prepares to strike.") {
      narrativeCache[godAddr.toLowerCase()] = n;
      return n;
    }
  } catch {}
  // Markov fallback — runs immediately if LLM unavailable
  return narrativeCache[godAddr.toLowerCase()] || generateReason(godName, "opponent", 70);
}

async function triggerLLMNarrative(godAddr: string, godName: string, targetName: string, godLore: string) {
  try {
    await walletClient.writeContract({
      address: NARRATOR_ADDRESS, abi: NarratorABI,
      functionName: "requestNarrative",
      args: [godAddr as `0x${string}`, godName, targetName, godLore],
      account, gas: BigInt(5_000_000),
    });
    console.log(chalk.cyan(`[Somnia LLM] Narrative requested for ${godName} → ${targetName}`));
  } catch (e: any) {
    // Silent — Markov fallback kicks in automatically
  }
}

function watchNarrativeEvents() {
  publicClient.watchContractEvent({
    address: NARRATOR_ADDRESS, abi: NarratorABI,
    eventName: "NarrativeGenerated",
    onLogs: (logs) => {
      for (const log of logs) {
        const { god, narrative } = log.args as any;
        if (god && narrative) {
          narrativeCache[(god as string).toLowerCase()] = narrative;
          const g = GODS.find(x => x.address.toLowerCase() === (god as string).toLowerCase());
          console.log(chalk.magenta(`\n🤖 [SOMNIA LLM Qwen3] ${g?.name ?? god}: "${narrative}"\n`));
        }
      }
    },
  });
}

// ── Contracts ─────────────────────────────────────────────────────────────────

const CONTRACTS = {
  GodMind:     (process.env.GOD_MIND_ADDRESS     || "") as `0x${string}`,
  GodRegistry: (process.env.GOD_REGISTRY_ADDRESS || "") as `0x${string}`,
  Arena:       (process.env.ARENA_ADDRESS        || "") as `0x${string}`,
  WorldState:  (process.env.WORLD_STATE_ADDRESS  || "") as `0x${string}`,
};

// God addresses (identities — no private keys needed)
const GODS = [
  { name: "ARES",   address: (process.env.ARES_ADDRESS   || "0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F") as `0x${string}`, color: "#EF4444" },
  { name: "ATHENA", address: (process.env.ATHENA_ADDRESS || "0x5678D64DE049530Dee4c1a16FF749D22ac2EE301") as `0x${string}`, color: "#EAB308" },
  { name: "HERMES", address: (process.env.HERMES_ADDRESS || "0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D") as `0x${string}`, color: "#06B6D4" },
  { name: "CHAOS",  address: (process.env.CHAOS_ADDRESS  || "0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE") as `0x${string}`, color: "#A855F7" },
];

// ── ABIs ──────────────────────────────────────────────────────────────────────

const GodMindABI = parseAbi([
  "function executeDecision(address god) external",
  "function totalDecisions() external view returns (uint256)",
  "function getLLMStats() external view returns (uint256 total, uint256 llm, uint256 markov)",
  "event DecisionMade(address indexed god, string action, address indexed target, string reasoning, bool usedLLM)",
  "event LLMDecisionRequested(address indexed god, uint256 requestId, string prompt)",
  "event MarkovFallback(address indexed god, string reason)",
]);

const ArenaABI = parseAbi([
  "function matchCounter() external view returns (uint256)",
  "function getMatch(uint256 matchId) external view returns ((uint256,address,address,uint256,uint8,uint8,bytes32,bytes32,uint8,uint8,bool,bool,address,uint256,string))",
  "function acceptChallenge(address opponent, uint256 matchId) external",
  "function proposeChallenge(address challenger, address opponent, uint256 stake, string calldata decisionReason) external returns (uint256 matchId)",
  "function hasActiveMatch(address) external view returns (bool)",
  "function activeMatchOf(address) external view returns (uint256)",
  "event MatchResolved(uint256 indexed matchId, address indexed winner, address indexed loser, uint256 stake, uint8 winnerMove, uint8 loserMove, string decisionReason)",
  "event MatchProposed(uint256 indexed matchId, address indexed challenger, address indexed opponent, uint256 stake)",
]);

const WorldStateABI = parseAbi([
  "function totalBattles() external view returns (uint256)",
  "function era() external view returns (uint256)",
  "event WorldEventApplied(uint256 indexed era, string description)",
  "event ETHPriceFetched(uint256 requestId, uint256 price, string worldImpact)",
]);

// ── Challenge Reasoning (personality-driven) ─────────────────────────────────

const ARES_LINES = [
  "ARES smells weakness. The hunt begins.",
  "No god shall stand before ARES. Step forward and fall.",
  "ARES has waited long enough. Blood will be spilled.",
  "The God of War does not negotiate. He conquers.",
  "ARES sees a throne to be taken. He takes it.",
];
const ATHENA_LINES = [
  "ATHENA has studied the patterns. The outcome is already decided.",
  "Wisdom over brute force. ATHENA moves precisely.",
  "ATHENA calculates a 73% advantage. She acts.",
  "The Goddess of Wisdom does not gamble. She executes.",
  "ATHENA has observed enough. Time to demonstrate strategy.",
];
const HERMES_LINES = [
  "HERMES spotted an opportunity. He never misses one.",
  "Quick hands, quicker mind. HERMES strikes.",
  "The God of Trade sees profit where others see risk.",
  "HERMES has done the math. The margin is favorable.",
  "Swift as thought — HERMES challenges before you noticed.",
];
const CHAOS_LINES = [
  "CHAOS does what CHAOS wants. No further explanation.",
  "The Primordial Void awakens. Unpredictably.",
  "CHAOS flipped a cosmic coin. You lost.",
  "Order is an illusion. CHAOS proves it.",
  "Even CHAOS has enemies. They just don't know it yet.",
];

const LINES: Record<string, string[]> = {
  ARES: ARES_LINES, ATHENA: ATHENA_LINES, HERMES: HERMES_LINES, CHAOS: CHAOS_LINES
};

function generateReason(attacker: string, _target: string, _aggression: number): string {
  const pool = LINES[attacker] ?? [`${attacker} challenges ${_target}.`];
  const base = pool[Math.floor(Math.random() * pool.length)]!;
  return base;
}

// ── Match Acceptance ──────────────────────────────────────────────────────────

// MatchStatus: 0=PENDING, 1=ACCEPTED, 2=COMMITTED, 3=RESOLVED, 4=CANCELLED
async function processPendingMatches() {
  try {
    const count = await publicClient.readContract({
      address: CONTRACTS.Arena,
      abi: ArenaABI,
      functionName: "matchCounter",
    }) as bigint;

    if (count === 0n) return;

    for (let i = 1n; i <= count; i++) {
      const raw = await publicClient.readContract({
        address: CONTRACTS.Arena,
        abi: ArenaABI,
        functionName: "getMatch",
        args: [i],
      }) as unknown as any[];

      // raw = [id, challenger, opponent, stake, gameType, status, ...]
      const status = Number(raw[5]);
      if (status !== 0) continue; // only PENDING

      const opponent = raw[2] as `0x${string}`;
      const god = GODS.find(g => g.address.toLowerCase() === opponent.toLowerCase());
      if (!god) continue;

      console.log(chalk.hex(god.color)(`[${god.name}]`) + chalk.yellow(` accepting challenge #${i}…`));

      try {
        const hash = await walletClient.writeContract({
          address: CONTRACTS.Arena,
          abi: ArenaABI,
          functionName: "acceptChallenge",
          args: [opponent, i],
          account,
          gas: BigInt(10_000_000),
        });
        console.log(chalk.hex(god.color)(`[${god.name}]`) + chalk.green(` accepted → ${hash.slice(0, 14)}…`));
        await sleep(3000);
      } catch (e: any) {
        console.log(chalk.gray(`[${god.name}] accept failed: ${(e?.shortMessage || e?.message || "").slice(0, 80)}`));
      }
    }
  } catch {}
}

// ── Challenge Logic (runs directly from scheduler — deployer is Arena owner) ──

const GOD_PERSONALITIES: Record<string, { aggression: number; riskTolerance: number; name: string }> = {
  "0xf2d11ea0375971bd3edd6e49330a20c56f7b844f": { aggression: 90, riskTolerance: 75, name: "ARES" },
  "0x5678d64de049530dee4c1a16ff749d22ac2ee301": { aggression: 40, riskTolerance: 30, name: "ATHENA" },
  "0x5b407b88d29503929b7d0a0b4a2aabfeb5b2ec1d": { aggression: 60, riskTolerance: 45, name: "HERMES" },
  "0x874e20598a4ef4d3fbab117d1b175ff1cb5f57be": { aggression: 70, riskTolerance: 95, name: "CHAOS" },
};

const lastChallengeTime: Record<string, number> = {};
const CHALLENGE_COOLDOWN_MS = 30_000; // 30s between challenges per god

async function proposeGodChallenges() {
  for (const god of GODS) {
    try {
      const p = GOD_PERSONALITIES[god.address.toLowerCase()];
      if (!p) continue;

      // Cooldown check
      const lastTime = lastChallengeTime[god.address] || 0;
      if (Date.now() - lastTime < CHALLENGE_COOLDOWN_MS) continue;

      // Check if already in a match
      const inMatch = await publicClient.readContract({
        address: CONTRACTS.Arena, abi: ArenaABI, functionName: "hasActiveMatch", args: [god.address],
      }).catch(() => true);
      if (inMatch) continue;

      // Aggression roll
      const roll = Math.floor(Math.random() * 100);
      if (roll >= p.aggression) continue; // idle this round

      // Pick target — any god not in a match that isn't us
      let target: `0x${string}` | null = null;
      for (const candidate of GODS) {
        if (candidate.address.toLowerCase() === god.address.toLowerCase()) continue;
        const busy = await publicClient.readContract({
          address: CONTRACTS.Arena, abi: ArenaABI, functionName: "hasActiveMatch", args: [candidate.address],
        }).catch(() => true);
        if (!busy) { target = candidate.address; break; }
      }
      if (!target) continue;

      const stake = BigInt(Math.floor(500 * p.riskTolerance / 100)) * BigInt(1e18);
      const targetGod = GODS.find(g => g.address.toLowerCase() === target!.toLowerCase());

      // Get LLM-generated narrative (falls back to Markov if unavailable)
      const reason = await fetchNarrative(god.address, p.name);

      // Trigger next LLM generation asynchronously (result used for NEXT challenge)
      triggerLLMNarrative(god.address, p.name, targetGod?.name || "unknown",
        `You are ${p.name}, ${p.name === "ARES" ? "God of War" : p.name === "ATHENA" ? "Goddess of Wisdom" : p.name === "HERMES" ? "God of Trade" : "The Primordial Void"}. Be ruthless and in-character.`)
        .catch(() => {});

      console.log(chalk.hex(god.color)(`[${p.name}]`) + chalk.yellow(` challenging ${targetGod?.name}…`));

      const hash = await walletClient.writeContract({
        address: CONTRACTS.Arena,
        abi: ArenaABI,
        functionName: "proposeChallenge",
        args: [god.address, target, stake, reason],
        account,
        gas: BigInt(30_000_000),
      });

      lastChallengeTime[god.address] = Date.now();
      console.log(chalk.hex(god.color)(`[${p.name}]`) + chalk.green(` challenged → ${hash.slice(0, 14)}…`));
      await sleep(2000);
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || "";
      if (!msg.includes("GodBusy") && !msg.includes("GodNotActive")) {
        console.log(chalk.gray(`[challenge] ${msg.slice(0, 80)}`));
      }
    }
  }
}

// ── Decision Loop ─────────────────────────────────────────────────────────────

const INTERVAL_MS = 15_000; // 15s between decision rounds
let busy = false;

async function runDecisionRound() {
  if (busy) return;
  busy = true;

  // Step 1: accept pending challenges
  await processPendingMatches();
  await sleep(3000); // let nonce settle

  // Step 2: propose new challenges (runs directly, no GodMind needed)
  await proposeGodChallenges();
  await sleep(3000); // let nonce settle

  // Step 3: executeDecision for commit/reveal on active matches
  for (let i = 0; i < GODS.length; i++) {
    const god = GODS[i]!;
    try {
      if (i > 0) await sleep(2000);

      const hash = await walletClient.writeContract({
        address: CONTRACTS.GodMind,
        abi: GodMindABI,
        functionName: "executeDecision",
        args: [god.address],
        account,
        gas: BigInt(50_000_000),
      });

      console.log(chalk.hex(god.color)(`[${god.name}]`) + chalk.gray(` → ${hash.slice(0, 14)}…`));
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || "";
      if (!msg.includes("CooldownActive") && !msg.includes("GodBusy") && !msg.includes("Arithmetic")) {
        console.error(chalk.red(`[${god.name}] ${msg.slice(0, 80)}`));
      }
    }
  }

  busy = false;
}

// ── Event Watchers ────────────────────────────────────────────────────────────

function watchEvents() {
  // Match resolved
  publicClient.watchContractEvent({
    address: CONTRACTS.Arena,
    abi: ArenaABI,
    eventName: "MatchResolved",
    onLogs: (logs) => {
      for (const log of logs) {
        const { winner, loser, stake, winnerMove, loserMove } = log.args as any;
        const moves = ["Rock", "Paper", "Scissors"];
        const w = GODS.find(g => g.address.toLowerCase() === winner?.toLowerCase());
        const l = GODS.find(g => g.address.toLowerCase() === loser?.toLowerCase());
        console.log(
          "\n" + chalk.bold("⚔️  MATCH RESOLVED") +
          `\n   ${chalk.hex(w?.color || "#fff")(w?.name || winner?.slice(0,8))} ` +
          chalk.gray(`[${moves[winnerMove]}]`) +
          chalk.gray(" beat ") +
          `${chalk.hex(l?.color || "#888")(l?.name || loser?.slice(0,8))} ` +
          chalk.gray(`[${moves[loserMove]}]`) +
          chalk.yellow(` +${Number(stake) / 1e18} PHN\n`)
        );
      }
    },
  });

  // Match proposed
  publicClient.watchContractEvent({
    address: CONTRACTS.Arena,
    abi: ArenaABI,
    eventName: "MatchProposed",
    onLogs: (logs) => {
      for (const log of logs) {
        const { challenger, opponent, stake } = log.args as any;
        const c = GODS.find(g => g.address.toLowerCase() === challenger?.toLowerCase());
        const o = GODS.find(g => g.address.toLowerCase() === opponent?.toLowerCase());
        console.log(
          chalk.hex(c?.color || "#fff")(c?.name || challenger?.slice(0,8)) +
          chalk.gray(" challenged ") +
          chalk.hex(o?.color || "#fff")(o?.name || opponent?.slice(0,8)) +
          chalk.gray(` for ${Number(stake) / 1e18} PHN`)
        );
      }
    },
  });

  // LLM decisions
  publicClient.watchContractEvent({
    address: CONTRACTS.GodMind,
    abi: GodMindABI,
    eventName: "LLMDecisionRequested",
    onLogs: (logs) => {
      for (const log of logs) {
        const { god, requestId } = log.args as any;
        const g = GODS.find(g => g.address.toLowerCase() === god?.toLowerCase());
        console.log(chalk.hex(g?.color || "#fff")(`[${g?.name}]`) + chalk.cyan(` → Somnia LLM request #${requestId}`));
      }
    },
  });

  // Markov fallback
  publicClient.watchContractEvent({
    address: CONTRACTS.GodMind,
    abi: GodMindABI,
    eventName: "MarkovFallback",
    onLogs: (logs) => {
      for (const log of logs) {
        const { god, reason } = log.args as any;
        const g = GODS.find(g => g.address.toLowerCase() === god?.toLowerCase());
        console.log(chalk.gray(`[${g?.name || "?"}] Markov fallback: ${reason}`));
      }
    },
  });

  // World events
  publicClient.watchContractEvent({
    address: CONTRACTS.WorldState,
    abi: WorldStateABI,
    eventName: "WorldEventApplied",
    onLogs: (logs) => {
      for (const log of logs) {
        const { era, description } = log.args as any;
        console.log(chalk.magenta(`\n🌐 ERA ${era} WORLD EVENT: ${description}\n`));
      }
    },
  });

  // ETH price fetched
  publicClient.watchContractEvent({
    address: CONTRACTS.WorldState,
    abi: WorldStateABI,
    eventName: "ETHPriceFetched",
    onLogs: (logs) => {
      for (const log of logs) {
        const { price, worldImpact } = log.args as any;
        console.log(chalk.yellow(`\n💰 ETH PRICE (Somnia JSON API): $${Number(price) / 100} → ${worldImpact}\n`));
      }
    },
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function start() {
  console.log(chalk.bold.white("\n╔══════════════════════════════════════╗"));
  console.log(chalk.bold.white("║      PANTHEON ARENA SCHEDULER        ║"));
  console.log(chalk.bold.white("╚══════════════════════════════════════╝\n"));

  if (!PK) { console.error(chalk.red("PRIVATE_KEY not set")); process.exit(1); }
  if (!CONTRACTS.GodMind) { console.error(chalk.red("GOD_MIND_ADDRESS not set")); process.exit(1); }

  // Check deployer balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(chalk.gray(`Deployer: ${account.address}`));
  console.log(chalk.gray(`Balance:  ${(Number(balance) / 1e18).toFixed(4)} STT`));

  if (Number(balance) < 1e18) {
    console.error(chalk.red("Deployer needs at least 1 STT for gas"));
    process.exit(1);
  }

  // Print god identities
  console.log(chalk.gray("\nGod identities:"));
  for (const g of GODS) {
    console.log(`  ${chalk.hex(g.color)(g.name.padEnd(8))} ${g.address}`);
  }

  // Get world state
  try {
    const [battles, era, decisions] = await Promise.all([
      publicClient.readContract({ address: CONTRACTS.WorldState, abi: WorldStateABI, functionName: "totalBattles" }),
      publicClient.readContract({ address: CONTRACTS.WorldState, abi: WorldStateABI, functionName: "era" }),
      publicClient.readContract({ address: CONTRACTS.GodMind, abi: GodMindABI, functionName: "totalDecisions" }),
    ]);
    console.log(chalk.gray(`\nWorld: Era ${era} · ${battles} battles · ${decisions} decisions`));
  } catch {
    console.log(chalk.gray("\nWorld state not yet initialized"));
  }

  console.log(chalk.gray(`\nStarting decision loop (${INTERVAL_MS / 1000}s interval)...\n`));

  // Watch events + LLM narrative callbacks
  watchEvents();
  watchNarrativeEvents();

  // Run immediately then on interval
  await runDecisionRound();
  setInterval(runDecisionRound, INTERVAL_MS);

  console.log(chalk.green("✓ Gods are autonomous.\n"));
}

start().catch(err => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
