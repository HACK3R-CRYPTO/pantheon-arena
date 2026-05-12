// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GodRegistry} from "./GodRegistry.sol";
import {Arena} from "./Arena.sol";
import {WorldState} from "./WorldState.sol";
import {IAgentRequester, IAgentRequesterHandler, ILLMAgent, IJsonApiAgent} from "./interfaces/ISomniaAgents.sol";

/// @notice God decision engine.
///
///         HYBRID AI ARCHITECTURE:
///         Uses Somnia's JSON API agent (consensus-validated, works on testnet) to call
///         an external LLM API endpoint. Multiple Somnia validators independently fetch
///         the same URL and reach consensus on the AI response before it enters the chain.
///
///         This means: real AI reasoning + Somnia consensus validation.
///         Switch to native LLM Inference when Somnia validators are fully online.
///
///         Decision history is permanently logged onchain — every AI choice is auditable.
contract GodMind is IAgentRequesterHandler {

    IAgentRequester public agentPlatform;
    uint256 public llmAgentId;  // 0 = disabled (pure Markov); 13174292974160097713 = JSON API agent
    uint256 public constant LLM_TOTAL_COST = 0.03 ether;

    // LLM proxy URL — deployed serverless function that calls Groq/OpenAI
    // Somnia JSON API validators call this URL and reach consensus on the response
    string public llmProxyUrl;

    GodRegistry public registry;
    Arena public arena;
    WorldState public worldState;
    address public owner;

    struct DecisionLog {
        uint256 blockNumber;
        address god;
        string action;
        address target;
        uint256 stake;
        uint8 move;
        string reasoning;
        bool usedLLM;
    }

    struct PendingRequest {
        address god;
        address target;
        uint256 stake;
        uint256 matchId;
        uint8 markovFallback;
    }

    mapping(address => DecisionLog[]) public decisionHistory;
    mapping(uint256 => PendingRequest) public pendingRequests;
    uint256 public totalDecisions;
    uint256 public llmDecisions;

    uint256 public constant CHALLENGE_COOLDOWN_BLOCKS = 10;
    mapping(address => uint256) public lastChallengeBlock;
    mapping(address => mapping(uint256 => bytes32)) private pendingSecrets;
    mapping(address => mapping(uint256 => uint8)) private pendingMoves;

    event LLMDecisionRequested(address indexed god, uint256 requestId, string prompt);
    event LLMDecisionReceived(address indexed god, uint256 requestId, string result, bool success);
    event DecisionMade(address indexed god, string action, address indexed target, string reasoning, bool usedLLM);
    event MarkovFallback(address indexed god, string reason);

    error Unauthorized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address _registry,
        address _arena,
        address _worldState,
        address _agentPlatform,
        uint256 _llmAgentId,
        string memory _llmProxyUrl
    ) {
        registry = GodRegistry(_registry);
        arena = Arena(_arena);
        worldState = WorldState(payable(_worldState));
        agentPlatform = IAgentRequester(_agentPlatform);
        llmAgentId = _llmAgentId;
        llmProxyUrl = _llmProxyUrl;
        owner = msg.sender;
    }

    function setAgentConfig(address _platform, uint256 _agentId, string calldata _proxyUrl) external onlyOwner {
        agentPlatform = IAgentRequester(_platform);
        llmAgentId = _agentId;
        llmProxyUrl = _proxyUrl;
    }

    // ─── Entry Point ────────────────────────────────────────────────────────────

    function executeDecision(address god) external {
        if (msg.sender != owner) revert Unauthorized();
        if (!registry.getStats(god).active) return;

        if (arena.hasActiveMatch(god)) {
            _handleMatch(god, arena.activeMatchOf(god));
        } else {
            _handleIdle(god);
        }
    }

    // ─── Match Handler ─────────────────────────────────────────────────────────

    function _handleMatch(address god, uint256 matchId) internal {
        Arena.Match memory m = arena.getMatch(matchId);
        if (m.status == Arena.MatchStatus.ACCEPTED) {
            _doCommit(god, matchId, m);
        } else if (m.status == Arena.MatchStatus.COMMITTED) {
            _doReveal(god, matchId);
        }
    }

    function _doCommit(address god, uint256 matchId, Arena.Match memory m) internal {
        address opp = m.challenger == god ? m.opponent : m.challenger;
        GodRegistry.GodPersonality memory gp = registry.getPersonality(god);
        uint8 markovMove = _markovPredict(opp, gp.adaptability, gp.favoredMove);

        if (address(this).balance >= LLM_TOTAL_COST && llmAgentId != 0) {
            _requestLLMMove(god, opp, matchId, m.stake, markovMove);
        } else {
            emit MarkovFallback(god, "Insufficient balance");
            _commitMove(god, matchId, markovMove, opp, m.stake, "Markov predictor", false);
        }
    }

    /// @notice Calls the LLM proxy via Somnia JSON API agent.
    ///         URL: llmProxyUrl?god=<addr>&opp=<addr>&match=<id>&ow=<wins>&ol=<losses>
    ///         Multiple Somnia validators independently fetch this URL and reach consensus.
    ///         The proxy calls Groq/OpenAI and returns: {"move": 0|1|2}
    function _requestLLMMove(address god, address opp, uint256 matchId, uint256 stake, uint8 markovMove) internal {
        GodRegistry.GodStats memory os = registry.getStats(opp);

        string memory url = string(abi.encodePacked(
            llmProxyUrl, "?god=", _addr(god),
            "&opp=", _addr(opp),
            "&match=", _u(matchId),
            "&ow=", _u(os.wins),
            "&ol=", _u(os.losses)
        ));

        // Use JSON API agent (consensus-validated, works on testnet)
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            url,
            "move",   // JSON path: response.move
            uint8(0)  // no decimal scaling
        );

        try agentPlatform.createRequest{value: LLM_TOTAL_COST}(
            llmAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        ) returns (uint256 requestId) {
            pendingRequests[requestId] = PendingRequest(god, opp, stake, matchId, markovMove);
            emit LLMDecisionRequested(god, requestId, url);
        } catch {
            emit MarkovFallback(god, "JSON API agent unavailable");
            _commitMove(god, matchId, markovMove, opp, stake, "Markov (agent unavailable)", false);
        }
    }

    function _doReveal(address god, uint256 matchId) internal {
        bytes32 secret = pendingSecrets[god][matchId];
        if (secret == bytes32(0)) return;
        uint8 move = pendingMoves[god][matchId];
        arena.revealMove(god, matchId, move, secret);
        delete pendingSecrets[god][matchId];
        delete pendingMoves[god][matchId];
    }

    // ─── LLM Callback ─────────────────────────────────────────────────────────

    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] memory responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request memory
    ) external override {
        require(msg.sender == address(agentPlatform), "Only platform");
        PendingRequest memory req = pendingRequests[requestId];
        if (req.god == address(0)) return;
        delete pendingRequests[requestId];

        uint8 move = req.markovFallback;
        bool usedLLM = false;
        string memory reason = "LLM failed. Markov fallback.";

        if (status == IAgentRequester.ResponseStatus.Success && responses.length > 0) {
            // JSON API agent returns uint256 (the move: 0, 1, or 2)
            try this.decodeUint(responses[0].result) returns (uint256 v) {
                if (v <= 2) {
                    move = uint8(v);
                    usedLLM = true;
                    llmDecisions++;
                    reason = string(abi.encodePacked(
                        "Somnia JSON API+LLM (hybrid). Move:", _u(move), " Req#", _u(requestId)
                    ));
                }
            } catch {}
        }

        emit LLMDecisionReceived(req.god, requestId, reason, usedLLM);

        if (req.matchId > 0) {
            _commitMove(req.god, req.matchId, move, req.target, req.stake, reason, usedLLM);
        } else {
            _executeChallenge(req.god, req.target, req.stake, reason);
        }
    }

    function decodeInt(bytes memory data) external pure returns (int256) {
        return abi.decode(data, (int256));
    }

    function decodeUint(bytes memory data) external pure returns (uint256) {
        return abi.decode(data, (uint256));
    }

    // ─── Idle ─────────────────────────────────────────────────────────────────

    function _handleIdle(address god) internal {
        if (block.number < lastChallengeBlock[god] + CHALLENGE_COOLDOWN_BLOCKS) return;

        GodRegistry.GodPersonality memory p = registry.getPersonality(god);
        int256 agg = worldState.getEffectiveAggression(god);
        uint256 roll = uint256(keccak256(abi.encodePacked(block.number, god, totalDecisions))) % 100;

        if (roll >= uint256(agg)) {
            _log(god, "IDLE", address(0), 0, 0, "Cooldown", false);
            return;
        }

        address target = _pickTarget(god, p);
        if (target == address(0)) return;

        uint256 stake = (500e18 * p.riskTolerance) / 100;
        if (stake < 1e18) stake = 1e18;

        lastChallengeBlock[god] = block.number;

        if (address(this).balance >= LLM_TOTAL_COST && llmAgentId != 0) {
            _requestLLMChallenge(god, target, stake, p);
        } else {
            _executeChallenge(god, target, stake, string(abi.encodePacked(p.name, " challenges via Markov.")));
        }
    }

    /// @notice Challenge decision via Somnia JSON API → LLM proxy.
    ///         Returns move choice (0/1/2) via the same proxy endpoint.
    function _requestLLMChallenge(address god, address target, uint256 stake, GodRegistry.GodPersonality memory p) internal {
        GodRegistry.GodStats memory ts = registry.getStats(target);

        string memory url = string(abi.encodePacked(
            llmProxyUrl, "?god=", _addr(god),
            "&opp=", _addr(target),
            "&match=0",
            "&ow=", _u(ts.wins),
            "&ol=", _u(ts.losses)
        ));

        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            url,
            "move",
            uint8(0)
        );

        try agentPlatform.createRequest{value: LLM_TOTAL_COST}(
            llmAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        ) returns (uint256 requestId) {
            pendingRequests[requestId] = PendingRequest(god, target, stake, 0, p.favoredMove);
            emit LLMDecisionRequested(god, requestId, url);
        } catch {
            emit MarkovFallback(god, "JSON API agent unavailable");
            _executeChallenge(god, target, stake, string(abi.encodePacked(p.name, " challenges via Markov.")));
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _commitMove(
        address god, uint256 matchId, uint8 move,
        address opp, uint256 stake, string memory reason, bool usedLLM
    ) internal {
        bytes32 secret = keccak256(abi.encodePacked(god, matchId, block.number));
        bytes32 commit = keccak256(abi.encode(move, secret));
        pendingSecrets[god][matchId] = secret;
        pendingMoves[god][matchId] = move;
        arena.commitMove(god, matchId, commit);
        _log(god, "COMMIT", opp, stake, move, reason, usedLLM);
        emit DecisionMade(god, "COMMIT", opp, reason, usedLLM);
    }

    function _executeChallenge(address god, address target, uint256 stake, string memory reason) internal {
        arena.proposeChallenge(god, target, stake, reason);
        _log(god, "CHALLENGE", target, stake, 0, reason, false);
        emit DecisionMade(god, "CHALLENGE", target, reason, false);
    }

    function _markovPredict(address opp, uint8 adaptability, uint8 favored) internal view returns (uint8) {
        uint8[] memory history = registry.getRecentMoves(opp, 6);
        uint256 len = history.length;
        if (len < 2) return uint8(uint256(keccak256(abi.encodePacked(block.number, opp))) % 3);

        uint8 last = history[len - 1];
        uint256[3] memory c;
        for (uint256 i = 0; i < len - 1; i++) {
            if (history[i] == last && history[i + 1] < 3) c[history[i + 1]]++;
        }
        uint8 pred = 0;
        if (c[1] > c[0]) pred = 1;
        if (c[2] > c[pred]) pred = 2;
        return adaptability < 30 ? favored : (pred + 1) % 3;
    }

    function _pickTarget(address god, GodRegistry.GodPersonality memory p) internal view returns (address) {
        uint256 n = registry.getGodCount();
        address best;
        uint256 bestScore;
        for (uint256 i = 0; i < n; i++) {
            address c = registry.getGodAt(i);
            if (c == god || arena.hasActiveMatch(c)) continue;
            GodRegistry.Relation rel = registry.getRelation(god, c);
            uint256 score = 50;
            if (rel == GodRegistry.Relation.WAR) score += 40;
            else if (rel == GodRegistry.Relation.RIVAL) score += 20;
            else if (rel == GodRegistry.Relation.ALLIED) score = 5;
            if (p.aggression > 70) {
                uint256 ps = registry.getStats(c).powerScore;
                score += ps < 1000 ? (1000 - ps) / 20 : 0;
            }
            if (score > bestScore) { bestScore = score; best = c; }
        }
        return best;
    }

    function _log(address god, string memory action, address target, uint256 stake, uint8 move, string memory reason, bool usedLLM) internal {
        decisionHistory[god].push(DecisionLog(block.number, god, action, target, stake, move, reason, usedLLM));
        totalDecisions++;
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v; uint256 d;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (v != 0) { d--; b[d] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }

    /// @notice Convert address to lowercase hex string for URL encoding
    function _addr(address a) internal pure returns (string memory) {
        bytes memory hex_chars = "0123456789abcdef";
        bytes memory str = new bytes(42);
        str[0] = "0"; str[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            str[2 + i * 2]     = hex_chars[uint8(bytes20(a)[i]) >> 4];
            str[3 + i * 2]     = hex_chars[uint8(bytes20(a)[i]) & 0x0f];
        }
        return string(str);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    function getDecisionHistory(address god, uint256 count) external view returns (DecisionLog[] memory) {
        DecisionLog[] storage h = decisionHistory[god];
        uint256 total = h.length;
        uint256 n = total < count ? total : count;
        DecisionLog[] memory out = new DecisionLog[](n);
        for (uint256 i = 0; i < n; i++) out[i] = h[total - 1 - i];
        return out;
    }

    function getLatestDecision(address god) external view returns (DecisionLog memory) {
        DecisionLog[] storage h = decisionHistory[god];
        require(h.length > 0, "No decisions");
        return h[h.length - 1];
    }

    function getLLMStats() external view returns (uint256 total, uint256 llm, uint256 markov) {
        return (totalDecisions, llmDecisions, totalDecisions - llmDecisions);
    }

    receive() external payable {}
}
