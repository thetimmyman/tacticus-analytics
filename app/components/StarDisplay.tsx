import { Sparkles, Star } from 'lucide-react'
import { getStarsFromProgressionIndex } from '@/app/lib/tacticus/stars'

export { getStarsFromProgressionIndex } from '@/app/lib/tacticus/stars'

export function getRarityTierFromStars(
  stars: number
):
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'mythic'
  | 'mythic-winged' {
  if (stars >= 14) return 'mythic-winged'
  if (stars >= 12) return 'mythic'
  if (stars >= 9) return 'legendary'
  if (stars >= 7) return 'epic'
  if (stars >= 5) return 'rare'
  if (stars >= 3) return 'uncommon'
  return 'common'
}

function getStarDisplayConfig(stars: number): {
  count: number
  color: string
} {
  if (stars <= 0) return { count: 0, color: 'text-secondary-wh40k' }

  if (stars >= 14) {
    return {
      count: 0,
      color: 'text-orange-400'
    }
  }

  // 11-13 = cyan (11->1 … 13->3).
  if (stars >= 11) {
    return {
      count: stars - 10,
      color: 'text-cyan-400'
    }
  }

  // 6-10 = red (6->1 … 10->5).
  if (stars >= 6) {
    return {
      count: stars - 5,
      color: 'text-red-500'
    }
  }

  return {
    count: stars,
    color: 'text-yellow-400'
  }
}

const STAR_SIZE_MAP = {
  sm: 12,
  md: 16,
  lg: 20
} as const

interface StarDisplayProps {
  progressionIndex: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

/** Stars for a progression index, matching the game's star graphics. */
export function StarDisplay({
  progressionIndex,
  size = 'sm',
  showLabel = false,
  className = ''
}: StarDisplayProps) {
  const stars = getStarsFromProgressionIndex(progressionIndex)
  const config = getStarDisplayConfig(stars)
  const tier = getRarityTierFromStars(stars)

  const iconSize = STAR_SIZE_MAP[size]

  if (stars === 0) {
    return (
      <div className={`flex items-center justify-center gap-1 ${className}`}>
        <span className="text-xs text-secondary-wh40k">-</span>
      </div>
    )
  }

  if (tier === 'mythic-winged') {
    return (
      <div className={`flex items-center justify-center gap-1 ${className}`}>
        <span
          className="text-orange-400 font-bold"
          title="14 Stars - Mythic Winged"
          role="img"
          aria-label="Mythic Winged"
        >
          <Sparkles
            className="text-orange-400"
            style={{ width: iconSize, height: iconSize }}
          />
        </span>
        {showLabel && <span className="text-xs text-orange-400 ml-1">14</span>}
      </div>
    )
  }

  const starPositions = Array.from(
    { length: config.count },
    (_, i) => `star-prog-${progressionIndex}-pos-${i + 1}`
  )

  return (
    <div
      className={`flex items-center justify-center gap-0.5 ${className}`}
      title={`${stars} Stars`}
    >
      {starPositions.map((starKey) => (
        <Star
          key={starKey}
          aria-hidden="true"
          className={`${config.color} fill-current`}
          style={{ width: iconSize, height: iconSize }}
        />
      ))}
      {showLabel && (
        <span className={`text-xs ${config.color} ml-1`}>{stars}</span>
      )}
    </div>
  )
}

export function StarCount({
  progressionIndex,
  className = ''
}: {
  progressionIndex: number
  className?: string
}) {
  const stars = getStarsFromProgressionIndex(progressionIndex)
  const tier = getRarityTierFromStars(stars)

  const colorClass = {
    'mythic-winged': 'text-orange-400',
    mythic: 'text-cyan-400',
    legendary: 'text-cyan-300',
    epic: 'text-orange-400',
    rare: 'text-blue-400',
    uncommon: 'text-green-400',
    common: 'text-yellow-400'
  }[tier]

  if (stars === 0) {
    return <span className={`text-secondary-wh40k ${className}`}>-</span>
  }

  return <span className={`${colorClass} ${className}`}>{stars}</span>
}

const STAR_SIZE_MAP_EXTENDED = {
  xs: 10,
  sm: 12,
  md: 16,
  lg: 20
} as const

interface StarDisplayFromCountProps {
  stars: number | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  showLabel?: boolean
  className?: string
}

/** Stars for a raw star count (0-14) instead of a progression index. */
export function StarDisplayFromCount({
  stars,
  size = 'sm',
  showLabel = false,
  className = ''
}: StarDisplayFromCountProps) {
  const starCount = stars ?? 0
  const config = getStarDisplayConfig(starCount)
  const tier = getRarityTierFromStars(starCount)

  const iconSize = STAR_SIZE_MAP_EXTENDED[size]

  if (starCount === 0) {
    return (
      <div className={`flex items-center justify-center gap-1 ${className}`}>
        <span className="text-xs text-secondary-wh40k">-</span>
      </div>
    )
  }

  if (tier === 'mythic-winged') {
    return (
      <div className={`flex items-center justify-center gap-1 ${className}`}>
        <span
          className="text-orange-400 font-bold"
          title="14 Stars - Mythic Winged"
          role="img"
          aria-label="Mythic Winged"
        >
          <Sparkles
            className="text-orange-400"
            style={{ width: iconSize, height: iconSize }}
          />
        </span>
        {showLabel && <span className="text-xs text-orange-400 ml-1">14</span>}
      </div>
    )
  }

  const starPositions = Array.from(
    { length: config.count },
    (_, i) => `star-count-${starCount}-pos-${i + 1}`
  )

  return (
    <div
      className={`flex items-center justify-center gap-0.5 ${className}`}
      title={`${starCount} Stars`}
    >
      {starPositions.map((starKey) => (
        <Star
          key={starKey}
          aria-hidden="true"
          className={`${config.color} fill-current`}
          style={{ width: iconSize, height: iconSize }}
        />
      ))}
      {showLabel && (
        <span className={`text-xs ${config.color} ml-1`}>{starCount}</span>
      )}
    </div>
  )
}
