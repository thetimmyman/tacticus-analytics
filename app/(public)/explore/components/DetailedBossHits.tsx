'use client'

import { Sword } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { formatDamageWithPrivacy } from '@tacticus/app-core/explore-privacy'
import {
  getTopRaritiesWithData,
  getRarityConfig,
  getRarityDisplayName,
  Rarity
} from '@tacticus/app-core/rarity-utils'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { generateParticles } from '../utils'
import type { BossHit } from '../types'

export function DetailedBossHits({
  bossHits,
  selectedRarities,
  defaultRarities,
  availableRarities
}: {
  bossHits: BossHit[]
  selectedRarities: Rarity[]
  defaultRarities: Rarity[]
  availableRarities: Rarity[]
}) {
  const desiredRarities = (
    selectedRarities.length > 0 ? selectedRarities : defaultRarities
  ).filter((rarity) => availableRarities.includes(rarity))
  const displayRarities =
    desiredRarities.length > 0
      ? desiredRarities
      : getTopRaritiesWithData(bossHits, 2)

  if (displayRarities.length === 0) return null

  const bossesByRarity = displayRarities.reduce(
    (acc, rarity) => {
      acc[rarity] = bossHits.filter(
        (hit) => hit.damage > 0 && hit.rarity === rarity
      )
      return acc
    },
    {} as Record<Rarity, BossHit[]>
  )

  return (
    <>
      <h4 className="text-sm font-semibold text-secondary-wh40k mb-2 flex items-center gap-2">
        <Sword className="w-4 h-4 text-orange-400" />
        {displayRarities
          .map((rarity) => getRarityDisplayName(rarity))
          .join(' / ')}
      </h4>

      {displayRarities.map((rarity) => {
        const bosses = bossesByRarity[rarity]
        if (!bosses || bosses.length === 0) return null

        const bossesBySet = bosses.reduce(
          (acc: Record<string, BossHit[]>, hit) => {
            const key = Number.isFinite(hit.set) ? hit.set.toString() : '0'
            if (!acc[key]) acc[key] = []
            acc[key].push(hit)
            return acc
          },
          {} as Record<string, BossHit[]>
        )

        const rarityConfig = getRarityConfig(rarity)

        return (
          <div key={rarity} className="mb-4">
            <div className="text-xs font-semibold text-secondary-wh40k mb-2">
              {rarity} Boss Hits
            </div>
            {Object.entries(bossesBySet)
              .sort(([setA], [setB]) => Number(setB) - Number(setA))
              .map(([set, hits]) => {
                const hitsByBoss = (hits as BossHit[]).reduce(
                  (acc: Record<string, BossHit>, hit: BossHit) => {
                    const bossKey = hit.boss
                    if (!acc[bossKey] || hit.damage > acc[bossKey].damage) {
                      acc[bossKey] = hit
                    }
                    return acc
                  },
                  {} as Record<string, BossHit>
                )

                const uniqueBossHits = Object.values(hitsByBoss)
                const hitsByEncounter: Record<number, BossHit> = {}

                uniqueBossHits.forEach((hit: BossHit) => {
                  const encounterId = hit.encounterId ?? 0
                  if (encounterId >= 0 && encounterId <= 2) {
                    hitsByEncounter[encounterId] = hit
                  }
                })

                const encounterHits = [
                  hitsByEncounter[0] || null,
                  hitsByEncounter[1] || null,
                  hitsByEncounter[2] || null
                ]

                const getSectionClass = (rarity: Rarity) => {
                  switch (rarity) {
                    case 'Mythic':
                      return 'mythic-section'
                    case 'Legendary':
                      return 'legendary-section'
                    case 'Epic':
                      return 'epic-section'
                    case 'Rare':
                      return 'rare-section'
                    case 'Uncommon':
                      return 'uncommon-section'
                    case 'Common':
                      return 'common-section'
                    default:
                      return 'common-section'
                  }
                }

                return (
                  <div
                    key={`${rarity}-set-${set}`}
                    className={`${getSectionClass(rarity)} rounded-lg p-3 relative mb-2`}
                  >
                    {/* Enhanced Particles (30 per rarity) */}
                    {generateParticles(rarity)}

                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="boss-hit-card__label font-bold text-lg text-primary-wh40k">
                          {rarityConfig.prefix}
                          {Number(set) + 1}
                        </div>
                      </div>
                      <div className="boss-hit-card__grid grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {(['main', 'side-1', 'side-2'] as const).map(
                          (slotId, slotIndex) => {
                            const hit = encounterHits[slotIndex]
                            return (
                              <div
                                key={`${rarity}-${set}-encounter-${slotId}`}
                                className="boss-hit-card"
                                data-rarity={rarity.toLowerCase()}
                              >
                                {hit ? (
                                  <div className="boss-hit-card__body flex items-center gap-3 p-3">
                                    <BossPortrait
                                      bossName={hit.boss}
                                      size="medium"
                                      variant="icon"
                                      className="boss-hit-card__portrait shrink-0"
                                    />
                                    <div className="boss-hit-card__meta flex-1 min-w-0">
                                      <div className="boss-hit-card__boss text-sm font-semibold text-primary-wh40k truncate">
                                        {hit.boss}
                                      </div>
                                      <div className="boss-hit-card__player text-xs text-secondary-wh40k truncate">
                                        {hit.player}
                                      </div>
                                      <div className="boss-hit-card__damage text-sm font-bold text-(--accent)">
                                        {hit.isObfuscated
                                          ? formatDamageWithPrivacy(
                                              hit.damage,
                                              'obfuscate_values',
                                              hit.originalDamage,
                                              hit.obfuscationPercent
                                            )
                                          : formatNumber(hit.damage)}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="boss-hit-card__body flex items-center gap-3 p-3 opacity-50">
                                    <div className="boss-hit-card__portrait w-12 h-12 rounded-full bg-gray-500/20 flex items-center justify-center shrink-0">
                                      <span className="text-xs text-secondary-wh40k">
                                        ?
                                      </span>
                                    </div>
                                    <div className="boss-hit-card__meta flex-1 min-w-0">
                                      <div className="boss-hit-card__boss text-sm font-semibold text-secondary-wh40k truncate">
                                        {slotIndex === 0
                                          ? 'Main Boss'
                                          : `Side Boss ${slotIndex}`}
                                      </div>
                                      <div className="boss-hit-card__player text-xs text-secondary-wh40k truncate">
                                        --
                                      </div>
                                      <div className="boss-hit-card__damage text-sm font-bold text-secondary-wh40k">
                                        --
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          }
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        )
      })}
    </>
  )
}
