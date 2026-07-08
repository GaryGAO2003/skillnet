// Hand-derived from contracts/src/SettlementVault.sol (EIP-712 cumulative-voucher
// batch-settlement vault). Covers the contract's own external/public surface plus the
// members its OpenZeppelin v5 bases contribute to the compiled ABI:
//   - EIP712 base -> eip712Domain() view + EIP712DomainChanged event
//   - ECDSA library (used by settleBatch) -> the three ECDSA* custom errors
// SettlementVault itself reverts with require-strings, so it declares no custom errors.
export const settlementVaultAbi = [
  {
    "type": "constructor",
    "inputs": [
      { "name": "_gateway", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "gateway",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deposits",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "spent",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balances",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "hashVoucher",
    "inputs": [
      {
        "name": "v",
        "type": "tuple",
        "internalType": "struct SettlementVault.Voucher",
        "components": [
          { "name": "payer", "type": "address", "internalType": "address" },
          { "name": "cumulativeSpent", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "outputs": [{ "name": "", "type": "bytes32", "internalType": "bytes32" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settleBatch",
    "inputs": [
      {
        "name": "vouchers",
        "type": "tuple[]",
        "internalType": "struct SettlementVault.Voucher[]",
        "components": [
          { "name": "payer", "type": "address", "internalType": "address" },
          { "name": "cumulativeSpent", "type": "uint256", "internalType": "uint256" }
        ]
      },
      { "name": "sigs", "type": "bytes[]", "internalType": "bytes[]" },
      {
        "name": "credits",
        "type": "tuple[]",
        "internalType": "struct SettlementVault.Credit[]",
        "components": [
          { "name": "recipient", "type": "address", "internalType": "address" },
          { "name": "amount", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getDeposit",
    "inputs": [{ "name": "a", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getBalance",
    "inputs": [{ "name": "a", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip712Domain",
    "inputs": [],
    "outputs": [
      { "name": "fields", "type": "bytes1", "internalType": "bytes1" },
      { "name": "name", "type": "string", "internalType": "string" },
      { "name": "version", "type": "string", "internalType": "string" },
      { "name": "chainId", "type": "uint256", "internalType": "uint256" },
      { "name": "verifyingContract", "type": "address", "internalType": "address" },
      { "name": "salt", "type": "bytes32", "internalType": "bytes32" },
      { "name": "extensions", "type": "uint256[]", "internalType": "uint256[]" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Deposited",
    "inputs": [
      { "name": "payer", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false },
      { "name": "newDeposit", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "VoucherConsumed",
    "inputs": [
      { "name": "payer", "type": "address", "indexed": true },
      { "name": "delta", "type": "uint256", "indexed": false },
      { "name": "cumulativeSpent", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "BatchSettled",
    "inputs": [
      { "name": "totalDebited", "type": "uint256", "indexed": false },
      { "name": "numVouchers", "type": "uint256", "indexed": false },
      { "name": "numCredits", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      { "name": "recipient", "type": "address", "indexed": true },
      { "name": "amount", "type": "uint256", "indexed": false }
    ]
  },
  {
    "type": "event",
    "name": "EIP712DomainChanged",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureLength",
    "inputs": [{ "name": "length", "type": "uint256", "internalType": "uint256" }]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureS",
    "inputs": [{ "name": "s", "type": "bytes32", "internalType": "bytes32" }]
  },
  {
    "type": "error",
    "name": "InvalidShortString",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StringTooLong",
    "inputs": [{ "name": "str", "type": "string", "internalType": "string" }]
  }
] as const
