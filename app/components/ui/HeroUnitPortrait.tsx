'use client'

import { memo } from 'react'
import { useHeroCatalog } from '@/app/lib/catalogs/heroes'
import { resolveHeroPortrait } from '@/app/lib/catalogs/hero-portrait-resolver'

type HeroUnitPortraitProps = {
  unitName: string
  size?: 'sm' | 'md'
  className?: string
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10'
} as const

/** Two-letter fallback; unlike war-shared `UnitPortrait`, no HP/defeated overlays. */
export const HeroUnitPortrait = memo(function HeroUnitPortrait({
  unitName,
  size = 'sm',
  className = ''
}: HeroUnitPortraitProps) {
  const { data: catalog } = useHeroCatalog()

  const { portraitUrl, displayName, fallbackBadge } = resolveHeroPortrait(
    unitName,
    catalog
  )

  if (portraitUrl) {
    return (
      <div
        className={`${sizeClasses[size]} rounded-full bg-center bg-cover overflow-hidden shrink-0 ${className}`.trim()}
        style={{
          backgroundImage: `linear-gradient(135deg, rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0.1)), url('${portraitUrl}')`
        }}
        title={displayName}
        role="img"
        aria-label={displayName}
      >
        <span className="sr-only">{displayName}</span>
      </div>
    )
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] flex items-center justify-center text-[10px] uppercase tracking-wide text-(--accent) font-semibold shrink-0 ${className}`.trim()}
      title={displayName}
    >
      {fallbackBadge}
    </div>
  )
})
