'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import { formatNumber, formatPercentage } from '@tacticus/app-core/formatters'
import { BossLink } from '@/app/components/ui/BossLink'
import { BarChart3, Users, Crown, Shield, Zap } from 'lucide-react'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'
import MultipleCategoryBadges from '@/app/components/MultipleCategoryBadges'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import { useGuildLeaderboardContext } from '@/app/(dashboard)/leaderboards/hooks/useGuildLeaderboardContext'
import {
  RadixTabs,
  RadixTabsList,
  RadixTabsTrigger
} from '@tacticus/ui-kit/radix-tabs'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'

interface MyGuildTabProps {
  guildCode: string
}

interface TeamCompositionDetails {
  heroDetails: string | null
  machineOfWarDetails: string | null
}

export interface MetaAnalysisEntry {
  bossName: string
  encounterIndex: number
  teamComposition: TeamCompositionDetails | null
  avgDamage: number
  maxDamage: number
  battleCount: number
  winRate: number
  // Raw coefficient of variation (rendered as 100 − CV); not Meta Atlas's global stability metric.
  consistency: number
  categories: string[]
}

// RETURNS TABLE columns arrive lowercase; teamcomposition's inner jsonb keys stay camelCase.
interface RawMetaAnalysisEntry {
  bossname?: string
  encounterindex?: number
  teamcomposition?: {
    heroDetails?: string | null
    machineOfWarDetails?: string | null
  } | null
  avgdamage?: number
  maxdamage?: number
  battlecount?: number
  winrate?: number
  consistency?: number
  categories?: string[]
}

export function normalizeMetaAnalysisRows(
  metaData: unknown
): MetaAnalysisEntry[] {
  return ((metaData ?? []) as unknown as RawMetaAnalysisEntry[]).map(
    (entry) => {
      const teamComp = entry.teamcomposition
      return {
        bossName: entry.bossname || 'Unknown Boss',
        encounterIndex: entry.encounterindex ?? 0,
        teamComposition: teamComp
          ? {
              heroDetails: teamComp.heroDetails ?? null,
              machineOfWarDetails: teamComp.machineOfWarDetails ?? null
            }
          : null,
        avgDamage: entry.avgdamage ?? 0,
        maxDamage: entry.maxdamage ?? 0,
        battleCount: entry.battlecount ?? 0,
        winRate: entry.winrate ?? 0,
        consistency: entry.consistency ?? 0,
        categories: entry.categories ?? []
      }
    }
  )
}

export async function fetchGuildMetaAnalysis(
  guildCode: string,
  season: string,
  selectedBoss: string
) {
  // User-JWT `dbClient()` required: the RPC gates on `auth.uid()`, which service-role would null.
  const supabase = dbClient()

  const { data: metaData, error: metaError } = await supabase.rpc(
    'get_guild_meta_analysis',
    {
      p_guild_code: guildCode,
      p_season: season,
      p_boss_name: selectedBoss === 'all' ? undefined : selectedBoss
    }
  )

  if (metaError)
    throw new Error(`Failed to get meta analysis: ${metaError.message}`)

  const normalizedData = normalizeMetaAnalysisRows(metaData)
  const uniqueBosses = [...new Set(normalizedData.map((item) => item.bossName))]

  return {
    data: normalizedData,
    availableBosses: uniqueBosses
  }
}

