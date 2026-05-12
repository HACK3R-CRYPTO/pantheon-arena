// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {GodRegistry} from "./GodRegistry.sol";
import {IAgentRequester, IAgentRequesterHandler, IJsonApiAgent} from "./interfaces/ISomniaAgents.sol";

/// @notice The living world. Two Somnia-native primitives in one contract:
///
///         1. REACTIVE CONTRACTS — Subscribes to Arena's MatchResolved event.
///            Somnia validators call _onEvent() automatically after every match.
///            No keeper. No cron. No human. The world updates itself.
///
///         2. JSON API AGENT — Every 50 battles, fetches ETH price from CoinGecko
///            via Somnia's consensus-validated JSON API agent. Multiple validators
///            independently fetch and agree on the result before it enters the chain.
///            This real-world signal modifies god aggression — the world reacts to reality.
///
///         IMPORTANT: Must hold >= 32 STT for reactive subscriptions + STT for JSON API calls.
///         JSON API cost: 0.1 STT/agent × 3 validators = 0.3 STT + 0.03 reserve = 0.33 STT per call.
contract WorldState is SomniaEventHandler, IAgentRequesterHandler {
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

    // ── Somnia JSON API Agent ──────────────────────────────────────────────────
    IAgentRequester public agentPlatform;
    uint256 public jsonApiAgentId;
    uint256 public constant JSON_API_COST = 0.03 ether; // platform getRequestDeposit() on Somnia testnet
    uint256 public pendingPriceRequestId;   // Track the live JSON API request
    uint256 public lastFetchedEthPrice;     // Last ETH price from Somnia JSON API (8 decimals)
    uint256 public lastPriceFetchBattle;    // Battle number when we last fetched

    uint256 public era;
    uint256 public totalBattles;
    uint256 public subscriptionId;

    BattleRecord[] public battleFeed;
    uint256 public constant MAX_FEED_SIZE = 100;
    WorldEvent[] public worldEvents;
    mapping(address => int8) public aggressionModifier;

    // ─── Events ───────────────────────────────────────────────────────────────
    event WorldUpdated(uint256 indexed era, address indexed winner, address indexed loser, uint256 matchId);
    event EraAdvanced(uint256 indexed newEra, uint256 blockNumber);
    event WorldEventApplied(uint256 indexed era, string description);
    event SubscriptionCreated(uint256 subscriptionId);
    event ETHPriceFetched(uint256 requestId, uint256 price, string worldImpact);
    event JSONAPIRequested(uint256 requestId, string url);

    error Unauthorized();
    error ArenaNotSet();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _registry, address _agentPlatform, uint256 _jsonApiAgentId) {
        registry = GodRegistry(_registry);
        agentPlatform = IAgentRequester(_agentPlatform);
        jsonApiAgentId = _jsonApiAgentId;
        owner = msg.sender;
        era = 1;
    }

    function setAgentConfig(address _platform, uint256 _agentId) external onlyOwner {
        agentPlatform = IAgentRequester(_platform);
        jsonApiAgentId = _agentId;
    }

    /// @notice Set Arena and activate the reactive subscription.
    ///         Contract must hold >= 32 STT before this call.
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

        // Somnia reactive callback: eventTopics[0] = event signature (topic0)
        // eventTopics[1] = matchId (first indexed), eventTopics[2] = winner, eventTopics[3] = loser
        uint256 matchId = uint256(eventTopics[1]);
        address winner  = address(uint160(uint256(eventTopics[2])));
        address loser   = address(uint160(uint256(eventTopics[3])));

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

        // Every era: fetch real-world ETH price via Somnia JSON API agent
        // Consensus-validated: multiple validators independently fetch and agree before it enters the chain
        _requestETHPrice();
    }

    // ─── Somnia JSON API Agent ────────────────────────────────────────────────

    /// @notice Fetch ETH price from CoinGecko via Somnia's consensus-validated JSON API agent.
    ///         Called automatically every 50 battles (each era advance).
    ///         The result modifies god aggression — the world reacts to reality.
    function _requestETHPrice() internal {
        if (address(agentPlatform) == address(0)) return;
        if (jsonApiAgentId == 0) return;
        if (address(this).balance < JSON_API_COST) return;
        if (pendingPriceRequestId != 0) return; // Already a pending request

        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
            "ethereum.usd",
            uint8(2) // 2 decimals: $2000.50 → 200050
        );

        uint256 requestId = agentPlatform.createRequest{value: JSON_API_COST}(
            jsonApiAgentId,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingPriceRequestId = requestId;
        lastPriceFetchBattle = totalBattles;

        emit JSONAPIRequested(requestId, "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    }

    /// @notice Somnia validators call this after consensus on the ETH price.
    ///         NOT called by any human. The price is consensus-validated across multiple validators.
    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] memory responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request memory /* details */
    ) external override {
        require(msg.sender == address(agentPlatform), "Only Somnia platform");

        if (requestId != pendingPriceRequestId) return;
        pendingPriceRequestId = 0;

        if (status != IAgentRequester.ResponseStatus.Success || responses.length == 0) return;

        uint256 price = abi.decode(responses[0].result, (uint256));
        uint256 previousPrice = lastFetchedEthPrice;
        lastFetchedEthPrice = price;

        string memory impact;
        address[] memory gods = _getAllGods();

        if (previousPrice > 0) {
            if (price < previousPrice) {
                // Price dropped — market fear → ARES gets aggressive, others defensive
                uint256 dropPct = ((previousPrice - price) * 100) / previousPrice;
                if (dropPct >= 3) {
                    for (uint256 i = 0; i < gods.length; i++) {
                        GodRegistry.GodPersonality memory p = registry.getPersonality(gods[i]);
                        // ARES (aggression > 80) gets more aggressive on market fear
                        aggressionModifier[gods[i]] = p.aggression > 80 ? int8(25) : int8(-10);
                    }
                    impact = "ETH price dropped. Market fear activates ARES. Others grow cautious.";
                    _logWorldEvent(impact, address(0), 25, 0);
                }
            } else if (price > previousPrice) {
                // Price rose — prosperity → HERMES (trade god) gets economic advantage
                uint256 risePct = ((price - previousPrice) * 100) / previousPrice;
                if (risePct >= 3) {
                    for (uint256 i = 0; i < gods.length; i++) {
                        GodRegistry.GodPersonality memory p = registry.getPersonality(gods[i]);
                        // HERMES (adaptability > 70) benefits from market prosperity
                        aggressionModifier[gods[i]] = p.adaptability > 70 ? int8(20) : int8(5);
                    }
                    impact = "ETH price surged. Market prosperity empowers HERMES and the adaptable.";
                    _logWorldEvent(impact, address(0), 20, 0);
                }
            }
        }

        if (bytes(impact).length == 0) {
            impact = "ETH price stable. The world is in equilibrium.";
        }

        emit ETHPriceFetched(requestId, price, impact);
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
