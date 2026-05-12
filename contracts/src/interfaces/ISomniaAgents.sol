// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Somnia Agents platform — the single entry point for all agent requests.
///         Testnet: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
///         Mainnet: 0x5E5205CF39E766118C01636bED000A54D93163E6
interface IAgentRequester {
    enum ResponseStatus { None, Pending, Success, Failed, TimedOut }
    enum ConsensusType { Median, Mode, First }

    struct Response {
        address validator;
        bytes result;
        ResponseStatus status;
        uint256 receipt;
        uint256 timestamp;
        uint256 executionCost;
    }

    struct Request {
        uint256 id;
        address requester;
        address callbackAddress;
        bytes4 callbackSelector;
        address[] subcommittee;
        Response[] responses;
        uint256 responseCount;
        uint256 failureCount;
        uint256 threshold;
        uint256 createdAt;
        uint256 deadline;
        ResponseStatus status;
        ConsensusType consensusType;
        uint256 remainingBudget;
        uint256 perAgentBudget;
    }

    /// @notice Simple request — uses default consensus (3 validators, median)
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    /// @notice Advanced request — custom subcommittee size, threshold, consensus type
    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    /// @notice Operations reserve required per request (in addition to agent reward)
    function getRequestDeposit() external view returns (uint256);

    /// @notice Total deposit for an advanced request with given subcommittee size
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);

    function getRequest(uint256 requestId) external view returns (Request memory);
}

/// @notice Your contract must implement this to receive agent responses
interface IAgentRequesterHandler {
    function handleResponse(
        uint256 requestId,
        IAgentRequester.Response[] memory responses,
        IAgentRequester.ResponseStatus status,
        IAgentRequester.Request memory details
    ) external;
}

// ── LLM Inference Agent payload interface ─────────────────────────────────────

/// @notice Encode payloads for the LLM Inference agent using these selectors.
///         These are encoded via abi.encodeWithSelector and sent as `payload` to createRequest.
interface ILLMAgent {
    /// @notice Single-turn inference returning a string (optionally constrained to allowedValues)
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);

    /// @notice Inference returning a number within [minValue, maxValue]
    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256 response);

    /// @notice Multi-turn conversation
    function inferChat(
        string[] calldata roles,
        string[] calldata messages,
        bool chainOfThought
    ) external returns (string memory response);
}

// ── JSON API Agent payload interface ──────────────────────────────────────────

/// @notice Encode payloads for the JSON API agent using these selectors.
interface IJsonApiAgent {
    function fetchString(string calldata url, string calldata selector)
        external returns (string memory);

    function fetchUint(string calldata url, string calldata selector, uint8 decimals)
        external returns (uint256);

    function fetchInt(string calldata url, string calldata selector, uint8 decimals)
        external returns (int256);

    function fetchBool(string calldata url, string calldata selector)
        external returns (bool);
}
