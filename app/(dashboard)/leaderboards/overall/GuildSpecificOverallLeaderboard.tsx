'use client'

import { useState, useEffect } from 'react'
import { StatusLabel } from '@tacticus/ui-kit'
import { dbClient } from '@/app/lib/db/client'
import { formatNumber, formatPercentage } from '@tacticus/app-core/formatters'
import { PlayerLink } from '@/app/components/ui/PlayerLink'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'leaderboards.overall.GuildSpecificOverallLeaderboard'
)
import {
  createError,
  formatErrorForUser
} from '@tacticus/app-core/error-handler'
import {
  ArrowLeft,
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Users
} from 'lucide-react'
import { Button } from '@tacticus/ui-kit'
import { LoadingSpinner } from '@tacticus/ui-kit/loading'
import { LinkifiedText } from '@/app/components/ui/LinkifiedText'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { useGuildLeaderboardContext } from '../hooks/useGuildLeaderboardContext'

interface GuildSpecificOverallLeaderboardProps {
  guildCode: string
}

interface PlayerStats {
  displayName: string
  Guild: string
  totalDamage: number
  battleCount: number
  avgDamage: number
  bombsUsed: number
  bossesKilled: number
  percentVsCluster?: number
  currentRank?: number
  priorSeasonRank?: number
  rankChange?: number
  fiveSeasonAvgRank?: number
}

interface OverallLeaderboardRow {
  player: PlayerStats
  index: number
}

export default function GuildSpecificOverallLeaderboard({
  guildCode
}: GuildSpecificOverallLeaderboardProps) {
  const [data, setData] = useState<PlayerStats[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const hasCluster = leaderboardContext?.hasCluster ?? false
  const expectedFetchKey = leaderboardContext?.season
    ? `${guildCode}::${leaderboardContext.season}`
    : null

  useEffect(() => {
    let cancelled = false
    const fetchGuildLeaderboard = async () => {
      if (!leaderboardContext?.season || !expectedFetchKey) return
      try {
        setLoading(true)
        setError(null)

        const { data: leaderboardData, error: leaderboardError } =
          await supabase.rpc('get_guild_overall_leaderboard', {
            p_guild_code: guildCode,
            p_season: leaderboardContext.season
          })

        if (leaderboardError) {
          throw leaderboardError
        }

        if (cancelled) return
        setData((leaderboardData as unknown as PlayerStats[]) || [])
        setLoadedKey(expectedFetchKey)
      } catch (err) {
        if (cancelled) return
        logger.error({ err: err }, 'Error fetching guild leaderboard:')
        const enhancedError = createError(
          'LEADERBOARD_LOAD_FAILED',
          'Failed to load leaderboard data',
          {
            component: 'GuildSpecificOverallLeaderboard',
            action: 'fetch_leaderboard',
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
      fetchGuildLeaderboard()
    }
    return () => {
      cancelled = true
    }
  }, [guildCode, leaderboardContext?.season, supabase, expectedFetchKey])

  const contextErrorMessage =
    contextError instanceof Error
      ? contextError.message
      : contextError
        ? 'Failed to load leaderboard context'
        : null
  const displayError = error ?? contextErrorMessage
  const leaderboardPending =
    Boolean(expectedFetchKey) && loadedKey !== expectedFetchKey

  const getRankChangeIcon = (change: number | null | undefined) => {
    if (!change || change === 0)
      return <Minus className="w-4 h-4 text-[var(--text-secondary)]" />
    if (change > 0) return <TrendingUp className="w-4 h-4 text-green-400" />
    return <TrendingDown className="w-4 h-4 text-red-400" />
  }

  const getRankChangeColor = (change: number | null | undefined) => {
    if (!change || change === 0) return 'text-[var(--text-secondary)]'
    if (change > 0) return 'text-green-400'
    return 'text-red-400'
  }

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
            message="Analyzing battle performance metrics..."
            variant="protocol"
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
            Guild Overall Leaderboard - Error
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

  const rowsForTable: OverallLeaderboardRow[] = data.map((player, index) => ({
    player,
    index
  }))

  const columns: DataTableColumn<OverallLeaderboardRow>[] = [
    {
      key: 'rank',
      header: 'Rank',
      sortable: false,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-[var(--text-primary)]">
            #{r.player.currentRank || r.index + 1}
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
          <PlayerLink playerName={r.player.displayName} />
        </span>
      )
    },
    {
      key: 'totalDamage',
      header: 'Total Damage',
      align: 'center',
      sortable: false,
      render: (r) => (
        <span className="font-semibold text-[var(--text-primary)]">
          {formatNumber(r.player.totalDamage)}
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
          {formatNumber(r.player.battleCount)}
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
          {formatNumber(Math.round(r.player.avgDamage))}
        </span>
      )
    },
    ...(hasCluster
      ? [
          {
            key: 'vsCluster',
            header: 'vs Cluster',
            align: 'center',
            sortable: false,
            render: (r: OverallLeaderboardRow) =>
              r.player.percentVsCluster ? (
                <StatusLabel
                  type={
                    r.player.percentVsCluster > 100
                      ? 'success'
                      : r.player.percentVsCluster > 90
                        ? 'warning'
                        : 'info'
                  }
                >
                  {formatPercentage(r.player.percentVsCluster / 100)}
                </StatusLabel>
              ) : (
                <span className="text-[var(--text-secondary)]">-</span>
              )
          } satisfies DataTableColumn<OverallLeaderboardRow>
        ]
      : []),
    {
      key: 'bombs',
      header: 'Bombs',
      align: 'center',
      sortable: false,
      render: (r) => (
        <span className="text-[var(--text-primary)]">
          {formatNumber(r.player.bombsUsed)}
        </span>
      )
    },
    {
      key: 'kills',
      header: 'Kills',
      align: 'center',
      sortable: false,
      render: (r) => (
        <span className="text-[var(--text-primary)]">
          {formatNumber(r.player.bossesKilled)}
        </span>
      )
    },
    {
      key: 'rankChange',
      header: 'Rank Change',
      align: 'center',
      sortable: false,
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          {getRankChangeIcon(r.player.rankChange)}
          <span className={getRankChangeColor(r.player.rankChange)}>
            {r.player.rankChange
              ? r.player.rankChange > 0
                ? `+${r.player.rankChange}`
                : r.player.rankChange
              : '-'}
          </span>
        </div>
      )
    }
  ]

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
            <Trophy className="w-6 h-6 text-yellow-400" />
            {guildDisplayName} - Overall Leaderboard
          </h1>
          <p className="text-[var(--text-secondary)] flex items-center gap-2 mt-1">
            <Users className="w-4 h-4" />
            Season {season} • {data.length} Players
          </p>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="bg-[var(--card-bg)] hover:bg-card/80 transition-colors duration-200 rounded-lg border border-[var(--card-border)] overflow-hidden">
        <DataTable
          rows={rowsForTable}
          columns={columns}
          rowKey={(r) =>
            `${r.player.displayName}-${r.player.Guild}-${r.player.totalDamage}`
          }
          empty={<></>}
          tableClassName="[&_th]:!text-[var(--text-primary)]"
        />
      </div>

      {data.length === 0 && (
        <div className="text-center py-8">
          <Users className="w-12 h-12 text-[var(--text-secondary)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            No Data Available
          </h3>
          <p className="text-[var(--text-secondary)]">
            No battle data found for {guildDisplayName} in season {season}.
          </p>
        </div>
      )}
    </div>
  )
}
