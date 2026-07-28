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
    <div className="max-w-2xl mx-auto px-6 py-12">
      <header className="mb-8">
        <h1 className="font-display text-5xl leading-[0.95] tracking-tight text-ink">Compose a Skill</h1>
        <p className="font-mono text-[12px] tracking-[0.02em] text-muted mt-3 max-w-[56ch]">
          Build on existing skills. Fix each contributor's royalty weight at mint —
          every downstream call settles the split on-chain, to the wei.
        </p>
      </header>

      <div className="bg-surface border border-line rounded-sm p-6">
        <ComposeForm
          availableSkills={skills}
          onSuccess={() => navigate('/')}
        />
      </div>
    </div>
  )
}
