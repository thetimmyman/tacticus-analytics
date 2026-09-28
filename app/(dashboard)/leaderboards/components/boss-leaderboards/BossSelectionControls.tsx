'use client'

import {
  RadixTabs,
  RadixTabsList,
  RadixTabsTrigger
} from '@tacticus/ui-kit/radix-tabs'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { BossLevelBadge } from '@/app/components/ui/BossLevelWrapper'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import { getBossId, getEncounterDisplayName, type BossSummary } from './model'

interface BossSelectionControlsProps {
  contextLabel: string
  season: string
  bossCount: number
  availableRarities: Rarity[]
  selectedRarities: Rarity[]
  defaultRarities: Rarity[]
  rarityCounts: Partial<Record<Rarity, number>>
  onRaritiesChange: (rarities: Rarity[]) => void
  onRaritiesReset: () => void
  levels: string[]
  activeLevel: string
  bossesByLevel: Record<string, BossSummary[]>
  selectedBossId: string
  onBossSelect: (bossId: string) => void
}

export function BossSelectionControls({
  contextLabel,
  season,
  bossCount,
  availableRarities,
  selectedRarities,
  defaultRarities,
  rarityCounts,
  onRaritiesChange,
  onRaritiesReset,
  levels,
  activeLevel,
  bossesByLevel,
  selectedBossId,
  onBossSelect
}: BossSelectionControlsProps) {
  const activeBosses = bossesByLevel[activeLevel] ?? []

  return (
    <>
      <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-3 sm:p-4 space-y-3 sm:space-y-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-primary-wh40k">
              Boss Leaderboards
            </h2>
            <p className="text-xs sm:text-sm text-secondary-wh40k mt-1">
              {contextLabel} | Season: {season} | Bosses Found: {bossCount}
            </p>
          </div>
        </div>
      </div>

      {availableRarities.length > 0 && (
        <div className="bg-(--card-bg) border border-(--card-border) rounded-lg p-3 sm:p-4 space-y-2 sm:space-y-3">
          <h3 className="text-xs sm:text-sm font-medium text-secondary-wh40k">
            Filters
          </h3>
          <RarityFilterControls
            availableRarities={availableRarities}
            selectedRarities={selectedRarities}
            defaultRarities={defaultRarities}
            onChange={onRaritiesChange}
            onReset={onRaritiesReset}
            counts={rarityCounts}
            hideIfSingle={false}
          />
        </div>
      )}

      {levels.length > 0 && activeLevel && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-secondary-wh40k">
            Select Boss Level:
          </h3>
          <RadixTabs
            value={activeLevel}
            onValueChange={(level) => {
              const firstBoss = bossesByLevel[level]?.[0]
              if (firstBoss) onBossSelect(getBossId(firstBoss))
            }}
          >
            <RadixTabsList className="grid w-full grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-10 gap-1 h-auto p-2 bg-[color-mix(in_srgb,var(--bg-tertiary)_50%,transparent)]">
              {levels.map((level) => {
                const isMythic = level.startsWith('M')
                return (
                  <RadixTabsTrigger
                    key={level}
                    value={level}
                    className={`
                      px-3 py-2 text-sm font-semibold min-h-11 relative overflow-hidden transition-all
                      bg-transparent! hover:bg-transparent! data-[state=active]:bg-transparent!
                      ${
                        isMythic
                          ? `text-orange-200 hover:text-orange-100
                         border border-transparent
                         hover:border-orange-600/40
                         data-[state=active]:bg-linear-to-br! data-[state=active]:from-[rgba(30,15,10,0.9)]! data-[state=active]:to-[rgba(40,20,15,0.8)]!
                         data-[state=active]:border-2 data-[state=active]:border-orange-500
                         data-[state=active]:shadow-[0_0_20px_rgba(255,140,0,0.5),inset_0_0_12px_rgba(255,195,0,0.2)]
                         data-[state=active]:text-orange-100!`
                          : `text-cyan-200 hover:text-cyan-100
                         border border-transparent
                         hover:border-cyan-600/40
                         data-[state=active]:bg-linear-to-br! data-[state=active]:from-[rgba(20,20,25,0.9)]! data-[state=active]:to-[rgba(30,30,35,0.8)]!
                         data-[state=active]:border-2 data-[state=active]:border-cyan-400
                         data-[state=active]:shadow-[0_0_20px_rgba(196,181,253,0.4),inset_0_0_10px_rgba(255,255,255,0.15)]
                         data-[state=active]:text-cyan-100!`
                      }
                    `}
                  >
                    <span className="relative z-10 font-bold tracking-wider">
                      {level}
                    </span>
                  </RadixTabsTrigger>
                )
              })}
            </RadixTabsList>
          </RadixTabs>
        </div>
      )}

      {activeLevel && activeBosses.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-secondary-wh40k">
            Select Boss:
          </h3>
          <div className="flex flex-wrap gap-2">
            {[...activeBosses]
              .sort((a, b) => {
                if (a.encounterId !== b.encounterId) {
                  return a.encounterId - b.encounterId
                }
                return a.Name.localeCompare(b.Name)
              })
              .map((boss) => {
                const bossId = getBossId(boss)
                return (
                  <button
                    key={bossId}
                    onClick={() => onBossSelect(bossId)}
                    className={`px-4 py-2 rounded-lg border transition-colors ${
                      selectedBossId === bossId
                        ? 'bg-primary-wh40k text-black border-primary-wh40k font-semibold'
                        : 'bg-(--card-bg) border-(--card-border) text-primary-wh40k hover:bg-card/80'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <BossLevelBadge level={activeLevel} />
                      {getEncounterDisplayName(boss.Name, boss.encounterId)}
                    </span>
                  </button>
                )
              })}
          </div>
        </div>
      )}
    </>
  )
}
