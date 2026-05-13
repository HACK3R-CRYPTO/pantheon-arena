export const GodRegistryABI = [
  {
    name: "getPersonality",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "epithet", type: "string" },
          { name: "lore", type: "string" },
          { name: "aggression", type: "uint8" },
          { name: "riskTolerance", type: "uint8" },
          { name: "adaptability", type: "uint8" },
          { name: "favoredMove", type: "uint8" },
          { name: "color", type: "string" },
        ],
      },
    ],
  },
  {
    name: "getStats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "wins", type: "uint256" },
          { name: "losses", type: "uint256" },
          { name: "totalStaked", type: "uint256" },
          { name: "powerScore", type: "uint256" },
          { name: "lastActionBlock", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getAllGodStates",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "addresses", type: "address[]" },
      {
        name: "perks",
        type: "tuple[]",
        components: [
          { name: "name", type: "string" },
          { name: "epithet", type: "string" },
          { name: "lore", type: "string" },
          { name: "aggression", type: "uint8" },
          { name: "riskTolerance", type: "uint8" },
          { name: "adaptability", type: "uint8" },
          { name: "favoredMove", type: "uint8" },
          { name: "color", type: "string" },
        ],
      },
      {
        name: "allStats",
        type: "tuple[]",
        components: [
          { name: "wins", type: "uint256" },
          { name: "losses", type: "uint256" },
          { name: "totalStaked", type: "uint256" },
          { name: "powerScore", type: "uint256" },
          { name: "lastActionBlock", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getRelation",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "godA", type: "address" }, { name: "godB", type: "address" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "getRecentMoves",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }, { name: "n", type: "uint256" }],
    outputs: [{ name: "", type: "uint8[]" }],
  },
] as const;

export const ArenaABI = [
  {
    name: "getRecentMatches",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "challenger", type: "address" },
          { name: "opponent", type: "address" },
          { name: "stake", type: "uint256" },
          { name: "gameType", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "challengerCommit", type: "bytes32" },
          { name: "opponentCommit", type: "bytes32" },
          { name: "challengerMove", type: "uint8" },
          { name: "opponentMove", type: "uint8" },
          { name: "challengerRevealed", type: "bool" },
          { name: "opponentRevealed", type: "bool" },
          { name: "winner", type: "address" },
          { name: "createdBlock", type: "uint256" },
          { name: "decisionReason", type: "string" },
        ],
      },
    ],
  },
  {
    name: "matchCounter",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "hasActiveMatch",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getGodMatchHistory",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  // Events
  {
    name: "MatchResolved",
    type: "event",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "loser", type: "address", indexed: true },
      { name: "stake", type: "uint256", indexed: false },
      { name: "winnerMove", type: "uint8", indexed: false },
      { name: "loserMove", type: "uint8", indexed: false },
      { name: "decisionReason", type: "string", indexed: false },
    ],
  },
  {
    name: "MatchProposed",
    type: "event",
    inputs: [
      { name: "matchId", type: "uint256", indexed: true },
      { name: "challenger", type: "address", indexed: true },
      { name: "opponent", type: "address", indexed: true },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
] as const;

export const WorldStateABI = [
  {
    name: "getWorldSummary",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "currentEra", type: "uint256" },
      { name: "battles", type: "uint256" },
      { name: "feedSize", type: "uint256" },
      { name: "worldEventCount", type: "uint256" },
    ],
  },
  {
    name: "getBattleFeed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "matchId", type: "uint256" },
          { name: "winner", type: "address" },
          { name: "loser", type: "address" },
          { name: "stake", type: "uint256" },
          { name: "winnerMove", type: "uint8" },
          { name: "loserMove", type: "uint8" },
          { name: "blockNumber", type: "uint256" },
          { name: "decisionReason", type: "string" },
        ],
      },
    ],
  },
  {
    name: "getWorldEvents",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "count", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "blockNumber", type: "uint256" },
          { name: "description", type: "string" },
          { name: "affectedGod", type: "address" },
          { name: "aggressionModifier", type: "int8" },
          { name: "eventType", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getEffectiveAggression",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }],
    outputs: [{ name: "", type: "int256" }],
  },
  {
    name: "WorldUpdated",
    type: "event",
    inputs: [
      { name: "era", type: "uint256", indexed: true },
      { name: "winner", type: "address", indexed: true },
      { name: "loser", type: "address", indexed: true },
      { name: "matchId", type: "uint256", indexed: false },
    ],
  },
  {
    name: "WorldEventApplied",
    type: "event",
    inputs: [
      { name: "era", type: "uint256", indexed: true },
      { name: "description", type: "string", indexed: false },
    ],
  },
] as const;

export const GodMindABI = [
  {
    name: "getDecisionHistory",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }, { name: "count", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "blockNumber", type: "uint256" },
          { name: "god", type: "address" },
          { name: "action", type: "string" },
          { name: "target", type: "address" },
          { name: "stake", type: "uint256" },
          { name: "move", type: "uint8" },
          { name: "reasoning", type: "string" },
        ],
      },
    ],
  },
  {
    name: "totalDecisions",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "DecisionMade",
    type: "event",
    inputs: [
      { name: "god", type: "address", indexed: true },
      { name: "action", type: "string", indexed: false },
      { name: "target", type: "address", indexed: true },
      { name: "reasoning", type: "string", indexed: false },
    ],
  },
] as const;

export const PantheonTokenABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Somnia LLM Inference Agent (Qwen3-30B) — consensus-validated narratives written onchain
export const NarratorAgentABI = [
  {
    name: "getNarrative",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "god", type: "address" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "latestNarrative",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "totalGenerated",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "LLM_AGENT_ID",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "PLATFORM",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "NarrativeGenerated",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "god", type: "address", indexed: true },
      { name: "narrative", type: "string", indexed: false },
    ],
  },
  {
    name: "NarrativeRequested",
    type: "event",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "god", type: "address", indexed: true },
      { name: "prompt", type: "string", indexed: false },
    ],
  },
] as const;
