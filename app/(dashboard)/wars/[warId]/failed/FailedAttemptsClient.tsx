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
import { zoneShortName } from '@/app/lib/war/war-naming'

const SUMMARY_SKELETON_KEYS = [
  'failed-attempts',
  'max-kills',
  'missed-score',
  'buff-tiers'
] as const

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {SUMMARY_SKELETON_KEYS.map((key) => (
        <Card
          key={key}
          className="border-[var(--border)] bg-[var(--bg-primary)]"
        >
          <CardContent className="p-5 space-y-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

const HISTOGRAM_SKELETON_KEYS = [
  'kill-histogram',
  'buff-breakdown',
  'zone-tally'
] as const
const HISTOGRAM_ROW_KEYS = [
  'row-1',
  'row-2',
  'row-3',
  'row-4',
  'row-5'
] as const

function HistogramSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {HISTOGRAM_SKELETON_KEYS.map((cardKey) => (
        <Card
          key={cardKey}
          className="border-[var(--border)] bg-[var(--bg-primary)]"
        >
          <CardHeader className="pb-2">
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="pt-4 space-y-2">
            {HISTOGRAM_ROW_KEYS.map((rowKey) => (
              <Skeleton key={`${cardKey}-${rowKey}`} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// Wider gutter: zone labels are words, not digits.
const renderHistogram = (
  entries: Array<[string, number]>,
  labelWidth = 'w-12'
) => {
  const max = Math.max(1, ...entries.map(([, count]) => count))
  return (
    <div className="space-y-2">
      {entries.map(([label, count]) => (
        <div key={label} className="flex items-center gap-3 text-sm">
          <div className={`${labelWidth} text-[var(--text-secondary)]`}>
            {label}
          </div>
          <div className="flex-1 h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-red-500/50 to-red-400/30"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <div className="w-10 text-right font-mono text-[var(--text-secondary)]">
            {count}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function FailedAttemptsClient({ warId }: { warId: string }) {
  const { data, isLoading, error } = useWarRecentActivity(warId, 'failed')
  const [activityFilters, setActivityFilters] =
    useState<ActivityFilters>(DEFAULT_FILTERS)

  const failedAttempts = data?.attempts ?? []
  const filteredAttempts = applyActivityFilters(failedAttempts, activityFilters)

  const killHistogram = filteredAttempts.reduce<Record<number, number>>(
    (acc, attempt) => {
      acc[attempt.kills] = (acc[attempt.kills] || 0) + 1
      return acc
    },
    {}
  )

  const buffBreakdown = filteredAttempts.reduce<Record<number, number>>(
    (acc, attempt) => {
      acc[attempt.buffLevel] = (acc[attempt.buffLevel] || 0) + 1
      return acc
    },
    {}
  )

  // By zone TYPE: legacy `zoneName` differs per sync.
  const zoneBreakdown = filteredAttempts.reduce<Record<string, number>>(
    (acc, attempt) => {
      acc[attempt.zoneType] = (acc[attempt.zoneType] || 0) + 1
      return acc
    },
    {}
  )

  const maxKills = Math.max(
    0,
    ...filteredAttempts.map((attempt) => attempt.kills)
  )
  const missedScore = filteredAttempts.length * 200

  return (
    <DataState
      error={error}
      isLoading={isLoading}
      errorUI={
        <div className="text-center py-8 text-red-400">
          Failed to load failed attempts data. Please try refreshing the page.
        </div>
      }
      skeleton={
        <div className="space-y-6">
          <SummarySkeleton />
          <HistogramSkeleton />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardContent className="p-5 space-y-1">
              <div className="text-xs text-[var(--text-tertiary)]">
                Failed attempts
              </div>
              <div className="text-2xl font-semibold text-red-400">
                {formatNumber(filteredAttempts.length)}
              </div>
            </CardContent>
          </Card>
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardContent className="p-5 space-y-1">
              <div className="text-xs text-[var(--text-tertiary)]">
                Max kills in failed
              </div>
              <div className="text-2xl font-semibold text-[var(--text-primary)]">
                {formatNumber(maxKills)}
              </div>
            </CardContent>
          </Card>
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardContent className="p-5 space-y-1">
              <div className="text-xs text-[var(--text-tertiary)]">
                Missed score
              </div>
              <div className="text-2xl font-semibold text-[var(--text-primary)]">
                {formatNumber(missedScore)}
              </div>
            </CardContent>
          </Card>
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardContent className="p-5 space-y-1">
              <div className="text-xs text-[var(--text-tertiary)]">
                Buff tiers affected
              </div>
              <div className="text-2xl font-semibold text-[var(--text-primary)]">
                {formatNumber(Object.keys(buffBreakdown).length)}
              </div>
            </CardContent>
          </Card>
        </div>

        <ActivityFilterBar
          filters={activityFilters}
          onChange={setActivityFilters}
          attempts={failedAttempts}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardHeader className="pb-2">
              <CardTitle>Kill Histogram</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {renderHistogram(
                Object.entries(killHistogram).map(([k, v]) => [k, v])
              )}
            </CardContent>
          </Card>
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardHeader className="pb-2">
              <CardTitle>Buff Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {renderHistogram(
                Object.entries(buffBreakdown).map(([k, v]) => [`Buff ${k}`, v])
              )}
            </CardContent>
          </Card>
          <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
            <CardHeader className="pb-2">
              <CardTitle>Zone Tally</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {renderHistogram(
                Object.entries(zoneBreakdown).map(([zoneType, count]) => [
                  zoneShortName(zoneType),
                  count
                ]),
                'w-20'
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
          <CardHeader className="pb-2">
            <CardTitle>Failed Attempts</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ActivityTable rows={filteredAttempts} />
          </CardContent>
        </Card>
      </div>
    </DataState>
  )
}
