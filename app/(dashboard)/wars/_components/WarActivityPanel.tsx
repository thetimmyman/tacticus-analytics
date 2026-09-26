'use client'

import { AlertTriangle, Clock, Copy } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ClientDate
} from '@tacticus/ui-kit'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { MemberName } from '@/app/components/ui/MemberName'
import { useMemberLabels } from '@/app/hooks/useMemberLabels'
import { useToast } from '@/app/hooks/useToast'
import { formatNumber } from '@tacticus/app-core/formatters'
import { formatPercentage } from '@/app/lib/utils/number-format'
import type { PlayerActivity, RangeOption } from './_hooks/useWarAnalyticsData'
import { generateParticipationSummary } from './war-analytics-summary-model'

const formatPercent = (value: number) =>
  formatPercentage(value, { multiplied: true })

const playerActivityColumns: DataTableColumn<PlayerActivity>[] = [
  {
    key: 'player',
    header: 'Player',
    sortable: false,
    render: (row) => (
      <span className="font-medium text-[var(--text-primary)]">
        <MemberName value={row.player} />
      </span>
    )
  },
  {
    key: 'participated',
    header: 'Participated',
    sortable: false,
    render: (row) => `${row.warsParticipated}/${row.totalWars}`
  },
  {
    key: 'rate',
    header: 'Rate',
    sortable: false,
    render: (row) => {
      const rateClass =
        row.participationRate >= 80
          ? 'text-green-400'
          : row.participationRate >= 50
            ? 'text-yellow-400'
            : 'text-red-400'
      return (
        <span className={`font-medium ${rateClass}`}>
          {formatPercent(row.participationRate)}
        </span>
      )
    }
  },
  {
    key: 'attacks',
    header: 'Attacks',
    sortable: false,
    render: (row) => formatNumber(row.attempts)
  },
  {
    key: 'winRate',
    header: 'Win Rate',
    sortable: false,
    render: (row) => (row.attempts > 0 ? formatPercent(row.winRate) : '—')
  },
  {
    key: 'score',
    header: 'Score',
    sortable: false,
    render: (row) => formatNumber(row.score)
  },
  {
    key: 'avgScore',
    header: 'Avg Score',
    sortable: false,
    render: (row) =>
      row.attempts > 0 ? formatNumber(Math.round(row.avgScore)) : '—'
  },
  {
    key: 'lastActive',
    header: 'Last Active',
    sortable: false,
    render: (row) =>
      row.lastActiveWarDate ? (
        <ClientDate date={row.lastActiveWarDate} format="date" />
      ) : (
        'Never'
      )
  }
]

export function WarActivityPanel({
  playerActivity,
  range,
  warsCount,
  avgParticipation,
  inactiveCount,
  highlyInactive
}: {
  playerActivity: PlayerActivity[]
  range: RangeOption
  warsCount: number
  avgParticipation: number | null
  inactiveCount: number
  highlyInactive: PlayerActivity[]
}) {
  const { toast } = useToast()
  const { labelFor } = useMemberLabels()

  if (playerActivity.length === 0) return null

  const avgParticipationLabel =
    avgParticipation === null ? 'N/A' : formatPercent(avgParticipation)

  const copySummary = async () => {
    const summary = generateParticipationSummary(
      playerActivity,
      range,
      warsCount,
      avgParticipation,
      labelFor
    )
    try {
      await navigator.clipboard.writeText(summary)
      toast.success(
        'Copied to clipboard',
        'Participation summary ready to paste in Discord'
      )
    } catch {
      toast.error('Copy failed', 'Could not copy to clipboard')
    }
  }

  return (
    <Card className="card-wh40k">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="subheading-wh40k text-base sm:text-lg flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-400" />
            Player Activity Summary
            {highlyInactive.length > 0 && (
              <Badge className="ml-2 bg-red-500/20 text-red-400 border-red-500/30">
                {highlyInactive.length} inactive
              </Badge>
            )}
          </CardTitle>
          <Button variant="outline" size="sm" onClick={copySummary}>
            <Copy className="h-4 w-4 mr-1" />
            Copy Summary
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
          <span>
            Avg participation:{' '}
            <span className="text-[var(--text-primary)]">
              {avgParticipationLabel}
            </span>
          </span>
          <span>
            Inactive below 50 percent:{' '}
            <span className="text-[var(--text-primary)]">
              {formatNumber(inactiveCount)}
            </span>
          </span>
        </div>
        {highlyInactive.length > 0 && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">
                Players missing 3+ wars
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {highlyInactive.slice(0, 9).map((player) => (
                <div
                  key={player.playerId}
                  className="flex items-center justify-between text-sm bg-card/20 rounded px-2 py-1"
                >
                  <span className="text-[var(--text-primary)] truncate">
                    <MemberName value={player.player} />
                  </span>
                  <span className="text-red-400 text-xs ml-2">
                    {player.warsInactive} missed
                  </span>
                </div>
              ))}
              {highlyInactive.length > 9 && (
                <div className="text-xs text-[var(--text-secondary)] col-span-full">
                  +{highlyInactive.length - 9} more
                </div>
              )}
            </div>
          </div>
        )}

        <DataTable
          rows={playerActivity.slice(0, 20)}
          columns={playerActivityColumns}
          rowKey={(row) => row.playerId}
          empty={<></>}
        />
        <div className="text-xs text-[var(--text-tertiary)]">
          Sorted by participation rate (lowest first). Based on {warsCount} wars
          in selected range.
        </div>
      </CardContent>
    </Card>
  )
}
