import { useNavigate } from 'react-router-dom'
import { useReadContracts } from 'wagmi'
import { skillNFTAbi } from '../abi/SkillNFT'
import { SKILL_NFT_ADDRESS } from '../constants'
import { useSkillCount } from '../hooks/useSkillNFT'
import { ComposeForm } from '../components/ComposeForm'
import type { SkillWithId } from '../types'

export function ComposeSkill() {
  const navigate = useNavigate()
  const { data: totalSkills } = useSkillCount()
  const count = Number(totalSkills ?? 0)

  const contracts = count > 0
    ? Array.from({ length: count }, (_, i) => ({
        address: SKILL_NFT_ADDRESS,
        abi: skillNFTAbi,
        functionName: 'getSkill' as const,
        args: [BigInt(i + 1)] as const,
      }))
    : []

  const { data: results } = useReadContracts({
    contracts,
    query: { enabled: count > 0 },
  })

  const skills: SkillWithId[] = (results ?? [])
    .map((r, i) => r.status === 'success' ? { ...r.result as any, tokenId: i + 1 } : null)
    .filter(Boolean) as SkillWithId[]

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Compose a Skill</h1>
      <p className="text-gray-500 text-sm mb-8">
        Create a new skill that builds on existing ones. Set dependency weights to define how royalties flow upstream.
      </p>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <ComposeForm
          availableSkills={skills}
          onSuccess={() => navigate('/')}
        />
      </div>
    </div>
  )
}
