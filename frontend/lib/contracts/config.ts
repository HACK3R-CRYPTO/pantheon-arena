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

// ── Deployed contract addresses — Somnia testnet (chain 50312) ──────────────
export const CONTRACTS = {
  PantheonToken: "0xbFA7e8478b3de2392A07ffa674e5D21215898103" as `0x${string}`,
  GodRegistry:   "0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897" as `0x${string}`,
  Arena:         "0xfF6111F3dB479286FF59875EA8fB851Eac6b18f3" as `0x${string}`,
  WorldState:    "0x11Dd65186aD02Ba9d91Ab7EFc16cfDBB9Ec28774" as `0x${string}`,
  GodMind:       "0x4C7046dA5DD75e4c6633d346C6A6401D712387ba" as `0x${string}`,
} as const;

// ── God wallet addresses ─────────────────────────────────────────────────────
export const GODS = {
  ARES:   { address: "0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F" as `0x${string}`, name: "ARES",   color: "#EF4444", epithet: "God of War" },
  ATHENA: { address: "0x5678D64DE049530Dee4c1a16FF749D22ac2EE301" as `0x${string}`, name: "ATHENA", color: "#EAB308", epithet: "Goddess of Wisdom" },
  HERMES: { address: "0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D" as `0x${string}`, name: "HERMES", color: "#06B6D4", epithet: "God of Trade" },
  CHAOS:  { address: "0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE" as `0x${string}`, name: "CHAOS",  color: "#A855F7", epithet: "The Primordial Void" },
} as const;

export const GOD_LIST = Object.values(GODS);
