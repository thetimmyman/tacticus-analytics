'use client'

import { useMemo } from 'react'
import { Crown, Trophy } from 'lucide-react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { BossRecommendation } from '../types'
import { ConfidenceChip } from './ConfidenceChip'
import { resolveHeroMapping, type HeroMapping } from '../utils/hero-mapping'

type HeroMappings = Map<string, HeroMapping>

export function TeamCard({
  rec,
  rank,
  heroMappings
}: {
  rec: BossRecommendation
  rank: number
  heroMappings: HeroMappings
}) {
  const { heroes, mow } = useMemo(() => {
    const parts = rec.team_composition.split(' + ')
    const heroesPart = parts[0] || ''
    const mowPart = parts[1]?.trim() || null
    return {
      heroes: heroesPart
        .split(', ')
        .map((h) => h.trim())
        .filter(Boolean),
      mow: mowPart
    }
  }, [rec.team_composition])

  const getRankStyle = (r: number) => {
    if (r === 1)
      return 'from-yellow-500/30 to-yellow-600/10 border-yellow-500/50'
    if (r === 2) return 'from-gray-400/20 to-gray-500/10 border-gray-400/40'
    if (r === 3) return 'from-amber-600/20 to-amber-700/10 border-amber-600/40'
    return 'from-(--card-bg) to-(--card-bg) border-(--card-border)'
  }

  const getRankIcon = (r: number) => {
    if (r === 1) return <Crown className="w-5 h-5 text-yellow-400" />
    if (r === 2) return <Trophy className="w-4 h-4 text-secondary-wh40k" />
    if (r === 3) return <Trophy className="w-4 h-4 text-amber-600" />
    return <span className="text-sm text-secondary-wh40k font-mono">#{r}</span>
  }

  return (
    <div
      className={`
      relative overflow-hidden rounded-lg border px-3 py-2
      bg-linear-to-br ${getRankStyle(rank)}
      hover:shadow-lg transition-all duration-300
    `}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {getRankIcon(rank)}
        <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
          {heroes.map((hero) => {
            const mapping = resolveHeroMapping(hero, heroMappings)
            const displayName = mapping?.display_name || hero
            const heroKey = mapping?.unit_id || hero
            return (
              <div key={`hero-${heroKey}`} className="relative group">
                {mapping?.web_icon_url ? (
                  <img
                    src={mapping.web_icon_url}
                    alt={displayName}
                    title={displayName}
                    className="w-7 h-7 rounded-md border border-white/10"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded-md bg-gray-700 flex items-center justify-center text-[9px] font-bold text-secondary-wh40k"
                    title={hero}
                  >
                    {hero.slice(0, 2)}
                  </div>
                )}
              </div>
            )
          })}
          {mow && (
            <>
              <span className="text-secondary-wh40k text-xs">+</span>
              {(() => {
                const mapping = resolveHeroMapping(mow, heroMappings)
                const displayName = mapping?.display_name || mow
                return mapping?.web_icon_url ? (
                  <img
                    src={mapping.web_icon_url}
                    alt={displayName}
                    title={displayName}
                    className="w-7 h-7 rounded-md border border-white/10"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="w-7 h-7 rounded-md bg-gray-700 flex items-center justify-center text-[9px] font-bold text-secondary-wh40k"
                    title={mow}
                  >
                    {mow.slice(0, 2)}
                  </div>
                )
              })()}
            </>
          )}
        </div>
        {rec.meta_team && (
          <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-purple-500/20 text-purple-400 font-medium shrink-0">
            {rec.meta_team}
          </span>
        )}
        <ConfidenceChip attackCount={rec.attack_count} />
      </div>

      <div className="flex items-baseline gap-3 text-xs">
        <div>
          <span className="text-secondary-wh40k">P90 </span>
          <span className="font-bold text-white">
            {formatNumber(Math.round(rec.damage_p90))}
          </span>
        </div>
        <div>
          <span className="text-secondary-wh40k">Avg </span>
          <span className="text-primary-wh40k">
            {formatNumber(Math.round(rec.damage_avg))}
          </span>
        </div>
        <div>
          <span className="text-secondary-wh40k">P75 </span>
          <span className="text-blue-400">
            {formatNumber(Math.round(rec.damage_p75))}
          </span>
        </div>
        <div>
          <span className="text-secondary-wh40k">Max </span>
          <span className="text-yellow-400">
            {formatNumber(rec.damage_max)}
          </span>
        </div>
      </div>
    </div>
  )
}
