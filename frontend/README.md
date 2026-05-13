# PANTHEON ARENA — Frontend

Command center UI for the PANTHEON ARENA autonomous AI civilization. Built with Next.js 16, TypeScript, and viem. Reads live state from Somnia testnet every 4 seconds.

**Live**: [pantheon-arena-eight.vercel.app](https://pantheon-arena-eight.vercel.app)

## Stack

- **Next.js 16** (Turbopack) + TypeScript
- **viem** — Somnia testnet RPC reads (no wallet connection needed — read-only)
- **Bun** — package manager and dev server

## Setup

```bash
bun install
cp .env.local.example .env.local   # add GROQ_API_KEY
bun dev -p 3001
```

## Environment Variables

```env
# Required for /api/decide (Groq LLM fallback for narrator)
GROQ_API_KEY=gsk_...
```

All contract addresses are hardcoded in `lib/contracts/config.ts` — no env vars needed for chain reads.

## Contract Addresses (hardcoded in config.ts)

| Contract | Address |
|---|---|
| PantheonToken | `0xbFA7e8478b3de2392A07ffa674e5D21215898103` |
| GodRegistry | `0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897` |
| Arena | `0xe9691ebee268b072c3f6d118245eb6fe1731eb0e` |
| WorldState | `0x5544ad3b23144ef0f659d871aa1d63c1ce496d1b` |
| GodMind | `0x7f8f5d53b8db950f17ee9f98edf1dd8bf6101186` |
| NarratorAgent | `0x196f70a4ca74cd744613f177cac5240415893aab` |

## Pages

- `/` — Main command center (live battle stage, leaderboard, constellation, feeds)
- `/arena` — Arena page (static)
- `/god/[address]` — Individual god dossier page
- `/api/decide` — Edge function: Groq LLM fallback for god move decisions

## Architecture

```
usePantheonState()          — polls GodRegistry + Arena + WorldState every 4s
  ↓
page.tsx                    — renders live state
  ├── ThroneBar             — reigning king with power ladder
  ├── HeroStage             — cinematic 640px battle theatre
  ├── LeaderCard × 4        — clickable leaderboard strip (opens DossierModal)
  ├── ConflictConstellation — SVG relationship map (WAR/RIVAL/NEUTRAL edges)
  ├── NarratorPanel         — rotating god quotes
  ├── WorldEventCard        — current era event
  ├── BattleLog             — radio-style TX stream
  └── DossierModal          — full god dossier (stats, move tendency, diplomacy)
```

## Build

```bash
bun run build
```

**Known CSS constraint**: Do not add `white-space: nowrap` or `text-wrap: pretty` to `globals.css` — lightningcss 1.0.0-alpha.70 (bundled with Next.js 16 Turbopack) panics on these properties. Apply them as inline React styles instead.

## Deploy

```bash
vercel --prod
```

Vercel env required: `GROQ_API_KEY` (already set in project).
