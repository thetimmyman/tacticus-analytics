'use client'

import { formatNumber } from '@tacticus/app-core/formatters'

/** Shows the battle count behind every damage aggregate: >=100 high, >=30 medium, else low. */
export function ConfidenceChip({
  attackCount,
  className = ''
}: {
  attackCount: number
  className?: string
}) {
  const { dotClass, confidence } =
    attackCount >= 100
      ? { dotClass: 'bg-green-400', confidence: 'High confidence' }
      : attackCount >= 30
        ? { dotClass: 'bg-yellow-400', confidence: 'Medium confidence' }
        : { dotClass: 'bg-orange-400', confidence: 'Low sample size' }

  return (
    <span
      className={`flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-[var(--text-secondary)] ${className}`}
      title={`${attackCount} attacks — ${confidence}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${dotClass}`}
      />
      {formatNumber(attackCount, 0)} atk
    </span>
  )
}
