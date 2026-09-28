'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@tacticus/ui-kit'
import { TrendingUp } from 'lucide-react'
import { MemberName } from '@/app/components/ui/MemberName'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import type {
  WarPointsRow,
  WarPointsSummary
} from './_hooks/useWarAnalyticsData'

// Per-cell density and colour live in the render output because DataTable's <td> forces `text-secondary`.
const columns: DataTableColumn<WarPointsRow>[] = [
  {
    key: 'player',
    header: 'Player',
    sortable: false,
    className: 'whitespace-nowrap',
    render: (row) => (
      <span className="font-medium text-primary-wh40k whitespace-nowrap">
        <MemberName value={row.player} />
      </span>
    )
  },
  {
    key: 'bar',
    header: '',
    sortable: false,
    className: 'w-24',
    render: () => null // placeholder — replaced per-row below via chartMax closure
  },
  {
    key: 'tot',
    header: 'Tot',
    headerTitle: 'Total points',
    align: 'right',
    sortable: false,
    render: (row) => (
      <span className="font-mono font-semibold text-emerald-400">
        {row.total}
      </span>
    )
  },
  {
    key: 'atk',
    header: 'Atk',
    headerTitle: 'Attack points',
    align: 'right',
    sortable: false,
    render: (row) => (
      <span className="font-mono text-primary-wh40k">{row.atk}</span>
    )
  },
  {
    key: 'buf',
    header: 'Buf',
    headerTitle: 'Medicae buff bonus',
    align: 'right',
    sortable: false,
    render: (row) => (
      <span className="font-mono text-cyan-400">
        {row.buf > 0 ? `+${row.buf}` : '—'}
      </span>
    )
  },
  {
    key: 'bon',
    header: 'Bon',
    headerTitle: 'Completion bonus',
    align: 'right',
    sortable: false,
    render: (row) => (
      <span className="font-mono text-yellow-400">
        {row.bon > 0 ? `+${row.bon}` : '—'}
      </span>
    )
  },
  {
    key: 'pen',
    header: 'Pen',
    headerTitle: 'Penalty: −1 per unused token (10/war)',
    align: 'right',
    sortable: false,
    render: (row) => (
      <span className="font-mono text-red-400">
        {row.tok < 0 ? row.tok : '—'}
      </span>
    )
  },
  {
    key: 'suc',
    header: 'Suc',
    headerTitle: 'Successful attacks (oneshots + cleanups)',
    align: 'right',
    sortable: false,
    render: (row) => row.suc
  },
  {
    key: 'cnt16',
    header: '16',
    headerTitle: 'Perfect oneshots — 0 units lost (7 pts)',
    align: 'right',
    sortable: false,
    render: (row) => row.cnt16 || '—'
  },
  {
    key: 'cnt14',
    header: '14',
    headerTitle: 'Oneshots — 1 unit lost (6 pts)',
    align: 'right',
    sortable: false,
    render: (row) => row.cnt14 || '—'
  },
  {
    key: 'cnt12',
    header: '12',
    headerTitle: 'Oneshots — 2 units lost (5 pts)',
    align: 'right',
    sortable: false,
    render: (row) => row.cnt12 || '—'
  },
  {
    key: 'cnt11',
    header: '11',
    headerTitle: 'Oneshots — 3–4 units lost (5 pts)',
    align: 'right',
    sortable: false,
    render: (row) => row.cnt11 || '—'
  },
  {
    key: 'cln',
    header: 'Cln',
    headerTitle: 'Cleanups — not first win on zone (5 pts)',
    align: 'right',
    sortable: false,
    render: (row) => row.cln || '—'
  },
  {
    key: 'failN',
    header: 'FN',
    headerTitle: 'Failed attacks, no medicae buff (1 pt)',
    align: 'right',
    sortable: false,
    render: (row) => row.failN || '—'
  },
  {
    key: 'failM',
    header: 'FM',
    headerTitle: 'Failed attacks on medicae zone (2 pts)',
    align: 'right',
    sortable: false,
    render: (row) => row.failM || '—'
  }
]

export function WarPointsTable({
  warPoints,
  deselectedCount,
  warsCount
}: {
  warPoints: WarPointsSummary
  deselectedCount: number
  warsCount: number
}) {
  // The bar needs per-summary `chartMax`, so build the columns here.
  const columnsWithBar: DataTableColumn<WarPointsRow>[] = columns.map((col) =>
    col.key === 'bar'
      ? {
          ...col,
          render: (row: WarPointsRow) => {
            const barWidth =
              warPoints.chartMax > 0
                ? Math.min((row.total / warPoints.chartMax) * 100, 100)
                : 0
            return (
              <div className="h-1 rounded-full overflow-hidden bg-(--bg-tertiary,rgba(156,163,175,0.1))">
                <div
                  className="h-full rounded-full bg-emerald-500/50"
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            )
          }
        }
      : col
  )

  return (
    <Card className="card-wh40k">
      <CardHeader className="pb-2">
        <CardTitle className="subheading-wh40k text-base sm:text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          War Points Score
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-secondary-wh40k">
          Atk: 7 perfect oneshot · 6 (1 loss) · 5 (2+ losses / cleanup) · 1
          failed &nbsp;·&nbsp; Buf: +2 per active medicae zone (up to +4)
          &nbsp;·&nbsp; Bon: +5 for 9/10, +10 for 10/10 successes per war
          &nbsp;·&nbsp; Pen: −1 per unused token (10/war)
        </div>
        <div className="text-xs text-secondary-wh40k">
          Attacks:{' '}
          <span className="text-primary-wh40k">{warPoints.totalAttempts}</span>
          {deselectedCount > 0 && (
            <span className="ml-2 text-amber-400">
              (filtered: {warsCount - deselectedCount}/{warsCount} wars)
            </span>
          )}
        </div>

        {warPoints.players.length === 0 ? (
          // Outside the table, so no empty 15-column header.
          <div className="rounded-lg border border-(--border) bg-[color-mix(in_srgb,var(--bg-secondary)_40%,transparent)] p-4 text-sm text-secondary-wh40k">
            No completed guild attacks yet.
          </div>
        ) : (
          <DataTable
            rows={warPoints.players}
            columns={columnsWithBar}
            rowKey={(row) => row.playerId}
            // Descendant overrides beat DataTable's `p-3 text-sm`.
            tableClassName="[&_td]:text-xs [&_td]:px-2 [&_td]:py-1"
          />
        )}
      </CardContent>
    </Card>
  )
}
