import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { settlementVaultAbi } from '../abi/settlementVault'
import { SETTLEMENT_VAULT_ADDRESS } from '../constants'

// Re-export the ABI so gateway-side tooling (settleBatch) can import it from one place.
export { settlementVaultAbi }

// Prepaid deposit balance a payer has left in the vault (drawn down by settled vouchers).
export function useVaultDeposit(address?: `0x${string}`) {
  return useReadContract({
    address: SETTLEMENT_VAULT_ADDRESS,
    abi: settlementVaultAbi,
    functionName: 'getDeposit',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 5000,
    },
  })
}

// Withdrawable (claimable) recipient balance credited by settled batches.
export function useVaultBalance(address?: `0x${string}`) {
  return useReadContract({
    address: SETTLEMENT_VAULT_ADDRESS,
    abi: settlementVaultAbi,
    functionName: 'getBalance',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 5000,
    },
  })
}

// Cumulative amount already settled (debited) for a payer — monotonic replay guard.
export function useVaultSpent(address?: `0x${string}`) {
  return useReadContract({
    address: SETTLEMENT_VAULT_ADDRESS,
    abi: settlementVaultAbi,
    functionName: 'spent',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 5000,
    },
  })
}

// The operator authorized to submit settlement batches.
export function useVaultGateway() {
  return useReadContract({
    address: SETTLEMENT_VAULT_ADDRESS,
    abi: settlementVaultAbi,
    functionName: 'gateway',
  })
}

export function useDepositToVault() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function deposit(value: bigint) {
    return writeContractAsync({
      address: SETTLEMENT_VAULT_ADDRESS,
      abi: settlementVaultAbi,
      functionName: 'deposit',
      value,
    })
  }

  return { deposit, hash, isPending, isConfirming, isSuccess, error }
}

export function useVaultWithdraw() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function withdraw() {
    return writeContractAsync({
      address: SETTLEMENT_VAULT_ADDRESS,
      abi: settlementVaultAbi,
      functionName: 'withdraw',
    })
  }

  return { withdraw, hash, isPending, isConfirming, isSuccess, error }
}
