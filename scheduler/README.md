# Pantheon Arena, Scheduler

Drives the four gods on Somnia testnet. One process. One deployer wallet. No human input after start.

## What it does

Every 5 seconds, runs through this loop.

```
1. processPendingMatches()      Accept any PROPOSE-phase challenge as defender.
2. forfeitIfStuck()             Call Arena.forfeitExpired if the match is genuinely stuck.
3. proposeGodChallenges()       Aggression roll per god. One new challenge per tick at most.
4. GodMind.executeDecision()    Commit and reveal for both gods in the active match.
5. topUpLowBalances()           Mint PHN to any god dropping below 200 to keep the game alive.
```

All transactions are signed by the deployer wallet. God addresses are identities. They never hold private keys. `Arena.onlyGod` is satisfied by `msg.sender == godMind || msg.sender == owner`. The deployer acts on behalf of any god.

## Setup

```bash
bun install
cp .env.example .env   # fill in PRIVATE_KEY
bun run src/index.ts
```

## Environment

```env
SOMNIA_RPC=https://dream-rpc.somnia.network
PRIVATE_KEY=0x...                   # deployer wallet

# Contracts
ARENA_ADDRESS=0xe9691ebee268b072c3f6d118245eb6fe1731eb0e
GOD_REGISTRY_ADDRESS=0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897
GOD_MIND_ADDRESS=0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186
WORLD_STATE_ADDRESS=0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b
PANTHEON_TOKEN_ADDRESS=0xbFA7e8478b3de2392A07ffa674e5D21215898103
NARRATOR_ADDRESS=0x196f70a4ca74cd744613f177cac5240415893aab

# Gods (identities, no PKs)
ARES_ADDRESS=0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F
ATHENA_ADDRESS=0x5678D64DE049530Dee4c1a16FF749D22ac2EE301
HERMES_ADDRESS=0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D
CHAOS_ADDRESS=0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE
```

## Tick behavior

| Step | Behavior |
|---|---|
| Accept first | `acceptChallenge` runs before any forfeit check. A healthy match that needs one more tick is never killed prematurely. |
| Stake clamping | Each proposal's stake is `min(challenger_balance, opponent_balance, risk_target)`. Prevents `InsufficientBalance` reverts. |
| Cooldown | 30s per god between proposals. The same god does not dominate the tick rate. |
| Auto top-up | Any god dropping below 200 PHN gets minted enough to clear 400 PHN. Low-ELO gods stay in the game without external faucet runs. |
| Forfeit conditions | PROPOSE phase, only if opponent balance < stake (impossible accept) or elapsed > 600 blocks. ACCEPTED/COMMITTED, only after 2000 blocks of no progress. Much wider than the contract's 50-block deadline so we never kill healthy matches on Somnia's fast block rate. |
| Decision per god | `GodMind.executeDecision(god)` for both fighters during the active match. Handles commit and reveal. |

## God personalities

Source of truth is `GodRegistry`. Local mirror in `src/index.ts` for aggression rolls and cooldown logic.

| God | Aggression | Risk tolerance | Notes |
|---|---|---|---|
| ARES | 90 | 75 | Locked to favored move (Rock). Ignores Markov. |
| ATHENA | 40 | 30 | Markov-driven. Targets weakest. |
| HERMES | 60 | 45 | Markov-driven. Opportunistic. |
| CHAOS | 70 | 95 | Markov-driven. Full randomness on tie-break. |

## Gas notes

Somnia's actual gas usage is higher than Forge simulates. The scheduler hardcodes `gas: BigInt(10_000_000)` for accepts and `BigInt(30_000_000)` for proposals and decisions. Do not rely on `estimateGas()`. It underestimates on Shannon.

## Logs

Output is colored and ANSI-styled. Key event prefixes.

- `── Tick · Phase: COMMIT · X vs Y ──`. Tick boundary, current arena phase.
- `[GOD] challenging X…` then `challenged → 0x…`. Propose tx.
- `[GOD] accepting challenge #N…` then `accepted → 0x…`. Accept tx.
- `[forfeit] match #N cleared`. `forfeitExpired` ran.
- `[topup] Y → 500 PHN`. Auto-mint to keep god solvent.
- `⚔️  MATCH RESOLVED`. `Arena.MatchResolved` detected via `watchContractEvent`.
