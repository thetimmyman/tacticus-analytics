'use client'

import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { formatDateTime } from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type { SavedPlanSummary } from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

interface SavedPlansCardProps {
  savedPlans: SavedPlanSummary[]
  savedPlansLoading: boolean
  savedPlansError: string | null
  snapshotSeasonId: string | null
  loadSavedPlans: (seasonId: string) => Promise<void>
  loadSavedPlan: (planId: string) => Promise<void>
  loadingSavedPlanId: string | null
  activeSavedPlanId: string | null
  timeZone: string
  hasMounted: boolean
}

export default function SavedPlansCard({
  savedPlans,
  savedPlansLoading,
  savedPlansError,
  snapshotSeasonId,
  loadSavedPlans,
  loadSavedPlan,
  loadingSavedPlanId,
  activeSavedPlanId,
  timeZone,
  hasMounted
}: SavedPlansCardProps) {
  const savedPlanColumns: DataTableColumn<SavedPlanSummary>[] = [
    {
      key: 'created',
      header: 'Created',
      sortable: false,
      render: (p) => (
        <span className="text-[var(--text-primary)]">
          {formatDateTime(p.created_at, timeZone, hasMounted)}
        </span>
      )
    },
    {
      key: 'kind',
      header: 'Kind',
      sortable: false,
      render: (p) => p.kind
    },
    {
      key: 'trigger',
      header: 'Trigger',
      sortable: false,
      render: (p) => p.trigger
    },
    {
      key: 'snapshot',
      header: 'Snapshot',
      sortable: false,
      render: (p) =>
        p.snapshot_at
          ? formatDateTime(p.snapshot_at, timeZone, hasMounted)
          : '—'
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      render: (p) => (
        <button
          onClick={() => void loadSavedPlan(p.id)}
          disabled={loadingSavedPlanId !== null}
          className="text-[var(--accent)] hover:underline"
        >
          {loadingSavedPlanId === p.id
            ? 'Loading...'
            : activeSavedPlanId === p.id
              ? 'Loaded'
              : 'Load'}
        </button>
      )
    }
  ]

  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            Saved Plans
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Load previous replans for this season configuration.
          </p>
        </div>
        <button
          onClick={() =>
            snapshotSeasonId && void loadSavedPlans(snapshotSeasonId)
          }
          disabled={savedPlansLoading || !snapshotSeasonId}
          className="px-3 py-2 rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] text-sm text-[var(--text-primary)] hover:bg-card/80 disabled:opacity-50"
        >
          {savedPlansLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {savedPlansError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {savedPlansError}
        </div>
      )}

      {!savedPlansLoading && savedPlans.length === 0 && (
        <div className="text-sm text-[var(--text-secondary)]">
          No saved plans yet.
        </div>
      )}

      {savedPlans.length > 0 && (
        <DataTable
          rows={savedPlans}
          columns={savedPlanColumns}
          rowKey={(p) => p.id}
          empty={<></>}
        />
      )}
    </div>
  )
}
