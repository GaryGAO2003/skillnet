import { useState } from 'react'
import { useAccount } from 'wagmi'
import { formatEther, parseEther } from 'viem'
import { SETTLEMENT_VAULT_ADDRESS, ZERO_ADDRESS } from '../constants'
import {
  useVaultDeposit,
  useVaultBalance,
  useVaultSpent,
  useDepositToVault,
  useVaultWithdraw,
} from '../hooks/useSettlementVault'

export function Vault() {
  const { address, isConnected } = useAccount()
  const notDeployed = SETTLEMENT_VAULT_ADDRESS === ZERO_ADDRESS

  const { data: deposited, refetch: refetchDeposit } = useVaultDeposit(address)
  const { data: withdrawable, refetch: refetchBalance } = useVaultBalance(address)
  const { data: spent } = useVaultSpent(address)

  const {
    deposit,
    isPending: isDepositing,
    isConfirming: isDepositConfirming,
    isSuccess: isDepositSuccess,
    error: depositError,
  } = useDepositToVault()
  const {
    withdraw,
    isPending: isWithdrawing,
    isConfirming: isWithdrawConfirming,
    isSuccess: isWithdrawSuccess,
    error: withdrawError,
  } = useVaultWithdraw()

  const [amount, setAmount] = useState('')

  const isDepositBusy = isDepositing || isDepositConfirming
  const isWithdrawBusy = isWithdrawing || isWithdrawConfirming

  let parsedAmount: bigint | null = null
  try {
    parsedAmount = amount.trim() ? parseEther(amount.trim()) : null
  } catch {
    parsedAmount = null
  }

  async function handleDeposit() {
    if (!parsedAmount || parsedAmount <= BigInt(0)) return
    await deposit(parsedAmount)
    setAmount('')
    setTimeout(() => refetchDeposit(), 3000)
  }

  async function handleWithdraw() {
    await withdraw()
    setTimeout(() => refetchBalance(), 3000)
  }

  if (notDeployed) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Settlement Vault</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800">
          <div className="font-medium">Vault not deployed</div>
          <p className="text-sm mt-1 text-amber-700">
            The SettlementVault contract address is not configured. Set{' '}
            <code className="bg-amber-100 px-1 py-0.5 rounded text-xs">VITE_SETTLEMENT_VAULT_ADDRESS</code>{' '}
            in your environment to enable deposits and withdrawals.
          </p>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">Connect your wallet to use the settlement vault.</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settlement Vault</h1>
        <p className="text-gray-500 mt-1">
          Prepay for off-chain skill calls, then withdraw royalties settled to you on-chain.
        </p>
      </div>

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-gray-900">
            {deposited !== undefined ? formatEther(deposited).slice(0, 10) : '…'}
          </div>
          <div className="text-sm text-gray-500">Prepaid Deposit (ETH)</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-gray-900">
            {spent !== undefined ? formatEther(spent).slice(0, 10) : '…'}
          </div>
          <div className="text-sm text-gray-500">Total Settled (ETH)</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-gray-900">
            {withdrawable !== undefined ? formatEther(withdrawable).slice(0, 10) : '…'}
          </div>
          <div className="text-sm text-gray-500">Withdrawable (ETH)</div>
        </div>
      </div>

      {/* Deposit form */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div>
          <div className="text-sm font-medium text-gray-800">Deposit</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Prepay ETH into the vault. Signed vouchers draw against this balance.
          </p>
        </div>
        <div className="flex gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="flex items-center text-sm text-gray-500 font-medium">ETH</span>
          <button
            onClick={handleDeposit}
            disabled={isDepositBusy || !parsedAmount || parsedAmount <= BigInt(0)}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg px-5 py-2.5 text-sm transition-colors"
          >
            {isDepositBusy ? 'Depositing…' : isDepositSuccess ? 'Deposited!' : 'Deposit'}
          </button>
        </div>
        {amount.trim() && !parsedAmount && (
          <div className="text-xs text-red-600">Enter a valid ETH amount.</div>
        )}
        {depositError && (
          <div className="text-xs text-red-600">
            {(depositError as any).shortMessage ?? depositError.message}
          </div>
        )}
      </div>

      {/* Withdraw */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 flex items-center justify-between">
        <div>
          <div className="text-sm text-indigo-600 font-medium">Withdrawable Balance</div>
          <div className="text-2xl font-bold text-indigo-900 mt-1">
            {withdrawable !== undefined ? formatEther(withdrawable) : '…'} ETH
          </div>
          {withdrawError && (
            <div className="text-xs text-red-600 mt-1">
              {(withdrawError as any).shortMessage ?? withdrawError.message}
            </div>
          )}
        </div>
        <button
          onClick={handleWithdraw}
          disabled={isWithdrawBusy || !withdrawable || withdrawable === BigInt(0)}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg px-5 py-2.5 text-sm transition-colors"
        >
          {isWithdrawBusy ? 'Withdrawing…' : isWithdrawSuccess ? 'Withdrawn!' : 'Withdraw'}
        </button>
      </div>
    </div>
  )
}
