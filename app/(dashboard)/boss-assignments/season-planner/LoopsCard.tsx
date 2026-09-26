'use client'

import { formatNumber } from '@tacticus/app-core/formatters'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { formatDateTime } from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type {
  LoopTimelineRow,
  ScheduleWindow
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

interface LoopsCardProps {
  loopTimelineWindow: LoopTimelineRow[]
  scheduleWindow: ScheduleWindow
  timeZone: string
  hasMounted: boolean
}

export default function LoopsCard({
  loopTimelineWindow,
  scheduleWindow,
  timeZone,
  hasMounted
}: LoopsCardProps) {
  const loopColumns: DataTableColumn<LoopTimelineRow>[] = [
    {
      key: 'loop',
      header: 'Loop',
      sortable: false,
      render: (row) => (
        <span className="text-[var(--text-primary)]">{row.loopIndex}</span>
      )
    },
    {
      key: 'start',
      header: 'Start',
      sortable: false,
      render: (row) => formatDateTime(row.startAt, timeZone, hasMounted)
    },
    {
      key: 'end',
      header: 'End',
      sortable: false,
      render: (row) => formatDateTime(row.endAt, timeZone, hasMounted)
    },
    {
      key: 'stages',
      header: 'Stages',
      sortable: false,
      render: (row) => formatNumber(row.stages)
    },
    {
      key: 'tokens',
      header: 'Tokens',
      sortable: false,
      render: (row) => formatNumber(row.tokens)
    },
    {
      key: 'players',
      header: 'Players',
      sortable: false,
      render: (row) => formatNumber(row.uniquePlayers)
    }
  ]

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-card/40 p-4">
      <h4 className="text-sm font-semibold text-[var(--text-primary)]">
        Loops ({scheduleWindow})
      </h4>
      {loopTimelineWindow.length === 0 ? (
        <div className="mt-3 text-sm text-[var(--text-secondary)]">
          No loop progress in this window.
        </div>
      ) : (
        <div className="mt-3">
          <DataTable
            rows={loopTimelineWindow}
            columns={loopColumns}
            rowKey={(row) => `loop-${row.loopIndex}`}
            empty={<></>}
          />
        </div>
      )}
    </div>
  )
}
