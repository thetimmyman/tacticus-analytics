'use client'

import { useMemo, useState } from 'react'
import { ClientDate } from '@tacticus/ui-kit'
import { formatNumber } from '@tacticus/app-core/formatters'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { BossLink } from '@/app/components/ui/BossLink'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import { getBossDisplayName } from '@/app/lib/utils/bossNames'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import type { HeroMapping } from '@/app/lib/utils/battle-log-helpers'
import { stableBossPlayerId } from '../../lib/boss-player-aggregates'
import { BossLeaderboardTeam } from './BossLeaderboardTeam'
import {
  getLevelDisplay,
  type BossLeaderboardEntry,
  type BossLeaderboardTableRow,
  type BossSummary,
  type RankBy
} from './model'

interface BossLeaderboardResultsProps {
  activeLevel: string
  selectedBoss: BossSummary | null
  rankBy: RankBy
  onRankByChange: (rankBy: RankBy) => void
  loading: boolean
  entries: BossLeaderboardEntry[]
  heroMappings: Map<string, HeroMapping>
  guildLabels: Record<string, string>
  userGuild: string
}

export function BossLeaderboardResults({
  activeLevel,
  selectedBoss,
  rankBy,
  onRankByChange,
  loading,
  entries,
  heroMappings,
  guildLabels,
  userGuild
}: BossLeaderboardResultsProps) {
  const desktopRows = useMemo<BossLeaderboardTableRow[]>(
    () => entries.map((entry, index) => ({ ...entry, rank: index + 1 })),
    [entries]
  )

  const getGuildColor = (guild: string) =>
    guild === userGuild ? 'text-(--primary)' : 'text-primary-wh40k'

  const renderGuild = (guild: string) =>
    guildLabels[guild] ?? formatGuildDisplayLabel(null, guild)

  const [particleStyles] = useState(() => ({
    mythic: Array.from({ length: 15 }).map(() => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 7}s`,
      width: `${3 + Math.random() * 3}px`,
      height: `${3 + Math.random() * 3}px`
    })),
    legendary: Array.from({ length: 15 }).map(() => ({
      left: `${Math.random() * 100}%`,
      animationDelay: `${Math.random() * 8}s`,
      width: `${2 + Math.random() * 2}px`,
      height: `${2 + Math.random() * 2}px`
    }))
  }))

  const desktopColumns: DataTableColumn<BossLeaderboardTableRow>[] = [
    {
      key: 'rank',
      header: '#',
      sortable: false,
      render: (entry) => entry.rank
    },
    {
      key: 'player',
      header: 'Player',
      sortable: false,
      render: (entry) => (
        <span className={`font-medium ${getGuildColor(entry.Guild)}`}>
          <PlayerLink
            playerName={entry.displayName}
            className={getGuildColor(entry.Guild)}
          >
            {entry.displayName}
          </PlayerLink>
        </span>
      )
    },
    {
      key: 'guild',
      header: 'Guild',
      sortable: false,
      render: (entry) => renderGuild(entry.Guild)
    },
    {
      key: 'maxDamage',
      header: 'Max Damage',
      sortable: false,
      render: (entry) => (
        <span
          className={
            rankBy === 'max'
              ? 'text-(--primary) font-bold'
              : 'text-primary-wh40k'
          }
        >
          {formatNumber(entry.damageDealt)}
        </span>
      )
    },
    {
      key: 'avgDamage',
      header: 'Avg Damage',
      sortable: false,
      render: (entry) => (
        <div
          className={
            rankBy === 'avg'
              ? 'text-(--primary) font-bold'
              : 'text-primary-wh40k'
          }
        >
          {entry.avgDamage !== undefined ? (
            <>
              {formatNumber(Math.round(entry.avgDamage))}
              <div className="text-xs font-normal text-secondary-wh40k">
                {entry.avgBattleCount ?? 0} battles
              </div>
            </>
          ) : (
            '—'
          )}
        </div>
      )
    },
    {
      key: 'category',
      header: 'Category',
      sortable: false,
      render: (entry) =>
        entry.categories && entry.categories.length > 0 ? (
          <MultipleCategoryBadges categories={entry.categories} />
        ) : null
    },
    {
      key: 'team',
      header: 'Team',
      sortable: false,
      render: (entry) => (
        <BossLeaderboardTeam
          entry={entry}
          heroMappings={heroMappings}
          variant="desktop"
        />
      )
    },
    {
      key: 'level',
      header: 'Level',
      sortable: false,
      render: (entry) => getLevelDisplay(entry.set, entry.rarity)
    },
    {
      key: 'loop',
      header: 'Loop',
      sortable: false,
      render: (entry) => (entry.loopIndex >= 0 ? entry.loopIndex : '—')
    },
    {
      key: 'date',
      header: 'Date',
      sortable: false,
      render: (entry) =>
        entry.completedOn ? (
          <ClientDate date={entry.completedOn} format="date" />
        ) : (
          '—'
        )
    }
  ]

  const isMythic = activeLevel.startsWith('M')

  return (
    <div
      className={`rounded-lg overflow-hidden relative ${
        isMythic ? 'mythic-section' : 'diamond-section'
      }`}
    >
      {isMythic
        ? particleStyles.mythic.map((style) => (
            <div
              key={`mythic-particle-${style.left}-${style.animationDelay}`}
              className="mythic-particle"
              style={style}
            />
          ))
        : particleStyles.legendary.map((style) => (
            <div
              key={`diamond-particle-${style.left}-${style.animationDelay}`}
              className="diamond-particle"
              style={style}
            />
          ))}

      <div className="relative z-10">
        <div className="p-4 border-b border-(--card-border) flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3
            className={`text-xl font-bold ${
              isMythic ? 'mythic-title' : 'diamond-title'
            }`}
          >
            {rankBy === 'avg'
              ? 'Top 20 Average Damage'
              : 'Top 20 Damage Dealers'}
            {selectedBoss && (
              <>
                {' - '}
                <BossLink
                  bossName={selectedBoss.Name}
                  className={
                    isMythic
                      ? 'text-(--accent) hover:text-orange-300'
                      : 'text-(--accent) hover:text-cyan-300'
                  }
                >
                  {getBossDisplayName(selectedBoss.Name)}
                </BossLink>
              </>
            )}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-secondary-wh40k">Rank by:</span>
            <div className="flex rounded-lg border border-(--card-border) overflow-hidden">
              {(
                [
                  { value: 'max', label: 'Max Damage' },
                  { value: 'avg', label: 'Avg Damage' }
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  onClick={() => onRankByChange(option.value)}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    rankBy === option.value
                      ? 'bg-primary-wh40k text-black font-semibold'
                      : 'bg-(--card-bg) text-primary-wh40k hover:bg-card/80'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-4 sm:p-6 md:p-8">
            <div className="space-y-3">
              {[
                'skeleton-1',
                'skeleton-2',
                'skeleton-3',
                'skeleton-4',
                'skeleton-5'
              ].map((skeletonId) => (
                <div key={skeletonId} className="animate-pulse">
                  <div className="h-16 bg-card/50 rounded-lg"></div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="lg:hidden space-y-3 p-3 sm:p-4">
              {entries.map((entry, index) => (
                <div
                  key={`entry-${stableBossPlayerId(entry)}-${entry.damageDealt}-${entry.completedOn}`}
                  className="bg-(--background) border border-(--card-border) rounded-lg p-3 sm:p-4 space-y-2 sm:space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg font-bold text-(--primary)">
                          #{index + 1}
                        </span>
                        <PlayerLink
                          playerName={entry.displayName}
                          className={`font-medium text-lg ${getGuildColor(entry.Guild)}`}
                        >
                          {entry.displayName}
                        </PlayerLink>
                      </div>
                      <div className="text-sm text-secondary-wh40k">
                        {renderGuild(entry.Guild)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-(--primary) font-bold text-lg">
                        {formatNumber(
                          rankBy === 'avg'
                            ? Math.round(entry.avgDamage ?? 0)
                            : entry.damageDealt
                        )}
                      </div>
                      <div className="text-xs text-secondary-wh40k">
                        {rankBy === 'avg'
                          ? `${entry.avgBattleCount ?? 0} battles · max ${formatNumber(entry.damageDealt)}`
                          : entry.avgDamage !== undefined
                            ? `avg ${formatNumber(Math.round(entry.avgDamage))}`
                            : ''}
                      </div>
                      {entry.completedOn && (
                        <div className="text-xs text-secondary-wh40k">
                          <ClientDate date={entry.completedOn} format="date" />
                        </div>
                      )}
                    </div>
                  </div>

                  {entry.categories && entry.categories.length > 0 && (
                    <div className="pt-2 border-t border-(--card-border)">
                      <div className="text-xs text-secondary-wh40k mb-1">
                        Meta Team:
                      </div>
                      <MultipleCategoryBadges categories={entry.categories} />
                    </div>
                  )}

                  <BossLeaderboardTeam
                    entry={entry}
                    heroMappings={heroMappings}
                    variant="mobile"
                  />

                  <div className="flex justify-between text-sm text-secondary-wh40k">
                    <span>
                      Level: {getLevelDisplay(entry.set, entry.rarity)}
                    </span>
                    {entry.loopIndex >= 0 && (
                      <span>Loop: {entry.loopIndex}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <DataTable
              className="hidden lg:block"
              rows={desktopRows}
              columns={desktopColumns}
              rowKey={(entry) =>
                `row-${stableBossPlayerId(entry)}-${entry.damageDealt}-${entry.completedOn}`
              }
              empty={<></>}
            />
          </>
        )}
      </div>
    </div>
  )
}
