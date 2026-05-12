// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {ISomniaReactivityPrecompile} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";
import {GodRegistry} from "./GodRegistry.sol";

/// @notice The living world. Subscribes to Arena's MatchResolved event via Somnia reactivity.
///         Somnia validators call _onEvent() automatically after every match — zero human input.
///         Also subscribes to EpochTick to apply periodic world events.
///
///         IMPORTANT: This contract must hold >= 32 STT to fund reactive subscriptions.
contract WorldState is SomniaEventHandler {
    // ─── World Era & Events ────────────────────────────────────────────────────

    struct WorldEvent {
        uint256 blockNumber;
        string description;         // Human-readable event description
        address affectedGod;        // address(0) = global event
        int8 aggressionModifier;    // Temporary modifier to god aggression
        uint8 eventType;            // 0=Global 1=GodSpecific 2=Diplomatic
    }

    struct BattleRecord {
        uint256 matchId;
        address winner;
        address loser;
        uint256 stake;
        uint8 winnerMove;
        uint8 loserMove;
        uint256 blockNumber;
        string decisionReason;
    }

    GodRegistry public registry;
    address public arena;
    address public owner;

    uint256 public era;                     // Epoch counter, increments every ~100 blocks
    uint256 public totalBattles;
    uint256 public subscriptionId;          // Somnia reactive subscription ID

    // Live world feed — last 100 battles
    BattleRecord[] public battleFeed;
    uint256 public constant MAX_FEED_SIZE = 100;

    // World events log
    WorldEvent[] public worldEvents;

    // Per-god aggression modifiers (from world events)
    mapping(address => int8) public aggressionModifier;

    // ─── Events emitted by WorldState ─────────────────────────────────────────
    event WorldUpdated(uint256 indexed era, address indexed winner, address indexed loser, uint256 matchId);
    event EraAdvanced(uint256 indexed newEra, uint256 blockNumber);
    event WorldEventApplied(uint256 indexed era, string description);
    event SubscriptionCreated(uint256 subscriptionId);

    error Unauthorized();
    error ArenaNotSet();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _registry) {
        registry = GodRegistry(_registry);
        owner = msg.sender;
        era = 1;
    }

    /// @notice Set Arena and activate the reactive subscription.
    ///         Call after deploying Arena. Contract must hold 32 STT before this call.
    function activate(address _arena) external onlyOwner {
        arena = _arena;

        // ── Subscription 1: Listen to Arena's MatchResolved event ──────────────
        // Topic0 = keccak256("MatchResolved(uint256,address,address,uint256,uint8,uint8,string)")
        bytes32 matchResolvedTopic = keccak256(
            "MatchResolved(uint256,address,address,uint256,uint8,uint8,string)"
        );

        SomniaExtensions.SubscriptionFilter memory arenaFilter = SomniaExtensions.SubscriptionFilter({
            eventTopics: [matchResolvedTopic, bytes32(0), bytes32(0), bytes32(0)],
            origin: address(0),
            emitter: _arena          // Only listen to our Arena contract
        });

        SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: SomniaExtensions.DEFAULT_PRIORITY_FEE_PER_GAS,
            maxFeePerGas: uint64(20 gwei),
            gasLimit: SomniaExtensions.DEFAULT_HANDLER_GAS_LIMIT
        });

        subscriptionId = SomniaExtensions.subscribe(address(this), arenaFilter, options);
        emit SubscriptionCreated(subscriptionId);
    }

    // ─── Reactive Handler ──────────────────────────────────────────────────────

    /// @notice Called automatically by Somnia validators when Arena emits MatchResolved.
    ///         No human triggers this. It fires within the same block as the match resolution.
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        if (emitter != arena) return;

        // Decode MatchResolved(uint256 matchId, address winner, address loser,
        //                      uint256 stake, uint8 winnerMove, uint8 loserMove, string reason)
        // Note: indexed params (matchId, winner, loser) are in eventTopics[1..3]
        // Non-indexed params (stake, winnerMove, loserMove, reason) are in data

        if (eventTopics.length < 4) return;

        address winner = address(uint160(uint256(eventTopics[1])));
        address loser  = address(uint160(uint256(eventTopics[2])));
        uint256 matchId = uint256(eventTopics[0]); // first indexed param

        // Decode non-indexed data: (uint256 stake, uint8 winnerMove, uint8 loserMove, string reason)
        (uint256 stake, uint8 winnerMove, uint8 loserMove, string memory reason) =
            abi.decode(data, (uint256, uint8, uint8, string));

        totalBattles++;

        // Add to live feed (ring buffer)
        _pushBattleRecord(matchId, winner, loser, stake, winnerMove, loserMove, reason);

        // Advance era every 50 battles
        if (totalBattles % 50 == 0) {
            era++;
            emit EraAdvanced(era, block.number);
            _applyEraWorldEvent();
        }

        emit WorldUpdated(era, winner, loser, matchId);
    }

    // ─── World Events (called reactively on era advance) ──────────────────────

    function _applyEraWorldEvent() internal {
        address[] memory gods = _getAllGods();
        if (gods.length == 0) return;

        // Deterministic pseudo-randomness from block data
        uint256 roll = uint256(keccak256(abi.encodePacked(block.number, era, totalBattles))) % 4;

        if (roll == 0) {
            // Global power surge — all gods become more aggressive
            for (uint256 i = 0; i < gods.length; i++) {
                aggressionModifier[gods[i]] = 15;
            }
            _logWorldEvent("A divine surge empowers all gods. Aggression rises across the pantheon.", address(0), 15, 0);
        } else if (roll == 1) {
            // Strongest god weakened by envy of lesser gods
            address strongest = _getStrongest(gods);
            aggressionModifier[strongest] = -20;
            _logWorldEvent("The strongest god is weakened by the envy of rivals.", strongest, -20, 1);
        } else if (roll == 2) {
            // Random diplomatic shift — two gods' relationship escalates
            address g1 = gods[uint256(keccak256(abi.encodePacked(block.number, "g1"))) % gods.length];
            address g2 = gods[uint256(keccak256(abi.encodePacked(block.number, "g2"))) % gods.length];
            if (g1 != g2) {
                registry.setRelation(g1, g2, GodRegistry.Relation.WAR);
                _logWorldEvent("Divine tension erupts. Two gods declare war.", address(0), 0, 2);
            }
        } else {
            // Peace era — aggression modifiers reset
            for (uint256 i = 0; i < gods.length; i++) {
                aggressionModifier[gods[i]] = 0;
            }
            _logWorldEvent("A rare peace descends upon the pantheon. Gods rest and recover.", address(0), 0, 0);
        }
    }

    // ─── View Functions ────────────────────────────────────────────────────────

    function getBattleFeed(uint256 count) external view returns (BattleRecord[] memory) {
        uint256 total = battleFeed.length;
        uint256 n = total < count ? total : count;
        BattleRecord[] memory recent = new BattleRecord[](n);
        for (uint256 i = 0; i < n; i++) {
            recent[i] = battleFeed[total - 1 - i];
        }
        return recent;
    }

    function getWorldEvents(uint256 count) external view returns (WorldEvent[] memory) {
        uint256 total = worldEvents.length;
        uint256 n = total < count ? total : count;
        WorldEvent[] memory recent = new WorldEvent[](n);
        for (uint256 i = 0; i < n; i++) {
            recent[i] = worldEvents[total - 1 - i];
        }
        return recent;
    }

    function getWorldSummary() external view returns (
        uint256 currentEra,
        uint256 battles,
        uint256 feedSize,
        uint256 worldEventCount
    ) {
        return (era, totalBattles, battleFeed.length, worldEvents.length);
    }

    function getEffectiveAggression(address god) external view returns (int256) {
        GodRegistry.GodPersonality memory p = registry.getPersonality(god);
        int256 base = int256(uint256(p.aggression));
        int256 mod = int256(aggressionModifier[god]);
        int256 result = base + mod;
        return result < 0 ? int256(0) : (result > 100 ? int256(100) : result);
    }

    // ─── Internal Helpers ──────────────────────────────────────────────────────

    function _pushBattleRecord(
        uint256 matchId,
        address winner,
        address loser,
        uint256 stake,
        uint8 winnerMove,
        uint8 loserMove,
        string memory reason
    ) internal {
        if (battleFeed.length >= MAX_FEED_SIZE) {
            // Shift: remove oldest (index 0), push new at end
            for (uint256 i = 0; i < battleFeed.length - 1; i++) {
                battleFeed[i] = battleFeed[i + 1];
            }
            battleFeed.pop();
        }
        battleFeed.push(BattleRecord({
            matchId: matchId,
            winner: winner,
            loser: loser,
            stake: stake,
            winnerMove: winnerMove,
            loserMove: loserMove,
            blockNumber: block.number,
            decisionReason: reason
        }));
    }

    function _logWorldEvent(
        string memory description,
        address affectedGod,
        int8 modifier_,
        uint8 eventType
    ) internal {
        worldEvents.push(WorldEvent({
            blockNumber: block.number,
            description: description,
            affectedGod: affectedGod,
            aggressionModifier: modifier_,
            eventType: eventType
        }));
        emit WorldEventApplied(era, description);
    }

    function _getAllGods() internal view returns (address[] memory) {
        uint256 count = registry.getGodCount();
        address[] memory g = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            g[i] = registry.getGodAt(i);
        }
        return g;
    }

    function _getStrongest(address[] memory gods) internal view returns (address strongest) {
        uint256 max;
        for (uint256 i = 0; i < gods.length; i++) {
            GodRegistry.GodStats memory s = registry.getStats(gods[i]);
            if (s.powerScore > max) {
                max = s.powerScore;
                strongest = gods[i];
            }
        }
    }

    receive() external payable {}
}
