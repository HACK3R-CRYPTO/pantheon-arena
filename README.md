# Pantheon Arena

> An autonomous onchain civilization. Four AI gods with onchain personalities reason about each other's move history, escalate rivalries, write their own narration. No human in the loop.

[![Pantheon Arena spectator UI](./frontend/public/hero.png)](https://pantheon-arena-eight.vercel.app)

[![Live](https://img.shields.io/badge/Live-Somnia%20Testnet-7c3aed?style=for-the-badge&logo=ethereum)](https://pantheon-arena-eight.vercel.app)
[![Tests](https://img.shields.io/badge/Tests-86%20Passing-10b981?style=for-the-badge)](./contracts/test)
[![Chain](https://img.shields.io/badge/Chain-Shannon%20%2350312-0ea5e9?style=for-the-badge)](https://shannon-explorer.somnia.network)

**Live:** [pantheon-arena-eight.vercel.app](https://pantheon-arena-eight.vercel.app)

## Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Contracts](#contracts)
- [The Gods](#the-gods)
- [Somnia Primitives](#somnia-primitives)
- [Onchain Markov Inference](#onchain-markov-inference)
- [Tri-Source Narrator](#tri-source-narrator)
- [Architecture](#architecture)
- [Spectator Client](#spectator-client)
- [Testnet Status (Shannon)](#testnet-status-shannon)
- [Running Locally](#running-locally)
- [Tests](#tests)

## Overview

Pantheon Arena is an autonomous onchain civilization. Four AI gods compete on Somnia's Agentic L1, every 15 to 20 seconds, in a fully composed loop of three native primitives.

| Primitive | Where it runs | What it does here |
|---|---|---|
| Reactive Contracts | `WorldState` inherits `SomniaEventHandler` | Validators call `_onEvent` in the same block as `Arena.MatchResolved`. No keeper. No cron. |
| LLM Inference Agent | `NarratorAgent` calls Qwen3-30B | Validators reach consensus on AI narration. The result is written to chain. |
| JSON API Agent | `WorldState._requestETHPrice` | Validators fetch live ETH/USD from CoinGecko. The world's aggression modifiers shift with the consensus-fetched price. |

These three primitives chain inside a single reactive callback. `MatchResolved` fires, `_onEvent` runs in the same block, the era boundary triggers the JSON oracle, and the LLM agent generates the next round's narration. One event, three agents, no human in between.

Each god has an onchain personality, an ELO rating, a 6-move history, and a diplomatic table that escalates from `NEUTRAL` to `RIVAL` to `WAR` and never downgrades. 300+ matches have resolved on Shannon testnet to date. The same composition pattern applies to autonomous trading agents, AI-mediated DAOs, and reactive DeFi protocols.

## Project Structure

The repo is split into three workspaces. Each has its own README with setup, behavior, and design notes.

| Path | What's in it | Read more |
|---|---|---|
| [`contracts/`](./contracts) | Solidity contracts, Foundry tests, deploy scripts | [contracts/README.md](./contracts/README.md) |
| [`scheduler/`](./scheduler) | Autonomous decision loop, runs the 5s tick, drives all four gods | [scheduler/README.md](./scheduler/README.md) |
| [`frontend/`](./frontend) | Next.js spectator UI, viem chain reads, `/api/narrate` LLM route | [frontend/README.md](./frontend/README.md) |

## Contracts

All deployed on Somnia Shannon Testnet (chain `50312`).

| Contract | Address | Purpose |
|---|---|---|
| `Arena` | [`0xe9691ebee268b072c3f6d118245eb6fe1731eb0e`](https://shannon-explorer.somnia.network/address/0xe9691ebee268b072c3f6d118245eb6fe1731eb0e) | Match lifecycle. Propose, commit, reveal, resolve. |
| `GodRegistry` | [`0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897`](https://shannon-explorer.somnia.network/address/0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897) | Personalities, ELO, move history, relations. |
| `GodMind` | [`0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186`](https://shannon-explorer.somnia.network/address/0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186) | Onchain Markov decision engine. |
| `WorldState` | [`0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b`](https://shannon-explorer.somnia.network/address/0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b) | Reactive contract. Subscription `#90327`. |
| `NarratorAgent` | [`0x9282048b837b1d3f8e325cdf99c7e31c0163cac3`](https://shannon-explorer.somnia.network/address/0x9282048b837b1d3f8e325cdf99c7e31c0163cac3) | LLM Inference Agent. Qwen3-30B, agent ID `12847293847561029384`. |
| `PantheonToken` | [`0xbFA7e8478b3de2392A07ffa674e5D21215898103`](https://shannon-explorer.somnia.network/address/0xbFA7e8478b3de2392A07ffa674e5D21215898103) | ERC-20 (PHN). Minted to winners. |

## The Gods

Each god is an EOA. The personality struct lives in `GodRegistry`. The `lore` field doubles as the AI system prompt and is permanently committed to chain.

| God | Aggression | Adaptability | Favored Move | Behavior |
|---|---|---|---|---|
| ARES | 90 | 25 (below threshold) | Rock | Skips Markov. Always plays favored. |
| ATHENA | 40 | 90 | Paper | Full Markov on last 6 moves. |
| HERMES | 60 | 75 | Scissors | Full Markov. Opportunistic targeting. |
| CHAOS | 70 | 100 | Rock | Pure adaptation. No bias. |

`GodMind._markovPredict` enforces the adaptability threshold of 30. Below it, the god short-circuits to their favored move. Above it, the god reads `GodRegistry.getRecentMoves(opp, 6)`, builds a transition table conditioned on the opponent's last move, and commits `(predicted + 1) mod 3` as the counter.

## Somnia Primitives

### Reactive Contracts

`WorldState.sol` inherits `SomniaEventHandler` and holds subscription `#90327`, confirmed at block `380497247`. It subscribes to `Arena.MatchResolved` and reacts in the same block.

```solidity
function _onEvent(address emitter, bytes32[] calldata topics, bytes calldata data)
    internal override
{
    // Decode (matchId, winner, loser, stake, moves, reason)
    // Increment totalBattles, push to battle feed, advance era every 50 battles
}
```

No external trigger. No keeper wallet. State advances purely from validator-driven callbacks.

### LLM Inference Agent (Qwen3-30B)

`NarratorAgent.sol` calls the LLM Agent on every challenge to generate dramatic narration in the challenger's voice.

```solidity
IAgentPlatform public constant PLATFORM = IAgentPlatform(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);
uint256 public constant LLM_AGENT_ID = 12847293847561029384;

function requestNarrative(address god, string godName, string oppName, string godLore)
    external onlyOwner returns (uint256 requestId)
{
    bytes memory payload = abi.encodeWithSelector(
        ILLMAgent.inferString.selector, prompt, godLore, false, new string[](0)
    );

    // Deposit = ops-reserve floor + per-agent budget * 3 validators.
    // Validators silently skip requests below the per-agent budget threshold.
    uint256 floor    = PLATFORM.getRequestDeposit();   // ~0.03 STT
    uint256 perAgent = 0.07 ether;                     // required by LLM agent
    uint256 deposit  = floor + (perAgent * 3);         // ~0.24 STT total

    requestId = PLATFORM.createRequest{value: deposit}(
        LLM_AGENT_ID, address(this), this.handleResponse.selector, payload
    );
}
```

Validators reach consensus on the Qwen3 output. They call `handleResponse`. The narrative lands in `latestNarrative[god]` and `NarrativeGenerated` fires.

Verifiable example: [tx `0x062da7c…`](https://shannon-explorer.somnia.network/tx/0x062da7c71a191e15e468e58404fb12c4173eb55abfbfbbb8ffdbf266be56c3b5). A `requestNarrative` call from the deployer. 0.24 STT deposit paid. The platform's `CreateRequest`, NarratorAgent's `NarrativeRequested`, and validator-driven `NarrativeGenerated` all emit. The first on-chain Qwen3 narrative landed in `latestNarrative[ARES]`: *"I will carve your pride into the dust, Athena. Prepare to fall."*

### JSON API Agent

Every 50 battles is one era. At the era boundary, `WorldState._requestETHPrice` calls the JSON API Agent to fetch `ethereum.usd` from CoinGecko. Validators fetch independently and reach consensus before the price enters chain state. Outcomes drive in-game modifiers.

- ETH down >3%, ARES aggression bonus
- ETH up >3%, HERMES power advantage
- Stable, forced WAR escalation between two random gods
- Every 4th era, all modifiers reset

## Onchain Markov Inference

`GodMind._markovPredict` builds a first-order transition table conditioned on the opponent's most recent move.

```solidity
function _markovPredict(address opp, uint8 adaptability, uint8 favored) internal view returns (uint8) {
    uint8[] memory history = registry.getRecentMoves(opp, 6);
    if (history.length < 2) return uint8(uint256(keccak256(abi.encodePacked(block.number, opp))) % 3);

    uint8 last = history[history.length - 1];
    uint256[3] memory c;
    for (uint256 i = 0; i < history.length - 1; i++) {
        if (history[i] == last && history[i + 1] < 3) c[history[i + 1]]++;
    }
    uint8 pred = 0;
    if (c[1] > c[0]) pred = 1;
    if (c[2] > c[pred]) pred = 2;
    return adaptability < 30 ? favored : (pred + 1) % 3;
}
```

No off-chain ML. No oracle. No API key. The model lives in storage and runs at view-time.

The spectator UI surfaces this execution trace every match in the `GODMIND Decision Dossier` panel. You see the last 6 moves, the transition histogram, the predicted move, and the counter pick. After reveal, a `✓ PREDICTION CONFIRMED` or `✗ DEVIATED` tag appears next to each counter.

## Tri-Source Narrator

Decentralized inference has variable latency. The spectator client runs three LLMs in priority order and labels the source of every line on screen.

| Priority | Source | Path | Badge |
|---|---|---|---|
| 1 | Somnia LLM Agent (Qwen3-30B) | `NarratorAgent` to validator consensus to `handleResponse` | `⬢ QWEN3-30B · ONCHAIN CONSENSUS` |
| 2 | Off-chain | `/api/narrate` to Groq `llama-3.3-70b-versatile` to Gemini `2.0-flash` | `⚡ OFF-CHAIN LLM · GROQ / GEMINI` |
| 3 | Local | Canned in-character lines from `NARR` pool | `⚠ LOCAL POOL · NO LLM YET` |

The off-chain hot path returns in ~200ms with two independent providers. When validators eventually respond on chain, the badge switches to green and `NarrativeGenerated` increments the on-chain counter.

The same layered approach applies to the JSON API oracle. `try/catch` the on-chain call, fall back off-chain, label the data accordingly.

## Architecture

```mermaid
flowchart TD
    SCHED["Scheduler · 5s tick"]
    subgraph GODS["Four Autonomous Gods"]
        ARES["ARES"]
        ATHENA["ATHENA"]
        HERMES["HERMES"]
        CHAOS["CHAOS"]
    end
    subgraph CHAIN["Somnia Testnet · 50312"]
        REGISTRY["GodRegistry"]
        GODMIND["GodMind"]
        ARENA["Arena"]
        WORLDSTATE["WorldState · SomniaEventHandler"]
        TOKEN["PantheonToken"]
        NARRATOR["NarratorAgent"]
    end
    subgraph SOMNIA["Somnia Native Agents"]
        REACTIVE["Reactive · sub #90327"]
        LLM["LLM Agent · Qwen3-30B"]
        JSONAPI["JSON API Agent"]
    end
    subgraph FRONTEND["Spectator Client"]
        UI["War Room UI · watchContractEvent"]
        NARRATE["/api/narrate · Groq → Gemini"]
    end
    SCHED --> GODS
    GODS --> ARENA
    GODMIND --> ARENA
    ARENA -->|MatchResolved| REACTIVE
    REACTIVE -->|same-block| WORLDSTATE
    WORLDSTATE --> REGISTRY
    WORLDSTATE --> TOKEN
    WORLDSTATE -->|era 50,100,150| JSONAPI
    JSONAPI -->|ETH price| WORLDSTATE
    NARRATOR --> LLM
    LLM -->|consensus| NARRATOR
    ARENA --> UI
    NARRATOR -->|NarrativeGenerated| UI
    NARRATE --> UI
    style REACTIVE fill:#7c3aed,color:#fff
    style LLM fill:#7c3aed,color:#fff
    style JSONAPI fill:#7c3aed,color:#fff
```

## Spectator Client

[pantheon-arena-eight.vercel.app](https://pantheon-arena-eight.vercel.app). Mirrors on-chain state in real time via viem's `watchContractEvent`. Every visible element maps to a specific contract call or event.

| UI element | Chain source |
|---|---|
| Hero stage + phase pill | `Arena.currentMatch()`. PROPOSE, COMMIT, REVEAL, RESOLVE. |
| Sealed `?` cards | `Arena.commitMove(hash)` landed. Reveal pending. |
| Move flip + white flash | `Arena.revealMove()` resolved for both gods. |
| `KILL CONFIRMED` banner | `Arena.MatchResolved` event payload. |
| `⚔ INITIATIVE KILL` tag | Both gods played same move. Contract resolves the tie to the challenger. |
| GODMIND Decision Dossier | `GodRegistry.getRecentMoves(opp, 6)` and transition table. |
| Narrator band | `NarratorAgent.getNarrative()` or `/api/narrate`. Tri-state badge labels source. |
| Leaderboard ELO + relations | `GodRegistry.getAllGodStates()` and `getRelation(a, b)`. |
| `NEMESIS` vs `● FIGHTING` rows | Persistent diplomatic state vs live match indicator. |
| Conflict Constellation (SVG) | `getRelation()` across all pairs. Animated edge for active fight. |
| World Event card | `WorldState.lastEvent()`. |
| Battle Net log | `KILL`, `ESCAL`, `ORACLE` lines from event subscriptions. |

### Match playback

Resolved matches play in two beats. **REVEAL** runs for 1.8 seconds. Sealed cards flip. White flash. Screen shake. **RESOLVE** runs for 3.5 seconds. Loser dims. Winner brightens. Banner slides in. Global colored flash fires.

On bursts, a `matchId`-keyed queue ensures every kill is shown in chronological order. Adaptive pacing compresses each beat as queue depth grows.

| Queue depth | REVEAL hold | RESOLVE hold | Per match |
|---|---|---|---|
| 0,1 | 1800ms | 3500ms | 5.3s |
| 2,3 | 1000ms | 2000ms | 3.0s |
| 4+ | 500ms | 1000ms | 1.5s |

The engagement number on the hero bar always reflects the match currently on screen. A `▶ PLAYBACK · N QUEUED` indicator appears when showing recent-past state.

## Testnet Status (Shannon)

All three Somnia base agents and the reactive subscription are operational on chain. The path to that state is worth documenting, because the two configuration issues we hit are exactly the kind that other teams building on the Agentic L1 will run into.

### Reactive Contracts (`SomniaEventHandler`)

`WorldState` holds an active reactive subscription, `#90327`, confirmed at block `380497247`. It subscribes to `Arena.MatchResolved`. When a match resolves, Somnia validators call `WorldState._onEvent` in the same block. No keeper wallet, no cron job, no off-chain process. The callback decodes the event topics, increments `totalBattles`, appends to the battle feed ring buffer, and runs the era-advance branch every 50 battles. 375+ matches have flowed through this path on Shannon. The subscription has stayed intact across every fix described below.

### LLM Inference Agent (Qwen3-30B)

`NarratorAgent` calls the LLM Inference Agent (agent ID `12847293847561029384`) on every challenge. The initial build sent only `PLATFORM.getRequestDeposit()` as the deposit, around 0.03 STT, which is the operations-reserve floor returned by the platform. The contract was correct, the wiring was correct, and the platform accepted the request. But validators never delivered a consensus response back to `handleResponse`. `NarratorAgent.totalGenerated` stayed at 0 for hours.

The Somnia team confirmed why. Validators silently skip requests below a per-agent budget threshold. For the LLM Inference Agent, that threshold is 0.07 STT per validator, and the agent uses a 3-validator quorum. The real deposit needs to be `floor + (0.07 STT * 3)`, around 0.24 STT. The redeploy was simple in code, three lines, but it required a new `NarratorAgent` address because Solidity constants are immutable.

We deployed the new contract at `0x9282048b837b1d3f8e325cdf99c7e31c0163cac3`, funded it with 5 STT (enough for ~20 inferences), and fired one `requestNarrative` for ARES challenging ATHENA. Tx [`0x062da7c…`](https://shannon-explorer.somnia.network/tx/0x062da7c71a191e15e468e58404fb12c4173eb55abfbfbbb8ffdbf266be56c3b5). Status success. Validators called `handleResponse` in the same block. `totalGenerated` ticked to 1. The first on-chain Qwen3 narrative landed in `latestNarrative[ARES]`: *"I will carve your pride into the dust, Athena. Prepare to fall."*

### JSON API Agent (ETH price oracle)

`WorldState._requestETHPrice` calls the JSON API Agent (agent ID `13174292974160097713`) every 50 battles to fetch ETH/USD from CoinGecko. This call is the trigger for the in-game world events that shape an entire era of gameplay. The initial build pinned `WorldState.agentPlatform` to `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3` because that address appeared in our deploy script as `SOMNIA_PLATFORM`. We had copied it from an early example. The address is dead. Every call to it reverted with `"AgentRequester: not enough active members"`. We tried deposits of 0.03, 0.24, and 0.5 STT. All reverted with the same error, because the contract on the other side is not a current platform contract at all.

Because `_requestETHPrice` sits inside the era-advance branch of `_onEvent`, that revert cascaded the whole reactive callback. `totalBattles` rolled back to 49. `era` rolled back to 1. The chain kept producing matches in Arena, but `WorldState` froze. The reactive subscription stayed armed and faithfully delivered every `MatchResolved`, but our handler reverted on each one.

The fix was a single owner-only transaction. `WorldState` exposes `setAgentConfig(address platform, uint256 agentId)` for exactly this case. We called it with the correct universal platform address, `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`, which is the same contract the LLM agent routes through. Tx [`0x6eadc4d3…`](https://shannon-explorer.somnia.network/tx/0x6eadc4d3115a654be93d1b2bc1726b4f3d71999b96a03799dfa2f892d5a19b77). No contract redeploy. The reactive subscription stayed intact.

The next match that resolved unfroze the era. `_onEvent` advanced `totalBattles` from 49 to 50. The era-advance branch fired. `_requestETHPrice` succeeded. Validators called `handlePriceResponse`. `pendingPriceRequestId` reset to 0 because the callback consumed it. `era` advanced from 1 to 2. `lastPriceFetchBattle` recorded as 50. The chain is climbing past `totalBattles=66` and growing one battle at a time as each new `MatchResolved` arrives.

The takeaway is that `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` is the single universal agent platform on Somnia. All three base agents route through it. Only the `agent_id` distinguishes which capability the call targets. If you copy an address from older docs or repo snippets that says otherwise, it will silently fail with the same error we hit.

#### Counter divergence

`Arena.matchCounter` and `WorldState.totalBattles` are not the same number, and that is intentional. `matchCounter` increments on every match Arena creates. `totalBattles` increments only when `WorldState._onEvent` completes successfully. During the wrong-platform period, the reactive subscription faithfully delivered every `MatchResolved` event, but our handler reverted at the era-advance branch on each one. Those matches are recorded on Arena and on the explorer, but they did not pass through `_onEvent`. WorldState's history starts at the moment we shipped the platform fix.

The era counter therefore reflects validated callbacks, not raw match volume. `era` advances every 50 successful `_onEvent` calls. Arena can show 389+ matches while WorldState shows 66 and `era=2`. Both are correct readings of two different things.

### What this means for the architecture

The same engineering principle drives the spectator client. When validators are responsive, the green `⬢ QWEN3-30B · ONCHAIN CONSENSUS` badge fires on the narrator strip. When they are slow, the off-chain Groq, Gemini hot path keeps the UI alive in under 200ms. The badge always tells the truth about provenance. The fix story for the JSON API path follows the same principle on the contract side. We did not redeploy. We did not break the reactive subscription. We used a configuration setter that was designed exactly for this case and validated the fix on chain before claiming it works.

## Running Locally

### Prerequisites

- Foundry (`forge --version`)
- Bun (`bun --version`)
- Somnia testnet STT from the [Shannon faucet](https://testnet.somnia.network)

### Contracts

```bash
cd contracts
npm install
forge build
forge test
```

### Scheduler

```bash
cd scheduler
cp .env.example .env   # fill in PRIVATE_KEY
bun run src/index.ts
```

### Frontend

```bash
cd frontend
bun install
cp .env.local.example .env.local   # GROQ_API_KEY, GEMINI_API_KEY
bun dev -p 3001
```

## Tests

86 Forge tests cover the full system.

```
contracts/test/
├── Arena.t.sol         42 tests. Match lifecycle, all RPS outcomes, commit-reveal.
├── GodRegistry.t.sol   27 tests. Registration, ELO math, Markov history, relations.
└── PantheonToken.t.sol 17 tests. ERC-20, minting, reward logic.
```

```bash
cd contracts && forge test --gas-report
```

GitHub Actions runs `forge build`, `forge test`, and `bun build` on every push.

## Acknowledgements

Thanks to **emrey.somi** from the Somnia team for two debugging assists that unlocked both agent integrations. First on the LLM Inference Agent, confirming validators need `floor + (0.07 STT * 3)` per request instead of just the platform floor. Then on the JSON API Agent, pointing out that the platform contract we had hardcoded was stale and identifying the correct universal address. Both fixes shipped on the same day; both integrations now write consensus-validated results on chain.

---

Built for the **Somnia Agentathon** by Encode Club, 2026.
