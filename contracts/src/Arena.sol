// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GodRegistry} from "./GodRegistry.sol";
import {PantheonToken} from "./PantheonToken.sol";

/// @notice Match lifecycle for god-vs-god battles.
///         Uses commit-reveal to prevent front-running — both gods commit a hashed move,
///         then reveal. The MatchResolved event triggers WorldState reactively.
contract Arena {
    enum GameType { RPS }       // Rock-Paper-Scissors. Expandable.
    enum MatchStatus { PENDING, ACCEPTED, COMMITTED, RESOLVED, CANCELLED }

    struct Match {
        uint256 id;
        address challenger;
        address opponent;
        uint256 stake;          // PHN amount each god puts up
        GameType gameType;
        MatchStatus status;
        bytes32 challengerCommit;
        bytes32 opponentCommit;
        uint8 challengerMove;   // 0=Rock 1=Paper 2=Scissors (revealed)
        uint8 opponentMove;
        bool challengerRevealed;  // true once challenger calls revealMove
        bool opponentRevealed;    // true once opponent calls revealMove
        address winner;
        uint256 createdBlock;
        string decisionReason;  // LLM reasoning stored onchain (or Markov label)
    }

    GodRegistry public registry;
    PantheonToken public token;
    address public worldState;
    address public owner;

    uint256 public matchCounter;
    mapping(uint256 => Match) public matches;

    // Track active match per god to prevent double-booking
    mapping(address => uint256) public activeMatchOf; // 0 = none
    mapping(address => bool) public hasActiveMatch;

    // Full match history per god
    mapping(address => uint256[]) public godMatchIds;

    // Commit deadline: both must commit within N blocks of acceptance
    uint256 public constant COMMIT_DEADLINE_BLOCKS = 50;
    // Reveal deadline: both must reveal within N blocks of last commit
    uint256 public constant REVEAL_DEADLINE_BLOCKS = 50;

    // Events — MatchResolved is subscribed to by WorldState (reactive)
    event MatchProposed(uint256 indexed matchId, address indexed challenger, address indexed opponent, uint256 stake);
    event MatchAccepted(uint256 indexed matchId, address indexed opponent);
    event MovesCommitted(uint256 indexed matchId);
    event MatchResolved(
        uint256 indexed matchId,
        address indexed winner,
        address indexed loser,
        uint256 stake,
        uint8 winnerMove,
        uint8 loserMove,
        string decisionReason
    );
    event MatchCancelled(uint256 indexed matchId, string reason);

    error Unauthorized();
    error GodNotActive();
    error GodBusy();
    error MatchNotFound();
    error WrongStatus();
    error InvalidMove();
    error CommitMismatch();
    error DeadlineExpired();
    error InsufficientBalance();

    /// @notice GodMind contract — authorized to call Arena on behalf of any god.
    ///         This means only the deployer wallet needs STT. God addresses are identities.
    address public godMind;

    modifier onlyGod(address god) {
        if (msg.sender != god && msg.sender != godMind && msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _registry, address _token) {
        registry = GodRegistry(_registry);
        token = PantheonToken(_token);
        owner = msg.sender;
    }

    function setGodMind(address _godMind) external onlyOwner {
        godMind = _godMind;
    }

    function setWorldState(address _worldState) external onlyOwner {
        worldState = _worldState;
    }

    // ─── Match Lifecycle ───────────────────────────────────────────────────────

    /// @notice God proposes a challenge to another god. Deducts stake from treasury.
    function proposeChallenge(
        address challenger,
        address opponent,
        uint256 stake,
        string calldata decisionReason
    ) external onlyGod(challenger) returns (uint256 matchId) {
        GodRegistry.GodStats memory cStats = registry.getStats(challenger);
        GodRegistry.GodStats memory oStats = registry.getStats(opponent);

        if (!cStats.active) revert GodNotActive();
        if (!oStats.active) revert GodNotActive();
        if (hasActiveMatch[challenger]) revert GodBusy();
        if (token.balanceOf(challenger) < stake) revert InsufficientBalance();

        matchId = ++matchCounter;
        matches[matchId] = Match({
            id: matchId,
            challenger: challenger,
            opponent: opponent,
            stake: stake,
            gameType: GameType.RPS,
            status: MatchStatus.PENDING,
            challengerCommit: bytes32(0),
            opponentCommit: bytes32(0),
            challengerMove: 0,
            opponentMove: 0,
            challengerRevealed: false,
            opponentRevealed: false,
            winner: address(0),
            createdBlock: block.number,
            decisionReason: decisionReason
        });

        hasActiveMatch[challenger] = true;
        activeMatchOf[challenger] = matchId;
        godMatchIds[challenger].push(matchId);
        godMatchIds[opponent].push(matchId);

        emit MatchProposed(matchId, challenger, opponent, stake);
    }

    /// @notice Opponent accepts the challenge.
    function acceptChallenge(address opponent, uint256 matchId) external onlyGod(opponent) {
        Match storage m = matches[matchId];
        if (m.id == 0) revert MatchNotFound();
        if (m.status != MatchStatus.PENDING) revert WrongStatus();
        if (m.opponent != opponent) revert Unauthorized();
        if (hasActiveMatch[opponent]) revert GodBusy();
        if (token.balanceOf(opponent) < m.stake) revert InsufficientBalance();

        m.status = MatchStatus.ACCEPTED;
        hasActiveMatch[opponent] = true;
        activeMatchOf[opponent] = matchId;

        emit MatchAccepted(matchId, opponent);
    }

    /// @notice Both gods submit their move hash. commit = keccak256(abi.encode(move, secret))
    function commitMove(address god, uint256 matchId, bytes32 commit) external onlyGod(god) {
        Match storage m = matches[matchId];
        if (m.id == 0) revert MatchNotFound();
        if (m.status != MatchStatus.ACCEPTED) revert WrongStatus();
        if (god != m.challenger && god != m.opponent) revert Unauthorized();

        if (god == m.challenger) {
            m.challengerCommit = commit;
        } else {
            m.opponentCommit = commit;
        }

        // Both committed
        if (m.challengerCommit != bytes32(0) && m.opponentCommit != bytes32(0)) {
            m.status = MatchStatus.COMMITTED;
            emit MovesCommitted(matchId);
        }
    }

    /// @notice Both gods reveal their move. Resolves the match.
    function revealMove(
        address god,
        uint256 matchId,
        uint8 move,
        bytes32 secret
    ) external onlyGod(god) {
        Match storage m = matches[matchId];
        if (m.id == 0) revert MatchNotFound();
        if (m.status != MatchStatus.COMMITTED) revert WrongStatus();
        if (move > 2) revert InvalidMove();

        bytes32 expected = keccak256(abi.encode(move, secret));

        if (god == m.challenger) {
            if (m.challengerCommit != expected) revert CommitMismatch();
            m.challengerMove = move;
            m.challengerRevealed = true;
        } else if (god == m.opponent) {
            if (m.opponentCommit != expected) revert CommitMismatch();
            m.opponentMove = move;
            m.opponentRevealed = true;
        } else {
            revert Unauthorized();
        }

        // Resolve only when BOTH have actually revealed
        if (m.challengerRevealed && m.opponentRevealed) {
            _resolveMatch(matchId);
        }
    }

    // ─── Internal Resolution ───────────────────────────────────────────────────

    function _resolveMatch(uint256 matchId) internal {
        Match storage m = matches[matchId];

        address winner;
        address loser;
        uint8 wMove;
        uint8 lMove;

        uint8 outcome = _rpsOutcome(m.challengerMove, m.opponentMove);
        if (outcome == 1) {
            winner = m.challenger; loser = m.opponent;
            wMove = m.challengerMove; lMove = m.opponentMove;
        } else if (outcome == 2) {
            winner = m.opponent; loser = m.challenger;
            wMove = m.opponentMove; lMove = m.challengerMove;
        } else {
            // Tie — challenger wins (they took the initiative)
            winner = m.challenger; loser = m.opponent;
            wMove = m.challengerMove; lMove = m.opponentMove;
        }

        m.winner = winner;
        m.status = MatchStatus.RESOLVED;

        // Clear active match tracking
        hasActiveMatch[m.challenger] = false;
        hasActiveMatch[m.opponent] = false;

        // Settle stakes — burn from loser, mint to winner
        token.reward(winner, loser, m.stake);

        // Update registry stats
        registry.recordResult(winner, loser, wMove, lMove, m.stake);

        // This event triggers WorldState.onEvent() automatically via Somnia reactivity
        emit MatchResolved(matchId, winner, loser, m.stake, wMove, lMove, m.decisionReason);
    }

    /// @notice Forfeit an expired match (called by anyone after deadline)
    function forfeitExpired(uint256 matchId) external {
        Match storage m = matches[matchId];
        if (m.id == 0) revert MatchNotFound();

        if (m.status == MatchStatus.PENDING) {
            if (block.number < m.createdBlock + COMMIT_DEADLINE_BLOCKS) revert DeadlineExpired();
            m.status = MatchStatus.CANCELLED;
            hasActiveMatch[m.challenger] = false;
            emit MatchCancelled(matchId, "Opponent never accepted");
        } else if (m.status == MatchStatus.ACCEPTED || m.status == MatchStatus.COMMITTED) {
            if (block.number < m.createdBlock + COMMIT_DEADLINE_BLOCKS + REVEAL_DEADLINE_BLOCKS) revert DeadlineExpired();
            // Give the win to whoever committed (or challenger on tie)
            address winner = m.challengerCommit != bytes32(0) ? m.challenger : m.opponent;
            address loser = winner == m.challenger ? m.opponent : m.challenger;
            m.winner = winner;
            m.status = MatchStatus.RESOLVED;
            hasActiveMatch[m.challenger] = false;
            hasActiveMatch[m.opponent] = false;
            token.reward(winner, loser, m.stake);
            registry.recordResult(winner, loser, 0, 0, m.stake);
            emit MatchResolved(matchId, winner, loser, m.stake, 0, 0, "Forfeit");
        }
    }

    // ─── View ──────────────────────────────────────────────────────────────────

    function getMatch(uint256 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    function getGodMatchHistory(address god) external view returns (uint256[] memory) {
        return godMatchIds[god];
    }

    function getRecentMatches(uint256 count) external view returns (Match[] memory) {
        uint256 total = matchCounter;
        uint256 n = total < count ? total : count;
        Match[] memory recent = new Match[](n);
        for (uint256 i = 0; i < n; i++) {
            recent[i] = matches[total - i];
        }
        return recent;
    }

    // ─── Pure helpers ──────────────────────────────────────────────────────────

    /// @return 1 if p1 wins, 2 if p2 wins, 0 if tie
    function _rpsOutcome(uint8 p1, uint8 p2) internal pure returns (uint8) {
        if (p1 == p2) return 0;
        // Rock(0) beats Scissors(2), Paper(1) beats Rock(0), Scissors(2) beats Paper(1)
        if ((p1 == 0 && p2 == 2) || (p1 == 1 && p2 == 0) || (p1 == 2 && p2 == 1)) return 1;
        return 2;
    }

}
