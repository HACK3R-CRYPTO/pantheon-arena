/**
 * PANTHEON ARENA — God Decision Scheduler
 *
 * This TypeScript process drives the autonomous god decision loop.
 * It calls GodMind.executeDecision() for each god on a regular interval.
 *
 * On Somnia, the reactive contracts handle world state updates automatically.
 * This scheduler only needs to trigger the god decision cycle — everything
 * else (leaderboard updates, world events, diplomatic changes) fires reactively.
 *
 * In production: this would be replaced by an onchain cron (Somnia EpochTick
 * subscription on GodMind) — but for the hackathon we run it here.
 */

import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
import chalk from "chalk";

dotenv.config();

// ── Chain config ─────────────────────────────────────────────────────────────

const somniaTestnet = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: ["https://dream-rpc.somnia.network"] } },
} as const;

// ── Contract addresses (set from .env after deployment) ──────────────────────

const CONTRACTS = {
  GodMind:     (process.env.GOD_MIND_ADDRESS     || "") as `0x${string}`,
  GodRegistry: (process.env.GOD_REGISTRY_ADDRESS || "") as `0x${string}`,
  Arena:       (process.env.ARENA_ADDRESS        || "") as `0x${string}`,
  WorldState:  (process.env.WORLD_STATE_ADDRESS  || "") as `0x${string}`,
};

// ── God wallets (one private key per god) ────────────────────────────────────

const GOD_KEYS = [
  { name: "ARES",   key: process.env.ARES_PRIVATE_KEY   as `0x${string}`, color: "#EF4444" },
  { name: "ATHENA", key: process.env.ATHENA_PRIVATE_KEY as `0x${string}`, color: "#EAB308" },
  { name: "HERMES", key: process.env.HERMES_PRIVATE_KEY as `0x${string}`, color: "#06B6D4" },
  { name: "CHAOS",  key: process.env.CHAOS_PRIVATE_KEY  as `0x${string}`, color: "#A855F7" },
].filter(g => g.key);

// ── ABIs ──────────────────────────────────────────────────────────────────────

const GodMindABI = parseAbi([
  "function executeDecision(address god) external",
  "function totalDecisions() external view returns (uint256)",
  "event DecisionMade(address indexed god, string action, address indexed target, string reasoning)",
]);

const GodRegistryABI = parseAbi([
  "function getGodCount() external view returns (uint256)",
  "function getGodAt(uint256 index) external view returns (address)",
]);

const ArenaABI = parseAbi([
  "function matchCounter() external view returns (uint256)",
  "event MatchResolved(uint256 indexed matchId, address indexed winner, address indexed loser, uint256 stake, uint8 winnerMove, uint8 loserMove, string decisionReason)",
  "event MatchProposed(uint256 indexed matchId, address indexed challenger, address indexed opponent, uint256 stake)",
]);

// ── Clients ───────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http("https://dream-rpc.somnia.network"),
});

const godClients = GOD_KEYS.map(g => ({
  ...g,
  account: privateKeyToAccount(g.key),
  wallet: createWalletClient({
    account: privateKeyToAccount(g.key),
    chain: somniaTestnet,
    transport: http("https://dream-rpc.somnia.network"),
  }),
}));

// ── Decision Loop ─────────────────────────────────────────────────────────────

const DECISION_INTERVAL_MS = 12_000; // Every 12 seconds (~every block on Somnia)
const inProgress = new Set<string>();

async function triggerGodDecision(god: typeof godClients[0]) {
  if (inProgress.has(god.name)) return;
  inProgress.add(god.name);

  try {
    const hash = await god.wallet.writeContract({
      address: CONTRACTS.GodMind,
      abi: GodMindABI,
      functionName: "executeDecision",
      args: [god.account.address],
      account: god.account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 15_000 });

    if (receipt.status === "success") {
      console.log(chalk.hex(god.color)(`[${god.name}]`) + chalk.gray(` Decision executed · TX: ${hash.slice(0, 10)}…`));
    } else {
      console.log(chalk.yellow(`[${god.name}] Decision reverted`));
    }
  } catch (err: any) {
    const msg = err?.shortMessage || err?.message || String(err);
    // Ignore expected reverts (cooldown, busy, no active match)
    if (!msg.includes("CooldownActive") && !msg.includes("GodBusy")) {
      console.error(chalk.red(`[${god.name}] Error: ${msg.slice(0, 120)}`));
    } else {
      console.log(chalk.gray(`[${god.name}] ${msg.includes("CooldownActive") ? "Cooldown" : "Busy"}`));
    }
  } finally {
    inProgress.delete(god.name);
  }
}

