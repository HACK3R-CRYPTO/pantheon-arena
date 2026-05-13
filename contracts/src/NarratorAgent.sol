// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Calls Somnia LLM Inference Agent to generate onchain battle narratives.
///         Uses the CORRECT platform: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
///         Agent ID: 12847293847561029384 (Qwen3 LLM Inference)
///
///         Every god challenge reason is AI-generated, consensus-validated by
///         Somnia validators, and stored permanently onchain.

interface IAgentPlatform {
    enum ResponseStatus { None, Pending, Success, Failed, TimedOut }
    struct Response { address validator; bytes result; ResponseStatus status; uint256 receipt; uint256 timestamp; uint256 executionCost; }
    struct Request { uint256 id; address requester; address callbackAddress; bytes4 callbackSelector; address[] subcommittee; Response[] responses; uint256 responseCount; uint256 failureCount; uint256 threshold; uint256 createdAt; uint256 deadline; ResponseStatus status; uint8 consensusType; uint256 remainingBudget; }
    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload) external payable returns (uint256 requestId);
    function getRequestDeposit() external view returns (uint256);
}

interface ILLMAgent {
    function inferString(string calldata prompt, string calldata system, bool chainOfThought, string[] calldata allowedValues) external returns (string memory);
}

contract NarratorAgent {

    // ── Somnia LLM Inference Agent ────────────────────────────────────────────
    // Source: docs.somnia.network/agents/base-agents/llm-inference
    IAgentPlatform public constant PLATFORM =
        IAgentPlatform(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);
    uint256 public constant LLM_AGENT_ID = 12847293847561029384;

    address public owner;

    // Latest AI-generated narrative per god (updated on each LLM response)
    mapping(address => string) public latestNarrative;
    mapping(uint256 => address) public pendingGod;
    uint256 public totalGenerated;

    event NarrativeRequested(uint256 indexed requestId, address indexed god, string prompt);
    event NarrativeGenerated(uint256 indexed requestId, address indexed god, string narrative);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Request an AI-generated battle narrative for a god's challenge.
    ///         Somnia validators independently run Qwen3 and reach consensus.
    function requestNarrative(
        address god,
        string calldata godName,
        string calldata opponentName,
        string calldata godLore
    ) external onlyOwner returns (uint256 requestId) {
        string memory prompt = string(abi.encodePacked(
            godName, " is about to challenge ", opponentName, " in the PANTHEON ARENA. ",
            "Write one dramatic sentence (max 100 chars) from ", godName, "'s perspective. ",
            "Be intense, in-character, short and powerful."
        ));

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            godLore,  // god's onchain personality as system prompt
            false,
            new string[](0)
        );

        // Deposit = ops-reserve floor + per-agent budget * 3 validators.
        // Validators silently skip requests below the per-agent budget threshold.
        // (Confirmed by Somnia team: floor 0.03 STT covers ops; validators need
        //  0.07 STT/agent each, and the LLM Inference agent uses a 3-validator quorum.)
        uint256 floor    = PLATFORM.getRequestDeposit();
        uint256 perAgent = 0.07 ether;
        uint256 deposit  = floor + (perAgent * 3);
        require(address(this).balance >= deposit, "Insufficient STT");

        requestId = PLATFORM.createRequest{value: deposit}(
            LLM_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingGod[requestId] = god;
        emit NarrativeRequested(requestId, god, prompt);
    }

    /// @notice Somnia validators call this after LLM consensus is reached.
    ///         The AI-generated narrative is stored onchain permanently.
    function handleResponse(
        uint256 requestId,
        IAgentPlatform.Response[] memory responses,
        IAgentPlatform.ResponseStatus status,
        IAgentPlatform.Request memory
    ) external {
        require(msg.sender == address(PLATFORM), "Only platform");

        address god = pendingGod[requestId];
        if (god == address(0)) return;
        delete pendingGod[requestId];

        if (status == IAgentPlatform.ResponseStatus.Success && responses.length > 0) {
            string memory narrative = abi.decode(responses[0].result, (string));
            latestNarrative[god] = narrative;
            totalGenerated++;
            emit NarrativeGenerated(requestId, god, narrative);
        }
    }

    function getNarrative(address god) external view returns (string memory) {
        string memory n = latestNarrative[god];
        return bytes(n).length > 0 ? n : "The god prepares to strike.";
    }

    receive() external payable {}
}
