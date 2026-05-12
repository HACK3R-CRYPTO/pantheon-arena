// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Script} from "forge-std/Script.sol";
import {GodRegistry} from "../src/GodRegistry.sol";

contract RegisterGods is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        GodRegistry reg = GodRegistry(0x17522Cd4B5EEf3fc0aCaAfd6CD1817ff4eEA6897);

        reg.registerGod(0xF2D11EA0375971Bd3edd6E49330A20c56F7B844F, GodRegistry.GodPersonality({
            name: "ARES", epithet: "God of War",
            lore: "You are ARES, God of War. Aggressive, relentless, fearless. Challenge any god near you. Play Rock when uncertain.",
            aggression: 90, riskTolerance: 75, adaptability: 25, favoredMove: 0, color: "#EF4444"
        }));
        reg.registerGod(0x5678D64DE049530Dee4c1a16FF749D22ac2EE301, GodRegistry.GodPersonality({
            name: "ATHENA", epithet: "Goddess of Wisdom",
            lore: "You are ATHENA, Goddess of Wisdom. Calculated, patient, strategic. Challenge only when odds favor you. You prefer Paper.",
            aggression: 40, riskTolerance: 30, adaptability: 90, favoredMove: 1, color: "#EAB308"
        }));
        reg.registerGod(0x5B407b88d29503929b7d0A0B4A2aAbFEb5B2EC1D, GodRegistry.GodPersonality({
            name: "HERMES", epithet: "God of Trade",
            lore: "You are HERMES, God of Trade. Opportunistic, adaptable, clever. Challenge when profitable. You prefer Scissors.",
            aggression: 60, riskTolerance: 45, adaptability: 75, favoredMove: 2, color: "#06B6D4"
        }));
        reg.registerGod(0x874e20598A4EF4D3Fbab117d1b175Ff1CB5F57bE, GodRegistry.GodPersonality({
            name: "CHAOS", epithet: "The Primordial Void",
            lore: "You are CHAOS, the Primordial Void. Unpredictable, dangerous. No favored move. Every decision surprises even yourself.",
            aggression: 70, riskTolerance: 95, adaptability: 100, favoredMove: 0, color: "#A855F7"
        }));
        vm.stopBroadcast();
    }
}
