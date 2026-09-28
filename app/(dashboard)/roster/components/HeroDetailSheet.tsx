'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { StarDisplay } from '@/app/components/StarDisplay'
import { FactionIcon } from './FactionIcon'
import { AllianceIcon } from './AllianceIcon'
import { RankIcon } from './RankIcon'
import { getRankName, getRarityBorderColor } from '../utils/roster-helpers'
import {
  getFrameUrl,
  getPortraitUrl,
  TILE_ASPECT_RATIO
} from '../utils/tile-art'
import type { ProcessedRosterUnit } from '../_lib/process-units'

interface HeroDetailSheetProps {
  unit: ProcessedRosterUnit | null
  onClose: () => void
}

/** Tile detail: bottom sheet on mobile, card on sm+; shows data hover cannot on touch. */
export function HeroDetailSheet({ unit, onClose }: HeroDetailSheetProps) {
  useEffect(() => {
    if (!unit) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [unit, onClose])

  if (!unit) return null

  const portraitUrl = getPortraitUrl(unit.id)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${unit.name} details`}
    >
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close details"
        tabIndex={-1}
      />
      <div className="card-wh40k relative w-full rounded-b-none rounded-t-xl p-4 sm:w-96 sm:rounded-lg">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-sm p-1 text-secondary-wh40k hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] hover:text-primary-wh40k"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-start gap-4">
          {/* Framed art; falls back to the bordered icon when no portrait exists. */}
          {portraitUrl ? (
            <div
              className="relative w-24 shrink-0"
              style={{ aspectRatio: TILE_ASPECT_RATIO }}
            >
              <div
                className="absolute overflow-hidden bg-(--bg-secondary)"
                style={{ inset: '3.2% 3.7%' }}
              >
                <img
                  src={portraitUrl}
                  alt={unit.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <img
                src={getFrameUrl(unit.rarity)}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full select-none"
              />
            </div>
          ) : (
            <div
              className={`relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border-2 bg-(--bg-secondary) ${getRarityBorderColor(unit.rarity)}`}
            >
              {unit.iconUrl ? (
                <img
                  src={unit.iconUrl}
                  alt={unit.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xl font-semibold text-secondary-wh40k">
                  {unit.name.slice(0, 2)}
                </div>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate pr-6 text-lg font-semibold text-primary-wh40k">
              {unit.name}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <FactionIcon faction={unit.faction} size="sm" />
              <AllianceIcon alliance={unit.grandAlliance} size="sm" />
            </div>
            <div className="mt-2">
              <StarDisplay progressionIndex={unit.progressionIndex} size="sm" />
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <RankIcon rank={unit.rank} size="sm" />
            <span className="text-primary-wh40k">{getRankName(unit.rank)}</span>
          </div>
          <div>
            <span className="text-secondary-wh40k">Level </span>
            <span className="text-primary-wh40k">{unit.xpLevel}</span>
          </div>
          <div>
            <span className={`font-medium ${unit.rarityColor}`}>
              {unit.rarity}
            </span>
          </div>
          <div>
            <span className="text-secondary-wh40k">Shards </span>
            <span className="text-primary-wh40k">{unit.shards}</span>
            {unit.mythicShards ? (
              <span className="ml-1 text-red-400">+{unit.mythicShards}</span>
            ) : null}
          </div>
          <div className="col-span-2">
            <span className="text-secondary-wh40k">Abilities </span>
            <span className="text-primary-wh40k">
              {(unit.abilities ?? []).map((a) => a.level).join(' / ') || '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
