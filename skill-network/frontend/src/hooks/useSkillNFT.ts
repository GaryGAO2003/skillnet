import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { skillNFTAbi } from '../abi/SkillNFT'
import { SKILL_NFT_ADDRESS } from '../constants'
import type { SkillMetadata, SkillType, VisibilityTier } from '../types'

export function useSkillCount() {
  return useReadContract({
    address: SKILL_NFT_ADDRESS,
    abi: skillNFTAbi,
    functionName: 'totalSkills',
    query: { refetchInterval: 5000 },
  })
}

export function useSkillMetadata(tokenId: number) {
  return useReadContract({
    address: SKILL_NFT_ADDRESS,
    abi: skillNFTAbi,
    functionName: 'getSkill',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
  })
}

export function useMintSkill() {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  async function mintSkill(params: {
    name: string
    description: string
    skillType: SkillType
    tier: VisibilityTier
    contentHash: `0x${string}`
    schemaURI: string
    pricePerCall: bigint
    previousVersion?: bigint
  }) {
    return writeContractAsync({
      address: SKILL_NFT_ADDRESS,
      abi: skillNFTAbi,
      functionName: 'mintSkill',
      args: [
        params.name,
        params.description,
        params.skillType,
        params.tier,
        params.contentHash,
        params.schemaURI,
        params.pricePerCall,
        params.previousVersion ?? BigInt(0),
      ],
    })
  }

  return { mintSkill, hash, isPending, isConfirming, isSuccess, error }
}

export function useSkillOwner(tokenId: number) {
  return useReadContract({
    address: SKILL_NFT_ADDRESS,
    abi: skillNFTAbi,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)],
    query: { enabled: tokenId > 0 },
  })
}

// Fetch all skills 1..count
export function useAllSkills(count: number): { skills: (SkillMetadata & { tokenId: number })[], isLoading: boolean } {
  // We'll load them one-by-one via individual hooks
  // In practice you'd use multicall or batch reads
  return { skills: [], isLoading: false }
}
