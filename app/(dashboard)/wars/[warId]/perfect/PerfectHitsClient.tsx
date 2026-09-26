'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton
} from '@tacticus/ui-kit'
import { DataState } from '@/app/components/DataState'
import ActivityTable from '../../_components/ActivityTable'
import { formatNumber } from '../../_components/war-shared'
import { useWarRecentActivity } from '../../_hooks'
import ActivityFilterBar, {
  DEFAULT_FILTERS,
  applyActivityFilters
} from '../../_components/ActivityFilterBar'
import type { ActivityFilters } from '../../_components/ActivityFilterBar'
import { zoneDisplayName } from '@/app/lib/war/war-naming'

const PERFECT_SUMMARY_KEYS = ['perfect-hits', 'zones-cleared'] as const

function SummarySkeleton() {
  return (
    <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
      <CardHeader className="pb-2">
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent className="pt-4 flex flex-wrap gap-8">
        {PERFECT_SUMMARY_KEYS.map((key) => (
          <div key={key} className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export default function PerfectHitsClient({ warId }: { warId: string }) {
  const { data, isLoading, error } = useWarRecentActivity(warId, 'perfect')
  const [activityFilters, setActivityFilters] =
    useState<ActivityFilters>(DEFAULT_FILTERS)

  const perfectAttempts = data?.attempts ?? []
  const filteredAttempts = applyActivityFilters(
    perfectAttempts,
    activityFilters
  )

  // By zone TYPE: legacy `zoneName` varies by sync and mis-buckets zones.
  const groupedByZone = filteredAttempts.reduce<
    Record<string, typeof filteredAttempts>
  >((acc, attempt) => {
    const zoneType = attempt.zoneType
    const zoneAttempts = acc[zoneType] ?? []
    zoneAttempts.push(attempt)
    acc[zoneType] = zoneAttempts
    return acc
  }, {})

  return (
    <DataState
      error={error}
      isLoading={isLoading}
      errorUI={
        <div className="text-center py-8 text-red-400">
          Failed to load perfect hits data. Please try refreshing the page.
        </div>
      }
      skeleton={
        <div className="space-y-6">
          <SummarySkeleton />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <div className="space-y-6">
        <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
          <CardHeader className="pb-2">
            <CardTitle>Perfect Hits Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 flex flex-wrap gap-8 text-sm text-[var(--text-secondary)]">
            <div>
              <div className="text-xs text-[var(--text-tertiary)]">
                Perfect hits
              </div>
              <div className="text-xl font-semibold text-green-400">
                {formatNumber(filteredAttempts.length)}
              </div>
            </div>
            <div>
              <div className="text-xs text-[var(--text-tertiary)]">
                Zones cleared
              </div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">
                {formatNumber(Object.keys(groupedByZone).length)}
              </div>
            </div>
          </CardContent>
        </Card>

        <ActivityFilterBar
          filters={activityFilters}
          onChange={setActivityFilters}
          attempts={perfectAttempts}
        />

        {Object.entries(groupedByZone).map(([zoneType, attempts]) => (
          <Card
            key={zoneType}
            className="border-[var(--border)] bg-[var(--bg-primary)]"
          >
            <CardHeader className="pb-2">
              <CardTitle>
                {zoneDisplayName(zoneType)} ({formatNumber(attempts.length)}{' '}
                hits)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ActivityTable rows={attempts} />
            </CardContent>
          </Card>
        ))}

        {filteredAttempts.length === 0 && (
          <div className="text-center py-12 text-[var(--text-secondary)]">
            No perfect hits recorded for this war
          </div>
        )}
      </div>
    </DataState>
  )
}
