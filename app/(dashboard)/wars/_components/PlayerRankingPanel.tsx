'use client'

// Behind the `warPlayerRanking` flag (the route 404s while off).

import { useQuery } from '@tanstack/react-query'
import { MemberName } from '@/app/components/ui/MemberName'
import { formatNumber } from '@tacticus/app-core/formatters'
import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import type {
  PlayerRankingResult,
  PlayerRankingRow,
  WarExclusion
} from '@/app/lib/war/bephus-ranking'

type RankingResponse = PlayerRankingResult & {
  zoneEventPopulation: number
}

const columns: DataTableColumn<PlayerRankingRow>[] = [
  {
    key: 'player',
    header: 'Player',
    render: (row) => (
      <span className="font-medium">
        <MemberName value={row.playerName ?? 'Unknown'} />
      </span>
    )
  },
  {
    key: 'total',
    header: 'Score',
    className: 'text-right',
    render: (row) => (
      <span className="font-mono">{row.totalMultiplier.toFixed(2)}</span>
    )
  },
  {
    key: 'avg',
    header: 'Avg',
    className: 'text-right',
    render: (row) => (
      <span className="font-mono">{row.avgMultiplier.toFixed(2)}</span>
    )
  },
  {
    key: 'oneshots',
    header: '1-shot',
    className: 'text-right',
    render: (row) => row.oneshots
  },
  {
    key: 'cleanups',
    header: 'Cleanup',
    className: 'text-right',
    render: (row) => row.cleanups
  },
  {
    key: 'losses',
    header: 'Loss',
    className: 'text-right',
    render: (row) => row.losses
  },
  {
    key: 'npc',
    header: 'NPC',
    className: 'text-right',
    render: (row) => row.npcHits
  },
  {
    key: 'points',
    header: 'Points',
    className: 'text-right',
    render: (row) => (
      <span className="font-mono">
        {formatNumber(Math.round(row.normalizedPoints))}
      </span>
    )
  }
]

export function PlayerRankingPanel({ warCount }: { warCount: number }) {
  const { data, isLoading, error } = useQuery<RankingResponse>({
    queryKey: ['war-player-ranking', warCount],
    queryFn: async () => {
      const res = await fetch('/api/wars/analytics/player-ranking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formulaVersion: 'bephus-v1', warCount })
      })
      if (!res.ok) throw new Error(`player-ranking failed: ${res.status}`)
      return res.json()
    },
    staleTime: 60 * 1000
  })

  return (
    <Card className="card-wh40k">
      <CardHeader className="pb-2">
        <CardTitle className="subheading-wh40k text-base sm:text-lg">
          Performance Leaderboard{' '}
          <span className="text-xs text-[var(--text-secondary)] font-normal">
            (bephus-v1)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-center text-[var(--text-secondary)]">
            Loading rankings…
          </div>
        ) : error || !data ? (
          <div className="p-6 text-center text-[var(--text-secondary)]">
            Rankings unavailable.
          </div>
        ) : (
          <>
            <DataTable
              rows={data.players}
              columns={columns}
              rowKey={(row) => row.playerId}
              empty={
                <div className="p-6 text-center text-[var(--text-secondary)]">
                  No scored battles in the selected wars.
                </div>
              }
            />
            {Object.values(data.excludedBattles).some((n) => n > 0) && (
              <div className="p-3 text-xs text-[var(--text-secondary)] border-t border-[var(--border)]">
                {Object.values(data.excludedBattles).reduce((a, b) => a + b, 0)}{' '}
                battle(s) not scored:{' '}
                {Object.entries(data.excludedBattles)
                  .filter(([, n]) => n > 0)
                  .map(([reason, n]) => `${n} ${reason}`)
                  .join(', ')}
              </div>
            )}
            {data.excludedWars.length > 0 && (
              <div className="p-3 text-xs text-[var(--text-secondary)] border-t border-[var(--border)]">
                {data.excludedWars.length} war
                {data.excludedWars.length === 1 ? '' : 's'} excluded:
                <ul className="list-disc ml-5 mt-1">
                  {data.excludedWars.map((w: WarExclusion) => (
                    <li key={w.warId}>
                      {w.warId.slice(0, 8)} — {w.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
