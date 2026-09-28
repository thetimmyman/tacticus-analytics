'use client'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton
} from '@tacticus/ui-kit'
import { DataState } from '@/app/components/DataState'
import GuildSummaryCard from './GuildSummaryCard'
import PlayerStatsTable from './PlayerStatsTable'
import { useWarPlayers } from '../_hooks'
import type { GuildSummary, PlayerStats } from '../_types'

type Side = 'guild' | 'opponent'

const SIDE_CONFIG: Record<
  Side,
  { summaryName: string; cardTitle: string; errorCopy: string }
> = {
  guild: {
    summaryName: 'Guild Stats',
    cardTitle: 'Guild Player Stats',
    errorCopy:
      'Failed to load guild player stats. Please try refreshing the page.'
  },
  opponent: {
    summaryName: 'Opponent Stats',
    cardTitle: 'Opponent Player Stats',
    errorCopy:
      'Failed to load opponent player stats. Please try refreshing the page.'
  }
}

const SUMMARY_STAT_KEYS = [
  'total-score',
  'attacks',
  'perfect-hits',
  'defenses',
  'win-rate'
] as const

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0
}

// Attempt-weighted rates: structural zeros from one-sided rows would dilute a mean of rates.
export function buildGuildSummary(
  players: PlayerStats[],
  summaryName: string
): GuildSummary {
  return {
    guildName: summaryName,
    guildTag: '',
    totalScore: players.reduce((sum, p) => sum + p.attacks.points, 0),
    totalAttacks: players.reduce((sum, p) => sum + p.attacks.total, 0),
    perfectHits: players.reduce((sum, p) => sum + p.attacks.perfect, 0),
    totalDefenses: players.reduce((sum, p) => sum + p.defenses.total, 0),
    totalConceded: players.reduce((sum, p) => sum + p.defenses.conceded, 0),
    winRate: rate(
      players.reduce((sum, p) => sum + p.attacks.wins, 0),
      players.reduce((sum, p) => sum + p.attacks.total, 0)
    ),
    holdRate: rate(
      players.reduce((sum, p) => sum + p.defenses.holds, 0),
      players.reduce((sum, p) => sum + p.defenses.total, 0)
    )
  }
}

function SummarySkeleton() {
  return (
    <Card className="border-(--border) bg-(--bg-primary)">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-32" />
      </CardHeader>
      <CardContent className="pt-4 space-y-5">
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {SUMMARY_STAT_KEYS.map((key) => (
            <div
              key={key}
              className="rounded-lg border border-(--border) bg-(--bg-secondary) p-4 space-y-1"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

const TABLE_ROW_KEYS = [
  'row-1',
  'row-2',
  'row-3',
  'row-4',
  'row-5',
  'row-6',
  'row-7',
  'row-8',
  'row-9',
  'row-10'
] as const

function TableSkeleton() {
  return (
    <Card className="border-(--border) bg-(--bg-primary)">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-2">
          {TABLE_ROW_KEYS.map((key) => (
            <Skeleton key={key} className="h-10 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function WarPlayerStatsClient({
  warId,
  side
}: {
  warId: string
  side: Side
}) {
  const { data: players = [], isLoading, error } = useWarPlayers(warId, side)
  const config = SIDE_CONFIG[side]
  const summary = buildGuildSummary(players, config.summaryName)

  return (
    <DataState
      error={error}
      isLoading={isLoading}
      errorUI={
        <div className="text-center py-8 text-red-400">{config.errorCopy}</div>
      }
      skeleton={
        <div className="space-y-6">
          <SummarySkeleton />
          <TableSkeleton />
        </div>
      }
    >
      <div className="space-y-6">
        <GuildSummaryCard summary={summary} />
        <Card className="border-(--border) bg-(--bg-primary)">
          <CardHeader className="pb-2">
            <CardTitle>{config.cardTitle}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <PlayerStatsTable players={players} />
          </CardContent>
        </Card>
      </div>
    </DataState>
  )
}
