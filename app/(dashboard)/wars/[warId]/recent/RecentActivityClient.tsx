'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button
} from '@tacticus/ui-kit'
import { RefreshCw } from 'lucide-react'
import type { RecentActivityFilter } from '../../_hooks'
import { useRecentActivity } from '../../_hooks'
import ActivityTable from '../../_components/ActivityTable'
import ActivityFilterBar, {
  DEFAULT_FILTERS,
  applyActivityFilters
} from '../../_components/ActivityFilterBar'
import type { ActivityFilters } from '../../_components/ActivityFilterBar'

const FILTER_LABELS: Record<RecentActivityFilter, string> = {
  all: 'All',
  guild: 'Our Attacks',
  opponent: 'Opponent',
  perfect: 'Perfect',
  failed: 'Failed'
}

const FILTER_OPTIONS: RecentActivityFilter[] = [
  'all',
  'guild',
  'opponent',
  'perfect',
  'failed'
]

export default function RecentActivityClient({ warId }: { warId: string }) {
  const [filter, setFilter] = useState<RecentActivityFilter>('all')
  const [activityFilters, setActivityFilters] =
    useState<ActivityFilters>(DEFAULT_FILTERS)

  const {
    data,
    isFetching,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useRecentActivity(warId, filter)

  const attempts = data?.pages.flatMap((p) => p.attempts) ?? []
  const filteredAttempts = applyActivityFilters(attempts, activityFilters)

  const [isLoadAllActive, setIsLoadAllActive] = useState(false)

  // A new war or filter abandons an in-progress load-all; reset at render so no effect sets state.
  const loadAllKey = `${warId}|${filter}`
  const [activeLoadAllKey, setActiveLoadAllKey] = useState(loadAllKey)
  if (loadAllKey !== activeLoadAllKey) {
    setActiveLoadAllKey(loadAllKey)
    setIsLoadAllActive(false)
  }

  // An active search fetches all pages so the filter covers the full set. fetchNextPage only fires
  // when idle, so pages cannot duplicate.
  const isSearchActive = activityFilters.playerSearch.trim().length > 0
  const shouldAutoLoad = isSearchActive || isLoadAllActive
  // Keeps the loop advancing when the isFetchingNextPage toggle collapses into one commit.
  const loadedPageCount = data?.pages.length ?? 0
  // Guards against a cursor that returns no rows forever.
  const drainExhausted = loadedPageCount >= 200
  // Drop the latch so a later refetch does not silently re-drain.
  if (isLoadAllActive && (!hasNextPage || drainExhausted)) {
    setIsLoadAllActive(false)
  }
  useEffect(() => {
    if (!shouldAutoLoad || error || !hasNextPage || drainExhausted) return
    if (!isFetchingNextPage) {
      fetchNextPage()
    }
  }, [
    drainExhausted,
    shouldAutoLoad,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    loadedPageCount
  ])

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">
          {error instanceof Error ? error.message : 'Failed to load activity'}
        </p>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <Card className="border-[var(--border)] bg-[var(--bg-primary)]">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-lg text-[var(--text-primary)] flex items-center gap-3">
            <span>Recent Activity</span>
            {attempts.length > 0 && (
              <span className="text-xs font-normal text-[var(--text-secondary)]">
                {attempts.length}
                {hasNextPage ? '+' : ''} entries
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-[var(--primary)] text-white'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw
                className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isFetching && attempts.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
          </div>
        ) : attempts.length === 0 ? (
          <div className="py-12 text-center text-[var(--text-secondary)]">
            No activity found for the selected filter.
          </div>
        ) : (
          <>
            <ActivityFilterBar
              filters={activityFilters}
              onChange={setActivityFilters}
              attempts={attempts}
            />
            <ActivityTable rows={filteredAttempts} />
            <div className="mt-4 flex items-center justify-center gap-4">
              <span className="text-xs text-[var(--text-tertiary)]">
                Showing {filteredAttempts.length}
                {!isSearchActive &&
                activityFilters.selectedZone === 'all' &&
                hasNextPage
                  ? '+'
                  : ''}{' '}
                entries
              </span>
              {hasNextPage && isSearchActive ? (
                <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Loading all entries to search…
                </span>
              ) : hasNextPage && isLoadAllActive ? (
                <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Loading all… {attempts.length} loaded
                </span>
              ) : hasNextPage ? (
                <>
                  <Button
                    onClick={() => fetchNextPage()}
                    variant="outline"
                    size="sm"
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? (
                      <>
                        <RefreshCw className="w-3 h-3 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      'Load 50 more'
                    )}
                  </Button>
                  <Button
                    onClick={() => setIsLoadAllActive(true)}
                    variant="outline"
                    size="sm"
                    disabled={isFetchingNextPage}
                  >
                    Load all
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
