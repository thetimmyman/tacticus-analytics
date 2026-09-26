'use client'

import Image from 'next/image'
import {
  getRankIconUrl,
  getRankName,
  getRankColor
} from '../utils/roster-helpers'

interface RankIconProps {
  rank: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

const sizeMap = {
  sm: { icon: 32, text: 'text-xs' },
  md: { icon: 48, text: 'text-sm' },
  lg: { icon: 64, text: 'text-base' }
}

export function RankIcon({
  rank,
  size = 'md',
  showLabel = false,
  className = ''
}: RankIconProps) {
  const iconUrl = getRankIconUrl(rank)
  const rankName = getRankName(rank)
  const { icon: iconSize, text: textSize } = sizeMap[size]

  if (!iconUrl) {
    // Text fallback for ranks without icons (Adamantium, Mythic, Silver III).
    return (
      <span
        className={`${getRankColor(rank)} ${textSize} font-semibold ${className}`}
      >
        {rankName}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Image
        src={iconUrl}
        alt={rankName}
        width={iconSize}
        height={iconSize}
        className="object-contain"
        unoptimized // External URL from datamine
      />
      {showLabel && (
        <span className={`${getRankColor(rank)} ${textSize} font-semibold`}>
          {rankName}
        </span>
      )}
    </span>
  )
}
