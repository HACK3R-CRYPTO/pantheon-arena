// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {GodRegistry} from "../src/GodRegistry.sol";

contract GodRegistryTest is Test {
    GodRegistry public registry;

    address public owner;
    address public arenaAddr;
    address public godA;
    address public godB;
    address public godC;
    address public stranger;

    // ── Helpers ────────────────────────────────────────────────────────────────

    function _defaultPersonality(string memory godName) internal pure returns (GodRegistry.GodPersonality memory) {
        return GodRegistry.GodPersonality({
            name: godName,
            epithet: "The Eternal",
            lore: "Ancient and powerful",
            aggression: 60,
            riskTolerance: 50,
            adaptability: 40,
            favoredMove: 0,
            color: "#FF0000"
        });
    }

    function setUp() public {
        owner = address(this);
        arenaAddr = vm.addr(10);
        godA = vm.addr(1);
        godB = vm.addr(2);
        godC = vm.addr(3);
        stranger = vm.addr(99);

        registry = new GodRegistry();
        registry.setArena(arenaAddr);

        registry.registerGod(godA, _defaultPersonality("Zeus"));
        registry.registerGod(godB, _defaultPersonality("Ares"));
    }

    // ── registerGod ────────────────────────────────────────────────────────────

    function test_registerGod_storesPersonality() public view {
        GodRegistry.GodPersonality memory p = registry.getPersonality(godA);
        assertEq(p.name, "Zeus");
        assertEq(p.epithet, "The Eternal");
        assertEq(p.lore, "Ancient and powerful");
        assertEq(p.aggression, 60);
        assertEq(p.riskTolerance, 50);
        assertEq(p.adaptability, 40);
        assertEq(p.favoredMove, 0);
        assertEq(p.color, "#FF0000");
    }

    function test_registerGod_initializesStats() public view {
        GodRegistry.GodStats memory s = registry.getStats(godA);
        assertEq(s.wins, 0);
        assertEq(s.losses, 0);
        assertEq(s.totalStaked, 0);
        assertEq(s.powerScore, 1000); // ELO starting point
        assertTrue(s.active);
    }

    function test_registerGod_incrementsGodCount() public view {
        assertEq(registry.getGodCount(), 2);
    }

    function test_registerGod_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit GodRegistry.GodRegistered(godC, "Athena");
        registry.registerGod(godC, _defaultPersonality("Athena"));
    }

    function test_registerGod_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(GodRegistry.Unauthorized.selector);
        registry.registerGod(godC, _defaultPersonality("Athena"));
    }

    function test_registerGod_revertsIfAlreadyRegistered() public {
        vm.expectRevert(GodRegistry.AlreadyRegistered.selector);
        registry.registerGod(godA, _defaultPersonality("Zeus Again"));
    }

    // ── recordResult ───────────────────────────────────────────────────────────

    function test_recordResult_updatesWinsAndLosses() public {
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);

        GodRegistry.GodStats memory wa = registry.getStats(godA);
        GodRegistry.GodStats memory lb = registry.getStats(godB);

        assertEq(wa.wins, 1);
        assertEq(wa.losses, 0);
        assertEq(lb.wins, 0);
        assertEq(lb.losses, 1);
    }

    function test_recordResult_updatesTotalStaked() public {
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 250 ether);

        assertEq(registry.getStats(godA).totalStaked, 250 ether);
        assertEq(registry.getStats(godB).totalStaked, 250 ether);
    }

    function test_recordResult_eloWinnerGains() public {
        uint256 startA = registry.getStats(godA).powerScore; // 1000
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);

        // Equal scores: transfer = 15
        assertEq(registry.getStats(godA).powerScore, startA + 15);
    }

    function test_recordResult_eloLoserLoses() public {
        uint256 startB = registry.getStats(godB).powerScore; // 1000
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);

        assertEq(registry.getStats(godB).powerScore, startB - 15);
    }

    function test_recordResult_eloUnderdogBonus() public {
        // Artificially lower godA's power score to make godB the favourite
        // We do this by having godA lose several times first
        // Win for godB against godA 10 times to give godB a high score
        address godX = vm.addr(50);
        registry.registerGod(godX, _defaultPersonality("Underdog"));

        // Give godB a large head-start by making it win vs godX repeatedly
        // godX starts at 1000, godB at 1000 — let godB win 10 times
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(arenaAddr);
            registry.recordResult(godB, godX, 1, 0, 100 ether);
        }

        uint256 scoreB = registry.getStats(godB).powerScore;
        uint256 scoreX = registry.getStats(godX).powerScore;
        // scoreB >> scoreX now; if godX wins the next match it's an underdog win
        assertTrue(scoreB > scoreX);

        uint256 xBefore = registry.getStats(godX).powerScore;
        vm.prank(arenaAddr);
        registry.recordResult(godX, godB, 0, 2, 100 ether);

        uint256 gained = registry.getStats(godX).powerScore - xBefore;
        assertTrue(gained > 15, "Underdog should gain more than base 15");
    }

    function test_recordResult_eloLoserFloorAt100() public {
        // Drain godB's score to near floor by making it lose many times
        address godY = vm.addr(51);
        registry.registerGod(godY, _defaultPersonality("PowerGod"));

        // Make godB lose many times until its score hits the floor
        for (uint256 i = 0; i < 60; i++) {
            vm.prank(arenaAddr);
            registry.recordResult(godY, godB, 1, 0, 100 ether);
        }
        uint256 scoreB = registry.getStats(godB).powerScore;
        assertGe(scoreB, 100, "Power score must not drop below 100");
    }

    function test_recordResult_revertsForNonArena() public {
        vm.prank(stranger);
        vm.expectRevert(GodRegistry.Unauthorized.selector);
        registry.recordResult(godA, godB, 0, 2, 100 ether);
    }

    function test_recordResult_emitsStatsUpdated() public {
        vm.prank(arenaAddr);
        vm.expectEmit(true, false, false, false);
        emit GodRegistry.StatsUpdated(godA, 1, 0, 0); // values checked loosely
        registry.recordResult(godA, godB, 0, 2, 100 ether);
    }

    // ── recordResult — relation escalation ────────────────────────────────────

    function test_recordResult_neutralBecomesRival() public {
        GodRegistry.Relation rel = registry.getRelation(godA, godB);
        assertEq(uint8(rel), uint8(GodRegistry.Relation.NEUTRAL));

        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);

        rel = registry.getRelation(godA, godB);
        assertEq(uint8(rel), uint8(GodRegistry.Relation.RIVAL));
    }

    function test_recordResult_rivalBecomesWar() public {
        // First fight: NEUTRAL → RIVAL
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);
        // Second fight: RIVAL → WAR
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);

        GodRegistry.Relation rel = registry.getRelation(godA, godB);
        assertEq(uint8(rel), uint8(GodRegistry.Relation.WAR));
    }

    // ── getRecentMoves ─────────────────────────────────────────────────────────

    function test_getRecentMoves_emptyHistory() public view {
        uint8[] memory moves = registry.getRecentMoves(godA, 5);
        assertEq(moves.length, 0);
    }

    function test_getRecentMoves_fewerThanRequested() public {
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 1, 0, 100 ether); // godA plays Paper (1)

        uint8[] memory moves = registry.getRecentMoves(godA, 10);
        assertEq(moves.length, 1);
        assertEq(moves[0], 1);
    }

    function test_getRecentMoves_returnsLastN() public {
        // godA plays Rock, Paper, Scissors in three matches
        uint8[3] memory movesPlayed = [uint8(0), uint8(1), uint8(2)];
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(arenaAddr);
            registry.recordResult(godA, godB, movesPlayed[i], movesPlayed[(i + 1) % 3], 100 ether);
        }

        uint8[] memory recent = registry.getRecentMoves(godA, 2);
        assertEq(recent.length, 2);
        // Most recent two: Paper (1) and Scissors (2)
        assertEq(recent[0], 1);
        assertEq(recent[1], 2);
    }

    function test_getRecentMoves_exactCount() public {
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 0, 2, 100 ether);
        vm.prank(arenaAddr);
        registry.recordResult(godA, godB, 1, 0, 100 ether);

        uint8[] memory recent = registry.getRecentMoves(godA, 2);
        assertEq(recent.length, 2);
        assertEq(recent[0], 0);
        assertEq(recent[1], 1);
    }

    // ── setRelation ────────────────────────────────────────────────────────────

    function test_setRelation_updatesRelation() public {
        vm.prank(arenaAddr);
        registry.setRelation(godA, godB, GodRegistry.Relation.ALLIED);

        assertEq(uint8(registry.getRelation(godA, godB)), uint8(GodRegistry.Relation.ALLIED));
    }

    function test_setRelation_sortedOrderIsSymmetric() public {
        vm.prank(arenaAddr);
        registry.setRelation(godB, godA, GodRegistry.Relation.WAR); // reversed order

        // getRelation normalises order internally
        assertEq(uint8(registry.getRelation(godA, godB)), uint8(GodRegistry.Relation.WAR));
        assertEq(uint8(registry.getRelation(godB, godA)), uint8(GodRegistry.Relation.WAR));
    }

    function test_setRelation_emitsEvent() public {
        (address a, address b) = godA < godB ? (godA, godB) : (godB, godA);
        vm.prank(arenaAddr);
        vm.expectEmit(true, true, false, true);
        emit GodRegistry.RelationChanged(a, b, GodRegistry.Relation.RIVAL);
        registry.setRelation(godA, godB, GodRegistry.Relation.RIVAL);
    }

    function test_setRelation_revertsForNonArena() public {
        vm.prank(stranger);
        vm.expectRevert(GodRegistry.Unauthorized.selector);
        registry.setRelation(godA, godB, GodRegistry.Relation.ALLIED);
    }

    // ── getAllGodStates / view helpers ─────────────────────────────────────────

    function test_getAllGodStates_returnsAll() public view {
        (address[] memory addrs, , GodRegistry.GodStats[] memory allStats) = registry.getAllGodStates();
        assertEq(addrs.length, 2);
        assertEq(allStats.length, 2);
    }

    function test_getGodAt_returnsCorrectAddress() public view {
        assertEq(registry.getGodAt(0), godA);
        assertEq(registry.getGodAt(1), godB);
    }

    // ── setArena (owner gating) ────────────────────────────────────────────────

    function test_setArena_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(GodRegistry.Unauthorized.selector);
        registry.setArena(vm.addr(88));
    }
}
