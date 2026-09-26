'use client'

import { useState, useEffect } from 'react'
import { dbClient } from '@/app/lib/db/client'
import { formatNumber } from '@tacticus/app-core/formatters'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { BossLink } from '@/app/components/ui/BossLink'
import { BossPortrait } from '@/app/components/ui/BossPortrait'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.boss.GuildSpecificBossLeaderboard'
)
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import { ArrowLeft, Target, Users, Crown, Sword } from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import TeamCompositionDisplay from '@/app/components/TeamCompositionDisplay'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { useGuildLeaderboardContext } from '../hooks/useGuildLeaderboardContext'
import {
  RadixTabs,
  RadixTabsList,
  RadixTabsTrigger
} from '@tacticus/ui-kit/radix-tabs'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'

interface GuildSpecificBossLeaderboardProps {
  guildCode: string
}

interface BossLeaderboardEntry {
  displayName: string
  Guild: string
  bossName: string
  encounterIndex: number
  maxDamage: number
  battleCount: number
  avgDamage: number
  heroDetails: string | null
  machineOfWarDetails: string | null
  categories: string[]
}

interface BossLeaderboardRow {
  entry: BossLeaderboardEntry
  index: number
}

interface RawBossLeaderboardEntry {
  displayName: string
  Guild: string
  bossName?: string | null
  bossname?: string | null
  encounterIndex: number
  maxDamage: number
  battleCount: number
  avgDamage: number
  heroDetails?: string | null
  machineOfWarDetails?: string | null
  categories: string[]
}

