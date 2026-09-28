'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ClientDate
} from '@tacticus/ui-kit'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@tacticus/ui-kit/select'
import { BarChart3, Shield, Sword, Trophy, Users } from 'lucide-react'
import { MemberName } from '@/app/components/ui/MemberName'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { formatNumber as formatNumberValue } from '@tacticus/app-core/formatters'
import { formatPercentage } from '@/app/lib/utils/number-format'
import {
  EMPTY_WAR_POINTS_SUMMARY,
  buildWarPointsScore,
  useWarAnalyticsData,
  type PlayerAgg,
  type RangeOption,
  type WarRow
} from './_hooks/useWarAnalyticsData'
import { WarPointsTable } from './WarPointsTable'
import { PlayerRankingPanel } from './PlayerRankingPanel'
import { isFeatureEnabled } from '@/app/lib/utils/feature-flags'
import { WarActivityPanel } from './WarActivityPanel'
import {
  buildWarAnalyticsSummary,
  MIN_ATTEMPTS_FOR_WIN_RATE,
  type SummaryTone
} from './war-analytics-summary-model'

interface WarAnalyticsProps {
  guildCode: string
}

const formatNumber = (value: number | null | undefined): string =>
  typeof value === 'number' ? formatNumberValue(value) : '0'

const formatOptionalNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? formatNumberValue(value)
    : 'N/A'

const formatSignedNumber = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A'
  const rounded = Math.round(value)
  if (rounded === 0) return '0'
  const sign = rounded > 0 ? '+' : '-'
  return `${sign}${formatNumberValue(Math.abs(rounded))}`
}

const formatPercent = (value: number): string =>
  formatPercentage(value, { multiplied: true })

const getResultBadge = (result: string | null) => {
  if (result === 'win')
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
        WIN
      </Badge>
    )
  if (result === 'loss')
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
        LOSS
      </Badge>
    )
  if (result === 'draw')
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
        DRAW
      </Badge>
    )
  return (
    <Badge className="bg-(--bg-secondary) text-secondary-wh40k border-(--border)">
      N/A
    </Badge>
  )
}

const summaryToneStyles: Record<SummaryTone, { text: string; border: string }> =
  {
    positive: { text: 'text-green-400', border: 'border-green-500/30' },
    negative: { text: 'text-red-400', border: 'border-red-500/30' },
    neutral: {
      text: 'text-primary-wh40k',
      border: 'border-(--border)'
    },
    info: { text: 'text-cyan-400', border: 'border-cyan-500/30' }
  }

