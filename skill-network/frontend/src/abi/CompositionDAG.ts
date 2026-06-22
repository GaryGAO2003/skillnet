export const compositionDAGAbi = [
  {
    "type": "constructor",
    "inputs": [{ "name": "_skillNFT", "type": "address", "internalType": "address" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "compose",
    "inputs": [
      { "name": "childId", "type": "uint256", "internalType": "uint256" },
      { "name": "parentIds", "type": "uint256[]", "internalType": "uint256[]" },
      { "name": "weights", "type": "uint256[]", "internalType": "uint256[]" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getDependencies",
    "inputs": [{ "name": "skillId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct CompositionDAG.CompositionEdge[]",
        "components": [
          { "name": "parentSkillId", "type": "uint256" },
          { "name": "weight", "type": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getDependents",
    "inputs": [{ "name": "skillId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256[]", "internalType": "uint256[]" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isComposed",
    "inputs": [{ "name": "skillId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "depth",
    "inputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DEPTH",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "skillNFT",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Composed",
    "inputs": [
      { "name": "childId", "type": "uint256", "indexed": true },
      { "name": "parentIds", "type": "uint256[]", "indexed": false },
      { "name": "weights", "type": "uint256[]", "indexed": false }
    ]
  }
] as const