export default function GuildSpecificBossLeaderboard({
  guildCode
}: GuildSpecificBossLeaderboardProps) {
  const [data, setData] = useState<BossLeaderboardEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedBoss, setSelectedBoss] = useState<string>('all')
  const [availableBosses, setAvailableBosses] = useState<string[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const supabase = dbClient()
  const {
    data: leaderboardContext,
    isLoading: contextLoading,
    error: contextError
  } = useGuildLeaderboardContext(guildCode)
  const season = leaderboardContext?.season ?? ''
  const guildDisplayName =
    leaderboardContext?.guildDisplayName ??
    formatGuildDisplayLabel(null, guildCode)
  const expectedFetchKey = leaderboardContext?.season
    ? `${guildCode}::${leaderboardContext.season}::${selectedBoss}`
    : null

  useEffect(() => {
    let cancelled = false
    const fetchBossLeaderboard = async () => {
      if (!leaderboardContext?.season || !expectedFetchKey) return
      try {
        setLoading(true)
        setError(null)

        const { data: leaderboardData, error: leaderboardError } =
          await supabase.rpc('get_guild_boss_leaderboard', {
            p_guild_code: guildCode,
            p_season: leaderboardContext.season,
            p_boss_name: selectedBoss === 'all' ? undefined : selectedBoss
          })

        if (leaderboardError) {
          throw leaderboardError
        }

        const normalizedData: BossLeaderboardEntry[] = (
          (leaderboardData ?? []) as unknown as RawBossLeaderboardEntry[]
        ).map((entry) => ({
          displayName: entry.displayName,
          Guild: entry.Guild,
          bossName: entry.bossName || entry.bossname || 'Unknown Boss',
          encounterIndex: entry.encounterIndex,
          maxDamage: entry.maxDamage,
          battleCount: entry.battleCount,
          avgDamage: entry.avgDamage,
          heroDetails: entry.heroDetails ?? null,
          machineOfWarDetails: entry.machineOfWarDetails ?? null,
          categories: entry.categories
        }))

        if (cancelled) return
        setData(normalizedData)

        const uniqueBosses = [
          ...new Set(normalizedData.map((item) => item.bossName))
        ]
        if (selectedBoss === 'all') {
          setAvailableBosses(uniqueBosses)
        }
        setLoadedKey(expectedFetchKey)
      } catch (err) {
        if (cancelled) return
        logger.error({ err: err }, 'Error fetching guild boss leaderboard:')
        const enhancedError = createError(
          'BOSS_DATA_LOAD_FAILED',
          'Failed to load boss leaderboard data',
          {
            component: 'GuildSpecificBossLeaderboard',
            action: 'fetch_boss_leaderboard',
            guildCode
          },
          err
        )
        const userError = formatErrorForUser(enhancedError)
        setError(userError.displayMessage)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    if (guildCode) {
      fetchBossLeaderboard()
    }
    return () => {
      cancelled = true
    }
  }, [
    guildCode,
    leaderboardContext?.season,
    selectedBoss,
    supabase,
    expectedFetchKey
  ])

  const contextErrorMessage =
    contextError instanceof Error
      ? contextError.message
      : contextError
        ? 'Failed to load leaderboard context'
        : null
  const displayError = error ?? contextErrorMessage
  const leaderboardPending =
    Boolean(expectedFetchKey) && loadedKey !== expectedFetchKey

  const filteredData =
    selectedBoss === 'all'
      ? data
      : data.filter((item) => item.bossName === selectedBoss)

  const bossTableColumns: DataTableColumn<BossLeaderboardRow>[] = [
    {
      key: 'rank',
      header: 'Rank',
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-2">
          {r.index === 0 && <Crown className="w-4 h-4 text-yellow-400" />}
          <span className="text-lg font-bold text-[var(--text-primary)]">
            #{r.index + 1}
          </span>
        </div>
      )
    },
    {
      key: 'player',
      header: 'Player',
      sortable: false,
      render: (r) => (
        // DataTable's <td> defaults to text-secondary; PlayerLink needs text-primary.
        <span className="text-[var(--text-primary)]">
          <PlayerLink playerName={r.entry.displayName} />
        </span>
      )
    },
    {
      key: 'maxDamage',
      header: 'Max Damage',
      align: 'center',
      sortable: false,
      render: (r) => (
        <span className="font-bold text-[var(--accent)]">
          {formatNumber(r.entry.maxDamage)}
        </span>
      )
    },
    {
      key: 'battles',
      header: 'Battles',
      align: 'center',
      sortable: false,
      render: (r) => (
        <span className="text-[var(--text-primary)]">
          {formatNumber(r.entry.battleCount)}
        </span>
      )
    },
    {
      key: 'avgDamage',
      header: 'Avg Damage',
      align: 'center',
      sortable: false,
      render: (r) => (
        <span className="text-[var(--text-primary)]">
          {formatNumber(Math.round(r.entry.avgDamage))}
        </span>
      )
    },
    {
      key: 'teamComposition',
      header: 'Team Composition',
      sortable: false,
      render: (r) =>
        r.entry.heroDetails ? (
          // Same as the Player column: the fallback badge has no colour of its own.
          <span className="text-[var(--text-primary)]">
            <TeamCompositionDisplay
              heroDetails={r.entry.heroDetails}
              machineOfWarDetails={r.entry.machineOfWarDetails}
            />
          </span>
        ) : null
    }
  ]

  const groupedData = filteredData.reduce<
    Record<string, BossLeaderboardEntry[]>
  >(
    (acc, item) => {
      const key = `${item.bossName}-${item.encounterIndex}`
      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(item)
      return acc
    },
    {} as Record<string, BossLeaderboardEntry[]>
  )

  if (contextLoading || loading || (!displayError && leaderboardPending)) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>
        <div className="min-h-[400px] flex items-center justify-center">
          <LoadingSpinner
            message="Calculating boss combat rankings..."
            variant="sacred"
            size="lg"
          />
        </div>
      </div>
    )
  }

  if (displayError) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Guild Boss Leaderboard - Error
          </h1>
        </div>
        <div className="bg-red-900/20 border border-red-600/30 rounded-lg p-4">
          <LinkifiedText
            text={displayError}
            className="text-red-400"
            linkClassName="text-red-300 hover:text-red-200 underline"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.history.back()}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Target className="w-6 h-6 text-red-400" />
            {guildDisplayName} - Boss Leaderboards
          </h1>
          <p className="text-[var(--text-secondary)] flex items-center gap-2 mt-1">
            <Users className="w-4 h-4" />
            Season {season} • {Object.keys(groupedData).length} Boss Encounters
          </p>
        </div>
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
                <span className="flex items-center gap-2">
                  <BossPortrait bossName={boss} size="small" variant="icon" />
                  <span>{boss}</span>
                </span>
              </RadixTabsTrigger>
            ))}
          </RadixTabsList>

          <div className="mt-6">
            {/* Boss Leaderboard Content */}
            {Object.entries(groupedData).map(([key, entries]) => {
              const [bossNameRaw, encounterIndexStrRaw] = key.split('-')
              const bossName = bossNameRaw ?? 'Unknown Boss'
              const encounterIndex = parseInt(encounterIndexStrRaw ?? '0', 10)
              const isPrime = encounterIndex > 0

              return (
                <div key={key} className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <BossLink
                      bossName={bossName}
                      showPortrait={true}
                      portraitSize="small"
                      portraitVariant="icon"
                    />
                    {isPrime && <Crown className="w-4 h-4 text-yellow-400" />}
                    <span className="text-[var(--text-secondary)]">
                      ({entries.length} entries)
                    </span>
                  </div>

                  <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[var(--card-border)] overflow-hidden">
                    <DataTable
                      rows={entries
                        .slice()
                        .sort((a, b) => b.maxDamage - a.maxDamage)
                        .map((entry, index) => ({ entry, index }))}
                      columns={bossTableColumns}
                      rowKey={(r) =>
                        `${r.entry.displayName}-${r.entry.bossName}-${r.entry.encounterIndex}-${r.entry.maxDamage}`
                      }
                      tableClassName="[&_th]:!text-[var(--text-primary)]"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </RadixTabs>
      )}

      {data.length === 0 && (
        <div className="text-center py-8">
          <Sword className="w-12 h-12 text-[var(--text-secondary)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            No Boss Data Available
          </h3>
          <p className="text-[var(--text-secondary)]">
            No boss battle data found for {guildDisplayName} in season {season}.
          </p>
        </div>
      )}
    </div>
  )
}
