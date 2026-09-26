'use client'

import { memo, useMemo } from 'react'
import { Skeleton } from '@tacticus/ui-kit/loading'
import { useHeroCatalog } from '@/app/lib/catalogs'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'
import { sortTeamUnitNamesForDisplay } from '@/app/lib/team-display-order'
import {
  parseHeroDetails,
  parseMachineOfWarDetails
} from '@/app/lib/utils/battle-log-helpers'

interface TeamCompositionDisplayProps {
  heroDetails?: string | null
  machineOfWarDetails?: string | null
  className?: string
  showNames?: boolean
  iconSize?: number
}

function TeamCompositionDisplay({
  heroDetails,
  machineOfWarDetails,
  className = '',
  showNames = false,
  iconSize = 20
}: TeamCompositionDisplayProps) {
  const { data: heroCatalog, isLoading: loading } = useHeroCatalog()

  const heroes = useMemo(() => parseHeroDetails(heroDetails), [heroDetails])
  const mow = useMemo(
    () => parseMachineOfWarDetails(machineOfWarDetails),
    [machineOfWarDetails]
  )

  const displayHeroes = useMemo(
    () => sortTeamUnitNamesForDisplay(heroes, { catalog: heroCatalog }),
    [heroes, heroCatalog]
  )

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {/* Display heroes */}
      {displayHeroes.map((heroId: string) => {
        const resolved = resolveHeroPortrait(heroId, heroCatalog)
        const title = resolved.displayName
        return (
          <div key={heroId} className="flex items-center">
            {resolved.portraitUrl ? (
              <img
                src={resolved.portraitUrl}
                alt={title}
                title={title}
                width={iconSize}
                height={iconSize}
                className="rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ width: iconSize, height: iconSize }}
                title={title}
              >
                {resolved.fallbackBadge}
              </div>
            )}
          </div>
        )
      })}

      {/* Display separator if MOW exists */}
      {mow && (
        <span className="text-[var(--text-secondary)] mx-2 font-bold">&</span>
      )}

      {/* Display MOW */}
      {mow && (
        <div className="flex items-center">
          {(() => {
            const resolved = resolveHeroPortrait(mow, heroCatalog)
            const title = resolved.displayName
            return resolved.portraitUrl ? (
              <img
                src={resolved.portraitUrl}
                alt={title}
                title={title}
                width={iconSize}
                height={iconSize}
                className="rounded-full object-cover"
                loading="lazy"
              />
            ) : (
              <div
                className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ width: iconSize, height: iconSize }}
                title={title}
              >
                {resolved.fallbackBadge}
              </div>
            )
          })()}
        </div>
      )}

      {/* Display text names if requested */}
      {showNames && (
        <div className="ml-2 text-sm">
          {mow
            ? `${displayHeroes.join(' ')} & ${mow}`
            : displayHeroes.join(' ')}
        </div>
      )}
    </div>
  )
}

export default memo(TeamCompositionDisplay)
