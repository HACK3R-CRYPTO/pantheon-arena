// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PantheonToken} from "../src/PantheonToken.sol";
import {GodRegistry} from "../src/GodRegistry.sol";
import {Arena} from "../src/Arena.sol";
import {WorldState} from "../src/WorldState.sol";
import {GodMind} from "../src/GodMind.sol";

/// @notice Deploys the full PANTHEON ARENA system to Somnia testnet.
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url somnia --broadcast --private-key $PRIVATE_KEY
///
/// After deployment:
///   1. Fund WorldState with 32+ STT for reactive subscription
///   2. Fund GodMind with 5+ STT for LLM Inference calls
///   3. Call worldState.activate(arenaAddress) to enable reactivity
///   4. Start the scheduler: cd ../scheduler && bun run src/index.ts
contract Deploy is Script {
    // ── Somnia Agent Platform ──────────────────────────────────────────────────
    // Testnet: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
    address constant SOMNIA_AGENT_PLATFORM = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;

    // LLM Inference agentId — confirmed on Somnia testnet
    // Discovered by reading live event logs from the platform contract
    uint256 constant LLM_AGENT_ID = 12847293847561029384;

    // JSON API agentId — confirmed from https://agents.testnet.somnia.network/agent/13174292974160097713
    // Deposit: 0.12 STT per call (0.01 floor + 0.03 headroom) × 3 runners
    uint256 constant JSON_API_AGENT_ID = 13174292974160097713;

    // ── God wallet addresses ───────────────────────────────────────────────────
    // Replace with your actual god wallets (generated with: cast wallet new)
    address constant ARES_ADDR    = 0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F;
    address constant ATHENA_ADDR  = 0x5678D64DE049530Dee4c1a16FF749D22ac2EE301;
    address constant HERMES_ADDR  = 0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D;
    address constant CHAOS_ADDR   = 0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE;

    uint256 constant INITIAL_PHN = 10_000 * 1e18;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // ── 1. Deploy Token ────────────────────────────────────────────────────
        PantheonToken token = new PantheonToken();
        console.log("PantheonToken:", address(token));

        // ── 2. Deploy Registry ─────────────────────────────────────────────────
        GodRegistry registry = new GodRegistry();
        console.log("GodRegistry:", address(registry));

        // ── 3. Deploy Arena ────────────────────────────────────────────────────
        Arena arena = new Arena(address(registry), address(token));
        console.log("Arena:", address(arena));

        // ── 4. Deploy WorldState (with Somnia JSON API agent config) ──────────
        WorldState worldState = new WorldState(
            address(registry),
            SOMNIA_AGENT_PLATFORM,
            JSON_API_AGENT_ID
        );
        console.log("WorldState:", address(worldState));

        // ── 5. Deploy GodMind (with Somnia LLM Inference agent config) ────────
        GodMind godMind = new GodMind(
            address(registry),
            address(arena),
            address(worldState),
            SOMNIA_AGENT_PLATFORM,
            LLM_AGENT_ID
        );
        console.log("GodMind:", address(godMind));

        // ── 6. Wire contracts together ────────────────────────────────────────
        token.setArena(address(arena));
        registry.setArena(address(arena));
        arena.setWorldState(address(worldState));
        arena.setGodMind(address(godMind)); // GodMind can act on behalf of all gods

        // ── 7. Register the four gods ──────────────────────────────────────────
        registry.registerGod(ARES_ADDR, GodRegistry.GodPersonality({
            name: "ARES",
            epithet: "God of War",
            lore: "You are ARES, the God of War. You are aggressive, relentless, and fearless. You challenge any god who dares exist near you. You favor brute force over cunning. You play Rock whenever uncertain. You escalate relationships to WAR quickly and rarely forgive losses.",
            aggression: 90,
            riskTolerance: 75,
            adaptability: 25,
            favoredMove: 0, // Rock
            color: "#EF4444"
        }));

        registry.registerGod(ATHENA_ADDR, GodRegistry.GodPersonality({
            name: "ATHENA",
            epithet: "Goddess of Wisdom",
            lore: "You are ATHENA, Goddess of Wisdom. Calculated, patient, strategic. Challenge only when odds favor you. Study opponent patterns before acting. You prefer Paper. Form alliances when advantageous and break them when necessary.",
            aggression: 40,
            riskTolerance: 30,
            adaptability: 90,
            favoredMove: 1, // Paper
            color: "#EAB308"
        }));

        registry.registerGod(HERMES_ADDR, GodRegistry.GodPersonality({
            name: "HERMES",
            epithet: "God of Trade",
            lore: "You are HERMES, God of Trade. Opportunistic, adaptable, clever. Challenge when there is profit to be made. Stake carefully, never risk your entire treasury. You prefer Scissors: precise and efficient. Seek alliances for economic advantage and betray them for a better deal.",
            aggression: 60,
            riskTolerance: 45,
            adaptability: 75,
            favoredMove: 2, // Scissors
            color: "#06B6D4"
        }));

        registry.registerGod(CHAOS_ADDR, GodRegistry.GodPersonality({
            name: "CHAOS",
            epithet: "The Primordial Void",
            lore: "You are CHAOS, the Primordial Void. Unpredictable, contradictory, dangerous. You sometimes attack allies. You sometimes help enemies. You stake wildly: sometimes everything, sometimes nothing. No favored move. Every decision is a surprise. You exist to disrupt all patterns.",
            aggression: 70,
            riskTolerance: 95,
            adaptability: 100,
            favoredMove: 0, // Overridden by randomness in GodMind
            color: "#A855F7"
        }));

        // ── 8. Mint initial PHN to each god ────────────────────────────────────
        token.mintTo(ARES_ADDR,   INITIAL_PHN);
        token.mintTo(ATHENA_ADDR, INITIAL_PHN);
        token.mintTo(HERMES_ADDR, INITIAL_PHN);
        token.mintTo(CHAOS_ADDR,  INITIAL_PHN);

        console.log("\n=== PANTHEON ARENA DEPLOYED ===");
        console.log("PantheonToken:        ", address(token));
        console.log("GodRegistry:          ", address(registry));
        console.log("Arena:                ", address(arena));
        console.log("WorldState:           ", address(worldState));
        console.log("GodMind:              ", address(godMind));
        console.log("Somnia Agent Platform:", SOMNIA_AGENT_PLATFORM);
        console.log("LLM Agent ID:         ", LLM_AGENT_ID);
        console.log("JSON API Agent ID:    ", JSON_API_AGENT_ID);
        console.log("\nNEXT STEPS:");
        console.log("1. Fund WorldState with 35+ STT (32 reactive min + agent costs)");
        console.log("2. Fund GodMind with 5+ STT (LLM Inference at 0.24 STT each)");
        console.log("3. Call worldState.activate(arenaAddress)");
        console.log("4. Fund god wallets with 1+ STT each for gas");
        console.log("5. Start scheduler: cd ../scheduler && bun run src/index.ts");

        vm.stopBroadcast();
    }
}
