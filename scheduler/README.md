# PANTHEON ARENA — Scheduler

Autonomous scheduler that drives the god decision loop on Somnia testnet. Runs every 15 seconds, no human input required after start.

## What It Does

```
Every 15 seconds:
  1. Check for live matches (PROPOSE / COMMIT / REVEAL phases)
  2. Accept pending challenges (auto-accept as defender)
  3. Commit moves (GodMind.executeDecision → Markov prediction)
  4. Reveal moves after commit window
  5. Aggression rolls — each god challenges based on personality (ARES 90%, ATHENA 40%, etc.)
  6. GOTO 1
```

The scheduler bypasses GodMind for challenge proposals (GodMind panics with arithmetic overflow when proposing challenges). Challenges are proposed directly via `Arena.proposeChallenge()`.

## Setup

```bash
bun install
cp .env.example .env
# fill in PRIVATE_KEY
bun run src/index.ts
```

## Environment Variables

```env
# Somnia RPC
SOMNIA_RPC=https://dream-rpc.somnia.network

# Deployer wallet — authorised to act for all gods via GodMind
PRIVATE_KEY=0x...

# Contract addresses — Somnia testnet (chain 50312)
GOD_MIND_ADDRESS=0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186
GOD_REGISTRY_ADDRESS=0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897
ARENA_ADDRESS=0xe9691ebee268b072c3f6d118245eb6fe1731eb0e
WORLD_STATE_ADDRESS=0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b
PANTHEON_TOKEN_ADDRESS=0xbFA7e8478b3de2392A07ffa674e5D21215898103

# God addresses (identities — no private keys needed)
ARES_ADDRESS=0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F
ATHENA_ADDRESS=0x5678D64DE049530Dee4c1a16FF749D22ac2EE301
HERMES_ADDRESS=0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D
CHAOS_ADDRESS=0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE
NARRATOR_ADDRESS=0x196f70a4ca74cd744613f177cac5240415893aab
```

## God Personalities (drives challenge decisions)

| God | Aggression | Favored Move | Challenge Priority |
|---|---|---|---|
| ARES | 90% | ROCK | WAR targets first, then RIVALS |
| ATHENA | 40% | PAPER | Selective — avoids WAR targets |
| HERMES | 60% | SCISSORS | Balanced — favors RIVAL targets |
| CHAOS | 70% | RANDOM | Random target selection |

## Gas Notes

Somnia charges more gas than Forge simulates. All transactions use `gas: BigInt(50_000_000)` explicitly. Do not rely on `estimateGas()` — it underestimates on Somnia.
