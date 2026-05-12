// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Stores the four gods, their personalities, stats, and diplomatic relations.
///         Personalities are stored onchain — they become the LLM prompt context for every decision.
contract GodRegistry {
    struct GodPersonality {
        string name;
        string epithet;
        string lore;            // Used as LLM persona prompt
        uint8 aggression;       // 0-100: challenge frequency
        uint8 riskTolerance;    // 0-100: stake size as % of treasury
        uint8 adaptability;     // 0-100: how much the god varies strategy
        uint8 favoredMove;      // 0=Rock 1=Paper 2=Scissors (default tendency)
        string color;           // Hex color for frontend
    }

    struct GodStats {
        uint256 wins;
        uint256 losses;
        uint256 totalStaked;
        uint256 powerScore;     // Derived ranking metric
        uint256 lastActionBlock;
        bool active;
    }

    // Diplomatic relation between two gods
    enum Relation { NEUTRAL, ALLIED, RIVAL, WAR }

    address public owner;
    address public arena;

    address[] public gods;
    mapping(address => GodPersonality) public personalities;
    mapping(address => GodStats) public stats;

    // relations[godA][godB] — always use sorted order (lower address first)
    mapping(address => mapping(address => Relation)) public relations;

    // Full move history per god for Markov prediction: godAddress => array of moves played
    mapping(address => uint8[]) private moveHistory;

    event GodRegistered(address indexed god, string name);
    event StatsUpdated(address indexed god, uint256 wins, uint256 losses, uint256 powerScore);
    event RelationChanged(address indexed godA, address indexed godB, Relation relation);

    error Unauthorized();
    error GodNotFound();
    error AlreadyRegistered();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyArena() {
        if (msg.sender != arena) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setArena(address _arena) external onlyOwner {
        arena = _arena;
    }

    /// @notice Register the four pre-configured gods. Called once during deployment.
    function registerGod(
        address godAddress,
        GodPersonality calldata personality
    ) external onlyOwner {
        if (stats[godAddress].active) revert AlreadyRegistered();
        gods.push(godAddress);
        personalities[godAddress] = personality;
        stats[godAddress] = GodStats({
            wins: 0,
            losses: 0,
            totalStaked: 0,
            powerScore: 1000, // Everyone starts at 1000 ELO-style
            lastActionBlock: block.number,
            active: true
        });
        emit GodRegistered(godAddress, personality.name);
    }

    /// @notice Called by Arena after each match to update stats
    function recordResult(
        address winner,
        address loser,
        uint8 winnerMove,
        uint8 loserMove,
        uint256 stake
    ) external onlyArena {
        GodStats storage w = stats[winner];
        GodStats storage l = stats[loser];

        w.wins++;
        w.totalStaked += stake;
        w.lastActionBlock = block.number;

        l.losses++;
        l.totalStaked += stake;
        l.lastActionBlock = block.number;

        // ELO-style power score: winner gains, loser loses
        uint256 transfer = _eloTransfer(w.powerScore, l.powerScore);
        w.powerScore += transfer;
        if (l.powerScore > transfer) {
            l.powerScore -= transfer;
        } else {
            l.powerScore = 100; // Floor
        }

        // Record move history for Markov prediction
        moveHistory[winner].push(winnerMove);
        moveHistory[loser].push(loserMove);

        emit StatsUpdated(winner, w.wins, w.losses, w.powerScore);
        emit StatsUpdated(loser, l.wins, l.losses, l.powerScore);

        // Rivals become WAR after 3 consecutive losses
        _checkRelationEscalation(winner, loser);
    }

    function setRelation(address godA, address godB, Relation rel) external onlyArena {
        (address a, address b) = _sorted(godA, godB);
        relations[a][b] = rel;
        emit RelationChanged(a, b, rel);
    }

    // ─── View functions ────────────────────────────────────────────────────────

    function getGodCount() external view returns (uint256) {
        return gods.length;
    }

    function getGodAt(uint256 index) external view returns (address) {
        return gods[index];
    }

    function getPersonality(address god) external view returns (GodPersonality memory) {
        return personalities[god];
    }

    function getStats(address god) external view returns (GodStats memory) {
        return stats[god];
    }

    function getRelation(address godA, address godB) external view returns (Relation) {
        (address a, address b) = _sorted(godA, godB);
        return relations[a][b];
    }

    /// @notice Returns last N moves for Markov prediction
    function getRecentMoves(address god, uint256 n) external view returns (uint8[] memory) {
        uint8[] storage history = moveHistory[god];
        uint256 len = history.length;
        uint256 count = len < n ? len : n;
        uint8[] memory recent = new uint8[](count);
        for (uint256 i = 0; i < count; i++) {
            recent[i] = history[len - count + i];
        }
        return recent;
    }

    /// @notice Returns all gods with their full state for the world view dashboard
    function getAllGodStates() external view returns (
        address[] memory addresses,
        GodPersonality[] memory perks,
        GodStats[] memory allStats
    ) {
        uint256 n = gods.length;
        addresses = gods;
        perks = new GodPersonality[](n);
        allStats = new GodStats[](n);
        for (uint256 i = 0; i < n; i++) {
            perks[i] = personalities[gods[i]];
            allStats[i] = stats[gods[i]];
        }
    }

    // ─── Internal ──────────────────────────────────────────────────────────────

    function _eloTransfer(uint256 winnerScore, uint256 loserScore) internal pure returns (uint256) {
        // More points transferred when an underdog wins
        if (winnerScore >= loserScore) return 15;
        uint256 diff = loserScore - winnerScore;
        uint256 bonus = diff / 50;
        return 15 + (bonus > 35 ? 35 : bonus); // Cap at 50
    }

    function _checkRelationEscalation(address winner, address loser) internal {
        (address a, address b) = _sorted(winner, loser);
        Relation current = relations[a][b];
        if (current == Relation.RIVAL) {
            relations[a][b] = Relation.WAR;
            emit RelationChanged(a, b, Relation.WAR);
        } else if (current == Relation.NEUTRAL) {
            relations[a][b] = Relation.RIVAL;
            emit RelationChanged(a, b, Relation.RIVAL);
        }
    }

    function _sorted(address a, address b) internal pure returns (address, address) {
        return a < b ? (a, b) : (b, a);
    }
}
