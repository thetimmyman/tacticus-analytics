'use client'

import { useMemo } from 'react'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import type { UnitPerformance } from '../_types'
import { formatNumber, formatPercent, UnitRow } from './war-shared'

type SortKey = 'unit' | 'uses' | 'winRate' | 'avgScore' | 'avgKills'

const columns: DataTableColumn<UnitPerformance, SortKey>[] = [
  {
    key: 'unit',
    header: 'Unit',
    sortValue: (row) => row.unit.name,
    render: (row) => (
      <div className="flex items-center gap-3">
        <UnitRow units={[row.unit]} size="sm" />
        <div>
          <div className="font-medium text-[var(--text-primary)]">
            {row.unit.name}
          </div>
          <div className="text-xs text-[var(--text-tertiary)]">
            {row.unit.faction}
          </div>
        </div>
      </div>
    )
  },
  {
    key: 'uses',
    header: 'Uses',
    sortValue: (row) => row.uses,
    render: (row) => formatNumber(row.uses)
  },
  {
    key: 'winRate',
    header: 'Win rate',
    sortValue: (row) => row.winRate,
    render: (row) => formatPercent(row.winRate)
  },
  {
    key: 'avgScore',
    header: 'Avg score',
    sortValue: (row) => row.avgScore,
    render: (row) => formatNumber(row.avgScore)
  },
  {
    key: 'avgKills',
    header: 'Avg kills',
    sortValue: (row) => row.avgKills,
    render: (row) => (row.avgKills > 0 ? row.avgKills.toFixed(1) : '—')
  }
]

export default function PerformanceTable({
  rows
}: {
  rows: UnitPerformance[]
}) {
  // Name-asc base order plus a stable sort keeps the unit-name tiebreak.
  const nameOrderedRows = useMemo(
    () => [...rows].sort((a, b) => a.unit.name.localeCompare(b.unit.name)),
    [rows]
  )
  return (
    <DataTable
      rows={nameOrderedRows}
      columns={columns}
      rowKey={(row) => row.unit.id}
      defaultSort={{ key: 'winRate', direction: 'desc' }}
      empty={
        <div className="p-8 text-center text-sm text-[var(--text-secondary)]">
          No data available for the selected period.
        </div>
      }
    />
  )
}
