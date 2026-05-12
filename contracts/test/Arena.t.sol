// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Arena} from "../src/Arena.sol";
import {GodRegistry} from "../src/GodRegistry.sol";
import {PantheonToken} from "../src/PantheonToken.sol";

contract ArenaTest is Test {
    Arena public arena;
    GodRegistry public registry;
    PantheonToken public token;

    address public owner;
    address public challenger; // godA
    address public opponent;   // godB
    address public godC;
    address public stranger;

    uint256 public constant STARTING_BALANCE = 10_000 ether;
    uint256 public constant STAKE = 100 ether;

    // ── Helpers ────────────────────────────────────────────────────────────────

    function _defaultPersonality(string memory godName) internal pure returns (GodRegistry.GodPersonality memory) {
        return GodRegistry.GodPersonality({
            name: godName,
            epithet: "The Ancient",
            lore: "Forged in chaos",
            aggression: 70,
            riskTolerance: 50,
            adaptability: 50,
            favoredMove: 0,
            color: "#AABBCC"
        });
    }

    /// @dev Computes commit hash using the same method as Arena.revealMove
    function _makeCommit(uint8 move, bytes32 secret) internal pure returns (bytes32) {
        return keccak256(abi.encode(move, secret));
    }

    /// @dev Runs propose → accept, returns matchId
    function _proposeAndAccept(uint256 stake) internal returns (uint256 matchId) {
        vm.prank(challenger);
        matchId = arena.proposeChallenge(challenger, opponent, stake, "Test challenge");

        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);
    }

    /// @dev Runs a full match with explicit moves; returns matchId
    function _fullMatch(uint8 cMove, uint8 oMove) internal returns (uint256 matchId) {
        matchId = _proposeAndAccept(STAKE);

        bytes32 cSecret = keccak256(abi.encodePacked("challenger_secret"));
        bytes32 oSecret = keccak256(abi.encodePacked("opponent_secret"));

        vm.prank(challenger);
        arena.commitMove(challenger, matchId, _makeCommit(cMove, cSecret));

        vm.prank(opponent);
        arena.commitMove(opponent, matchId, _makeCommit(oMove, oSecret));

        vm.prank(challenger);
        arena.revealMove(challenger, matchId, cMove, cSecret);

        vm.prank(opponent);
        arena.revealMove(opponent, matchId, oMove, oSecret);
    }

    function setUp() public {
        owner = address(this);
        challenger = vm.addr(1);
        opponent = vm.addr(2);
        godC = vm.addr(3);
        stranger = vm.addr(99);

        // Deploy contracts
        registry = new GodRegistry();
        token = new PantheonToken();
        arena = new Arena(address(registry), address(token));

        // Wire up
        token.setArena(address(arena));
        registry.setArena(address(arena));

        // Register gods
        registry.registerGod(challenger, _defaultPersonality("Zeus"));
        registry.registerGod(opponent, _defaultPersonality("Ares"));
        registry.registerGod(godC, _defaultPersonality("Athena"));

        // Fund gods
        token.mintTo(challenger, STARTING_BALANCE);
        token.mintTo(opponent, STARTING_BALANCE);
        token.mintTo(godC, STARTING_BALANCE);
    }

    // ── proposeChallenge ───────────────────────────────────────────────────────

    function test_propose_createsMatch() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "Let us fight");

        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.id, matchId);
        assertEq(m.challenger, challenger);
        assertEq(m.opponent, opponent);
        assertEq(m.stake, STAKE);
        assertEq(uint8(m.status), uint8(Arena.MatchStatus.PENDING));
    }

    function test_propose_setsHasActiveMatch() public {
        vm.prank(challenger);
        arena.proposeChallenge(challenger, opponent, STAKE, "go");

        assertTrue(arena.hasActiveMatch(challenger));
        assertFalse(arena.hasActiveMatch(opponent));
    }

    function test_propose_emitsEvent() public {
        vm.prank(challenger);
        vm.expectEmit(true, true, true, true);
        emit Arena.MatchProposed(1, challenger, opponent, STAKE);
        arena.proposeChallenge(challenger, opponent, STAKE, "go");
    }

    function test_propose_revertsIfGodBusy() public {
        vm.prank(challenger);
        arena.proposeChallenge(challenger, opponent, STAKE, "first");

        vm.prank(challenger);
        vm.expectRevert(Arena.GodBusy.selector);
        arena.proposeChallenge(challenger, godC, STAKE, "second");
    }

    function test_propose_revertsIfInsufficientBalance() public {
        address poorGod = vm.addr(50);
        registry.registerGod(poorGod, _defaultPersonality("PoorGod"));
        // poorGod has 0 tokens

        vm.prank(poorGod);
        vm.expectRevert(Arena.InsufficientBalance.selector);
        arena.proposeChallenge(poorGod, opponent, STAKE, "broke");
    }

    function test_propose_revertsForUnauthorized() public {
        vm.prank(stranger);
        vm.expectRevert(Arena.Unauthorized.selector);
        arena.proposeChallenge(challenger, opponent, STAKE, "impersonating");
    }

    // ── acceptChallenge ────────────────────────────────────────────────────────

    function test_accept_changesStatusToAccepted() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");

        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(uint8(m.status), uint8(Arena.MatchStatus.ACCEPTED));
    }

    function test_accept_setsOpponentActiveMatch() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");

        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        assertTrue(arena.hasActiveMatch(opponent));
        assertEq(arena.activeMatchOf(opponent), matchId);
    }

    function test_accept_revertsIfOpponentBusy() public {
        // Opponent is already in another match as challenger
        vm.prank(opponent);
        arena.proposeChallenge(opponent, godC, STAKE, "other match");

        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "new match");

        vm.prank(opponent);
        vm.expectRevert(Arena.GodBusy.selector);
        arena.acceptChallenge(opponent, matchId);
    }

    function test_accept_revertsIfWrongOpponent() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");

        vm.prank(godC);
        vm.expectRevert(Arena.Unauthorized.selector);
        arena.acceptChallenge(godC, matchId);
    }

    function test_accept_revertsIfMatchNotFound() public {
        vm.prank(opponent);
        vm.expectRevert(Arena.MatchNotFound.selector);
        arena.acceptChallenge(opponent, 999);
    }

    function test_accept_revertsIfNotPending() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");

        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        // Try to accept again
        vm.prank(opponent);
        vm.expectRevert(Arena.WrongStatus.selector);
        arena.acceptChallenge(opponent, matchId);
    }

    // ── commitMove ─────────────────────────────────────────────────────────────

    function test_commit_storesHashes() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        bytes32 cCommit = _makeCommit(0, keccak256("csec"));
        bytes32 oCommit = _makeCommit(1, keccak256("osec"));

        vm.prank(challenger);
        arena.commitMove(challenger, matchId, cCommit);
        vm.prank(opponent);
        arena.commitMove(opponent, matchId, oCommit);

        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.challengerCommit, cCommit);
        assertEq(m.opponentCommit, oCommit);
    }

    function test_commit_statusBecomesCommittedAfterBoth() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        vm.prank(challenger);
        arena.commitMove(challenger, matchId, _makeCommit(0, keccak256("csec")));
        // After only one commit, status stays ACCEPTED
        assertEq(uint8(arena.getMatch(matchId).status), uint8(Arena.MatchStatus.ACCEPTED));

        vm.prank(opponent);
        arena.commitMove(opponent, matchId, _makeCommit(1, keccak256("osec")));
        assertEq(uint8(arena.getMatch(matchId).status), uint8(Arena.MatchStatus.COMMITTED));
    }

    function test_commit_emitsMovesCommittedWhenBothDone() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        vm.prank(challenger);
        arena.commitMove(challenger, matchId, _makeCommit(0, keccak256("csec")));

        vm.prank(opponent);
        vm.expectEmit(true, false, false, false);
        emit Arena.MovesCommitted(matchId);
        arena.commitMove(opponent, matchId, _makeCommit(1, keccak256("osec")));
    }

    function test_commit_revertsIfWrongStatus() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        // Status is PENDING, not ACCEPTED

        vm.prank(challenger);
        vm.expectRevert(Arena.WrongStatus.selector);
        arena.commitMove(challenger, matchId, _makeCommit(0, keccak256("sec")));
    }

    // ── revealMove + resolution ────────────────────────────────────────────────

    function test_reveal_commitMismatchReverts() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        bytes32 cCommit = _makeCommit(0, keccak256("csec"));
        vm.prank(challenger);
        arena.commitMove(challenger, matchId, cCommit);
        vm.prank(opponent);
        arena.commitMove(opponent, matchId, _makeCommit(1, keccak256("osec")));

        // Challenger tries to reveal with wrong secret
        vm.prank(challenger);
        vm.expectRevert(Arena.CommitMismatch.selector);
        arena.revealMove(challenger, matchId, 0, keccak256("WRONG_SECRET"));
    }

    function test_reveal_invalidMoveReverts() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        vm.prank(challenger);
        arena.commitMove(challenger, matchId, _makeCommit(0, keccak256("csec")));
        vm.prank(opponent);
        arena.commitMove(opponent, matchId, _makeCommit(1, keccak256("osec")));

        vm.prank(challenger);
        vm.expectRevert(Arena.InvalidMove.selector);
        arena.revealMove(challenger, matchId, 3, keccak256("csec")); // move 3 is invalid
    }

    function test_reveal_wrongStatus_reverts() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        // Status is ACCEPTED, not COMMITTED — cannot reveal yet
        vm.prank(challenger);
        vm.expectRevert(Arena.WrongStatus.selector);
        arena.revealMove(challenger, matchId, 0, keccak256("csec"));
    }

    // ── RPS outcomes ──────────────────────────────────────────────────────────

    // Rock (0) beats Scissors (2)
    function test_rps_rockBeatsScissors() public {
        uint256 matchId = _fullMatch(0, 2); // challenger=Rock, opponent=Scissors
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, challenger);
        assertEq(uint8(m.status), uint8(Arena.MatchStatus.RESOLVED));
    }

    // Paper (1) beats Rock (0)
    function test_rps_paperBeatsRock() public {
        uint256 matchId = _fullMatch(0, 1); // challenger=Rock, opponent=Paper → opponent wins
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, opponent);
    }

    // Scissors (2) beats Paper (1)
    function test_rps_scissorsBeatsPaper() public {
        uint256 matchId = _fullMatch(1, 2); // challenger=Paper, opponent=Scissors → opponent wins
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, opponent);
    }

    // Challenger wins when they pick the winning move
    function test_rps_challengerWinsWithPaperVsRock() public {
        uint256 matchId = _fullMatch(1, 0); // challenger=Paper, opponent=Rock → challenger wins
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, challenger);
    }

    function test_rps_scissorsBeatsOpponentPaper() public {
        uint256 matchId = _fullMatch(2, 1); // challenger=Scissors, opponent=Paper → challenger wins
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, challenger);
    }

    // Tie — challenger wins (initiative rule)
    function test_rps_tieGoesToChallengerRock() public {
        uint256 matchId = _fullMatch(0, 0); // both Rock
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, challenger);
    }

    function test_rps_tieGoesToChallengerPaper() public {
        uint256 matchId = _fullMatch(1, 1); // both Paper
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, challenger);
    }

    function test_rps_tieGoesToChallengerScissors() public {
        uint256 matchId = _fullMatch(2, 2); // both Scissors
        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(m.winner, challenger);
    }

    // ── Token settlement ───────────────────────────────────────────────────────

    function test_resolve_winnerGainsStake() public {
        uint256 cBefore = token.balanceOf(challenger);
        uint256 oBefore = token.balanceOf(opponent);

        _fullMatch(0, 2); // challenger (Rock) beats opponent (Scissors)

        assertEq(token.balanceOf(challenger), cBefore + STAKE);
        assertEq(token.balanceOf(opponent), oBefore - STAKE);
    }

    function test_resolve_tieWinnerGainsStake() public {
        uint256 cBefore = token.balanceOf(challenger);
        uint256 oBefore = token.balanceOf(opponent);

        _fullMatch(0, 0); // tie — challenger wins

        assertEq(token.balanceOf(challenger), cBefore + STAKE);
        assertEq(token.balanceOf(opponent), oBefore - STAKE);
    }

    function test_resolve_clearsActiveMatchFlags() public {
        _fullMatch(0, 2);
        assertFalse(arena.hasActiveMatch(challenger));
        assertFalse(arena.hasActiveMatch(opponent));
    }

    function test_resolve_emitsMatchResolved() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        bytes32 cSecret = keccak256(abi.encodePacked("cs"));
        bytes32 oSecret = keccak256(abi.encodePacked("os"));
        uint8 cMove = 0; // Rock
        uint8 oMove = 2; // Scissors — challenger wins

        vm.prank(challenger);
        arena.commitMove(challenger, matchId, _makeCommit(cMove, cSecret));
        vm.prank(opponent);
        arena.commitMove(opponent, matchId, _makeCommit(oMove, oSecret));

        vm.prank(challenger);
        arena.revealMove(challenger, matchId, cMove, cSecret);

        vm.prank(opponent);
        vm.expectEmit(true, true, true, false);
        emit Arena.MatchResolved(matchId, challenger, opponent, STAKE, cMove, oMove, "go");
        arena.revealMove(opponent, matchId, oMove, oSecret);
    }

    // ── GodBusy guard ──────────────────────────────────────────────────────────

    function test_godBusy_preventsDoublePropose() public {
        vm.prank(challenger);
        arena.proposeChallenge(challenger, opponent, STAKE, "first");

        vm.prank(challenger);
        vm.expectRevert(Arena.GodBusy.selector);
        arena.proposeChallenge(challenger, godC, STAKE, "second");
    }

    function test_godBusy_clearedAfterResolution() public {
        _fullMatch(0, 2);

        // Now challenger can propose a new match
        vm.prank(challenger);
        uint256 newMatchId = arena.proposeChallenge(challenger, opponent, STAKE, "rematch");
        assertTrue(newMatchId > 0);
    }

    // ── Match history tracking ─────────────────────────────────────────────────

    function test_matchHistory_recordedForBothGods() public {
        uint256 matchId = _proposeAndAccept(STAKE);

        uint256[] memory cHistory = arena.getGodMatchHistory(challenger);
        uint256[] memory oHistory = arena.getGodMatchHistory(opponent);

        assertEq(cHistory.length, 1);
        assertEq(oHistory.length, 1);
        assertEq(cHistory[0], matchId);
        assertEq(oHistory[0], matchId);
    }

    // ── getRecentMatches ───────────────────────────────────────────────────────

    function test_getRecentMatches_returnsUpToCount() public {
        _fullMatch(0, 2);
        _fullMatch(1, 0);

        Arena.Match[] memory recent = arena.getRecentMatches(1);
        assertEq(recent.length, 1);
        assertEq(recent[0].id, 2); // most recent first
    }

    function test_getRecentMatches_clampsToTotal() public {
        _fullMatch(0, 2);

        Arena.Match[] memory recent = arena.getRecentMatches(100);
        assertEq(recent.length, 1);
    }

    // ── godMind authorization ─────────────────────────────────────────────────

    function test_godMind_canActOnBehalfOfGod() public {
        address godMind = vm.addr(77);
        arena.setGodMind(godMind);

        // godMind proposes on behalf of challenger
        vm.prank(godMind);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "mind control");
        assertTrue(matchId > 0);
    }

    function test_setGodMind_revertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(Arena.Unauthorized.selector);
        arena.setGodMind(vm.addr(77));
    }

    // ── forfeitExpired ────────────────────────────────────────────────────────

    function test_forfeit_pendingAfterDeadline() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");

        // Roll past the commit deadline
        vm.roll(block.number + arena.COMMIT_DEADLINE_BLOCKS() + 1);

        arena.forfeitExpired(matchId);

        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(uint8(m.status), uint8(Arena.MatchStatus.CANCELLED));
        assertFalse(arena.hasActiveMatch(challenger));
    }

    function test_forfeit_pendingBeforeDeadlineReverts() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");

        vm.expectRevert(Arena.DeadlineExpired.selector);
        arena.forfeitExpired(matchId);
    }

    function test_forfeit_acceptedAfterDeadline() public {
        vm.prank(challenger);
        uint256 matchId = arena.proposeChallenge(challenger, opponent, STAKE, "go");
        vm.prank(opponent);
        arena.acceptChallenge(opponent, matchId);

        uint256 deadline = arena.COMMIT_DEADLINE_BLOCKS() + arena.REVEAL_DEADLINE_BLOCKS();
        vm.roll(block.number + deadline + 1);

        // Challenger committed but opponent did not — challenger wins
        arena.forfeitExpired(matchId);

        Arena.Match memory m = arena.getMatch(matchId);
        assertEq(uint8(m.status), uint8(Arena.MatchStatus.RESOLVED));
    }

    function test_forfeit_revertsIfMatchNotFound() public {
        vm.expectRevert(Arena.MatchNotFound.selector);
        arena.forfeitExpired(999);
    }
}