function SummaryTile({
  label,
  value,
  hint,
  tone = 'neutral'
}: {
  label: string
  value: string
  hint?: string
  tone?: SummaryTone
}) {
  const toneStyle = summaryToneStyles[tone]
  return (
    <div className={`stat-card-wh40k p-3 sm:p-4 ${toneStyle.border}`}>
      <div className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
        {label}
      </div>
      <div className={`text-lg sm:text-xl font-semibold ${toneStyle.text}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-secondary-wh40k">{hint}</div>}
    </div>
  )
}

// DataTable's <td> forces text-secondary, so primary-coloured cells wrap in a span.
const topPlayersColumns: DataTableColumn<PlayerAgg>[] = [
  {
    key: 'player',
    header: 'Player',
    sortable: false,
    render: (row) => (
      <span className="font-medium text-primary-wh40k">
        <MemberName value={row.player} />
      </span>
    )
  },
  {
    key: 'wars',
    header: 'Wars',
    sortable: false,
    render: (row) => row.wars
  },
  {
    key: 'attempts',
    header: 'Attempts',
    sortable: false,
    render: (row) => row.attempts
  },
  {
    key: 'winRate',
    header: 'Win%',
    sortable: false,
    render: (row) => formatPercent(row.winRate)
  },
  {
    key: 'score',
    header: 'Score',
    sortable: false,
    align: 'right',
    render: (row) => (
      <span className="font-mono text-primary-wh40k">
        {formatNumber(row.score)}
      </span>
    )
  },
  {
    key: 'avgScore',
    header: 'Avg',
    sortable: false,
    align: 'right',
    render: (row) => (
      <span className="font-mono">
        {formatNumber(Math.round(row.avgScore))}
      </span>
    )
  }
]

const warsInRangeColumns: DataTableColumn<WarRow>[] = [
  {
    key: 'opponent',
    header: 'Opponent',
    sortable: false,
    render: (war) => (
      <span className="font-medium text-primary-wh40k">
        {war.opponent_guild_name ?? 'Unknown'}
      </span>
    )
  },
  {
    key: 'result',
    header: 'Result',
    sortable: false,
    render: (war) => getResultBadge(war.war_result)
  },
  {
    key: 'score',
    header: 'Score',
    sortable: false,
    align: 'right',
    render: (war) => (
      <span className="font-mono text-primary-wh40k">
        {formatNumber(war.guild_score)} - {formatNumber(war.opponent_score)}
      </span>
    )
  },
  {
    key: 'ended',
    header: 'Ended',
    sortable: false,
    render: (war) =>
      war.war_end_date ? (
        <ClientDate date={war.war_end_date} format="date" />
      ) : (
        'N/A'
      )
  }
]

export default function WarAnalytics({ guildCode }: WarAnalyticsProps) {
  const [range, setRange] = useState<RangeOption>('6')
  const [deselectedWarIds, setDeselectedWarIds] = useState<Set<string>>(
    new Set()
  )
  const { data, isLoading, error } = useWarAnalyticsData(guildCode, range)

  const wars = data?.wars ?? []
  const players = data?.players ?? []
  const offenseZones = data?.offenseZones ?? []
  const defenseZones = data?.defenseZones ?? []
  const playerActivity = data?.playerActivity ?? []
  const warPoints = data?.warPoints ?? EMPTY_WAR_POINTS_SUMMARY
  const attempts = useMemo(() => data?.attempts ?? [], [data?.attempts])
  const allMembers = useMemo(() => data?.allMembers ?? [], [data?.allMembers])

  const toggleWarId = useCallback((warId: string) => {
    setDeselectedWarIds((prev) => {
      const next = new Set(prev)
      if (next.has(warId)) next.delete(warId)
      else next.add(warId)
      return next
    })
  }, [])

  const filteredWarPoints = useMemo(() => {
    if (deselectedWarIds.size === 0) return warPoints
    const filtered = attempts.filter(
      (a) => a.war_id && !deselectedWarIds.has(a.war_id)
    )
    return buildWarPointsScore(filtered, allMembers)
  }, [attempts, deselectedWarIds, warPoints, allMembers])

  const summary = buildWarAnalyticsSummary({
    wars,
    players,
    offenseZones,
    defenseZones,
    playerActivity
  })
  const {
    totalWars,
    wins,
    losses,
    draws,
    winRate,
    avgGuildScore,
    avgOpponentScore,
    avgScoreDiff,
    offenseAttempts,
    offenseWinRate,
    defenseAttempts,
    defenseHoldRate,
    topScorer,
    mostActive,
    bestWinRate,
    avgParticipation,
    recentWars,
    recordTone,
    winRateTone,
    diffTone,
    offenseTone,
    defenseTone,
    inactivePlayers,
    highlyInactive
  } = summary
  const offenseWinRateLabel =
    offenseWinRate === null ? 'N/A' : formatPercent(offenseWinRate)
  const defenseHoldRateLabel =
    defenseHoldRate === null ? 'N/A' : formatPercent(defenseHoldRate)

  if (isLoading) {
    return (
      <Card className="card-wh40k">
        <CardContent className="p-6 text-sm text-secondary-wh40k">
          Loading analytics.
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="card-wh40k">
        <CardContent className="p-6 text-sm text-red-400">
          Failed to load analytics.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="card-wh40k p-4 sm:p-6 space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
              <h2 className="heading-wh40k text-xl">Guild War Analytics</h2>
            </div>
            <p className="text-xs text-secondary-wh40k">
              Scores use official war scoring (zone-capture bonuses included):
              match scores are game-reported; player scores sum guild
              members&apos; score earned; zone scores cover both guild (offense)
              and opponent (defense) attacks.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-xs uppercase tracking-wide text-(--text-tertiary)">
              Range
            </span>
            <Select
              value={range}
              onValueChange={(value) => {
                setRange(value as RangeOption)
                setDeselectedWarIds(new Set())
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">Last 6 wars</SelectItem>
                <SelectItem value="12">Last 12 wars</SelectItem>
                <SelectItem value="24">Last 24 wars</SelectItem>
                <SelectItem value="all">All wars</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <SummaryTile
            label="Wars"
            value={formatNumber(totalWars)}
            tone="info"
          />
          <SummaryTile
            label="Record"
            value={`${wins}-${losses}-${draws}`}
            hint="W-L-D"
            tone={recordTone}
          />
          <SummaryTile
            label="Win Rate"
            value={formatPercent(winRate)}
            tone={winRateTone}
          />
          <SummaryTile
            label="Avg Diff"
            value={formatSignedNumber(avgScoreDiff)}
            tone={diffTone}
          />
          <SummaryTile
            label="Avg Guild Score"
            value={formatOptionalNumber(
              avgGuildScore !== null ? Math.round(avgGuildScore) : null
            )}
            hint="Official (game-reported)"
          />
          <SummaryTile
            label="Avg Opp Score"
            value={formatOptionalNumber(
              avgOpponentScore !== null ? Math.round(avgOpponentScore) : null
            )}
            hint="Official (game-reported)"
          />
          <SummaryTile
            label="Attack Win Rate"
            value={offenseWinRateLabel}
            hint={
              offenseAttempts > 0
                ? `${formatNumber(offenseAttempts)} attacks`
                : 'No attacks'
            }
            tone={offenseTone}
          />
          <SummaryTile
            label="Defense Hold"
            value={defenseHoldRateLabel}
            hint={
              defenseAttempts > 0
                ? `${formatNumber(defenseAttempts)} defenses`
                : 'No defenses'
            }
            tone={defenseTone}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-lg border border-(--border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
                  Top Scorer
                </p>
                <p className="text-sm font-semibold text-primary-wh40k">
                  {topScorer ? <MemberName value={topScorer.player} /> : 'N/A'}
                </p>
              </div>
              <Trophy className="h-5 w-5 text-yellow-400" />
            </div>
            <div className="mt-2 text-xs text-secondary-wh40k">
              {topScorer
                ? `${formatNumber(topScorer.score)} score - ${formatPercent(topScorer.winRate)} win rate`
                : 'No completed attempts yet.'}
            </div>
          </div>

          <div className="rounded-lg border border-(--border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
                  Most Active
                </p>
                <p className="text-sm font-semibold text-primary-wh40k">
                  {mostActive ? (
                    <MemberName value={mostActive.player} />
                  ) : (
                    'N/A'
                  )}
                </p>
              </div>
              <Sword className="h-5 w-5 text-green-400" />
            </div>
            <div className="mt-2 text-xs text-secondary-wh40k">
              {mostActive
                ? `${formatNumber(mostActive.attempts)} attacks - ${formatNumber(mostActive.wars)} wars`
                : 'No activity logged yet.'}
            </div>
          </div>

          <div className="rounded-lg border border-(--border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
                  Best Win Rate
                </p>
                <p className="text-sm font-semibold text-primary-wh40k">
                  {bestWinRate ? (
                    <MemberName value={bestWinRate.player} />
                  ) : (
                    'N/A'
                  )}
                </p>
              </div>
              <Shield className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="mt-2 text-xs text-secondary-wh40k">
              {bestWinRate
                ? `${formatPercent(bestWinRate.winRate)} win rate - ${formatNumber(bestWinRate.attempts)} attacks`
                : `Need ${MIN_ATTEMPTS_FOR_WIN_RATE}+ attacks for ranking.`}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wide text-(--text-tertiary)">
            Recent Wars
          </div>
          {recentWars.length === 0 ? (
            <div className="mt-2 text-xs text-secondary-wh40k">
              No completed wars yet.
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {recentWars.map((war) => {
                const diff = (war.guild_score ?? 0) - (war.opponent_score ?? 0)
                const diffClass = diff >= 0 ? 'text-green-400' : 'text-red-400'
                const isDeselected = deselectedWarIds.has(war.war_id)
                return (
                  <div
                    key={war.war_id}
                    onClick={() => toggleWarId(war.war_id)}
                    title={
                      isDeselected
                        ? 'Click to include in War Points Score'
                        : 'Click to exclude from War Points Score'
                    }
                    className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer select-none transition-opacity ${
                      isDeselected
                        ? 'border-(--border) bg-[color-mix(in_srgb,var(--bg-secondary)_20%,transparent)] opacity-40'
                        : 'border-emerald-500/40 bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] opacity-100'
                    }`}
                  >
                    {getResultBadge(war.war_result)}
                    <span className="text-primary-wh40k">
                      {war.opponent_guild_name ?? 'Unknown'}
                    </span>
                    <span className={`font-mono ${diffClass}`}>
                      {formatNumber(war.guild_score)}-
                      {formatNumber(war.opponent_score)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <WarPointsTable
        warPoints={filteredWarPoints}
        deselectedCount={deselectedWarIds.size}
        warsCount={wars.length}
      />

      {isFeatureEnabled('warPlayerRanking') && (
        <PlayerRankingPanel warCount={wars.length || 6} />
      )}

      {wars.length === 0 ? (
        <Card className="card-wh40k">
          <CardContent className="p-10 text-center text-secondary-wh40k">
            No completed wars found for this range.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="card-wh40k overflow-hidden xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="subheading-wh40k text-base sm:text-lg flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-400" />
                  Top Players
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable
                  rows={players.slice(0, 15)}
                  columns={topPlayersColumns}
                  rowKey={(row) => row.playerId}
                  empty={<></>}
                />
              </CardContent>
            </Card>

            <Card className="card-wh40k overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="subheading-wh40k text-base sm:text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-(--accent)" />
                  Wars In Range
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <DataTable
                  rows={wars}
                  columns={warsInRangeColumns}
                  rowKey={(war) => war.war_id}
                  empty={<></>}
                />
              </CardContent>
            </Card>
          </div>

          <WarActivityPanel
            playerActivity={playerActivity}
            range={range}
            warsCount={wars.length}
            avgParticipation={avgParticipation}
            inactiveCount={inactivePlayers.length}
            highlyInactive={highlyInactive}
          />
        </>
      )}
    </div>
  )
}
