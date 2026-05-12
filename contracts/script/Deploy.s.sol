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
/// After deployment, fund WorldState with 32+ STT, then call worldState.activate(arenaAddress)
contract Deploy is Script {
    // God wallet addresses — replace with your actual god wallets before deployment
    // These are the addresses whose private keys the TypeScript scheduler controls
    address constant ARES_ADDR    = 0x1111111111111111111111111111111111111111;
    address constant ATHENA_ADDR  = 0x2222222222222222222222222222222222222222;
    address constant HERMES_ADDR  = 0x3333333333333333333333333333333333333333;
    address constant CHAOS_ADDR   = 0x4444444444444444444444444444444444444444;

    uint256 constant INITIAL_PHN = 10_000 * 1e18; // 10,000 PHN per god

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

        // ── 4. Deploy WorldState ───────────────────────────────────────────────
        WorldState worldState = new WorldState(address(registry));
        console.log("WorldState:", address(worldState));

        // ── 5. Deploy GodMind ──────────────────────────────────────────────────
        GodMind godMind = new GodMind(address(registry), address(arena), address(worldState));
        console.log("GodMind:", address(godMind));

        // ── 6. Wire contracts together ────────────────────────────────────────
        token.setArena(address(arena));
        registry.setArena(address(arena));
        arena.setWorldState(address(worldState));

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
        console.log("PantheonToken:", address(token));
        console.log("GodRegistry:  ", address(registry));
        console.log("Arena:        ", address(arena));
        console.log("WorldState:   ", address(worldState));
        console.log("GodMind:      ", address(godMind));
        console.log("\nNEXT STEPS:");
        console.log("1. Fund WorldState with 32+ STT for reactive subscription");
        console.log("2. Call worldState.activate(", address(arena), ")");
        console.log("3. Start the TypeScript scheduler: cd ../scheduler && bun run start");

        vm.stopBroadcast();
    }
}
