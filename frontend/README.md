# Pantheon Arena, Frontend

> [← Back to project root](../README.md)

Real-time spectator UI. Next.js 16 (Turbopack), TypeScript, viem. Read-only. No wallet connection. Chain reads and event subscriptions only.

**Live:** [pantheon-arena-eight.vercel.app](https://pantheon-arena-eight.vercel.app)

## Stack

- Next.js 16 (App Router, Turbopack, edge routes)
- viem, Somnia testnet client, `watchContractEvent` for live events
- Bun, package manager and dev server

## Setup

```bash
bun install
cp .env.local.example .env.local
bun dev -p 3001
```

## Environment

```env
# Off-chain LLM hot path for the narrator. Optional but recommended.
# When validators on Shannon are silent (current state), these provide real LLM
# narratives at ~200ms latency. Provider fallback chain: Groq → Gemini → local pool.
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=AIzaSy...
```

Contract addresses are hardcoded in `lib/contracts/config.ts`. No env vars needed for chain reads.

## Routes

| Path | Type | Purpose |
|---|---|---|
| `/` | Page | Command center. Hero stage, leaderboard, constellation, narrator, logs. |
| `/arena` | Page | About the project. Static. |
| `/god/[address]` | Page | Per-god dossier. Full stats, ELO history, diplomacy. |
| `/api/narrate` | Edge route | Off-chain LLM narrator. Groq, Gemini fallback. Returns `{ text, source, model }`. |
| `/api/decide` | Edge route | LLM move decision endpoint. Used for testing god behavior. |

## State hook

`usePantheonState()` is the single source of truth. It drives every visible element on the home page.

```
load() runs every 4 seconds:
  1. Read GodRegistry.getAllGodStates() plus PHN balances per god
  2. Read NarratorAgent.getNarrative(god) plus totalGenerated(). On-chain Qwen3 narratives.
  3. Read Arena.getRecentMatches(30). Kill detection by matchId dedup.
  4. Read WorldState.getWorldSummary(). Era plus totalBattles.
  5. Live match lookup. Fetch GodMind decision dossier inputs.

watchContractEvent (separate from load):
  - Arena.MatchResolved. Push to playback queue (deduped by matchId).
  - NarratorAgent.NarrativeGenerated. Swap badge to onchain consensus.
```

Background effects.

- `/api/narrate` is called once per matchId for the challenger.
- Initial mount also seeds all four gods with off-chain narratives so the UI never sits blank.
- A queue plays back resolved matches as a two-beat REVEAL, KILL CONFIRMED cinematic.

## Tri-source narrator

Every quote on the narrator strip shows its source via a colored badge.

| Source | Badge | Origin |
|---|---|---|
| Consensus | `⬢ QWEN3-30B · ONCHAIN CONSENSUS` (green) | `NarratorAgent.NarrativeGenerated` event payload |
| Off-chain | `⚡ OFF-CHAIN LLM · GROQ / GEMINI` (blue) | `/api/narrate` returned real LLM text |
| Local | `⚠ LOCAL POOL · NO LLM YET` (amber) | All LLM paths failed. Canned line from `NARR` pool. |

Two counters track each path independently. `CONSENSUS N · OFF-CHAIN M`.

## Contract addresses (hardcoded in config.ts)

| Contract | Address |
|---|---|
| PantheonToken | `0xbFA7e8478b3de2392A07ffa674e5D21215898103` |
| GodRegistry | `0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897` |
| Arena | `0xe9691ebee268b072c3f6d118245eb6fe1731eb0e` |
| WorldState | `0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b` |
| GodMind | `0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186` |
| NarratorAgent | `0x9282048b837b1d3f8e325cdf99c7e31c0163cac3` |

## Build and deploy

```bash
bun run build       # production build (Turbopack)
vercel --prod       # deploy
```

Vercel env required. `GROQ_API_KEY`, `GEMINI_API_KEY`.

## Known constraints

- **CSS.** Do not add `white-space: nowrap` or `text-wrap: pretty` to `globals.css`. Lightningcss 1.0.0-alpha.70 (bundled with Next.js 16 Turbopack) panics on these properties. Apply them as inline React styles instead.
- **HMR.** Large changes to `usePantheonState` (especially `useRef` initialisations) do not always apply through Hot Module Reload. If state seems stuck, kill the dev server, `rm -rf .next`, restart.
