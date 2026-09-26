'use client'

import { useMemo, CSSProperties } from 'react'
import {
  Rarity,
  RARITY_HIERARCHY,
  getRarityConfig
} from '@tacticus/app-core/rarity-utils'

export interface RarityFilterControlsProps {
  availableRarities: Rarity[]
  selectedRarities: Rarity[]
  defaultRarities?: Rarity[]
  onChange?: (rarities: Rarity[]) => void
  onRarityChange?: (rarities: Rarity[]) => void
  onReset?: () => void
  counts?: Partial<Record<Rarity, number>>
  compact?: boolean
  className?: string
  hideIfSingle?: boolean
  label?: string
}

const raritySort = (rarities: Rarity[]) =>
  RARITY_HIERARCHY.filter((rarity) => rarities.includes(rarity))

const arrayEquals = (a: Rarity[], b: Rarity[]): boolean => {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export function RarityFilterControls({
  availableRarities,
  selectedRarities,
  defaultRarities,
  onChange,
  onRarityChange,
  onReset,
  counts,
  compact = true,
  className = '',
  hideIfSingle = true,
  label = 'Rarity'
}: RarityFilterControlsProps) {
  const sortedAvailable = useMemo(
    () => raritySort(Array.from(new Set(availableRarities))),
    [availableRarities]
  )
  const normalizedSelected = useMemo(
    () => raritySort(Array.from(new Set(selectedRarities))),
    [selectedRarities]
  )
  const normalizedDefault = useMemo(() => {
    const baseDefaults =
      defaultRarities && defaultRarities.length > 0
        ? defaultRarities
        : availableRarities
    return raritySort(Array.from(new Set(baseDefaults)))
  }, [availableRarities, defaultRarities])

  if (sortedAvailable.length <= 1 && hideIfSingle) {
    return null
  }

  const pillSizeClasses = compact
    ? 'px-2.5 py-1 text-xs'
    : 'px-3 py-1.5 text-sm'

  const toggleRarity = (rarity: Rarity) => {
    const exists = normalizedSelected.includes(rarity)
    let next: Rarity[]

    if (exists) {
      next = normalizedSelected.filter((value) => value !== rarity)
    } else {
      next = raritySort([...normalizedSelected, rarity])
    }

    onChange?.(next)
    onRarityChange?.(next)
  }

  const handleReset = () => {
    onChange?.(normalizedDefault)
    onRarityChange?.(normalizedDefault)
    onReset?.()
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {label}
      </span>
      {sortedAvailable.map((rarity) => {
        const config = getRarityConfig(rarity)
        const isActive =
          normalizedSelected.length === 0 || normalizedSelected.includes(rarity)
        const count = counts?.[rarity]

        return (
          <button
            key={rarity}
            type="button"
            onClick={() => toggleRarity(rarity)}
            className={`rarity-pill ${pillSizeClasses} ${isActive ? 'is-active' : ''}`.trim()}
            aria-pressed={isActive}
            data-rarity={rarity}
            style={
              {
                borderColor: config.color,
                color: isActive ? config.color : undefined,
                '--rarity-pill-color': config.color
              } as CSSProperties
            }
          >
            <span className="font-semibold">{config.prefix}</span>
            <span className="hidden sm:inline ml-1">{rarity}</span>
            {typeof count === 'number' && (
              <span className="ml-2 text-[var(--text-tertiary)]">{count}</span>
            )}
          </button>
        )
      })}
      {!arrayEquals(normalizedSelected, normalizedDefault) &&
        normalizedDefault.length > 0 && (
          <button
            type="button"
            onClick={handleReset}
            className={`rarity-pill reset ${pillSizeClasses}`}
            aria-label="Reset rarity filters"
          >
            Reset
          </button>
        )}
      {normalizedSelected.length === 0 && normalizedDefault.length > 0 && (
        <span className="text-[var(--text-tertiary)] text-xs italic">
          Showing defaults
        </span>
      )}
    </div>
  )
}
