/** Applies Mythic or Legendary styling to boss sections. */

import React, { useMemo } from 'react'

import { RarityBadge } from '@/app/components/ui/RarityBadge'
import type { Rarity } from '@tacticus/app-core/rarity-utils'

interface BossLevelWrapperProps {
  rarity: 'Mythic' | 'Legendary' | string
  children: React.ReactNode
  showParticles?: boolean
  particleCount?: number
  className?: string
}

export function BossLevelWrapper({
  rarity,
  children,
  showParticles = true,
  particleCount = 20,
  className = ''
}: BossLevelWrapperProps) {
  const isMythic = rarity === 'Mythic'
  const isLegendary = rarity === 'Legendary'

  const pseudoRandom = (seed: number) => {
    const value = Math.sin(seed) * 10000
    return value - Math.floor(value)
  }

  const particles = useMemo(() => {
    if (!showParticles) {
      return []
    }

    const items = []
    for (let index = 0; index < particleCount; index++) {
      const seed = index + 1
      const baseLeft = pseudoRandom(seed) * 100
      const baseDelay = pseudoRandom(seed * 1.37)
      const baseSize = pseudoRandom(seed * 2.13)

      if (isMythic) {
        const emberColor = 140 + pseudoRandom(seed * 3.19) * 55
        const size = 3 + baseSize * 3
        items.push({
          key: `mythic-${seed}`,
          className: 'mythic-particle',
          style: {
            left: `${baseLeft}%`,
            animationDelay: `${baseDelay * 7}s`,
            width: `${size}px`,
            height: `${size}px`,
            background: `radial-gradient(circle, rgba(255, ${emberColor.toFixed(2)}, 0, 0.8) 0%, transparent 70%)`
          } as React.CSSProperties
        })
      } else if (isLegendary) {
        const size = 2 + baseSize * 2
        items.push({
          key: `legendary-${seed}`,
          className: 'diamond-particle',
          style: {
            left: `${baseLeft}%`,
            animationDelay: `${baseDelay * 8}s`,
            width: `${size}px`,
            height: `${size}px`,
            background:
              'radial-gradient(circle, rgba(255, 255, 255, 0.6) 0%, transparent 70%)'
          } as React.CSSProperties
        })
      }
    }

    return items
  }, [isLegendary, isMythic, particleCount, showParticles])

  if (!isMythic && !isLegendary) {
    return <div className={className}>{children}</div>
  }

  return (
    <div
      className={`${isMythic ? 'mythic-section' : 'diamond-section'} rounded-lg p-6 relative ${className}`}
    >
      {/* Particle effects for visual enhancement */}
      {particles.map((particle) => (
        <div
          key={particle.key}
          className={particle.className}
          style={particle.style}
        />
      ))}

      <div className="relative z-10">{children}</div>
    </div>
  )
}

interface BossLevelTitleProps {
  rarity: 'Mythic' | 'Legendary' | string
  children: React.ReactNode
  className?: string
}

export function BossLevelTitle({
  rarity,
  children,
  className = ''
}: BossLevelTitleProps) {
  const isMythic = rarity === 'Mythic'
  const isLegendary = rarity === 'Legendary'

  if (!isMythic && !isLegendary) {
    return <div className={className}>{children}</div>
  }

  return (
    <div
      className={`${isMythic ? 'mythic-title' : 'diamond-title'} ${className}`}
    >
      {children}
    </div>
  )
}

interface BossLevelBadgeProps {
  level: string // e.g., "L1", "M3"
  className?: string
}

export function BossLevelBadge({ level, className = '' }: BossLevelBadgeProps) {
  const rarityPrefix = level.slice(0, 1).toUpperCase()
  const rarityMap: Record<string, Rarity> = {
    M: 'Mythic',
    L: 'Legendary',
    E: 'Epic',
    R: 'Rare',
    U: 'Uncommon',
    C: 'Common'
  }

  const rarity = rarityMap[rarityPrefix]

  return (
    <RarityBadge rarity={rarity} className={className} compact>
      {level}
    </RarityBadge>
  )
}