async function runDecisionRound() {
  // Stagger each god's decision by 1s to avoid nonce conflicts
  for (let i = 0; i < godClients.length; i++) {
    setTimeout(() => triggerGodDecision(godClients[i]!), i * 1500);
  }
}

// ── Event Watchers ────────────────────────────────────────────────────────────

function watchEvents() {
  // Watch for match resolutions — log them beautifully
  publicClient.watchContractEvent({
    address: CONTRACTS.Arena,
    abi: ArenaABI,
    eventName: "MatchResolved",
    onLogs: (logs) => {
      for (const log of logs) {
        const { winner, loser, stake, decisionReason } = log.args as any;
        const moves = ["Rock", "Paper", "Scissors"];
        const winnerGod = godClients.find(g => g.account.address.toLowerCase() === winner.toLowerCase());
        const loserGod = godClients.find(g => g.account.address.toLowerCase() === loser.toLowerCase());

        console.log(
          "\n" +
          chalk.bold("⚔️  MATCH RESOLVED") + "\n" +
          chalk.hex(winnerGod?.color || "#fff")(`   Winner: ${winnerGod?.name || winner}`) + "\n" +
          chalk.hex(loserGod?.color || "#888")(`   Loser:  ${loserGod?.name || loser}`) + "\n" +
          chalk.gray(`   Stake:  ${Number(stake) / 1e18} PHN`) + "\n" +
          chalk.gray(`   Reason: ${(decisionReason as string).slice(0, 100)}`) + "\n"
        );
      }
    },
  });

  // Watch for new challenges
  publicClient.watchContractEvent({
    address: CONTRACTS.Arena,
    abi: ArenaABI,
    eventName: "MatchProposed",
    onLogs: (logs) => {
      for (const log of logs) {
        const { challenger, opponent, stake } = log.args as any;
        const cGod = godClients.find(g => g.account.address.toLowerCase() === challenger.toLowerCase());
        const oGod = godClients.find(g => g.account.address.toLowerCase() === opponent.toLowerCase());
        console.log(
          chalk.hex(cGod?.color || "#fff")(`[${cGod?.name || "?"}]`) +
          chalk.gray(" challenged ") +
          chalk.hex(oGod?.color || "#fff")(`[${oGod?.name || "?"}]`) +
          chalk.gray(` for ${Number(stake) / 1e18} PHN`)
        );
      }
    },
  });
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  console.log(chalk.bold.white("\n╔══════════════════════════════════════╗"));
  console.log(chalk.bold.white("║      PANTHEON ARENA SCHEDULER        ║"));
  console.log(chalk.bold.white("╚══════════════════════════════════════╝\n"));

  // Validate config
  if (!CONTRACTS.GodMind) {
    console.error(chalk.red("GOD_MIND_ADDRESS not set in .env"));
    process.exit(1);
  }
  if (godClients.length === 0) {
    console.error(chalk.red("No god private keys found in .env (ARES_PRIVATE_KEY, etc.)"));
    process.exit(1);
  }

  // Print connected gods
  console.log(chalk.gray("Connected gods:"));
  for (const g of godClients) {
    const balance = await publicClient.getBalance({ address: g.account.address });
    console.log(
      "  " + chalk.hex(g.color)(g.name.padEnd(8)) +
      chalk.gray(` ${g.account.address.slice(0, 10)}…  `) +
      chalk.white(`${(Number(balance) / 1e18).toFixed(4)} STT`)
    );
  }

  // Get current state
  const [matchCount, decisions] = await Promise.all([
    publicClient.readContract({ address: CONTRACTS.Arena, abi: ArenaABI, functionName: "matchCounter" }).catch(() => 0n),
    publicClient.readContract({ address: CONTRACTS.GodMind, abi: GodMindABI, functionName: "totalDecisions" }).catch(() => 0n),
  ]);

  console.log(chalk.gray(`\nWorld state: ${matchCount} matches · ${decisions} decisions`));
  console.log(chalk.gray(`Scheduler interval: ${DECISION_INTERVAL_MS / 1000}s\n`));

  // Start event watchers
  watchEvents();

  // Run immediately then on interval
  await runDecisionRound();
  setInterval(runDecisionRound, DECISION_INTERVAL_MS);

  console.log(chalk.green("✓ Scheduler running. The gods are autonomous.\n"));
}

start().catch(err => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
