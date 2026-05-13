# PANTHEON ARENA — Smart Contracts

Solidity contracts for the PANTHEON ARENA autonomous AI civilization. Deployed on **Somnia Shannon Testnet** (Chain ID: 50312).

## Deployed Addresses

| Contract | Address | Role |
|---|---|---|
| PantheonToken | `0xbFA7e8478b3de2392A07ffa674e5D21215898103` | ERC-20 resource token (PHN) |
| GodRegistry | `0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897` | Onchain god personalities, ELO, move history |
| Arena | `0xe9691ebee268b072c3f6d118245eb6fe1731eb0e` | Match lifecycle (propose → commit → reveal → resolve) |
| WorldState | `0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b` | Reactive contract — subscription **#90327** active |
| GodMind | `0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186` | Markov decision engine, onchain move prediction |
| NarratorAgent | `0x196f70a4ca74cd744613f177cac5240415893aab` | Somnia LLM Inference agent (Qwen3-30B) |

Explorer: [shannon-explorer.somnia.network](https://shannon-explorer.somnia.network)

## Architecture

```
Arena.sol               — Match lifecycle, commit-reveal fairness
  ↓ MatchResolved event
WorldState.sol          — SomniaEventHandler: fires _onEvent() automatically, no keeper needed
  → Updates ELO, diplomacy, battle feed, world events

GodRegistry.sol         — Onchain personalities, ELO scores, Markov move history (last 8)
GodMind.sol             — Reads history, predicts opponent move, commits counter-move
PantheonToken.sol       — PHN token, minted to winners
NarratorAgent.sol       — Requests Qwen3-30B narrative via Somnia LLM platform
```

## Build & Test

```bash
# install Somnia reactive dependency
npm install

# compile
forge build

# run all tests (86 passing)
forge test

# gas report
forge test --gas-report

# format
forge fmt
```

## Tests

```
test/
├── Arena.t.sol           — 42 tests: match lifecycle, all RPS outcomes, commit-reveal fairness
├── GodRegistry.t.sol     — 27 tests: registration, ELO math, Markov history
└── PantheonToken.t.sol   — 17 tests: ERC-20, minting, reward logic
```

## Deploy

Uses a Python deploy script (bypasses Forge's gas simulation which diverges from Somnia's actual EVM):

```bash
# Set env
export PRIVATE_KEY=0x...
export RPC_URL=https://dream-rpc.somnia.network

# Deploy all contracts in order
python3 deploy.py
```

**foundry.toml settings required for Somnia:**
```toml
[profile.default]
evm_version = "london"
via_ir = true
solc = "0.8.30"
```

## Key Design Decisions

- **Commit-reveal** — moves are hashed + committed before reveal, preventing front-running
- **`challengerRevealed` / `opponentRevealed` flags** — explicit bools in Match struct to track reveal state (prevents RPS tie bug from implicit commit-existence check)
- **Somnia reactive** — WorldState inherits `SomniaEventHandler`, topic indexing: `[0]=sig, [1]=matchId, [2]=winner, [3]=loser`
- **`via_ir = true`** — required to avoid stack-too-deep in GodMind's Markov logic
- **Gas** — all txs use `gas: 50_000_000` on Somnia (RPC gas estimation matches actual usage)
