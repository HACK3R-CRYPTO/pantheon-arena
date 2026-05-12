// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GodRegistry} from "./GodRegistry.sol";
import {Arena} from "./Arena.sol";
import {WorldState} from "./WorldState.sol";
import {IAgentRequester, IAgentRequesterHandler, ILLMAgent} from "./interfaces/ISomniaAgents.sol";

/// @notice The decision engine for each god.
///
///         PRIMARY PATH — Somnia LLM Inference:
///           1. requestDecision() builds a prompt from the god's onchain personality + world state
///           2. Sends to Somnia platform via createRequest()
///           3. Somnia validators independently run the LLM and reach consensus
///           4. handleResponse() receives the consensus result and executes the god's move
///           5. The entire flow is onchain, verifiable, and auditable forever
///
///         FALLBACK PATH — Markov predictor:
///           If LLM Inference is unavailable or times out, the Markov chain runs
///           deterministically onchain using the opponent's move history.
///
///         Every decision is permanently logged on chain — the reasoning is public record.
contract GodMind is IAgentRequesterHandler {

    // ── Somnia Agent config ────────────────────────────────────────────────────

    /// @notice Somnia Agents platform — testnet: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
    IAgentRequester public agentPlatform;

    /// @notice LLM Inference agent ID — confirmed on Somnia testnet
    uint256 public llmAgentId;

    /// @notice Cost per LLM request: 0.07 STT/agent × 3 validators + 0.03 reserve = 0.24 STT
    uint256 public constant LLM_COST_PER_AGENT  = 0.07 ether;
    uint256 public constant DEFAULT_SUBCOMMITTEE = 3;
    uint256 public constant LLM_TOTAL_COST = LLM_COST_PER_AGENT * DEFAULT_SUBCOMMITTEE + 0.03 ether;

    // ── Core contracts ─────────────────────────────────────────────────────────

    GodRegistry public registry;
    Arena public arena;
    WorldState public worldState;
    address public owner;

    // ── Decision log ───────────────────────────────────────────────────────────

    struct DecisionLog {
        uint256 blockNumber;
        address god;
        string action;
        address target;
        uint256 stake;
        uint8 move;
        string reasoning;
        bool usedLLM;       // true = Somnia LLM Inference, false = Markov fallback
    }

    mapping(address => DecisionLog[]) public decisionHistory;
    uint256 public totalDecisions;
    uint256 public llmDecisions;    // Track how many used real LLM

    // ── Pending LLM requests ───────────────────────────────────────────────────

    struct PendingRequest {
        address god;
        address target;
        uint256 stake;
        uint256 matchId;        // 0 = challenge decision, >0 = move decision in existing match
        uint8 markovFallback;   // Pre-computed move if LLM fails
        string context;         // Snapshot of world state at request time
    }

    mapping(uint256 => PendingRequest) public pendingRequests; // requestId => pending

    // ── Cooldown ───────────────────────────────────────────────────────────────

    uint256 public constant CHALLENGE_COOLDOWN_BLOCKS = 10;
    mapping(address => uint256) public lastChallengeBlock;
    mapping(address => mapping(uint256 => bytes32)) private pendingSecrets;
    mapping(address => mapping(uint256 => uint8)) private pendingMoves;

    // ── Events ─────────────────────────────────────────────────────────────────

    event LLMDecisionRequested(address indexed god, uint256 requestId, string prompt);
    event LLMDecisionReceived(address indexed god, uint256 requestId, string result, bool success);
    event DecisionMade(address indexed god, string action, address indexed target, string reasoning, bool usedLLM);
    event MarkovFallback(address indexed god, string reason);

    error Unauthorized();
    error InsufficientBalance();
    error CooldownActive();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address _registry,
        address _arena,
        address _worldState,
        address _agentPlatform,
        uint256 _llmAgentId
    ) {
        registry = GodRegistry(_registry);
        arena = Arena(_arena);
        worldState = WorldState(payable(_worldState));
        agentPlatform = IAgentRequester(_agentPlatform);
        llmAgentId = _llmAgentId;
        owner = msg.sender;
    }

    function setAgentConfig(address _platform, uint256 _agentId) external onlyOwner {
        agentPlatform = IAgentRequester(_platform);
        llmAgentId = _agentId;
    }

    // ─── Core Decision Entry Point ─────────────────────────────────────────────

    /// @notice Called by the scheduler to trigger a god's decision cycle.
    ///         Msg.sender must be the god's own address or the owner.
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
            _handleIdle(god);
        }
    }

    // ─── Active Match Handler ──────────────────────────────────────────────────

    function _handleActiveMatch(address god, uint256 matchId, Arena.Match memory m) internal {
        if (m.status == Arena.MatchStatus.ACCEPTED) {
            _requestMoveDecision(god, matchId, m);
        } else if (m.status == Arena.MatchStatus.COMMITTED) {
            _revealDecision(god, matchId);
        }
    }

    /// @notice Request a move decision via Somnia LLM Inference.
    ///         Falls back to Markov if LLM balance insufficient.
    function _requestMoveDecision(address god, uint256 matchId, Arena.Match memory m) internal {
        GodRegistry.GodPersonality memory p = registry.getPersonality(god);
        address opponent = m.challenger == god ? m.opponent : m.challenger;
        GodRegistry.GodPersonality memory op = registry.getPersonality(opponent);
        GodRegistry.GodStats memory opStats = registry.getStats(opponent);

        uint8 markovMove = _markovPredict(opponent, p);

        // Try LLM Inference if funded
        if (address(this).balance >= LLM_TOTAL_COST && llmAgentId != 0) {
            string memory prompt = _buildMovePrompt(p, op, opStats, matchId, m.stake);
            string[] memory allowedValues = new string[](3);
            allowedValues[0] = "0"; allowedValues[1] = "1"; allowedValues[2] = "2";

            bytes memory payload = abi.encodeWithSelector(
                ILLMAgent.inferNumber.selector,
                prompt,
                p.lore,
                int256(0),
                int256(2),
                false
            );

            uint256 requestId = agentPlatform.createRequest{value: LLM_TOTAL_COST}(
                llmAgentId,
                address(this),
                this.handleResponse.selector,
                payload
            );

            pendingRequests[requestId] = PendingRequest({
                god: god,
                target: opponent,
                stake: m.stake,
                matchId: matchId,
                markovFallback: markovMove,
                context: prompt
            });

            emit LLMDecisionRequested(god, requestId, prompt);
        } else {
            // Markov fallback
            emit MarkovFallback(god, address(this).balance < LLM_TOTAL_COST ? "Insufficient balance" : "Agent not configured");
            _commitWithMove(god, matchId, markovMove, opponent, m.stake,
                string(abi.encodePacked(p.name, " uses Markov predictor. Predicted opponent move: ", _uint2str(markovMove), ".")),
                false
            );
        }
    }

    // ─── Somnia LLM Callback ───────────────────────────────────────────────────

    /// @notice Called by Somnia validators after consensus on LLM output.
    ///         This IS the onchain AI decision — consensus-validated across multiple validators.
    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] memory responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request memory /* details */
    ) external override {
        require(msg.sender == address(agentPlatform), "Only Somnia platform");

        PendingRequest memory req = pendingRequests[requestId];
        if (req.god == address(0)) return;
        delete pendingRequests[requestId];

        bool success = status == IAgentRequester.ResponseStatus.Success && responses.length > 0;
        uint8 move = req.markovFallback;
        string memory reasoning = "LLM timed out. Markov fallback used.";

        if (success) {
            // Decode the LLM's move decision (0=Rock, 1=Paper, 2=Scissors)
            try this.decodeNumberResponse(responses[0].result) returns (int256 llmMove) {
                if (llmMove >= 0 && llmMove <= 2) {
                    move = uint8(uint256(llmMove));
                    reasoning = string(abi.encodePacked(
                        "Somnia LLM Inference (consensus-validated). Move: ", _uint2str(move), ". ",
                        "Request ID: ", _uint2str(requestId), "."
                    ));
                    llmDecisions++;
                }
            } catch {
                reasoning = "LLM response decode failed. Markov fallback used.";
            }
        }

        emit LLMDecisionReceived(req.god, requestId, reasoning, success);

        if (req.matchId > 0) {
            _commitWithMove(req.god, req.matchId, move, req.target, req.stake, reasoning, success);
        } else {
            // Challenge decision — execute with the move as preferred
            _executeChallenge(req.god, req.target, req.stake, reasoning);
        }
    }

    function decodeNumberResponse(bytes memory result) external pure returns (int256) {
        return abi.decode(result, (int256));
    }

    // ─── Idle Handler ──────────────────────────────────────────────────────────

    function _handleIdle(address god) internal {
        if (block.number < lastChallengeBlock[god] + CHALLENGE_COOLDOWN_BLOCKS) return;

        GodRegistry.GodPersonality memory p = registry.getPersonality(god);
        int256 effectiveAggression = worldState.getEffectiveAggression(god);
        uint256 roll = uint256(keccak256(abi.encodePacked(block.number, god, totalDecisions))) % 100;

        if (roll >= uint256(effectiveAggression)) {
            _logDecision(god, "IDLE", address(0), 0, 0,
                string(abi.encodePacked("Roll ", _uint2str(roll), " vs aggression ", _int2str(effectiveAggression), ". Resting.")),
                false
            );
            return;
        }

        address target = _pickTarget(god, p);
        if (target == address(0)) return;

        uint256 stake = _computeStake(god, p);
        lastChallengeBlock[god] = block.number;

        // For challenge decisions, request LLM to choose target and reasoning
        if (address(this).balance >= LLM_TOTAL_COST && llmAgentId != 0) {
            _requestChallengeDecision(god, target, stake, p);
        } else {
            string memory reason = string(abi.encodePacked(
                p.name, " challenges ", registry.getPersonality(target).name,
                " (Markov). Aggression=", _int2str(effectiveAggression), " stake=", _uint2str(stake / 1e18), " PHN."
            ));
            _executeChallenge(god, target, stake, reason);
        }
    }

    function _requestChallengeDecision(
        address god,
        address target,
        uint256 stake,
        GodRegistry.GodPersonality memory p
    ) internal {
        GodRegistry.GodPersonality memory tp = registry.getPersonality(target);
        GodRegistry.GodStats memory ts = registry.getStats(target);
        GodRegistry.GodStats memory gs = registry.getStats(god);

        string memory prompt = string(abi.encodePacked(
            "You are ", p.name, " (", p.epithet, "). ",
            "Power score: ", _uint2str(gs.powerScore), ". Wins: ", _uint2str(gs.wins), ". ",
            "You are about to challenge ", tp.name, " (power: ", _uint2str(ts.powerScore), ", wins: ", _uint2str(ts.wins), "). ",
            "Stake: ", _uint2str(stake / 1e18), " PHN. ",
            "Provide a one-sentence strategic reason for this challenge in character. Max 100 characters."
        ));

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            p.lore,
            false,
            new string[](0)
        );

        uint256 requestId = agentPlatform.createRequest{value: LLM_TOTAL_COST}(
            llmAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = PendingRequest({
            god: god,
            target: target,
            stake: stake,
            matchId: 0,
            markovFallback: p.favoredMove,
            context: prompt
        });

        emit LLMDecisionRequested(god, requestId, prompt);
    }

    // ─── Commit/Reveal ─────────────────────────────────────────────────────────

    function _commitWithMove(
        address god,
        uint256 matchId,
        uint8 move,
        address opponent,
        uint256 stake,
        string memory reasoning,
        bool usedLLM
    ) internal {
        bytes32 secret = keccak256(abi.encodePacked(god, matchId, block.number, "pantheon-v2"));
        bytes32 commit = keccak256(abi.encode(move, secret));

        pendingSecrets[god][matchId] = secret;
        pendingMoves[god][matchId] = move;

        arena.commitMove(god, matchId, commit);
        _logDecision(god, "COMMIT", opponent, stake, move, reasoning, usedLLM);

        emit DecisionMade(god, "COMMIT", opponent, reasoning, usedLLM);
    }

    function _revealDecision(address god, uint256 matchId) internal {
        uint8 move = pendingMoves[god][matchId];
        bytes32 secret = pendingSecrets[god][matchId];
        if (secret == bytes32(0)) return;

        arena.revealMove(god, matchId, move, secret);
        delete pendingSecrets[god][matchId];
        delete pendingMoves[god][matchId];
    }

    function _executeChallenge(address god, address target, uint256 stake, string memory reasoning) internal {
        arena.proposeChallenge(god, target, stake, reasoning);
        _logDecision(god, "CHALLENGE", target, stake, 0, reasoning, false);
        emit DecisionMade(god, "CHALLENGE", target, reasoning, false);
    }

    // ─── Markov Predictor (onchain) ────────────────────────────────────────────

    function _markovPredict(address opponent, GodRegistry.GodPersonality memory p) internal view returns (uint8) {
        uint8[] memory history = registry.getRecentMoves(opponent, 10);
        uint256 len = history.length;

        if (len < 2) {
            return uint8(uint256(keccak256(abi.encodePacked(block.number, opponent, p.adaptability))) % 3);
        }

        uint8 lastMove = history[len - 1];
        uint256[3] memory counts;
        for (uint256 i = 0; i < len - 1; i++) {
            if (history[i] == lastMove && history[i + 1] < 3) {
                counts[history[i + 1]]++;
            }
        }

        uint8 predicted = 0;
        if (counts[1] > counts[0]) predicted = 1;
        if (counts[2] > counts[predicted]) predicted = 2;

        if (p.adaptability > 70) {
            uint256 rng = uint256(keccak256(abi.encodePacked(block.number, opponent))) % 100;
            if (rng < uint256(p.adaptability) - 70) {
                return uint8(rng % 3);
            }
        }

        return p.adaptability < 30 ? p.favoredMove : (predicted + 1) % 3;
    }

    // ─── Target / Stake Selection ──────────────────────────────────────────────

    function _pickTarget(address god, GodRegistry.GodPersonality memory p) internal view returns (address) {
        uint256 count = registry.getGodCount();
        address best;
        uint256 bestScore;

        for (uint256 i = 0; i < count; i++) {
            address candidate = registry.getGodAt(i);
            if (candidate == god) continue;
            if (arena.hasActiveMatch(candidate)) continue;

            GodRegistry.Relation rel = registry.getRelation(god, candidate);
            GodRegistry.GodStats memory cs = registry.getStats(candidate);
            GodRegistry.GodStats memory gs = registry.getStats(god);

            uint256 score = 50;
            if (rel == GodRegistry.Relation.WAR)    score += 40;
            else if (rel == GodRegistry.Relation.RIVAL) score += 20;
            else if (rel == GodRegistry.Relation.ALLIED) score = 5;

            if (p.aggression > 70) {
                score += cs.powerScore < 1000 ? (1000 - cs.powerScore) / 20 : 0;
            } else {
                uint256 diff = gs.powerScore > cs.powerScore
                    ? gs.powerScore - cs.powerScore
                    : cs.powerScore - gs.powerScore;
                score += diff < 100 ? (100 - diff) / 5 : 0;
            }

            if (score > bestScore) { bestScore = score; best = candidate; }
        }
        return best;
    }

    function _computeStake(address god, GodRegistry.GodPersonality memory p) internal view returns (uint256) {
        // In production: read PHN balance. For now: fixed amount per risk tolerance.
        uint256 base = 100e18; // 100 PHN base
        uint256 stake = (base * p.riskTolerance) / 100;
        return stake < 1e18 ? 1e18 : stake;
    }

    // ─── Prompt Building ───────────────────────────────────────────────────────

    function _buildMovePrompt(
        GodRegistry.GodPersonality memory p,
        GodRegistry.GodPersonality memory op,
        GodRegistry.GodStats memory opStats,
        uint256 matchId,
        uint256 stake
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            "You are ", p.name, " (", p.epithet, "). ",
            "You are in match #", _uint2str(matchId), " against ", op.name, " (", op.epithet, "). ",
            "Opponent: ", _uint2str(opStats.wins), " wins, ", _uint2str(opStats.losses), " losses. ",
            "Stake: ", _uint2str(stake / 1e18), " PHN. ",
            "Choose your move: 0=Rock, 1=Paper, 2=Scissors. ",
            "Return ONLY the number: 0, 1, or 2."
        ));
    }

    // ─── Logging ───────────────────────────────────────────────────────────────

    function _logDecision(
        address god,
        string memory action,
        address target,
        uint256 stake,
        uint8 move,
        string memory reasoning,
        bool usedLLM
    ) internal {
        decisionHistory[god].push(DecisionLog({
            blockNumber: block.number,
            god: god,
            action: action,
            target: target,
            stake: stake,
            move: move,
            reasoning: reasoning,
            usedLLM: usedLLM
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

    function getLLMStats() external view returns (uint256 total, uint256 llm, uint256 markov) {
        return (totalDecisions, llmDecisions, totalDecisions - llmDecisions);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 temp = v; uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    function _int2str(int256 v) internal pure returns (string memory) {
        if (v < 0) return string(abi.encodePacked("-", _uint2str(uint256(-v))));
        return _uint2str(uint256(v));
    }

    receive() external payable {}
}
