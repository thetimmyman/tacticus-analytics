'use client'

import type { Dispatch, SetStateAction } from 'react'
import { Shield } from 'lucide-react'
import { formatDamage } from '@tacticus/app-core/formatters'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import SeasonSelector from '@/app/components/SeasonSelector'

interface CommandCenterHeaderProps {
  selectedSeason: string
  totalDamage: number
  availableRarities: Rarity[]
  selectedRarities: Rarity[]
  setSelectedRarities: Dispatch<SetStateAction<Rarity[]>>
}

export function CommandCenterHeader({
  selectedSeason,
  totalDamage,
  availableRarities,
  selectedRarities,
  setSelectedRarities
}: CommandCenterHeaderProps) {
  return (
    <>
      {/* Command Center Header with Season Selector */}
      <div className="card-wh40k p-3 sm:p-4 glow-primary relative hover:shadow-xl hover:shadow-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300">
        <Shield
          className="heraldry-display hidden h-12 w-12 text-(--accent) sm:block"
          aria-hidden="true"
        />
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="heading-wh40k text-lg sm:text-2xl text-glow-accent">
              Command Center
            </h1>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-4">
              <div>
                <div className="stat-label-wh40k">Total Damage</div>
                <div className="stat-value-wh40k">
                  {formatDamage(totalDamage, 2)}
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 relative z-20">
              <SeasonSelector currentSeason={selectedSeason} />
              <RarityFilterControls
                availableRarities={availableRarities}
                selectedRarities={selectedRarities}
                defaultRarities={['Legendary', 'Mythic']}
                onChange={setSelectedRarities}
                compact={true}
                className="shrink-0"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
