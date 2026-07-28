import { useNavigate } from 'react-router-dom'
import { TierBadge } from './TierBadge'
import { usePayForCall } from '../hooks/useFeeRouter'
import { SKILL_TYPE_LABELS } from '../constants'
import { formatWeiValue, registryMark } from '../lib/format'
import type { SkillWithId } from '../types'

interface SkillRowProps {
  skill: SkillWithId
}

/** A skill rendered as a ledger row (not a card). */
export function SkillRow({ skill }: SkillRowProps) {
  const navigate = useNavigate()
  const { payForCall, isPending, isConfirming } = usePayForCall()

  const isFree = skill.pricePerCall === BigInt(0)

  async function handleCall() {
    // Payment floor: free skills still record a call at the minimum unit.
    const value = isFree ? BigInt(1) : skill.pricePerCall
    await payForCall(skill.tokenId, value)
  }

  const isBusy = isPending || isConfirming
  const calls = skill.totalCalls.toString()
  const revenue = formatWeiValue(skill.totalRevenue)
  const price = formatWeiValue(skill.pricePerCall)

  return (
    <div className="led-row">
      <div className="led-id">{registryMark(skill.tokenId)}</div>

      <div className="led-main">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="led-name">{skill.name}</span>
          <TierBadge tier={skill.tier} size="sm" />
        </div>
        <div className="led-desc line-clamp-2">{skill.description}</div>
        <span className="led-type">{SKILL_TYPE_LABELS[skill.skillType]}</span>
      </div>

      <div className="led-num">{calls}</div>
      <div className="led-num">
        {revenue} <span className="u">ETH</span>
      </div>
      <div className={`led-num price ${isFree ? 'free' : ''}`}>
        {isFree ? 'FREE' : <>{price} <span className="u">ETH</span></>}
      </div>

      {/* Compact numeric stack for narrow screens */}
      <div className="led-mobilenums">
        <span className="mn"><small>Calls</small>{calls}</span>
        <span className="mn"><small>Revenue</small>{revenue}</span>
        <span className="mn"><small>Price</small>{isFree ? 'FREE' : price}</span>
      </div>

      <div className="led-act">
        <button
          onClick={handleCall}
          disabled={isBusy}
          className="btn btn-primary btn-sm"
        >
          {isBusy ? '…' : 'Call'}
        </button>
        <button
          onClick={() => navigate(`/skill/${skill.tokenId}`)}
          className="btn btn-ghost btn-sm"
        >
          DAG
        </button>
      </div>
    </div>
  )
}
