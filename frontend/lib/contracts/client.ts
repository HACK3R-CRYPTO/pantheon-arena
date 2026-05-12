import { createPublicClient, http } from "viem";
import { somniaTestnet } from "./config";

export const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http("https://dream-rpc.somnia.network"),
  pollingInterval: 2_000,
});
