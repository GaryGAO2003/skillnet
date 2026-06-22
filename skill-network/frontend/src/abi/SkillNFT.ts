export const skillNFTAbi = [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "mintSkill",
    "inputs": [
      { "name": "name", "type": "string", "internalType": "string" },
      { "name": "description", "type": "string", "internalType": "string" },
      { "name": "skillType", "type": "uint8", "internalType": "enum SkillNFT.SkillType" },
      { "name": "tier", "type": "uint8", "internalType": "enum SkillNFT.VisibilityTier" },
      { "name": "contentHash", "type": "bytes32", "internalType": "bytes32" },
      { "name": "schemaURI", "type": "string", "internalType": "string" },
      { "name": "pricePerCall", "type": "uint256", "internalType": "uint256" },
      { "name": "previousVersion", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "upgradeTier",
    "inputs": [
      { "name": "tokenId", "type": "uint256", "internalType": "uint256" },
      { "name": "newTier", "type": "uint8", "internalType": "enum SkillNFT.VisibilityTier" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "recordCall",
    "inputs": [
      { "name": "tokenId", "type": "uint256", "internalType": "uint256" },
      { "name": "value", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeRouter",
    "inputs": [{ "name": "_feeRouter", "type": "address", "internalType": "address" }],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getSkill",
    "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct SkillNFT.SkillMetadata",
        "components": [
          { "name": "name", "type": "string" },
          { "name": "description", "type": "string" },
          { "name": "skillType", "type": "uint8" },
          { "name": "tier", "type": "uint8" },
          { "name": "contentHash", "type": "bytes32" },
          { "name": "schemaURI", "type": "string" },
          { "name": "pricePerCall", "type": "uint256" },
          { "name": "creator", "type": "address" },
          { "name": "version", "type": "uint256" },
          { "name": "previousVersion", "type": "uint256" },
          { "name": "totalCalls", "type": "uint256" },
          { "name": "totalRevenue", "type": "uint256" },
          { "name": "createdAt", "type": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSkills",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeRouter",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "owner", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "SkillMinted",
    "inputs": [
      { "name": "tokenId", "type": "uint256", "indexed": true },
      { "name": "creator", "type": "address", "indexed": true },
      { "name": "tier", "type": "uint8", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "TierUpgraded",
    "inputs": [
      { "name": "tokenId", "type": "uint256", "indexed": true },
      { "name": "from", "type": "uint8", "indexed": false },
      { "name": "to", "type": "uint8", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "SkillCalled",
    "inputs": [
      { "name": "tokenId", "type": "uint256", "indexed": true },
      { "name": "totalCalls", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true },
      { "name": "to", "type": "address", "indexed": true },
      { "name": "tokenId", "type": "uint256", "indexed": true }
    ]
  }
] as const
