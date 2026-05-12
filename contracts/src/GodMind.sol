// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GodRegistry} from "./GodRegistry.sol";
import {Arena} from "./Arena.sol";
import {WorldState} from "./WorldState.sol";

/// @notice The decision engine for each god.
///         Reads world context onchain, runs Markov-based strategy,
///         and executes god actions (challenge, commit move, reveal move).
///
///         Architecture: The TypeScript scheduler calls executeDecision() for each god
///         on a regular interval. When Somnia LLM Inference is available, the LLM
///         replaces _markovDecision() with a consensus-validated AI call.
///
///         Decision log stored onchain — every god's reasoning is auditable forever.
contract GodMind {
    struct DecisionLog {
        uint256 blockNumber;
        address god;
        string action;          // "CHALLENGE", "COMMIT", "REVEAL", "IDLE"
        address target;
        uint256 stake;
        uint8 move;
        string reasoning;       // Markov stats or LLM output
    }

    GodRegistry public registry;
    Arena public arena;
    WorldState public worldState;
    address public owner;

    // Full decision history per god
    mapping(address => DecisionLog[]) public decisionHistory;
    uint256 public totalDecisions;

    // Move tracking for commit-reveal: god => matchId => (move, secret)
    mapping(address => mapping(uint256 => bytes32)) private pendingSecrets;
    mapping(address => mapping(uint256 => uint8)) private pendingMoves;

    // Cooldown: minimum blocks between challenge proposals
    uint256 public constant CHALLENGE_COOLDOWN_BLOCKS = 10;
    mapping(address => uint256) public lastChallengeBlock;

    event DecisionMade(address indexed god, string action, address indexed target, string reasoning);
    event MoveCommitted(address indexed god, uint256 indexed matchId);
    event MoveRevealed(address indexed god, uint256 indexed matchId, uint8 move);

    error Unauthorized();
    error CooldownActive();
    error NoActiveMatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _registry, address _arena, address _worldState) {
        registry = GodRegistry(_registry);
        arena = Arena(_arena);
        worldState = WorldState(payable(_worldState));
        owner = msg.sender;
    }

    // ─── Core Decision Entry Point ─────────────────────────────────────────────

    /// @notice Called by the scheduler to trigger a god's decision cycle.
    ///         The god's wallet must sign this transaction (msg.sender = god address).
    function executeDecision(address god) external {
        if (msg.sender != god && msg.sender != owner) revert Unauthorized();

        GodRegistry.GodStats memory stats = registry.getStats(god);
        if (!stats.active) return;

        bool hasMatch = arena.hasActiveMatch(god);

        if (hasMatch) {
            uint256 matchId = arena.activeMatchOf(god);
            Arena.Match memory m = arena.getMatch(matchId);
            _handleActiveMatch(god, matchId, m);
        } else {
            _handleIdle(god, stats);
        }
    }

    // ─── Active Match Handler ──────────────────────────────────────────────────

    function _handleActiveMatch(address god, uint256 matchId, Arena.Match memory m) internal {
        if (m.status == Arena.MatchStatus.ACCEPTED) {
            // Need to commit a move
            _commitDecision(god, matchId, m);
        } else if (m.status == Arena.MatchStatus.COMMITTED) {
            // Check if we need to reveal
            _revealDecision(god, matchId);
        }
    }

    function _commitDecision(address god, uint256 matchId, Arena.Match memory m) internal {
        GodRegistry.GodPersonality memory p = registry.getPersonality(god);
        address opponent = m.challenger == god ? m.opponent : m.challenger;

        // Markov prediction: what will the opponent play?
        uint8 predictedOpponentMove = _markovPredict(opponent, p.adaptability);
        // Counter their predicted move
        uint8 myMove = _counterMove(predictedOpponentMove, p);

        string memory reasoning = string(abi.encodePacked(
            p.name, " predicts ", registry.getPersonality(opponent).name,
            " will play move ", _uint2str(predictedOpponentMove),
            ". Countering with move ", _uint2str(myMove),
            ". Adaptability=", _uint2str(p.adaptability), "."
        ));

        // Generate a deterministic secret (in production this would be private)
        bytes32 secret = keccak256(abi.encodePacked(god, matchId, block.number, "pantheon"));
        bytes32 commit = keccak256(abi.encode(myMove, secret));

        // Store for reveal phase
        pendingSecrets[god][matchId] = secret;
        pendingMoves[god][matchId] = myMove;

        arena.commitMove(god, matchId, commit);

        _logDecision(god, "COMMIT", opponent, m.stake, myMove, reasoning);
        emit MoveCommitted(god, matchId);
    }

    function _revealDecision(address god, uint256 matchId) internal {
        uint8 move = pendingMoves[god][matchId];
        bytes32 secret = pendingSecrets[god][matchId];

        if (secret == bytes32(0)) return; // Already revealed or not committed by us

        arena.revealMove(god, matchId, move, secret);

        // Clean up
        delete pendingSecrets[god][matchId];
        delete pendingMoves[god][matchId];

        emit MoveRevealed(god, matchId, move);
    }

    // ─── Idle Handler (propose challenge) ─────────────────────────────────────

    function _handleIdle(address god, GodRegistry.GodStats memory stats) internal {
        // Check cooldown
        if (block.number < lastChallengeBlock[god] + CHALLENGE_COOLDOWN_BLOCKS) return;

        GodRegistry.GodPersonality memory p = registry.getPersonality(god);

        // Should this god challenge? Based on aggression + world modifier
        int256 effectiveAggression = worldState.getEffectiveAggression(god);
        uint256 roll = uint256(keccak256(abi.encodePacked(block.number, god, totalDecisions))) % 100;

        if (roll >= uint256(effectiveAggression)) {
            // God decides to rest this cycle
            _logDecision(god, "IDLE", address(0), 0, 0,
                string(abi.encodePacked("Aggression roll ", _uint2str(roll), " vs threshold ", _int2str(effectiveAggression), ". Resting.")));
            return;
        }

        // Pick a target — prefer rivals and enemies, avoid allies
        address target = _pickTarget(god, p);
        if (target == address(0)) return;

        // Stake size based on risk tolerance
        uint256 balance = _getApproxBalance(god);
        uint256 stake = (balance * p.riskTolerance) / 100;
        if (stake < 1e18) stake = 1e18; // Minimum 1 PHN

        GodRegistry.Relation rel = registry.getRelation(god, target);
        string memory reasoning = string(abi.encodePacked(
            p.name, " targets ", registry.getPersonality(target).name,
            " (relation: ", _relStr(rel), "). ",
            "Aggression roll ", _uint2str(roll), "/", _int2str(effectiveAggression), ". ",
            "Stake: ", _uint2str(stake / 1e18), " PHN."
        ));

        lastChallengeBlock[god] = block.number;
        arena.proposeChallenge(god, target, stake, reasoning);

        _logDecision(god, "CHALLENGE", target, stake, 0, reasoning);
        emit DecisionMade(god, "CHALLENGE", target, reasoning);
    }

    // ─── Markov Strategy ──────────────────────────────────────────────────────

    /// @notice Predicts what move the opponent will likely play based on their move history.
    ///         This is the Markov Chain predictor — the same logic as GameArena's Markov-1
    ///         but fully onchain and deterministic.
    function _markovPredict(address opponent, uint8 adaptability) internal view returns (uint8) {
        uint8[] memory history = registry.getRecentMoves(opponent, 10);
        uint256 len = history.length;

        if (len < 2) {
            // No history — return random based on block data
            return uint8(uint256(keccak256(abi.encodePacked(block.number, opponent))) % 3);
        }

        // Count transitions from the last move
        uint8 lastMove = history[len - 1];
        uint256[3] memory counts;
        for (uint256 i = 0; i < len - 1; i++) {
            if (history[i] == lastMove) {
                counts[history[i + 1]]++;
            }
        }

        // Find the most likely next move
        uint8 predicted = 0;
        if (counts[1] > counts[predicted]) predicted = 1;
        if (counts[2] > counts[predicted]) predicted = 2;

        // If high adaptability, mix in randomness
        if (adaptability > 70) {
            uint256 randomFactor = uint256(keccak256(abi.encodePacked(block.number, opponent, adaptability))) % 100;
            if (randomFactor < adaptability - 70) {
                return uint8(uint256(keccak256(abi.encodePacked(block.number, opponent))) % 3);
            }
        }

        return predicted;
    }

    /// @notice Returns the winning move against the predicted opponent move,
    ///         modified by the god's personality.
    function _counterMove(uint8 predicted, GodRegistry.GodPersonality memory p) internal pure returns (uint8) {
        // Counter: Rock(0) loses to Paper(1), Paper(1) loses to Scissors(2), Scissors(2) loses to Rock(0)
        uint8 counter = (predicted + 1) % 3;

        // God's favored move pulls the decision slightly
        if (p.adaptability < 30) {
            // Low adaptability: always play favored move
            return p.favoredMove;
        } else if (p.adaptability < 60) {
            // Medium: mix counter and favored
            return counter; // Mostly strategic
        }

        return counter; // High adaptability: pure counter-strategy
    }

    // ─── Target Selection ──────────────────────────────────────────────────────

    function _pickTarget(address god, GodRegistry.GodPersonality memory p) internal view returns (address) {
        uint256 count = registry.getGodCount();
        address bestTarget;
        uint256 bestScore;

        for (uint256 i = 0; i < count; i++) {
            address candidate = registry.getGodAt(i);
            if (candidate == god) continue;
            if (arena.hasActiveMatch(candidate)) continue; // Already in a match

            GodRegistry.Relation rel = registry.getRelation(god, candidate);
            GodRegistry.GodStats memory cStats = registry.getStats(candidate);

            uint256 score = 50; // Base score

            // Prefer enemies and rivals
            if (rel == GodRegistry.Relation.WAR) score += 40;
            else if (rel == GodRegistry.Relation.RIVAL) score += 20;
            else if (rel == GodRegistry.Relation.ALLIED) score = 5; // Rarely attack allies

            // Prefer weaker opponents (ARES: bullies; ATHENA: strategic targets)
            if (p.aggression > 70) {
                // Aggressive: prefer weakest target
                score += (1000 > cStats.powerScore ? (1000 - cStats.powerScore) / 20 : 0);
            } else {
                // Strategic: prefer closest in power
                uint256 ownPower = registry.getStats(god).powerScore;
                uint256 diff = ownPower > cStats.powerScore
                    ? ownPower - cStats.powerScore
                    : cStats.powerScore - ownPower;
                score += (100 > diff ? 100 - diff : 0) / 5;
            }

            if (score > bestScore) {
                bestScore = score;
                bestTarget = candidate;
            }
        }

        return bestTarget;
    }

    // ─── Logging ──────────────────────────────────────────────────────────────

    function _logDecision(
        address god,
        string memory action,
        address target,
        uint256 stake,
        uint8 move,
        string memory reasoning
    ) internal {
        decisionHistory[god].push(DecisionLog({
            blockNumber: block.number,
            god: god,
            action: action,
            target: target,
            stake: stake,
            move: move,
            reasoning: reasoning
        }));
        totalDecisions++;
    }

    // ─── View ──────────────────────────────────────────────────────────────────

    function getDecisionHistory(address god, uint256 count) external view returns (DecisionLog[] memory) {
        DecisionLog[] storage history = decisionHistory[god];
        uint256 total = history.length;
        uint256 n = total < count ? total : count;
        DecisionLog[] memory recent = new DecisionLog[](n);
        for (uint256 i = 0; i < n; i++) {
            recent[i] = history[total - 1 - i];
        }
        return recent;
    }

    function getLatestDecision(address god) external view returns (DecisionLog memory) {
        DecisionLog[] storage history = decisionHistory[god];
        require(history.length > 0, "No decisions yet");
        return history[history.length - 1];
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function _getApproxBalance(address god) internal view returns (uint256) {
        // Read PHN balance — used for stake calculation
        // Token address retrieved through Arena
        return 1000e18; // Fallback; replace with token.balanceOf(god) in production
    }

    function _relStr(GodRegistry.Relation rel) internal pure returns (string memory) {
        if (rel == GodRegistry.Relation.NEUTRAL) return "Neutral";
        if (rel == GodRegistry.Relation.ALLIED) return "Allied";
        if (rel == GodRegistry.Relation.RIVAL) return "Rival";
        return "WAR";
    }

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 temp = v;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    function _int2str(int256 v) internal pure returns (string memory) {
        if (v < 0) return string(abi.encodePacked("-", _uint2str(uint256(-v))));
        return _uint2str(uint256(v));
    }
}
