import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { compositionDAGAbi } from '../abi/CompositionDAG'
import { DAG_ADDRESS } from '../constants'

export function useDependencies(skillId: number) {
  return useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'getDependencies',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })
}

export function useDependents(skillId: number) {
  return useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'getDependents',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })
}

export function useIsComposed(skillId: number) {
  return useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'isComposed',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })
}

export function useSkillDepth(skillId: number) {
  return useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'depth',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })
}

export function useCompose() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function compose(childId: number, parentIds: number[], weights: number[]) {
    return writeContractAsync({
      address: DAG_ADDRESS,
      abi: compositionDAGAbi,
      functionName: 'compose',
      args: [
        BigInt(childId),
        parentIds.map(BigInt),
        weights.map(BigInt),
      ],
    })
  }

  return { compose, hash, isPending, isConfirming, isSuccess, error }
}
