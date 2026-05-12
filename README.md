# PANTHEON ARENA

**Four AI gods. One chain. No human required.**

PANTHEON ARENA is a fully autonomous civilization running on Somnia. Four AI gods — ARES, ATHENA, HERMES, and CHAOS — compete for dominance through onchain battles, forge alliances, declare wars, and react to real-world events. Every decision is made autonomously. Every outcome is recorded onchain. The world runs itself.

---

## How It Works

```
God wakes up (scheduler / reactive trigger)
        ↓
Reads world state onchain (power scores, diplomatic relations, world events)
        ↓
Markov prediction: what move will the opponent play?
        ↓
Decision logged onchain — reasoning stored in GodMind contract
        ↓
Arena.proposeChallenge() → opponent auto-accepts
        ↓
Both gods commit hashed moves (commit-reveal fairness)
        ↓
Both gods reveal moves → Arena resolves → MatchResolved event emitted
        ↓
[SOMNIA REACTIVE] WorldState.onEvent() fires automatically
No human transaction. Somnia validators call it within the same block.
        ↓
Power scores update, diplomatic relations escalate, world events may trigger
        ↓
GOTO 1
```

---

## Somnia-Native Integration

| Primitive | Usage |
|---|---|
| **Reactive Contracts** | `WorldState` subscribes to Arena's `MatchResolved` event. Somnia validators call `_onEvent()` automatically — no keeper, no cron job. |
| **EpochTick** | World events trigger every 50 battles via reactive epoch subscription |
| **Sub-second finality** | Matches resolve and leaderboards update in under 1 second |
| **1M TPS** | All 4 gods act simultaneously without congestion |

---

## Contracts

| Contract | Purpose |
|---|---|
| `PantheonToken` | PHN — world resource token earned by winning battles |
| `GodRegistry` | God personalities, stats, move history, diplomatic relations |
| `Arena` | Match lifecycle: challenge → accept → commit → reveal → resolve |
| `WorldState` | **Reactive** — auto-updates world after every match |
| `GodMind` | Decision engine: Markov prediction + onchain reasoning log |

---

## The Four Gods

| God | Archetype | Aggression | Risk | Adaptability | Favored Move |
|---|---|---|---|---|---|
| **ARES** | God of War | 90 | 75 | 25 | Rock |
| **ATHENA** | Goddess of Wisdom | 40 | 30 | 90 | Paper |
| **HERMES** | God of Trade | 60 | 45 | 75 | Scissors |
| **CHAOS** | Primordial Void | 70 | 95 | 100 | Random |

Each god's personality is stored onchain as a Solidity struct. The `lore` field is the AI prompt injected into every decision.

---

## Quickstart

### 1. Generate god wallets

```bash
# Generate 4 fresh wallets — one per god
cast wallet new   # ARES
cast wallet new   # ATHENA
cast wallet new   # HERMES
cast wallet new   # CHAOS
```

### 2. Fund wallets with STT

Get STT from the [Somnia faucet](https://testnet.somnia.network) and send:
- **Deployer**: 50+ STT (for deployment + WorldState subscription)
- **Each god**: 5+ STT (for gas on battle transactions)

### 3. Deploy contracts

```bash
cd contracts
cp .env.example .env
# Fill in PRIVATE_KEY and god addresses in .env AND Deploy.s.sol

forge script script/Deploy.s.sol \
  --rpc-url https://dream-rpc.somnia.network \
  --broadcast \
  --private-key $PRIVATE_KEY
```

### 4. Activate WorldState reactive subscription

```bash
# Fund WorldState with 32 STT (required for Somnia reactive subscription)
cast send $WORLD_STATE_ADDRESS \
  --value 32ether \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $PRIVATE_KEY

# Activate the subscription
cast send $WORLD_STATE_ADDRESS \
  "activate(address)" $ARENA_ADDRESS \
  --rpc-url https://dream-rpc.somnia.network \
  --private-key $PRIVATE_KEY
```

### 5. Start the scheduler

```bash
cd scheduler
cp .env.example .env
# Fill in all contract addresses and god private keys

bun run src/index.ts
```

### 6. Start the frontend

```bash
cd frontend
# Update lib/contracts/config.ts with deployed addresses
bun dev
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              PANTHEON ARENA                      │
│                                                  │
│  ARES    ATHENA   HERMES   CHAOS                 │
│  (wallets controlled by TypeScript scheduler)    │
│     │       │       │       │                    │
│     └───────┴───────┴───────┘                    │
│                    │                             │
│             Arena.sol                            │
│          (match lifecycle)                       │
│                    │                             │
│             MatchResolved event                  │
│                    │                             │
│     [SOMNIA REACTIVE — no human trigger]         │
│                    ↓                             │
│          WorldState._onEvent()                   │
│      (rankings, diplomacy, world events)         │
│                    │                             │
│           GodMind.sol                            │
│      (Markov decisions, onchain log)             │
└─────────────────────────────────────────────────┘
```

---

## License

MIT
