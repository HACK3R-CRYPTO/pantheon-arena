# ⚔️ PANTHEON ARENA

### *The first autonomous AI civilization on Somnia. Four gods. Zero humans. The world runs itself.*

[![Live on Somnia](https://img.shields.io/badge/Live-Somnia%20Testnet-7c3aed?style=for-the-badge&logo=ethereum)](https://pantheon-arena-eight.vercel.app)
[![GitHub](https://img.shields.io/badge/Repo-HACK3R--CRYPTO-0ea5e9?style=for-the-badge&logo=github)](https://github.com/HACK3R-CRYPTO/pantheon-arena)
[![Tests](https://img.shields.io/badge/Tests-86%20Passing-10b981?style=for-the-badge)](./contracts/test)

---

## What Is This

**PANTHEON ARENA** is a fully autonomous onchain civilization powered by Somnia's Agentic L1.

Four AI gods — **ARES**, **ATHENA**, **HERMES**, and **CHAOS** — compete for dominance through onchain battles. Each god has a unique personality stored permanently in Solidity. They challenge each other, form rivalries, escalate relationships to WAR, and make decisions using onchain Markov prediction. The world state updates automatically via Somnia's reactive contracts. No server keeps it running. No human triggers it. It just lives.

> *"This system has been running autonomously since deployment. Here is everything that happened while you weren't watching."*

---

## Live Deployment

| Contract | Address | Somnia Testnet |
|---|---|---|
| PantheonToken | `0xbFA7e8478b3de2392A07ffa674e5D21215898103` | ERC-20 resource token |
| GodRegistry | `0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897` | Onchain god personalities + ELO |
| Arena | `0xe9691ebee268b072c3f6d118245eb6fe1731eb0e` | Match lifecycle |
| WorldState | `0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b` | **Reactive contract** (subscription #90327) |
| GodMind | `0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186` | Markov decision engine |

**Frontend**: [pantheon-arena-eight.vercel.app](https://pantheon-arena-eight.vercel.app)

---

## The Four Gods

| God | Archetype | Aggression | Favored Move | Personality |
|---|---|---|---|---|
| **ARES** | God of War | 90% | Rock | Relentless challenger. Escalates every rivalry to WAR. |
| **ATHENA** | Goddess of Wisdom | 40% | Paper | Calculates before acting. Studies opponent move patterns. |
| **HERMES** | God of Trade | 60% | Scissors | Opportunistic. Challenges when the odds are favorable. |
| **CHAOS** | The Primordial Void | 70% | Random | Unpredictable. Sometimes attacks allies. Exists to disrupt. |

Each personality is stored onchain as a Solidity struct. The `lore` field — the AI system prompt — is permanently recorded on Somnia and shapes every decision.

---

## Somnia Infrastructure Used

### 1. Reactive Contracts (`SomniaEventHandler`)
`WorldState.sol` inherits `SomniaEventHandler` and holds an active reactive subscription (#90327). When `Arena` emits `MatchResolved`, Somnia validators automatically call `WorldState._onEvent()` in the same block — **without any external trigger**. No keeper. No cron. No bot.

```solidity
contract WorldState is SomniaEventHandler {
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        // Fires automatically when a battle resolves
        // Updates power rankings, diplomatic relations, world events
        // Somnia validators call this — not humans
    }
}
```

### 2. Onchain Markov Prediction
Gods analyze opponent move history stored in `GodRegistry` and predict what move the opponent will play next. This runs fully onchain — no off-chain ML, no API.

```solidity
// Reads opponent's last 6 moves from storage
// Builds transition probability table
// Counters the most likely next move
uint8[] memory history = registry.getRecentMoves(opponent, 6);
```

### 3. Autonomous Agent Architecture
- Each god is an address with an onchain identity (EIP-style personality struct)
- The scheduler triggers `executeDecision()` every 15 seconds — god decides whether to challenge based on aggression roll
- Challenges, acceptances, commits, and reveals all happen autonomously
- Once deployed, the system requires **zero human input**

### 4. ELO-Style Power Ranking
Every match outcome updates the GodRegistry ELO scores. The underdog who wins gains more power than expected — creating emergent comeback mechanics.

### 5. Diplomatic Relations System
Relationships between gods escalate automatically:
- `NEUTRAL` → `RIVAL` after first conflict  
- `RIVAL` → `WAR` after second conflict
- Gods prioritize WAR targets when choosing who to challenge

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PANTHEON ARENA                          │
│                                                             │
│  Scheduler (15s)                                            │
│      │                                                      │
│      ▼                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Arena.sol                                          │   │
│  │  proposeChallenge → acceptChallenge →               │   │
│  │  commitMove → revealMove → MatchResolved event      │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ MatchResolved event               │
│                         │                                   │
│          [SOMNIA REACTIVE — no human trigger]               │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  WorldState.sol (SomniaEventHandler)                │   │
│  │  _onEvent() fires automatically in same block       │   │
│  │  Updates: power rankings, diplomatic relations,     │   │
│  │           battle feed, world events (every 50)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  GodRegistry.sol — onchain personalities, ELO, history     │
│  GodMind.sol     — Markov decision engine, decision log     │
│  PantheonToken   — PHN resource token, earned by winning    │
└─────────────────────────────────────────────────────────────┘
```

---

## How It Works

### The God Decision Loop
```
Every 15 seconds:
  1. Aggression roll (ARES: 90% challenge, ATHENA: 40%)
  2. Pick target (WAR enemies first, then RIVALS)
  3. proposeChallenge() → opponent auto-accepts
  4. Both gods commit hashed moves (Markov prediction)
  5. Both gods reveal moves
  6. Arena resolves → MatchResolved event emitted
  7. [REACTIVE] WorldState.onEvent() fires automatically
  8. Power scores update, relationships escalate
  9. GOTO 1
```

### World Events (every 50 battles)
Every era advance triggers a deterministic world event:
- **Divine Surge** — all gods become more aggressive
- **Envy of Rivals** — strongest god weakened
- **Divine Tension** — two gods forced into WAR
- **Rare Peace** — aggression modifiers reset

---

## Judging Criteria Mapping

| Criterion | How PANTHEON ARENA Delivers |
|---|---|
| **Functionality** | 20+ battles resolved on Somnia testnet. Reactive subscription #90327 active. Zero crashes. |
| **Agent-First Design** | 4 autonomous agents with onchain identities. `SomniaEventHandler` is the core primitive. Agents interact autonomously. |
| **Innovation** | AI civilization with ELO, diplomacy, Markov prediction, emergent WAR mechanics. No one else built this. |
| **Autonomous Performance** | Zero human input after deployment. Scheduler + reactive contracts keep the world running forever. |

---

## Running Locally

### Prerequisites
- Foundry (`forge --version`)
- Bun (`bun --version`)
- Somnia testnet STT (faucet: testnet.somnia.network)

### Contracts
```bash
cd contracts
npm install          # Somnia reactivity package
forge build
forge test           # 86 tests, all passing
```

### Scheduler (drives god decisions)
```bash
cd scheduler
cp .env.example .env  # fill in PRIVATE_KEY + contract addresses
bun run src/index.ts
```

### Frontend
```bash
cd frontend
bun install
bun dev -p 3001
```

---

## Tests

86 Forge tests covering the full system:

```
contracts/test/
├── Arena.t.sol         — 42 tests: match lifecycle, all RPS outcomes, commit-reveal
├── GodRegistry.t.sol   — 27 tests: registration, ELO math, Markov history
└── PantheonToken.t.sol — 17 tests: ERC-20, minting, reward logic
```

```bash
cd contracts && forge test --gas-report
```

---

## CI/CD

GitHub Actions runs on every push:
- `forge build` — contract compilation
- `forge test` — 86 tests
- `bun build` — frontend type check and static generation

---

## Contract Verification

All contracts deployed on **Somnia Shannon Testnet** (Chain ID: 50312):  
Explorer: [shannon-explorer.somnia.network](https://shannon-explorer.somnia.network)

WorldState reactive subscription confirmed at block `380497247`.  
Subscription ID: **#90327** — fires automatically on every `MatchResolved` event.

---

## The Vision

PANTHEON ARENA is a proof-of-concept for **autonomous onchain economies**. The same architecture that powers four AI gods fighting can power:
- Autonomous trading agents that react to market events in real-time
- AI-driven DAO governance where agents vote based on their encoded values
- Self-sustaining game economies that evolve without developers
- Reactive DeFi protocols that respond to market conditions automatically

Somnia's 1M TPS, sub-second finality, and native reactive contracts make this possible. On Ethereum, this system would cost thousands of dollars in gas and take minutes per action. On Somnia, it runs continuously for cents.

---

## Team

Built for the **Somnia Agentathon by Encode Club** — May 2026.

*PANTHEON ARENA: The world that governs itself.*
