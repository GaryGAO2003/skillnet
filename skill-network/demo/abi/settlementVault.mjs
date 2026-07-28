'use strict'
/**
 * SettlementVault ABI — vendored copy for the demo (do NOT import across packages).
 * Kept in sync by hand with skill-network/frontend/src/abi/settlementVault.ts, which is
 * itself hand-derived from contracts/src/SettlementVault.sol. Only the members the gateway
 * actually calls are load-bearing here (settleBatch, spent, getBalance, getDeposit, deposit,
 * hashVoucher); the rest are included for faithfulness / event decoding.
 */
export const settlementVaultAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_gateway', type: 'address', internalType: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'gateway',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deposits',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'spent',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balances',
    inputs: [{ name: '', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'hashVoucher',
    inputs: [
      {
        name: 'v',
        type: 'tuple',
        internalType: 'struct SettlementVault.Voucher',
        components: [
          { name: 'payer', type: 'address', internalType: 'address' },
          { name: 'cumulativeSpent', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'settleBatch',
    inputs: [
      {
        name: 'vouchers',
        type: 'tuple[]',
        internalType: 'struct SettlementVault.Voucher[]',
        components: [
          { name: 'payer', type: 'address', internalType: 'address' },
          { name: 'cumulativeSpent', type: 'uint256', internalType: 'uint256' },
        ],
      },
      { name: 'sigs', type: 'bytes[]', internalType: 'bytes[]' },
      {
        name: 'credits',
        type: 'tuple[]',
        internalType: 'struct SettlementVault.Credit[]',
        components: [
          { name: 'recipient', type: 'address', internalType: 'address' },
          { name: 'amount', type: 'uint256', internalType: 'uint256' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getDeposit',
    inputs: [{ name: 'a', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBalance',
    inputs: [{ name: 'a', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'payer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'newDeposit', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'VoucherConsumed',
    inputs: [
      { name: 'payer', type: 'address', indexed: true },
      { name: 'delta', type: 'uint256', indexed: false },
      { name: 'cumulativeSpent', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BatchSettled',
    inputs: [
      { name: 'totalDebited', type: 'uint256', indexed: false },
      { name: 'numVouchers', type: 'uint256', indexed: false },
      { name: 'numCredits', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
]
