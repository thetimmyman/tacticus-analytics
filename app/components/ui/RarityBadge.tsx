import type { ReactNode } from 'react'
import clsx from 'clsx'

import {
  getRarityConfig,
  normalizeRarity,
  type Rarity
} from '@tacticus/app-core/rarity-utils'
import '@/app/styles/rarity-badges.css'

const RARITY_CLASS_MAP: Record<Rarity, string> = {
  Mythic: 'rarity-badge--mythic',
  Legendary: 'rarity-badge--legendary',
  Epic: 'rarity-badge--epic',
  Rare: 'rarity-badge--rare',
  Uncommon: 'rarity-badge--uncommon',
  Common: 'rarity-badge--common'
}

interface RarityBadgeProps {
  rarity?: string | null
  className?: string
  children?: ReactNode
  compact?: boolean
  title?: string
}

export function RarityBadge({
  rarity,
  className = '',
  children,
  compact = false,
  title
}: RarityBadgeProps) {
  const normalized = normalizeRarity(rarity ?? undefined)
  const fallbackLabel = rarity ?? 'Unknown'
  const label = children ?? normalized ?? fallbackLabel

  const variantClass = normalized
    ? RARITY_CLASS_MAP[normalized]
    : 'rarity-badge--default'
  const config = normalized ? getRarityConfig(normalized) : undefined

  return (
    <span
      className={clsx(
        'rarity-badge',
        variantClass,
        compact && 'rarity-badge--compact',
        className
      )}
      data-rarity={normalized ? normalized.toLowerCase() : undefined}
      title={title ?? config?.description ?? undefined}
    >
      {label}
    </span>
  )
}
