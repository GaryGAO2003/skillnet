import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { feeRouterAbi } from '../abi/FeeRouter'
import { FEE_ROUTER_ADDRESS } from '../constants'

export function useClaimableBalance(address?: `0x${string}`) {
  return useReadContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterAbi,
    functionName: 'getBalance',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 5000,
    },
  })
}

export function usePayForCall() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function payForCall(skillId: number, value: bigint) {
    return writeContractAsync({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterAbi,
      functionName: 'payForCall',
      args: [BigInt(skillId)],
      value,
    })
  }

  return { payForCall, hash, isPending, isConfirming, isSuccess, error }
}

export function useWithdraw() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function withdraw() {
    return writeContractAsync({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterAbi,
      functionName: 'withdraw',
    })
  }

  return { withdraw, hash, isPending, isConfirming, isSuccess, error }
}
