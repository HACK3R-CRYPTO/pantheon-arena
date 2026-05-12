// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {GodRegistry} from "./GodRegistry.sol";
import {Arena} from "./Arena.sol";

/// @notice Minimal autonomous god decision engine using onchain Markov prediction.
///         Deliberately simple — every line is battle-tested.
contract GodMindV2 {

    GodRegistry public immutable registry;
    Arena public immutable arena;
    address public immutable owner;

    uint256 public totalDecisions;
    uint256 public constant COOLDOWN = 10;

    mapping(address => uint256) public lastChallengeBlock;
    mapping(address => mapping(uint256 => bytes32)) private secrets;
    mapping(address => mapping(uint256 => uint8)) private moves;

    struct Log { uint256 block_; address god; string action; address target; uint8 move; }
    mapping(address => Log[]) public logs;

    event Challenged(address indexed god, address indexed target, uint256 stake);
    event Committed(address indexed god, uint256 indexed matchId, uint8 move);
    event Revealed(address indexed god, uint256 indexed matchId);

    constructor(address _registry, address _arena) {
        registry = GodRegistry(_registry);
        arena = Arena(_arena);
        owner = msg.sender;
    }

    function executeDecision(address god) external {
        require(msg.sender == owner, "Only owner");
        if (!registry.getStats(god).active) return;

        if (arena.hasActiveMatch(god)) {
            uint256 mid = arena.activeMatchOf(god);
            Arena.Match memory m = arena.getMatch(mid);
            if (m.status == Arena.MatchStatus.ACCEPTED) {
                _commit(god, mid, m);
            } else if (m.status == Arena.MatchStatus.COMMITTED) {
                _reveal(god, mid);
            }
        } else {
            _idle(god);
        }
    }

    function _idle(address god) internal {
        if (block.number < lastChallengeBlock[god] + COOLDOWN) return;

        // Simple aggression check using god's onchain personality
        uint8 agg = registry.getPersonality(god).aggression;
        uint256 roll = uint256(keccak256(abi.encodePacked(block.number, god, totalDecisions))) % 100;
        if (roll >= agg) {
            _log(god, "IDLE", address(0), 0);
            return;
        }

        address target = _pick(god);
        if (target == address(0)) return;

        uint8 favored = registry.getPersonality(god).favoredMove;
        uint256 stake = (500 ether * registry.getPersonality(god).riskTolerance) / 100;
        if (stake < 1 ether) stake = 1 ether;

        lastChallengeBlock[god] = block.number;

        string memory reason = string(abi.encodePacked(
            registry.getPersonality(god).name, " challenges via Markov"
        ));
        arena.proposeChallenge(god, target, stake, reason);
        _log(god, "CHALLENGE", target, favored);
        emit Challenged(god, target, stake);
    }

    function _commit(address god, uint256 mid, Arena.Match memory m) internal {
        address opp = m.challenger == god ? m.opponent : m.challenger;
        uint8 mv = _markov(opp, registry.getPersonality(god));
        bytes32 sec = keccak256(abi.encodePacked(god, mid, block.number));
        secrets[god][mid] = sec;
        moves[god][mid] = mv;
        arena.commitMove(god, mid, keccak256(abi.encode(mv, sec)));
        _log(god, "COMMIT", opp, mv);
        emit Committed(god, mid, mv);
    }

    function _reveal(address god, uint256 mid) internal {
        bytes32 sec = secrets[god][mid];
        if (sec == bytes32(0)) return;
        arena.revealMove(god, mid, moves[god][mid], sec);
        delete secrets[god][mid];
        delete moves[god][mid];
        emit Revealed(god, mid);
    }

    function _pick(address god) internal view returns (address best) {
        uint256 n = registry.getGodCount();
        uint256 bestScore;
        for (uint256 i = 0; i < n; i++) {
            address c = registry.getGodAt(i);
            if (c == god || arena.hasActiveMatch(c)) continue;
            GodRegistry.Relation rel = registry.getRelation(god, c);
            uint256 score = 50;
            if (rel == GodRegistry.Relation.WAR)   score = 90;
            else if (rel == GodRegistry.Relation.RIVAL) score = 70;
            else if (rel == GodRegistry.Relation.ALLIED) score = 5;
            if (score > bestScore) { bestScore = score; best = c; }
        }
    }

    function _markov(address opp, GodRegistry.GodPersonality memory p) internal view returns (uint8) {
        uint8[] memory h = registry.getRecentMoves(opp, 6);
        uint256 len = h.length;
        if (len < 2) return uint8(uint256(keccak256(abi.encodePacked(block.number, opp))) % 3);
        uint8 last = h[len - 1];
        uint256[3] memory c;
        for (uint256 i = 0; i < len - 1; i++) {
            if (h[i] == last && h[i+1] < 3) c[h[i+1]]++;
        }
        uint8 pred = 0;
        if (c[1] > c[0]) pred = 1;
        if (c[2] > c[pred]) pred = 2;
        return p.adaptability < 30 ? p.favoredMove : (pred + 1) % 3;
    }

    function _log(address god, string memory action, address target, uint8 mv) internal {
        logs[god].push(Log(block.number, god, action, target, mv));
        totalDecisions++;
    }
}
