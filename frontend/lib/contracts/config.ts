import { defineChain } from "viem";

export const somniaTestnet = defineChain({
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://dream-rpc.somnia.network"] },
  },
  blockExplorers: {
    default: { name: "Shannon Explorer", url: "https://shannon-explorer.somnia.network" },
  },
});

// ── Deployed contract addresses (update after deployment) ───────────────────
export const CONTRACTS = {
  PantheonToken: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  GodRegistry:   "0x0000000000000000000000000000000000000000" as `0x${string}`,
  Arena:         "0x0000000000000000000000000000000000000000" as `0x${string}`,
  WorldState:    "0x0000000000000000000000000000000000000000" as `0x${string}`,
  GodMind:       "0x0000000000000000000000000000000000000000" as `0x${string}`,
} as const;

// ── God wallet addresses ─────────────────────────────────────────────────────
export const GODS = {
  ARES:   { address: "0x1111111111111111111111111111111111111111" as `0x${string}`, name: "ARES",   color: "#EF4444", epithet: "God of War" },
  ATHENA: { address: "0x2222222222222222222222222222222222222222" as `0x${string}`, name: "ATHENA", color: "#EAB308", epithet: "Goddess of Wisdom" },
  HERMES: { address: "0x3333333333333333333333333333333333333333" as `0x${string}`, name: "HERMES", color: "#06B6D4", epithet: "God of Trade" },
  CHAOS:  { address: "0x4444444444444444444444444444444444444444" as `0x${string}`, name: "CHAOS",  color: "#A855F7", epithet: "The Primordial Void" },
} as const;

export const GOD_LIST = Object.values(GODS);