export default function MyGuildTab({ guildCode }: MyGuildTabProps) {
  const [selectedBoss, setSelectedBoss] = useState<string>('all')

  const {
    data: leaderboardContext,
    isLoading: contextLoading,
    error: contextError
  } = useGuildLeaderboardContext(guildCode)
  const contextSeason = leaderboardContext?.season

  const hasGuild = !!guildCode

  const allBossesQuery = useQuery({
    queryKey: ['myGuildMetaAnalysis', guildCode, contextSeason, 'all'],
    queryFn: () =>
      fetchGuildMetaAnalysis(guildCode, leaderboardContext!.season, 'all'),
    enabled: hasGuild && !!contextSeason,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
  const filteredBossQuery = useQuery({
    queryKey: ['myGuildMetaAnalysis', guildCode, contextSeason, selectedBoss],
    queryFn: () =>
      fetchGuildMetaAnalysis(
        guildCode,
        leaderboardContext!.season,
        selectedBoss
      ),
    enabled: hasGuild && !!contextSeason && selectedBoss !== 'all',
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const activeQuery =
    selectedBoss === 'all' ? allBossesQuery : filteredBossQuery
  const queryResult = activeQuery.data
  const data = queryResult?.data ?? []
  const season = leaderboardContext?.season ?? ''
  const guildDisplayName = leaderboardContext?.guildDisplayName ?? ''
  const availableBosses = allBossesQuery.data?.availableBosses ?? []
  const isLoading =
    hasGuild &&
    (contextLoading ||
      allBossesQuery.isLoading ||
      (selectedBoss !== 'all' && filteredBossQuery.isLoading))
  const displayError =
    contextError ??
    allBossesQuery.error ??
    (selectedBoss !== 'all' ? filteredBossQuery.error : null)

  const filteredData =
    selectedBoss === 'all'
      ? data
      : data.filter((item) => item.bossName === selectedBoss)

  const groupedData = filteredData.reduce<Record<string, MetaAnalysisEntry[]>>(
    (acc, item) => {
      const key = `${item.bossName}-${item.encounterIndex}`
      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(item)
      return acc
    },
    {} as Record<string, MetaAnalysisEntry[]>
  )

  const getPerformanceColor = (
    value: number,
    type: 'winRate' | 'consistency'
  ) => {
    if (type === 'winRate') {
      if (value >= 80) return 'text-green-400'
      if (value >= 60) return 'text-yellow-400'
      return 'text-red-400'
    } else {
      // Lower std-dev ratio is better.
      if (value <= 20) return 'text-green-400'
      if (value <= 40) return 'text-yellow-400'
      return 'text-red-400'
    }
  }

  if (!hasGuild) {
    return (
      <div className="text-center py-8">
        <Users className="w-12 h-12 text-[var(--text-secondary)] mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
          No Guild Linked
        </h3>
        <p className="text-[var(--text-secondary)]">
          Join a guild to see your guild&apos;s meta.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <LoadingSpinner
          message="Analyzing meta team compositions..."
          variant="sacred"
          size="lg"
          showBinary={true}
        />
      </div>
    )
  }

  if (displayError) {
    // A stale profile guild_code trips the RPC gate; show friendly copy, not "Access denied".
    const rawMessage =
      displayError instanceof Error
        ? displayError.message
        : 'Failed to load meta analysis data'
    const isAccessDenied = rawMessage.includes('Access denied')
    return (
      <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-4">
        <p className="text-red-400">
          {isAccessDenied
            ? "You're not a current member of this guild, so its meta data isn't available to you."
            : rawMessage}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Summary line; Meta Atlas owns the <h1>. */}
      <div className="flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-purple-400" />
        <span className="text-[var(--text-primary)] font-semibold">
          {guildDisplayName || 'Your Guild'}
        </span>
        <span className="text-[var(--text-secondary)] flex items-center gap-2">
          <Users className="w-4 h-4" />
          Season {season} • {data.length} Team Compositions
        </span>
      </div>

      {/* Boss Tabs */}
      {availableBosses.length > 0 && (
        <RadixTabs
          value={selectedBoss}
          onValueChange={setSelectedBoss}
          className="w-full"
        >
          <RadixTabsList className="bg-[var(--bg-secondary)] p-1 rounded-lg w-full justify-start overflow-x-auto">
            <RadixTabsTrigger value="all" className="whitespace-nowrap">
              All Bosses
            </RadixTabsTrigger>
            {availableBosses.map((boss) => (
              <RadixTabsTrigger
                key={boss}
                value={boss}
                className="whitespace-nowrap"
              >
                {getBossDisplayName(boss)}
              </RadixTabsTrigger>
            ))}
          </RadixTabsList>

          <div className="mt-6">
            {/* Meta Analysis Content */}
            {Object.entries(groupedData).map(([key, entries]) => {
              const [bossNameRaw, encounterIndexStrRaw] = key.split('-')
              const bossName = bossNameRaw ?? 'Unknown Boss'
              const encounterIndex = parseInt(encounterIndexStrRaw ?? '0', 10)
              const isPrime = encounterIndex > 0

              return (
                <div key={key} className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <BossLink bossName={bossName}>
                      {getBossDisplayName(bossName)}
                    </BossLink>
                    {isPrime && <Crown className="w-4 h-4 text-yellow-400" />}
                    <span className="text-[var(--text-secondary)]">
                      ({entries.length} team variations)
                    </span>
                  </div>

                  <div className="grid gap-4">
                    {entries
                      .sort((a, b) => b.avgDamage - a.avgDamage)
                      .map((entry, entryIndex) => {
                        const teamKey =
                          entry.teamComposition?.heroDetails ?? 'no-heroes'
                        const mowKey =
                          entry.teamComposition?.machineOfWarDetails ?? 'no-mow'
                        const uniqueKey = `${entry.bossName}-${entry.encounterIndex}-${teamKey}-${mowKey}-${entry.avgDamage}`

                        return (
                          <div
                            key={uniqueKey}
                            className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[var(--card-border)] p-4 space-y-3"
                          >
                            {/* Header: rank + category badges */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)]">
                                #{entryIndex + 1} Team Composition
                              </span>
                              {entry.categories &&
                                entry.categories.length > 0 && (
                                  <MultipleCategoryBadges
                                    categories={entry.categories}
                                  />
                                )}
                            </div>

                            {/* Team icons — sized to match battle-log team displays */}
                            {entry.teamComposition && (
                              <TeamCompositionDisplay
                                heroDetails={entry.teamComposition.heroDetails}
                                machineOfWarDetails={
                                  entry.teamComposition.machineOfWarDetails
                                }
                                iconSize={40}
                                className="flex-wrap"
                              />
                            )}

                            {/* Metrics strip fills the card width. */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                              <div className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                                  <Zap className="w-3 h-3 text-yellow-400" />
                                  Avg Damage
                                </div>
                                <div className="text-sm font-semibold text-[var(--accent)] tabular-nums">
                                  {formatNumber(Math.round(entry.avgDamage))}
                                </div>
                              </div>
                              <div className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                                  Max Damage
                                </div>
                                <div className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                                  {formatNumber(entry.maxDamage)}
                                </div>
                              </div>
                              <div className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                                  Battles
                                </div>
                                <div className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
                                  {formatNumber(entry.battleCount)}
                                </div>
                              </div>
                              <div className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                                  <Shield className="w-3 h-3 text-blue-400" />
                                  Win Rate
                                </div>
                                <div
                                  className={`text-sm font-semibold tabular-nums ${getPerformanceColor(entry.winRate, 'winRate')}`}
                                >
                                  {formatPercentage(entry.winRate / 100)}
                                </div>
                              </div>
                              <div className="rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                                <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                                  Consistency
                                </div>
                                <div
                                  className={`text-sm font-semibold tabular-nums ${getPerformanceColor(entry.consistency, 'consistency')}`}
                                >
                                  {formatPercentage(
                                    (100 - entry.consistency) / 100
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )
            })}
          </div>
        </RadixTabs>
      )}

      {data.length === 0 && (
        <div className="text-center py-8">
          <BarChart3 className="w-12 h-12 text-[var(--text-secondary)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            No Meta Analysis Data Available
          </h3>
          <p className="text-[var(--text-secondary)]">
            Not enough battle data found for {guildDisplayName || 'your guild'}{' '}
            in season {season} to generate meta analysis.
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-2">
            Meta analysis requires at least 3 battles per team composition.
          </p>
        </div>
      )}
    </div>
  )
}
