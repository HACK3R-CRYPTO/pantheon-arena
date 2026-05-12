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
  "event MatchResolved(uint256 indexed matchId, address indexed winner, address indexed loser, uint256 stake, uint8 winnerMove, uint8 loserMove, string decisionReason)",
  "event MatchProposed(uint256 indexed matchId, address indexed challenger, address indexed opponent, uint256 stake)",
]);

const WorldStateABI = parseAbi([
  "function totalBattles() external view returns (uint256)",
  "function era() external view returns (uint256)",
  "event WorldEventApplied(uint256 indexed era, string description)",
  "event ETHPriceFetched(uint256 requestId, uint256 price, string worldImpact)",
]);

// ── Decision Loop ─────────────────────────────────────────────────────────────

const INTERVAL_MS = 15_000; // 15s between decision rounds
let busy = false;

async function runDecisionRound() {
  if (busy) return;
  busy = true;

  for (let i = 0; i < GODS.length; i++) {
    const god = GODS[i]!;
    try {
      // Stagger each god by 2s to avoid nonce conflicts
      if (i > 0) await sleep(2000);

      const hash = await walletClient.writeContract({
        address: CONTRACTS.GodMind,
        abi: GodMindABI,
        functionName: "executeDecision",
        args: [god.address],
        account,
        gas: BigInt(50_000_000), // Somnia charges much more gas than standard EVM
      });

      console.log(chalk.hex(god.color)(`[${god.name}]`) + chalk.gray(` → ${hash.slice(0, 14)}…`));
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || "";
      if (msg.includes("CooldownActive")) {
        console.log(chalk.gray(`[${god.name}] cooldown`));
      } else if (msg.includes("GodBusy")) {
        console.log(chalk.gray(`[${god.name}] in match`));
      } else {
        console.error(chalk.red(`[${god.name}] ${msg.slice(0, 100)}`));
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

  // Watch events
  watchEvents();

  // Run immediately then on interval
  await runDecisionRound();
  setInterval(runDecisionRound, INTERVAL_MS);

  console.log(chalk.green("✓ Gods are autonomous.\n"));
}

start().catch(err => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
