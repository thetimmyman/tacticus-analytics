'use client'

import type { ReactNode } from 'react'
import Image from 'next/image'
import type { RaidTeamHero } from '@/app/lib/constants/guild-raid-teams'
import {
  TIER_BG,
  TIER_COLORS,
  TIER_LABELS,
  type HeroMappingInfo,
  type SortField,
  type SortDirection
} from './guild-teams-shared'

interface GuildTeamsDesktopTableProps {
  herosByTier: { tier: string; heroes: RaidTeamHero[] }[]
  orderedHeroes: RaidTeamHero[]
  heroMappings: Record<string, HeroMappingInfo>
  sortField: SortField
  sortDirection: SortDirection
  sortHeroUnitId: string | null
  selectedHeroUnitIds: Set<string> | null
  handleHeroSort: (unitId: string) => void
  tableBody: ReactNode
}

export function GuildTeamsDesktopTable({
  herosByTier,
  orderedHeroes,
  heroMappings,
  sortField,
  sortDirection,
  sortHeroUnitId,
  selectedHeroUnitIds,
  handleHeroSort,
  tableBody
}: GuildTeamsDesktopTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-card-border/50">
      <table className="w-full border-collapse min-w-max">
        {/* Tier header row */}
        <thead>
          <tr className="bg-card/80">
            <th className="sticky left-0 z-20 bg-(--card-bg) px-3 py-1 text-left text-xs font-medium text-secondary-wh40k uppercase tracking-wider border-b border-card-border/50 min-w-[140px]">
              Player
            </th>
            {herosByTier.map((group) => (
              <th
                key={group.tier}
                colSpan={group.heroes.length}
                className={`px-2 py-1 text-center text-xs font-semibold uppercase tracking-wider border-b border-l ${TIER_COLORS[group.tier]} text-secondary-wh40k`}
              >
                {TIER_LABELS[group.tier]}
              </th>
            ))}
          </tr>

          {/* Hero header row — click to sort by hero */}
          <tr className="bg-card/60">
            <th className="sticky left-0 z-20 bg-(--card-bg) px-3 py-2 border-b border-card-border/50" />
            {orderedHeroes.map((hero, idx) => {
              const mapping = heroMappings[hero.unitId]
              const name = mapping?.display_name ?? hero.displayName
              const iconUrl = mapping?.web_icon_url
              const previousHero = orderedHeroes[idx - 1]
              const isFirstInTier =
                idx === 0 || previousHero?.tier !== hero.tier
              const isSortedByThis =
                sortField === 'hero' && sortHeroUnitId === hero.unitId
              const isExcluded =
                selectedHeroUnitIds !== null &&
                !selectedHeroUnitIds.has(hero.unitId)

              return (
                <th
                  key={hero.unitId}
                  onClick={() => handleHeroSort(hero.unitId)}
                  className={`px-1 py-2 text-center border-b border-card-border/50 min-w-[80px] cursor-pointer hover:bg-card/40 transition-colors ${isFirstInTier && idx > 0 ? 'border-l border-card-border/30' : ''} ${isSortedByThis ? 'bg-indigo-900/30' : (TIER_BG[hero.tier] ?? '')} ${isExcluded ? 'opacity-40' : ''}`}
                >
                  <div className="flex flex-col items-center gap-1">
                    {iconUrl ? (
                      <Image
                        src={iconUrl}
                        alt={name}
                        width={28}
                        height={28}
                        className="rounded-xs object-contain"
                        unoptimized
                      />
                    ) : (
                      <div className="w-7 h-7 bg-(--card-bg) rounded-xs flex items-center justify-center text-[10px] text-secondary-wh40k">
                        ?
                      </div>
                    )}
                    <span
                      className="text-[10px] text-secondary-wh40k leading-tight max-w-[75px] truncate"
                      title={`${name} \u2014 click to sort`}
                    >
                      {name}
                      {isSortedByThis && (
                        <span className="ml-0.5">
                          {sortDirection === 'asc' ? '\u2191' : '\u2193'}
                        </span>
                      )}
                    </span>
                  </div>
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>{tableBody}</tbody>
      </table>
    </div>
  )
}
