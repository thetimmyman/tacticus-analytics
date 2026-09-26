import { getStarsFromProgressionIndex } from '@/app/lib/tacticus/stars'
import { getStarTier, getStarUrl } from '../utils/tile-art'

/** Sprite pips sized as a share of tile width; 14 stars show one winged skull. */

const PIP_WIDTH_PCT = 15
/** Pips overlap slightly, as in-game. */
const PIP_OVERLAP_PCT = 3
const MYTHIC_WIDTH_PCT = 46

interface TileStarsProps {
  progressionIndex: number
  className?: string
}

export function TileStars({
  progressionIndex,
  className = ''
}: TileStarsProps) {
  const stars = getStarsFromProgressionIndex(progressionIndex)
  const band = getStarTier(stars)

  if (!band) return null

  const label = stars >= 14 ? 'Mythic Winged (14 stars)' : `${stars} stars`

  if (band.tier === 'mythic') {
    return (
      <img
        src={getStarUrl('mythic')}
        alt=""
        role="img"
        aria-label={label}
        title={label}
        className={`pointer-events-none select-none ${className}`}
        style={{ width: `${MYTHIC_WIDTH_PCT}%` }}
        loading="lazy"
        decoding="async"
      />
    )
  }

  // The row spans the full tile so percentages resolve against the tile and do not compound.
  return (
    <div
      className={`pointer-events-none flex w-full select-none items-center justify-center ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: band.count }, (_, i) => (
        <img
          key={`${band.tier}-pip-${i + 1}`}
          src={getStarUrl(band.tier)}
          alt=""
          aria-hidden="true"
          className="block shrink-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
          style={{
            width: `${PIP_WIDTH_PCT}%`,
            marginLeft: i === 0 ? undefined : `-${PIP_OVERLAP_PCT}%`
          }}
          loading="lazy"
          decoding="async"
        />
      ))}
    </div>
  )
}
