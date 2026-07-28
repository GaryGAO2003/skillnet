import { useState } from 'react'
import { useAccount } from 'wagmi'
import { parseEther } from 'viem'
import { SETTLEMENT_VAULT_ADDRESS, ZERO_ADDRESS } from '../constants'
import {
  useVaultDeposit,
  useVaultBalance,
  useVaultSpent,
  useDepositToVault,
  useVaultWithdraw,
} from '../hooks/useSettlementVault'
import { VisitorEmptyState } from '../components/VisitorEmptyState'
import { formatWeiValue, formatEth } from '../lib/format'

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t-2 border-line-strong pt-3">
      <div className="font-mono text-[24px] font-bold tracking-tight text-ink leading-none">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted mt-2">{label}</div>
    </div>
  )
}

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
      <div className="max-w-content mx-auto px-6 py-12">
        <h1 className="font-display text-5xl leading-[0.95] tracking-tight text-ink mb-6">Settlement Vault</h1>
        <div className="alert warning">
          <span className="lbl">Not Deployed</span>
          <span className="msg">
            The SettlementVault contract address is not configured. Set{' '}
            <code className="font-mono text-[12px] bg-surface-raised px-1 py-0.5 border border-line rounded-sm">VITE_SETTLEMENT_VAULT_ADDRESS</code>{' '}
            in your environment to enable deposits and withdrawals.
          </span>
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <VisitorEmptyState
        title="Settlement Vault"
        pitch="Prepay ETH once; signed vouchers draw against it as skills settle royalties to you on-chain — no gas per call."
        columnLabels={['Deposit', 'Settled', 'Withdrawable']}
        rows={[
          { id: '◆ A1', name: 'agent.eth', cols: ['0.500000', '0.142000', '0.358000'] },
          { id: '◆ B2', name: 'builder.eth', cols: ['0.100000', '0.087500', '0.012500'] },
        ]}
      />
    )
  }

  return (
    <div className="max-w-content mx-auto px-6 py-12 space-y-10">
      <div>
        <h1 className="font-display text-5xl leading-[0.95] tracking-tight text-ink">Settlement Vault</h1>
        <p className="font-mono text-[12px] tracking-[0.02em] text-muted mt-3 max-w-[60ch]">
          Prepay for off-chain skill calls, then withdraw royalties settled to you on-chain.
        </p>
      </div>

      {/* Balance stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Stat value={deposited !== undefined ? formatWeiValue(deposited) : '…'} label="Prepaid Deposit (ETH)" />
        <Stat value={spent !== undefined ? formatWeiValue(spent) : '…'} label="Total Settled (ETH)" />
        <Stat value={withdrawable !== undefined ? formatWeiValue(withdrawable) : '…'} label="Withdrawable (ETH)" />
      </div>

      {/* Deposit form */}
      <div className="bg-surface border border-line rounded-sm p-5 space-y-3">
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink">Deposit</div>
          <p className="font-mono text-[11px] text-muted mt-1">
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
            className="field-input flex-1"
          />
          <span className="flex items-center font-mono text-[12px] text-muted">ETH</span>
          <button
            onClick={handleDeposit}
            disabled={isDepositBusy || !parsedAmount || parsedAmount <= BigInt(0)}
            className="btn btn-primary"
          >
            {isDepositBusy ? 'Depositing…' : isDepositSuccess ? 'Deposited ✓' : 'Deposit'}
          </button>
        </div>
        {amount.trim() && !parsedAmount && (
          <div className="font-mono text-[11px] text-danger">Enter a valid ETH amount.</div>
        )}
        {depositError && (
          <div className="font-mono text-[11px] text-danger">
            {(depositError as any).shortMessage ?? depositError.message}
          </div>
        )}
      </div>

      {/* Withdraw — receipt */}
      <div className="receipt flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Withdrawable Balance</div>
          <div className="font-mono text-[26px] font-bold text-ink mt-1">
            {withdrawable !== undefined ? formatEth(withdrawable) : '…'}
          </div>
          {withdrawError && (
            <div className="font-mono text-[11px] text-danger mt-1">
              {(withdrawError as any).shortMessage ?? withdrawError.message}
            </div>
          )}
        </div>
        <button
          onClick={handleWithdraw}
          disabled={isWithdrawBusy || !withdrawable || withdrawable === BigInt(0)}
          className="btn btn-primary"
        >
          {isWithdrawBusy ? 'Withdrawing…' : isWithdrawSuccess ? 'Withdrawn ✓' : 'Withdraw'}
        </button>
      </div>
    </div>
  )
}
