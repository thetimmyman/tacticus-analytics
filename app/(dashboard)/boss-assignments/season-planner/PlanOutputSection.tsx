'use client'

import type { Dispatch, SetStateAction } from 'react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { DataTable, type DataTableColumn } from '@tacticus/ui-kit'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type {
  PlannedSession,
  PlannerResult
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import { summarizeSequenceBudget } from '@/app/lib/season-forecast/boss-feasibility-math'
import BossFeasibilityTable from '@/app/(dashboard)/boss-assignments/season-planner/BossFeasibilityTable'
import LoopsCard from '@/app/(dashboard)/boss-assignments/season-planner/LoopsCard'
import {
  IS_DEV,
  STAGE_TIMELINE_PAGE_SIZE,
  formatDateTime
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-format'
import type {
  GeneratedSeasonPlanPayload,
  LoopTimelineRow,
  PerPlayerTotalsRow,
  ScheduleWindow,
  StageTimelineRow
} from '@/app/(dashboard)/boss-assignments/season-planner/planner-types'

interface PlanOutputSectionProps {
  scheduleWindow: ScheduleWindow
  setScheduleWindow: Dispatch<SetStateAction<ScheduleWindow>>
  displayedPlan: GeneratedSeasonPlanPayload | null
  metrics: PlannerResult['metrics'] | null
  sequenceBudget: ReturnType<typeof summarizeSequenceBudget> | null
  warnings: PlannerResult['warnings']
  totalTokens: { spent: number; held: number }
  loopTimelineWindow: LoopTimelineRow[]
  stageTimelineWindow: StageTimelineRow[]
  visibleStageTimeline: StageTimelineRow[]
  stageTimelineTruncated: boolean
  showFullStageTimeline: boolean
  setShowFullStageTimeline: Dispatch<SetStateAction<boolean>>
  perPlayer: PerPlayerTotalsRow[]
  sessionsWindow: PlannedSession[]
  rosterNameById: Map<string, string>
  rawPlanJson: string | null
  showRaw: boolean
  timeZone: string
  hasMounted: boolean
  labelFor: (displayName: string | null | undefined) => string
}

export default function PlanOutputSection({
  scheduleWindow,
  setScheduleWindow,
  displayedPlan,
  metrics,
  sequenceBudget,
  warnings,
  totalTokens,
  loopTimelineWindow,
  stageTimelineWindow,
  visibleStageTimeline,
  stageTimelineTruncated,
  showFullStageTimeline,
  setShowFullStageTimeline,
  perPlayer,
  sessionsWindow,
  rosterNameById,
  rawPlanJson,
  showRaw,
  timeZone,
  hasMounted,
  labelFor
}: PlanOutputSectionProps) {
  const stageTimelineColumns: DataTableColumn<StageTimelineRow>[] = [
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
      key: 'stage',
      header: 'Stage',
      sortable: false,
      render: (row) => (
        <span className="text-primary-wh40k">{row.stageCode}</span>
      )
    },
    {
      key: 'loop',
      header: 'Loop',
      sortable: false,
      render: (row) => row.loopIndex
    },
    {
      key: 'boss',
      header: 'Boss',
      sortable: false,
      render: (row) => getBossDisplayName(row.bossName)
    },
    {
      key: 'tokens',
      header: 'Tokens',
      sortable: false,
      render: (row) => formatNumber(row.tokens)
    },
    {
      key: 'topAttackers',
      header: 'Top attackers',
      sortable: false,
      render: (row) =>
        row.players
          .slice(0, 3)
          .map((p) => `${labelFor(p.displayName)} (${p.tokens})`)
          .join(', ') || '-'
    }
  ]

  const perPlayerColumns: DataTableColumn<PerPlayerTotalsRow>[] = [
    {
      key: 'player',
      header: 'Player',
      sortable: false,
      render: (p) => (
        <span className="text-primary-wh40k">{labelFor(p.displayName)}</span>
      )
    },
    {
      key: 'sessions',
      header: 'Sessions',
      sortable: false,
      render: (p) => p.sessions
    },
    {
      key: 'spent',
      header: 'Spent',
      sortable: false,
      render: (p) => p.spent
    },
    {
      key: 'held',
      header: 'Held',
      sortable: false,
      render: (p) => p.held
    }
  ]

  const sessionColumns: DataTableColumn<PlannedSession>[] = [
    {
      key: 'at',
      header: 'At',
      sortable: false,
      render: (session) => formatDateTime(session.at, timeZone, hasMounted)
    },
    {
      key: 'player',
      header: 'Player',
      sortable: false,
      render: (session) => (
        <span className="text-primary-wh40k">
          {labelFor(
            (typeof session.playerDisplayName === 'string' &&
            session.playerDisplayName.trim().length > 0
              ? session.playerDisplayName
              : null) ||
              rosterNameById.get(session.playerId) ||
              'Unknown player'
          )}
        </span>
      )
    },
    {
      key: 'spent',
      header: 'Spent',
      sortable: false,
      render: (session) => session.tokensSpent
    },
    {
      key: 'held',
      header: 'Held',
      sortable: false,
      render: (session) => session.tokensHeld
    },
    {
      key: 'target',
      header: 'Target',
      sortable: false,
      render: (session) =>
        session.actions?.[0]?.bossName
          ? getBossDisplayName(session.actions[0].bossName)
          : '-'
    }
  ]

  return (
    <div className="rounded-lg border border-(--card-border) bg-(--card-bg) p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-primary-wh40k">
            Plan Output
          </h3>
          <p className="text-sm text-secondary-wh40k">
            Summary metrics + schedule preview across main and prime bosses.
          </p>
        </div>
        <label className="text-sm text-secondary-wh40k">
          Window{' '}
          <select
            value={scheduleWindow}
            onChange={(e) =>
              setScheduleWindow(e.target.value as typeof scheduleWindow)
            }
            className="ml-2 rounded-md border border-(--card-border) bg-(--card-bg) px-2 py-1 text-sm text-primary-wh40k"
          >
            <option value="24h">Next 24h</option>
            <option value="48h">Next 48h</option>
            <option value="7d">Next 7d</option>
            <option value="all">Full season</option>
          </select>
        </label>
      </div>

      {!displayedPlan && (
        <div className="text-sm text-secondary-wh40k">
          Generate a plan or load a saved plan to view output.
        </div>
      )}

      {displayedPlan && (
        <>
          <div className="rounded-lg border border-(--card-border) bg-card/40 p-4 text-sm text-secondary-wh40k">
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                  From
                </div>
                <div className="text-primary-wh40k">
                  {formatDateTime(
                    displayedPlan.snapshot_at,
                    timeZone,
                    hasMounted
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                  To
                </div>
                <div className="text-primary-wh40k">
                  {formatDateTime(
                    displayedPlan.season_end_at,
                    timeZone,
                    hasMounted
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                  Tokens (spent/held)
                </div>
                <div className="text-primary-wh40k">
                  {formatNumber(totalTokens.spent)} /{' '}
                  {formatNumber(totalTokens.held)}
                </div>
              </div>
              {metrics && (
                <>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                      Wasted
                    </div>
                    <div className="text-primary-wh40k">
                      {formatNumber(metrics.wastedTokens)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                      Bosses Defeated
                    </div>
                    <div className="text-primary-wh40k">
                      {formatNumber(metrics.bossesDefeated)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                      Loop Advances
                    </div>
                    <div className="text-primary-wh40k">
                      {formatNumber(metrics.loopAdvances)}
                    </div>
                  </div>
                </>
              )}
              {/* Officer budget vs model estimate; only when token targets exist. */}
              {sequenceBudget && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-secondary-wh40k">
                    Officer Budget
                  </div>
                  <div className="text-primary-wh40k">
                    {formatNumber(sequenceBudget.budgetTokens)}
                    {sequenceBudget.varianceTokens !== 0 && (
                      <span className="ml-1 text-xs text-secondary-wh40k">
                        · model est{' '}
                        {formatNumber(sequenceBudget.modelEstimateTokens)} (
                        {sequenceBudget.varianceTokens > 0 ? '+' : ''}
                        {formatNumber(sequenceBudget.varianceTokens)})
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {warnings?.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <div className="font-medium text-amber-100">Planner warnings</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {warnings.slice(0, 10).map((warning) => (
                  <li key={`warning-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {displayedPlan.remainingBossSequence &&
            displayedPlan.remainingBossSequence.length > 0 && (
              <BossFeasibilityTable
                sequence={displayedPlan.remainingBossSequence}
                tokensSpendable={displayedPlan.tokens_remaining_spendable}
              />
            )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LoopsCard
              loopTimelineWindow={loopTimelineWindow}
              scheduleWindow={scheduleWindow}
              timeZone={timeZone}
              hasMounted={hasMounted}
            />

            <div className="rounded-lg border border-(--card-border) bg-card/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-primary-wh40k">
                  Stage timeline ({scheduleWindow})
                </h4>
                {scheduleWindow === 'all' &&
                  stageTimelineWindow.length > STAGE_TIMELINE_PAGE_SIZE && (
                    <button
                      onClick={() => setShowFullStageTimeline((prev) => !prev)}
                      className="text-xs text-(--accent) hover:underline"
                    >
                      {showFullStageTimeline
                        ? 'Show less'
                        : `Show all (${formatNumber(stageTimelineWindow.length)})`}
                    </button>
                  )}
              </div>

              {visibleStageTimeline.length === 0 ? (
                <div className="mt-3 text-sm text-secondary-wh40k">
                  No stage progress in this window.
                </div>
              ) : (
                <div className="mt-3">
                  <DataTable
                    rows={visibleStageTimeline}
                    columns={stageTimelineColumns}
                    rowKey={(row) =>
                      `${row.loopIndex}:${row.stageCode}:${row.bossName}:${row.startAt}`
                    }
                    empty={<></>}
                  />
                  {stageTimelineTruncated && (
                    <div className="mt-2 text-xs text-secondary-wh40k">
                      Showing {formatNumber(visibleStageTimeline.length)} of{' '}
                      {formatNumber(stageTimelineWindow.length)} stage segments.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-(--card-border) bg-card/40 p-4">
              <h4 className="text-sm font-semibold text-primary-wh40k">
                Per-player totals
              </h4>
              <div className="mt-3">
                <DataTable
                  rows={perPlayer}
                  columns={perPlayerColumns}
                  rowKey={(p) => p.playerId}
                  empty={<></>}
                />
              </div>
            </div>

            <div className="rounded-lg border border-(--card-border) bg-card/40 p-4">
              <h4 className="text-sm font-semibold text-primary-wh40k">
                Sessions ({scheduleWindow})
              </h4>
              <div className="mt-3">
                <DataTable
                  rows={sessionsWindow}
                  columns={sessionColumns}
                  rowKey={(session) => `${session.at}-${session.playerId}`}
                  empty={<></>}
                />
              </div>
            </div>
          </div>

          {IS_DEV && showRaw && (
            <div className="rounded-lg border border-(--card-border) bg-(--card-bg) p-4">
              <pre className="text-xs text-secondary-wh40k whitespace-pre-wrap wrap-break-word">
                {rawPlanJson}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
