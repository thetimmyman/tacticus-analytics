'use client'

import { Target } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { formatDamageWithPrivacy } from '@tacticus/app-core/explore-privacy'
import { getRarityConfig } from '@tacticus/app-core/rarity-utils'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { BossLevelBadge } from '@/app/components/ui/BossLevelWrapper'
import { generateParticles } from '../utils'
import type { BossHit } from '../types'

export function PrimaryTargetView({ bossHits }: { bossHits: BossHit[] }) {
  const topHits = bossHits
    .filter((hit) => hit.damage > 0)
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 3)

  if (topHits.length === 0) return null

  return (
    <div>
      <h4 className="text-sm font-semibold text-secondary-wh40k mb-3 flex items-center gap-2">
        <Target className="w-4 h-4 text-orange-400" />
        Primary Targets
      </h4>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {topHits.map((hit, index) => {
          const rarityConfig = getRarityConfig(hit.rarity)
          const level = `${rarityConfig.prefix}${hit.set + 1}`
          const title = index === 0 ? 'Primary Target' : `Prime ${index}`

          return (
            <div
              key={`primary-${hit.boss}-${hit.encounterId}`}
              className={`${rarityConfig.cssClass} relative overflow-hidden rounded-lg border border-card-border/60 p-3 transition-all`}
            >
              {/* Particles */}
              {generateParticles(hit.rarity)}

              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <BossPortrait
                    bossName={hit.boss}
                    size="small"
                    variant="portrait"
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono text-xs uppercase tracking-wider text-[#888]">
                        {title}
                      </span>
                      <BossLevelBadge level={level} className="text-xs" />
                    </div>
                    <h4 className="text-sm font-bold text-primary-wh40k truncate">
                      {hit.boss}
                    </h4>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span className="text-secondary-wh40k truncate">
                        {hit.player}
                      </span>
                      <span className="text-(--accent) font-mono">
                        {hit.isObfuscated
                          ? formatDamageWithPrivacy(
                              hit.damage,
                              'obfuscate_values',
                              hit.originalDamage,
                              hit.obfuscationPercent
                            )
                          : formatNumber(hit.damage)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
